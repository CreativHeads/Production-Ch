import os
from datetime import timedelta

from django.http import FileResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from core import audit
from core.exceptions import Conflict
from core.models import SystemSetting
from core.permissions import CanManageBackups
from talent.filters import annotate_for_user, filter_talent
from talent.models import Talent

from . import services
from .models import ExportJob, ImportBatch, ImportRow


def batch_payload(b, rows=False, row_filter=None):
    data = {
        "id": b.id, "original_name": b.original_name, "status": b.status, "headers": b.headers, "mapping": b.mapping,
        "total_rows": b.total_rows, "summary": b.summary, "created_at": b.created_at, "completed_at": b.completed_at,
        "has_photos_zip": bool(b.photos_zip), "error": b.error,
        "fields": [{"key": k, "label": v[0]} for k, v in services.IMPORT_FIELDS.items()],
    }
    if rows:
        qs = b.rows.all()
        if row_filter == "errors":
            qs = qs.exclude(errors=[])
        elif row_filter == "duplicates":
            qs = qs.exclude(duplicates=[])
        elif row_filter == "staging":
            qs = qs.filter(action="staging")
        data["rows"] = [
            {"id": r.id, "row_number": r.row_number, "data": r.data, "raw": r.raw, "errors": r.errors, "warnings": r.warnings,
             "duplicates": r.duplicates, "action": r.action, "duplicate_acknowledged": r.duplicate_acknowledged,
             "result": r.result, "result_message": r.result_message, "talent": r.talent_id}
            for r in qs[:1000]
        ]
    return data


class ImportListView(APIView):
    def get(self, request):
        return Response([batch_payload(b) for b in ImportBatch.objects.all()[:50]])

    def post(self, request):
        f = request.FILES.get("file")
        if not f:
            raise ValidationError({"file": ["Choose a CSV or XLSX file."]})
        try:
            headers, data = services.read_table(f, f.name)
        except services.ImportFileError as e:
            raise ValidationError({"file": [str(e)]})
        z = request.FILES.get("photos_zip")
        if z and not z.name.lower().endswith(".zip"):
            raise ValidationError({"photos_zip": ["Photos must be uploaded as a .zip file."]})
        f.seek(0)
        batch = ImportBatch(created_by=request.user, original_name=f.name[:255], headers=headers, total_rows=len(data))
        batch.file.save(f.name, f, save=False)
        if z:
            batch.photos_zip.save(z.name, z, save=False)
        batch.mapping = services.auto_mapping(headers)
        batch.save()
        ImportRow.objects.bulk_create([ImportRow(batch=batch, row_number=i + 2, raw=row) for i, row in enumerate(data)])
        audit.log(request, "import.uploaded", entity_type="import", entity_id=str(batch.pk), label=batch.original_name, changes={"rows": len(data)})
        return Response(batch_payload(batch), status=201)


class ImportDetailView(APIView):
    def get(self, request, pk):
        b = get_object_or_404(ImportBatch, pk=pk)
        return Response(batch_payload(b, rows=True, row_filter=request.query_params.get("rows")))

    def delete(self, request, pk):
        b = get_object_or_404(ImportBatch, pk=pk)
        if b.status in ("importing", "completed"):
            raise Conflict("This import has already run and can't be cancelled.")
        b.status = "cancelled"
        b.save(update_fields=["status"])
        b.file.delete(save=False)
        if b.photos_zip:
            b.photos_zip.delete(save=False)
        return Response(status=204)


class ImportValidateView(APIView):
    """Apply field mapping and produce the validation + duplicate preview."""

    def post(self, request, pk):
        b = get_object_or_404(ImportBatch, pk=pk)
        if b.status not in ("uploaded", "mapped"):
            raise Conflict("This import can no longer be changed.")
        mapping = request.data.get("mapping") or b.mapping
        valid_keys = set(services.IMPORT_FIELDS)
        mapping = {h: k for h, k in mapping.items() if h in b.headers and k in valid_keys}
        used = [k for k in mapping.values()]
        dupes = {k for k in used if used.count(k) > 1}
        if dupes:
            raise ValidationError({"mapping": [f"Each field can only be mapped once: {', '.join(sorted(dupes))}"]})
        missing = [k for k in ("full_name", "phone", "city", "categories") if k not in used]
        if missing:
            labels = [services.IMPORT_FIELDS[k][0] for k in missing]
            raise ValidationError({"mapping": [f"Map these required fields: {', '.join(labels)}"]})
        services.validate_batch(b, mapping)
        return Response(batch_payload(b, rows=True))


class ImportRowView(APIView):
    """Per-row decision: action and explicit duplicate acknowledgement."""

    def patch(self, request, pk, row_id):
        row = get_object_or_404(ImportRow, pk=row_id, batch_id=pk)
        if row.batch.status != "mapped":
            raise Conflict("Validate the import before changing rows.")
        action = request.data.get("action")
        if action:
            if action not in dict(ImportRow.ACTION_CHOICES):
                raise ValidationError({"action": ["Unknown action."]})
            if action != "skip" and row.errors:
                raise ValidationError({"action": ["Fix the errors in the source file first; this row can only be skipped."]})
            if action == "create" and "photo_filename" not in row.data:
                raise ValidationError({"action": ["This row has no photo, so it can only go to import staging."]})
            row.action = action
        if "duplicate_acknowledged" in request.data:
            row.duplicate_acknowledged = bool(request.data["duplicate_acknowledged"])
        row.save(update_fields=["action", "duplicate_acknowledged"])
        return Response({"id": row.id, "action": row.action, "duplicate_acknowledged": row.duplicate_acknowledged})


