import json
import mimetypes
import os
from datetime import timedelta

from django.conf import settings
from django.db.models import Q
from django.http import FileResponse, Http404, HttpResponse, HttpResponseForbidden
from django.utils import timezone
from django.views.decorators.http import require_GET
from rest_framework import serializers
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response
from rest_framework.views import APIView

from . import audit
from .models import COMPLETENESS_LABELS, AuditLog, SystemSetting
from .permissions import CanManageBackups


# ---------------------------------------------------------------------------
# Protected media (FR-001: every media file requires authentication)
# ---------------------------------------------------------------------------
@require_GET
def protected_media(request, path):
    if not (request.user.is_authenticated and request.user.is_active):
        return HttpResponseForbidden("Sign in to view this file.")
    root = os.path.realpath(settings.MEDIA_ROOT)
    full = os.path.realpath(os.path.join(root, path))
    if not full.startswith(root + os.sep) or not os.path.isfile(full):
        raise Http404
    # Masters and consent evidence are more sensitive: log access
    if "/master/" in path or "/consent/" in path:
        audit.log(request, "media.sensitive_viewed", entity_type="file", entity_id=path[:64], label=path[:255])
    if settings.PROTECTED_MEDIA_ACCEL_PREFIX:
        resp = HttpResponse()
        resp["X-Accel-Redirect"] = settings.PROTECTED_MEDIA_ACCEL_PREFIX.rstrip("/") + "/" + path
        resp["Content-Type"] = mimetypes.guess_type(full)[0] or "application/octet-stream"
    else:
        resp = FileResponse(open(full, "rb"))
    resp["Cache-Control"] = "private, max-age=3600"
    resp["X-Content-Type-Options"] = "nosniff"
    return resp


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------
class SystemSettingSerializer(serializers.ModelSerializer):
    class Meta:
        model = SystemSetting
        fields = [
            "session_idle_hours", "review_interval_days", "contact_review_interval_days", "export_expiry_hours", "completeness_fields",
            "require_consent_for_all", "default_currency", "default_country_code", "whatsapp_template", "updated_at",
        ]

    def validate_completeness_fields(self, v):
        bad = [f for f in v if f not in COMPLETENESS_LABELS]
        if bad:
            raise serializers.ValidationError(f"Unknown checklist fields: {', '.join(bad)}")
        if not v:
            raise serializers.ValidationError("Keep at least one checklist field.")
        return v

    def validate_session_idle_hours(self, v):
        if v < 0.25 or v > 72:
            raise serializers.ValidationError("Choose between 15 minutes and 72 hours.")
        return v


