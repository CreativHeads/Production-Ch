from datetime import datetime, time, timedelta

from django.db import transaction
from django.db.models import Count, Prefetch, Q, Sum
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from core import audit
from core.exceptions import Conflict
from talent.models import Talent, TalentPhoto

from . import services
from .models import Availability, Booking, Project, Role, ShortlistEntry
from .serializers import (
    AvailabilitySerializer,
    BookingSerializer,
    ProjectSerializer,
    RoleSerializer,
    ShortlistEntrySerializer,
    ShortlistEventSerializer,
)

PROJECT_AUDIT = ["title", "client_name", "code", "status", "shoot_start", "shoot_end", "budget", "location"]


class ProjectViewSet(viewsets.ModelViewSet):
    serializer_class = ProjectSerializer

    def get_queryset(self):
        qs = Project.objects.annotate(
            role_count=Count("roles", distinct=True),
            positions_needed=Sum("roles__positions_needed", distinct=False),
        )
        p = self.request.query_params
        status = p.get("status")
        if status == "open":
            qs = qs.filter(status__in=Project.OPEN_STATUSES)
        elif status:
            qs = qs.filter(status__in=status.split(","))
        elif self.action == "list" and p.get("archived") != "include":
            qs = qs.exclude(status="archived")
        q = (p.get("q") or "").strip()
        if q:
            qs = qs.filter(Q(title__icontains=q) | Q(client_name__icontains=q) | Q(code__icontains=q) | Q(location__icontains=q))
        sort = p.get("sort", "-created_at")
        allowed = {"-created_at", "created_at", "title", "-title", "shoot_start", "-shoot_start", "status"}
        return qs.order_by(sort if sort in allowed else "-created_at")

    def perform_create(self, serializer):
        p = serializer.save(created_by=self.request.user, updated_by=self.request.user)
        audit.log(self.request, "project.created", p)

    def perform_update(self, serializer):
        before = audit.snapshot(serializer.instance, PROJECT_AUDIT)
        p = serializer.save(updated_by=self.request.user)
        changes = audit.diff(before, audit.snapshot(p, PROJECT_AUDIT))
        if changes:
            audit.log(self.request, "project.updated", p, changes=changes)

    def perform_destroy(self, instance):
        instance.soft_delete(self.request.user)
        audit.log(self.request, "project.deleted", instance)

    @action(detail=False, methods=["get"])
    def trash(self, request):
        qs = Project.all_objects.filter(deleted_at__isnull=False).order_by("-deleted_at")
        return Response([{"id": p.id, "code": p.code, "title": p.title, "deleted_at": p.deleted_at} for p in qs[:200]])

    @action(detail=False, methods=["post"], url_path=r"trash/(?P<pid>\d+)/restore")
    def restore(self, request, pid=None):
        p = get_object_or_404(Project.all_objects, pk=pid, deleted_at__isnull=False)
        p.restore()
        audit.log(request, "project.restored", p)
        return Response({"ok": True, "id": p.id})

    @action(detail=True, methods=["get"])
    def board(self, request, pk=None):
        """Everything needed for the project page in one call."""
        project = self.get_object()
        roles = (
            Role.objects.filter(project=project)
            .prefetch_related("languages", "categories", "tags", "skills")
            .annotate(
                shortlist_count=Count("shortlist", filter=Q(shortlist__is_removed=False), distinct=True),
                selected_count=Count("shortlist", filter=Q(shortlist__is_removed=False, shortlist__status="selected"), distinct=True),
            )
        )
        entries = (
            ShortlistEntry.objects.filter(role__project=project)
            .select_related("talent", "role")
            .prefetch_related(Prefetch("talent__photos", queryset=TalentPhoto.objects.filter(is_primary=True)), "bookings")
            .order_by("role_id", "is_removed", "priority")
        )
        bookings = Booking.objects.filter(project=project).select_related("talent", "role", "project", "override_by").prefetch_related(
            Prefetch("talent__photos", queryset=TalentPhoto.objects.filter(is_primary=True))
        )
        return Response(
            {
                "project": ProjectSerializer(project).data,
                "roles": RoleSerializer(roles, many=True).data,
                "shortlist": ShortlistEntrySerializer(entries, many=True).data,
                "bookings": BookingSerializer(bookings, many=True).data,
            }
        )

    @action(detail=True, methods=["get"])
    def history(self, request, pk=None):
        from core.models import AuditLog

        project = self.get_object()
        entries = AuditLog.objects.filter(entity_type="project", entity_id=str(project.pk))[:200]
        return Response([{"id": e.id, "at": e.created_at, "actor": e.actor_name, "action": e.action, "changes": e.changes, "message": e.message} for e in entries])