class ImportConfirmView(APIView):
    def post(self, request, pk):
        b = get_object_or_404(ImportBatch, pk=pk)
        if b.status != "mapped":
            raise Conflict("Validate the import before confirming it.")
        summary = services.run_import(b, request.user, request)
        return Response(batch_payload(b, rows=True) | {"summary": summary})


# ---------------------------------------------------------------------------
# Exports
# ---------------------------------------------------------------------------
def export_payload(j):
    return {
        "id": j.id, "format": j.format, "filename": j.filename, "row_count": j.row_count, "created_at": j.created_at, "expires_at": j.expires_at,
        "is_expired": j.is_expired, "download_count": j.download_count, "params": j.params,
        "created_by": j.created_by.get_username() if j.created_by else None,
        "download_url": f"/api/exports/{j.id}/download/" if not j.is_expired else None,
    }


class ExportListView(APIView):
    def get(self, request):
        qs = ExportJob.objects.select_related("created_by")
        if not CanManageBackups().has_permission(request, self):
            qs = qs.exclude(format="backup")
        return Response([export_payload(j) for j in qs[:50]])

    def post(self, request):
        fmt = request.data.get("format", "xlsx")
        if fmt not in dict(ExportJob.FORMAT_CHOICES):
            raise ValidationError({"format": ["Choose CSV, XLSX or full backup."]})
        hours = SystemSetting.get().export_expiry_hours
        if fmt == "backup":
            if not CanManageBackups().has_permission(request, self):
                return Response({"detail": "Full backups are restricted to backup operators."}, status=403)
            job = ExportJob.objects.create(
                created_by=request.user, format="backup", params={"include_media": bool(request.data.get("include_media", True))},
                include_internal=True, expires_at=timezone.now() + timedelta(hours=hours),
            )
            services.build_backup(job, include_media=job.params["include_media"])
            audit.log(request, "export.backup_created", entity_type="export", entity_id=str(job.pk), label=job.filename, changes={"rows": job.row_count})
            return Response(export_payload(job), status=201)

        audience = request.data.get("audience", "internal")
        include = set()
        if audience == "internal":
            include = {g for g in ("contact", "fees", "internal") if request.data.get(f"include_{g}", g != "internal") in (True, "true", "1")}
        else:  # client-facing: never internal notes; contact/fees only if explicitly ticked
            include = {g for g in ("contact", "fees") if request.data.get(f"include_{g}") in (True, "true", "1")}
        filters = request.data.get("filters") or {}
        ids = request.data.get("ids") or []
        qs = annotate_for_user(Talent.objects.all(), request.user)
        if ids:
            qs = qs.filter(pk__in=ids).order_by("full_name")
        else:
            qs = filter_talent(qs, filters, request.user)
        job = ExportJob.objects.create(
            created_by=request.user, format=fmt, params={"filters": filters, "ids": ids, "audience": audience, "include": sorted(include)},
            include_internal="internal" in include, expires_at=timezone.now() + timedelta(hours=hours),
        )
        services.build_export(job, qs, include, request)
        audit.log(request, "export.created", entity_type="export", entity_id=str(job.pk), label=job.filename,
                  changes={"rows": job.row_count, "audience": audience, "include": sorted(include)})
        return Response(export_payload(job), status=201)


class ExportDownloadView(APIView):
    def get(self, request, pk):
        job = get_object_or_404(ExportJob, pk=pk)
        if job.format == "backup" and not CanManageBackups().has_permission(request, self):
            return Response({"detail": "Full backups are restricted to backup operators."}, status=403)
        if job.is_expired or not job.file:
            return Response({"detail": "This export link has expired. Create a new export."}, status=410)
        job.download_count += 1
        job.last_downloaded_at = timezone.now()
        job.save(update_fields=["download_count", "last_downloaded_at"])
        audit.log(request, "export.downloaded", entity_type="export", entity_id=str(job.pk), label=job.filename)
        resp = FileResponse(job.file.open("rb"), as_attachment=True, filename=job.filename)
        resp["Cache-Control"] = "no-store"
        return resp


class TemplateView(APIView):
    """A blank CSV with recommended headers."""

    def get(self, request):
        import csv
        import io

        from django.http import HttpResponse

        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow([v[0] for v in services.IMPORT_FIELDS.values()])
        w.writerow(["Anjali Menon", "", "+91 98470 12345", "", "", "", "@anjali.menon", "Kochi", "Ernakulam", "Kerala", "Female",
                    "14/02/1996", "", "24", "30", "", "162", "Actor, Model", "Corporate Look", "Classical dance", "Malayalam, English, Tamil",
                    "Experienced", "15000", "Per day", "State", "", "", "", "anjali.jpg", "https://youtu.be/xxxx", "", ""])
        resp = HttpResponse("﻿" + buf.getvalue(), content_type="text/csv")
        resp["Content-Disposition"] = 'attachment; filename="talent-import-template.csv"'
        return resp