class SettingsView(APIView):
    def get(self, request):
        data = SystemSettingSerializer(SystemSetting.get()).data
        data["completeness_options"] = [{"key": k, "label": v} for k, v in COMPLETENESS_LABELS.items()]
        return Response(data)

    def patch(self, request):
        obj = SystemSetting.objects.get_or_create(pk=1)[0]
        before = SystemSettingSerializer(obj).data
        ser = SystemSettingSerializer(obj, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        ser.save()
        after = SystemSettingSerializer(obj).data
        changes = {k: [before[k], after[k]] for k in after if before.get(k) != after[k] and k != "updated_at"}
        audit.log(request, "settings.updated", entity_type="settings", entity_id="1", label="System settings", changes=changes)
        if "completeness_fields" in changes or "require_consent_for_all" in changes:
            from talent.models import Talent
            from talent.services import refresh_completeness

            for t in Talent.objects.all().iterator(chunk_size=200):
                refresh_completeness(t)
        return self.get(request)


# ---------------------------------------------------------------------------
# Audit log
# ---------------------------------------------------------------------------
class AuditListView(APIView):
    def get(self, request):
        from .pagination import StandardPagination

        qs = AuditLog.objects.all()
        p = request.query_params
        if p.get("action"):
            qs = qs.filter(action__startswith=p["action"])
        if p.get("entity_type"):
            qs = qs.filter(entity_type=p["entity_type"])
        if p.get("entity_id"):
            qs = qs.filter(entity_id=p["entity_id"])
        if p.get("actor"):
            qs = qs.filter(actor_name__iexact=p["actor"])
        if p.get("q"):
            qs = qs.filter(Q(entity_label__icontains=p["q"]) | Q(message__icontains=p["q"]) | Q(action__icontains=p["q"]))
        pager = StandardPagination()
        page = pager.paginate_queryset(qs, request)
        rows = [
            {"id": e.id, "at": e.created_at, "actor": e.actor_name or "system", "action": e.action, "entity_type": e.entity_type,
             "entity_id": e.entity_id, "label": e.entity_label, "changes": e.changes, "message": e.message, "ip": e.ip_address}
            for e in page
        ]
        return pager.get_paginated_response(rows)


# ---------------------------------------------------------------------------
# Dashboard (FR-002)
# ---------------------------------------------------------------------------
class DashboardView(APIView):
    def get(self, request):
        from casting.models import Booking, Project, ShortlistEvent
        from talent.models import Favorite, Talent
        from talent.reminders import reminder_counts
        from talent.serializers import TalentListSerializer
        from talent.filters import annotate_for_user

        live = Talent.objects.filter(is_archived=False).exclude(status=Talent.STATUS_STAGING)
        now = timezone.now()
        upcoming = (
            Booking.objects.filter(shoot_end__gte=now, status__in=["confirmed", "tentative"])
            .select_related("talent", "project", "role")
            .order_by("shoot_start")
        )
        recent_qs = annotate_for_user(live.prefetch_related("categories", "tags", "photos", "languages__language"), request.user).order_by("-created_at")[:8]
        fav_qs = annotate_for_user(
            live.filter(favorited_by__user=request.user).prefetch_related("categories", "tags", "photos", "languages__language"), request.user
        ).order_by("full_name")[:8]
        reminders = reminder_counts()
        from talent.reminders import apply_reminder, base_queryset

        review_ids = set()
        for r in reminders:
            if r["key"] != "incomplete" and r["count"]:
                review_ids.update(apply_reminder(base_queryset(), r["key"]).values_list("pk", flat=True))

        activity = AuditLog.objects.filter(
            Q(action__startswith="shortlist.") | Q(action__startswith="booking.") | Q(action__startswith="project.")
            | Q(action="talent.created") | Q(action="talent.note_added")
        )[:15]
        return Response(
            {
                "metrics": {
                    "active_talent": {"count": live.count(), "link": "/talent"},
                    "needs_completion": {"count": live.filter(completeness__lt=100).count(), "link": "/talent?completeness=incomplete"},
                    "upcoming_bookings": {"count": upcoming.count(), "link": "/bookings?upcoming=1"},
                    "open_projects": {"count": Project.objects.filter(status__in=Project.OPEN_STATUSES).count(), "link": "/projects?status=open"},
                    "recently_added": {"count": live.filter(created_at__gte=now - timedelta(days=30)).count(), "link": f"/talent?sort=newest&added_after={(timezone.localdate() - timedelta(days=30)).isoformat()}"},
                    "favorites": {"count": Favorite.objects.filter(user=request.user, talent__in=live).count(), "link": "/talent?favorite=1"},
                    "requiring_review": {"count": len(review_ids), "link": "/reminders"},
                    "staging": {"count": Talent.objects.filter(status=Talent.STATUS_STAGING, is_archived=False).count(), "link": "/talent?status=staging"},
                },
                "reminders": reminders,
                "upcoming_bookings": [
                    {"id": b.id, "talent": b.talent.full_name, "talent_id": b.talent_id, "project": b.project.title, "project_id": b.project_id,
                     "role": b.role.name, "status": b.status, "shoot_start": b.shoot_start, "shoot_end": b.shoot_end}
                    for b in upcoming[:8]
                ],
                "recent_talent": TalentListSerializer(recent_qs, many=True).data,
                "favorites": TalentListSerializer(fav_qs, many=True).data,
                "activity": [
                    {"id": e.id, "at": e.created_at, "actor": e.actor_name or "system", "action": e.action, "label": e.entity_label,
                     "entity_type": e.entity_type, "entity_id": e.entity_id, "message": e.message}
                    for e in activity
                ],
            }
        )


class RemindersView(APIView):
    def get(self, request):
        from talent.reminders import reminder_counts
        from talent.models import ContactNote, RetentionReview
        from talent.serializers import ContactNoteSerializer, RetentionReviewSerializer

        due = ContactNote.objects.filter(follow_up_on__lte=timezone.localdate(), follow_up_done=False).select_related("talent", "staff", "project")[:50]
        reviews = RetentionReview.objects.filter(status="open").select_related("talent")[:50]
        return Response(
            {
                "counts": reminder_counts(),
                "follow_ups": ContactNoteSerializer(due, many=True).data,
                "retention_reviews": RetentionReviewSerializer(reviews, many=True).data,
                "intervals": {
                    "rates_days": SystemSetting.get().review_interval_days,
                    "contact_days": SystemSetting.get().contact_review_interval_days,
                },
            }
        )


# ---------------------------------------------------------------------------
# Choices for the frontend
# ---------------------------------------------------------------------------
class MetaView(APIView):
    def get(self, request):
        from casting.models import Availability, Booking, Project, Role, ShortlistEntry, FEE_BASIS_CHOICES
        from talent.models import Consent, ContactNote, FeaturedVideo, Talent, TalentLanguage
        from talent.reminders import REMINDERS

        c = lambda choices: [{"value": v, "label": l} for v, l in choices]  # noqa: E731
        s = SystemSetting.get()
        return Response(
            {
                "gender": c(Talent.GENDER_CHOICES),
                "experience": c(Talent.EXPERIENCE_CHOICES),
                "fee_type": c(Talent.FEE_TYPE_CHOICES),
                "travel": c(Talent.TRAVEL_CHOICES),
                "fluency": c(TalentLanguage.FLUENCY_CHOICES),
                "video_platform": c(FeaturedVideo.PLATFORM_CHOICES),
                "note_kind": c(ContactNote.KIND_CHOICES),
                "note_result": c(ContactNote.RESULT_CHOICES),
                "consent_type": c(Consent.TYPE_CHOICES),
                "consent_status": c(Consent.STATUS_CHOICES),
                "consent_method": c(Consent.METHOD_CHOICES),
                "project_status": c(Project.STATUS_CHOICES),
                "production_type": c(Project.PRODUCTION_TYPES),
                "role_gender": c(Role.GENDER_CHOICES),
                "shortlist_status": c(ShortlistEntry.STATUS_CHOICES),
                "availability_type": c(Availability.TYPE_CHOICES),
                "availability_source": c(Availability.SOURCE_CHOICES),
                "booking_status": c(Booking.STATUS_CHOICES),
                "booking_outcome": c(Booking.OUTCOME_CHOICES),
                "fee_basis": c(FEE_BASIS_CHOICES),
                "reminders": c(REMINDERS),
                "whatsapp_template": s.whatsapp_template,
                "default_currency": s.default_currency,
                "default_country_code": s.default_country_code,
            }
        )


# ---------------------------------------------------------------------------
# Backups (FR-022) — status only; backup files never pass through the app
# ---------------------------------------------------------------------------
class BackupStatusView(APIView):
    permission_classes = [CanManageBackups]

    def get(self, request):
        path = settings.BACKUP_STATUS_FILE
        status = {"configured": False}
        if path.exists():
            try:
                status = json.loads(path.read_text())
                status["configured"] = True
            except ValueError:
                status = {"configured": True, "error": "Backup status file is unreadable."}
        last_ok = status.get("last_success_at")
        stale = True
        if last_ok:
            from django.utils.dateparse import parse_datetime

            dt = parse_datetime(last_ok)
            stale = not dt or (timezone.now() - dt) > timedelta(hours=26)
        status["healthy"] = bool(last_ok) and not stale and status.get("last_result") == "success"
        audit.log(request, "backup.status_viewed", entity_type="backup", label="Backup status")
        return Response(status)


@api_view(["GET"])
@permission_classes([])
def health(request):
    from django.db import connection

    try:
        connection.ensure_connection()
        return Response({"ok": True})
    except Exception:
        return Response({"ok": False}, status=503)