class RoleViewSet(viewsets.ModelViewSet):
    serializer_class = RoleSerializer
    pagination_class = None

    def get_queryset(self):
        qs = Role.objects.select_related("project").prefetch_related("languages", "categories", "tags", "skills")
        if self.request.query_params.get("project"):
            qs = qs.filter(project_id=self.request.query_params["project"])
        return qs

    def perform_create(self, serializer):
        r = serializer.save(created_by=self.request.user, updated_by=self.request.user)
        audit.log(self.request, "project.role_added", r.project, message=r.name)

    def perform_update(self, serializer):
        r = serializer.save(updated_by=self.request.user)
        audit.log(self.request, "project.role_updated", r.project, message=r.name)

    def destroy(self, request, *args, **kwargs):
        role = self.get_object()
        if role.bookings.exists():
            raise Conflict("This role has bookings, so it can't be deleted. Cancel the bookings or keep the role.", code="role_has_bookings")
        if role.shortlist.exists():
            raise Conflict("This role has a shortlist history. Remove it only after clearing candidates, or rename the role instead.", code="role_has_shortlist")
        audit.log(request, "project.role_removed", role.project, message=role.name)
        role.delete()
        return Response(status=204)

    @action(detail=True, methods=["get"], url_path="search-filters")
    def search_filters(self, request, pk=None):
        """FR-013: role requirements as pre-filled directory filters."""
        r = self.get_object()
        f = {}
        if r.gender_preference and r.gender_preference != "any":
            f["gender"] = r.gender_preference
        if r.age_min is not None:
            f["age_min"] = r.age_min
        if r.age_max is not None:
            f["age_max"] = r.age_max
        for key, rel in (("category", r.categories), ("tag", r.tags), ("skill", r.skills), ("language", r.languages)):
            ids = [str(t.id) for t in rel.all()]
            if ids:
                f[key] = ",".join(ids)
        if r.accent_requirements:
            f["accent"] = r.accent_requirements
        if r.travel_requirement:
            f["travel_min"] = r.travel_requirement
        if r.shoot_start:
            f["available_on"] = r.shoot_start.isoformat()
        if r.budget is not None:
            f["fee_max"] = str(r.budget)
        return Response({"filters": f, "role": {"id": r.id, "name": r.name, "project": r.project.title, "project_id": r.project_id}})


class ShortlistViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.UpdateModelMixin, viewsets.GenericViewSet):
    """FR-014. Entries are never hard-deleted."""

    serializer_class = ShortlistEntrySerializer
    pagination_class = None

    def get_queryset(self):
        qs = ShortlistEntry.objects.select_related("talent", "role").prefetch_related(
            Prefetch("talent__photos", queryset=TalentPhoto.objects.filter(is_primary=True)), "bookings"
        )
        p = self.request.query_params
        if p.get("role"):
            qs = qs.filter(role_id=p["role"])
        if p.get("project"):
            qs = qs.filter(role__project_id=p["project"])
        if p.get("talent"):
            qs = qs.filter(talent_id=p["talent"])
        if p.get("include_removed") != "1":
            qs = qs.filter(is_removed=False)
        return qs

    @action(detail=False, methods=["post"])
    def add(self, request):
        role = get_object_or_404(Role, pk=request.data.get("role"))
        ids = request.data.get("talent_ids") or ([request.data.get("talent")] if request.data.get("talent") else [])
        results, errors = [], []
        for tid in ids:
            talent = Talent.objects.filter(pk=tid).first()
            if not talent:
                errors.append({"talent": tid, "detail": "Talent not found."})
                continue
            try:
                entry, created = services.add_to_shortlist(role, talent, request.user, notes=request.data.get("notes", ""))
                results.append({"id": entry.id, "talent": talent.id, "created": created})
                audit.log(request, "shortlist.added", talent, message=f"{role.project.title} — {role.name}")
                audit.log(request, "project.shortlist_added", role.project, message=f"{talent.full_name} → {role.name}")
            except Conflict as e:
                errors.append({"talent": tid, "name": talent.full_name, "detail": str(e.detail)})
        return Response({"added": results, "errors": errors}, status=201 if results else 400)

    def perform_update(self, serializer):
        entry = serializer.instance
        before = {f: getattr(entry, f) for f in ("status", "priority", "proposed_fee", "availability_confirmed", "notes")}
        data = serializer.validated_data
        if data.get("availability_confirmed") and not entry.availability_confirmed:
            serializer.validated_data["availability_confirmed_at"] = timezone.now()
        if "availability_confirmed" in data and not data["availability_confirmed"]:
            serializer.validated_data["availability_confirmed_at"] = None
        entry = serializer.save(updated_by=self.request.user)
        u = self.request.user
        note = self.request.data.get("event_note", "")
        if before["status"] != entry.status:
            services.record_event(entry, "status", u, before["status"], entry.status, note)
            audit.log(self.request, "shortlist.status", entry.talent, changes={"status": [before["status"], entry.status]}, message=f"{entry.role.project.title} — {entry.role.name}")
        if before["proposed_fee"] != entry.proposed_fee:
            services.record_event(entry, "fee", u, before["proposed_fee"], entry.proposed_fee)
        if before["availability_confirmed"] != entry.availability_confirmed:
            services.record_event(entry, "availability", u, before["availability_confirmed"], entry.availability_confirmed, entry.availability_notes)
        if before["notes"] != entry.notes:
            services.record_event(entry, "note", u, note=entry.notes)

    @action(detail=True, methods=["post"])
    def remove(self, request, pk=None):
        entry = self.get_object() if self.get_queryset().filter(pk=pk).exists() else get_object_or_404(ShortlistEntry, pk=pk)
        entry.is_removed = True
        entry.removed_at = timezone.now()
        entry.removed_reason = (request.data.get("reason") or "")[:255]
        entry.updated_by = request.user
        entry.save()
        services.record_event(entry, "removed", request.user, note=entry.removed_reason)
        return Response(ShortlistEntrySerializer(entry).data)

    @action(detail=True, methods=["post"])
    def restore(self, request, pk=None):
        entry = get_object_or_404(ShortlistEntry, pk=pk)
        entry.is_removed = False
        entry.removed_at = None
        entry.updated_by = request.user
        entry.save()
        services.record_event(entry, "restored", request.user)
        return Response(ShortlistEntrySerializer(entry).data)

    @action(detail=False, methods=["post"])
    @transaction.atomic
    def reorder(self, request):
        role = get_object_or_404(Role, pk=request.data.get("role"))
        order = [int(i) for i in request.data.get("order") or []]
        entries = {e.id: e for e in ShortlistEntry.objects.filter(role=role, pk__in=order)}
        for i, eid in enumerate(order, start=1):
            e = entries.get(eid)
            if e and e.priority != i:
                services.record_event(e, "priority", request.user, e.priority, i)
                e.priority = i
                e.save(update_fields=["priority", "updated_at"])
        return Response({"ok": True})

    @action(detail=True, methods=["get"])
    def history(self, request, pk=None):
        entry = get_object_or_404(ShortlistEntry, pk=pk)
        return Response(ShortlistEventSerializer(entry.events.select_related("actor"), many=True).data)


def _parse_range(params):
    start = parse_datetime(params.get("start") or "") or None
    end = parse_datetime(params.get("end") or "") or None
    tz = timezone.get_current_timezone()
    if not start and parse_date(params.get("start") or ""):
        start = timezone.make_aware(datetime.combine(parse_date(params["start"]), time.min), tz)
    if not end and parse_date(params.get("end") or ""):
        end = timezone.make_aware(datetime.combine(parse_date(params["end"]), time.min), tz) + timedelta(days=1)
    return start, end


class AvailabilityViewSet(viewsets.ModelViewSet):
    """FR-015 availability entries (separate from shortlist status)."""

    serializer_class = AvailabilitySerializer
    pagination_class = None

    def get_queryset(self):
        qs = Availability.objects.select_related("talent")
        p = self.request.query_params
        if p.get("talent"):
            qs = qs.filter(talent_id=p["talent"])
        start, end = _parse_range(p)
        if start:
            qs = qs.filter(end__gt=start)
        if end:
            qs = qs.filter(start__lt=end)
        return qs.order_by("start")

    def _warnings(self, obj):
        others = services.overlapping(Availability.objects.filter(talent=obj.talent).exclude(pk=obj.pk), obj.start, obj.end)
        return [{"id": a.id, "kind": a.kind, "label": a.get_kind_display(), "start": a.start, "end": a.end} for a in others]

    def create(self, request, *args, **kwargs):
        ser = self.get_serializer(data=request.data)
        ser.is_valid(raise_exception=True)
        obj = ser.save(created_by=request.user, updated_by=request.user)
        if obj.source and not obj.confirmed_at:
            obj.confirmed_at = timezone.now()
            obj.save(update_fields=["confirmed_at"])
        audit.log(request, "talent.availability_added", obj.talent, message=f"{obj.get_kind_display()} {obj.start:%d %b} – {obj.end:%d %b}")
        data = AvailabilitySerializer(obj).data
        data["overlaps"] = self._warnings(obj)
        return Response(data, status=201)

    def perform_update(self, serializer):
        if serializer.instance.booking_id:
            raise Conflict("This entry mirrors a booking. Change the booking instead.", code="booking_managed")
        obj = serializer.save(updated_by=self.request.user)
        audit.log(self.request, "talent.availability_updated", obj.talent)

    def perform_destroy(self, instance):
        if instance.booking_id:
            raise Conflict("This entry mirrors a booking. Cancel the booking instead.", code="booking_managed")
        audit.log(self.request, "talent.availability_removed", instance.talent)
        instance.delete()


class BookingViewSet(viewsets.ModelViewSet):
    serializer_class = BookingSerializer

    def get_queryset(self):
        qs = Booking.objects.select_related("talent", "role", "project", "override_by").prefetch_related(
            Prefetch("talent__photos", queryset=TalentPhoto.objects.filter(is_primary=True))
        )
        p = self.request.query_params
        if p.get("project"):
            qs = qs.filter(project_id=p["project"])
        if p.get("talent"):
            qs = qs.filter(talent_id=p["talent"])
        if p.get("status"):
            qs = qs.filter(status__in=p["status"].split(","))
        if p.get("upcoming") == "1":
            qs = qs.filter(shoot_end__gte=timezone.now()).exclude(status="cancelled").order_by("shoot_start")
        start, end = _parse_range(p)
        if start:
            qs = qs.filter(shoot_end__gt=start)
        if end:
            qs = qs.filter(shoot_start__lt=end)
        return qs

    def _flags(self, request):
        d = request.data
        truthy = lambda v: v in (True, "true", "1", 1)  # noqa: E731
        return {
            "override": truthy(d.get("override")),
            "override_reason": d.get("override_reason", "") or "",
            "acknowledge_warnings": truthy(d.get("acknowledge_warnings")),
        }

    def create(self, request, *args, **kwargs):
        ser = self.get_serializer(data=request.data)
        ser.is_valid(raise_exception=True)
        role = ser.validated_data["role"]
        booking = Booking(**ser.validated_data, project=role.project)
        if booking.proposed_fee is None:
            entry = booking.shortlist_entry or ShortlistEntry.objects.filter(role=role, talent=booking.talent).first()
            booking.shortlist_entry = entry
            booking.proposed_fee = entry.proposed_fee if entry and entry.proposed_fee is not None else booking.talent.expected_fee
        if not booking.fee_basis:
            booking.fee_basis = booking.talent.fee_type or role.fee_basis
        booking, warnings = services.save_booking(booking, request.user, request, is_new=True, **self._flags(request))
        audit.log(request, "booking.created", booking.talent, message=f"{booking.project.title} — {booking.role.name} ({booking.get_status_display()})")
        audit.log(request, "project.booking_created", booking.project, message=f"{booking.talent.full_name} as {booking.role.name}")
        if booking.shortlist_entry and booking.status == "confirmed" and booking.shortlist_entry.status != "selected":
            prev = booking.shortlist_entry.status
            booking.shortlist_entry.status = "selected"
            booking.shortlist_entry.save(update_fields=["status", "updated_at"])
            services.record_event(booking.shortlist_entry, "status", request.user, prev, "selected", "Booked")
        data = BookingSerializer(booking).data
        data["warnings"] = warnings
        return Response(data, status=201)

    def update(self, request, *args, **kwargs):
        partial = kwargs.pop("partial", True)
        booking = self.get_object()
        before = audit.snapshot(booking, ["status", "shoot_start", "shoot_end", "agreed_fee", "proposed_fee", "outcome", "travel_charges", "accommodation_charges"])
        ser = self.get_serializer(booking, data=request.data, partial=partial)
        ser.is_valid(raise_exception=True)
        for k, v in ser.validated_data.items():
            setattr(booking, k, v)
        booking, warnings = services.save_booking(booking, request.user, request, **self._flags(request))
        changes = audit.diff(before, audit.snapshot(booking, list(before)))
        if changes:
            audit.log(request, "booking.updated", booking.talent, changes=changes, message=f"{booking.project.title} — {booking.role.name}")
        data = BookingSerializer(booking).data
        data["warnings"] = warnings
        return Response(data)

    def destroy(self, request, *args, **kwargs):
        booking = self.get_object()
        booking.status = "cancelled"
        if booking.outcome == "pending":
            booking.outcome = request.data.get("outcome") if request.data.get("outcome") in dict(Booking.OUTCOME_CHOICES) else "cancelled_client"
        booking.updated_by = request.user
        booking.save()
        services.sync_availability(booking, request.user)
        audit.log(request, "booking.cancelled", booking.talent, message=f"{booking.project.title} — {booking.role.name}")
        return Response(BookingSerializer(booking).data)

    @action(detail=False, methods=["post"], url_path="check-conflicts")
    def check_conflicts(self, request):
        talent = get_object_or_404(Talent, pk=request.data.get("talent"))
        start = parse_datetime(request.data.get("shoot_start") or "")
        end = parse_datetime(request.data.get("shoot_end") or "")
        if not start or not end:
            raise ValidationError({"shoot_start": ["Give a start and end date/time."]})
        if timezone.is_naive(start):
            start = timezone.make_aware(start)
        if timezone.is_naive(end):
            end = timezone.make_aware(end)
        blocking, warnings = services.find_conflicts(talent, start, end, request.data.get("exclude"))
        from talent.services import booking_blockers

        return Response({"conflicts": blocking, "warnings": warnings, "blockers": booking_blockers(talent)})
