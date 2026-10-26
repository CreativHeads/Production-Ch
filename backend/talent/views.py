import json

from django.db import transaction
from django.db.models import Count, Prefetch, Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from core import audit
from core.exceptions import Conflict
from core.models import AuditLog

from . import services
from .filters import annotate_for_user, filter_talent
from .models import (
    Consent,
    ContactNote,
    Favorite,
    FeaturedVideo,
    Guardian,
    PortfolioLink,
    RetentionReview,
    Talent,
    TalentLanguage,
    TalentPhoto,
    Term,
)
from .reminders import reminder_counts, reminders_for
from .serializers import (
    AUDITED_FIELDS,
    ConsentSerializer,
    ContactNoteSerializer,
    GuardianSerializer,
    PhotoSerializer,
    PortfolioLinkSerializer,
    RetentionReviewSerializer,
    TalentDetailSerializer,
    TalentListSerializer,
    TalentWriteSerializer,
    TermSerializer,
    VideoSerializer,
)


def duplicate_payload(matches):
    return [
        {
            "id": m["talent"].id,
            "cast_id": m["talent"].cast_id,
            "full_name": m["talent"].full_name,
            "city": m["talent"].city,
            "phone": m["talent"].phone,
            "is_archived": m["talent"].is_archived,
            "is_deleted": bool(m["talent"].deleted_at),
            "photo": (lambda p: p.thumb.name and f"/media/{p.thumb.name}" if p else None)(m["talent"].photos.filter(is_primary=True).first()),
            "strength": m["strength"],
            "reasons": m["reasons"],
        }
        for m in matches
    ]


def check_duplicates_or_raise(data, acknowledged, exclude_id=None):
    """FR-021. Any match must be explicitly acknowledged (by id) before saving."""
    matches = services.find_duplicates(
        full_name=data.get("full_name", ""),
        phone=data.get("phone", ""),
        alt_phone=data.get("alt_phone", ""),
        instagram=data.get("instagram", ""),
        city=data.get("city", ""),
        age=data.get("approx_age"),
        exclude_id=exclude_id,
    )
    ack = {int(a) for a in (acknowledged or []) if str(a).isdigit()}
    unacked = [m for m in matches if m["talent"].id not in ack]
    if unacked:
        exact = any(m["strength"] == "exact" for m in unacked)
        raise Conflict(
            "This phone number already belongs to another profile." if exact else "This looks like it may already be in the database.",
            code="duplicate",
            extra={"duplicates": duplicate_payload(matches), "has_exact": exact},
        )
    return matches


def _parse_list(val):
    if val is None:
        return []
    if isinstance(val, list):
        return val
    try:
        parsed = json.loads(val)
        return parsed if isinstance(parsed, list) else [parsed]
    except (TypeError, ValueError):
        return [v for v in str(val).split(",") if v]


class TermViewSet(viewsets.ModelViewSet):
    serializer_class = TermSerializer
    pagination_class = None

    def get_queryset(self):
        qs = Term.objects.select_related("merged_into")
        kind = self.request.query_params.get("kind")
        if kind:
            qs = qs.filter(kind=kind)
        if self.request.query_params.get("archived") != "include":
            qs = qs.filter(is_archived=False)
        if self.request.query_params.get("usage") == "1":
            qs = qs.annotate(
                usage=Count("talent_in_category", distinct=True)
                + Count("talent_with_tag", distinct=True)
                + Count("talent_with_skill", distinct=True)
                + Count("talent_languages", distinct=True)
            )
        return qs

    def perform_create(self, serializer):
        t = serializer.save(created_by=self.request.user, updated_by=self.request.user)
        audit.log(self.request, f"{t.kind}.created", t)

    def perform_update(self, serializer):
        before = audit.snapshot(serializer.instance, ["name", "is_archived"])
        t = serializer.save(updated_by=self.request.user)
        changes = audit.diff(before, audit.snapshot(t, ["name", "is_archived"]))
        if changes:
            audit.log(self.request, f"{t.kind}.updated", t, changes=changes)

    def destroy(self, request, *args, **kwargs):
        term = self.get_object()
        term.is_archived = True
        term.save(update_fields=["is_archived", "updated_at"])
        audit.log(request, f"{term.kind}.archived", term)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["post"])
    @transaction.atomic
    def merge(self, request, pk=None):
        """Move every relationship from this term into `into`, then archive it."""
        source = self.get_object()
        target = get_object_or_404(Term, pk=request.data.get("into"), kind=source.kind)
        if target == source:
            raise ValidationError({"into": ["Choose a different term to merge into."]})
        rel = {"category": "talent_in_category", "tag": "talent_with_tag", "skill": "talent_with_skill"}.get(source.kind)
        moved = 0
        if rel:
            field = {"category": "categories", "tag": "tags", "skill": "skills"}[source.kind]
            for talent in getattr(source, rel).all():
                getattr(talent, field).add(target)
                getattr(talent, field).remove(source)
                moved += 1
            from casting.models import Role

            for role in Role.objects.filter(**{field: source}):
                getattr(role, field).add(target)
                getattr(role, field).remove(source)
        else:  # language
            for tl in TalentLanguage.objects.filter(language=source):
                if TalentLanguage.objects.filter(talent=tl.talent, language=target).exists():
                    tl.delete()
                else:
                    tl.language = target
                    tl.save(update_fields=["language"])
                moved += 1
            from casting.models import Role

            for role in Role.objects.filter(languages=source):
                role.languages.add(target)
                role.languages.remove(source)
        source.merged_into = target
        source.is_archived = True
        source.save(update_fields=["merged_into", "is_archived", "updated_at"])
        audit.log(request, f"{source.kind}.merged", source, changes={"into": target.name, "moved": moved})
        return Response({"moved": moved, "into": TermSerializer(target).data})


class TalentViewSet(viewsets.ModelViewSet):
    def get_queryset(self):
        qs = Talent.objects.select_related("created_by", "updated_by").prefetch_related(
            "categories",
            "tags",
            Prefetch("languages", queryset=TalentLanguage.objects.select_related("language")),
            Prefetch("photos", queryset=TalentPhoto.objects.order_by("-is_primary", "sort_order", "id")),
        )
        qs = annotate_for_user(qs, self.request.user)
        if self.action == "list":
            return filter_talent(qs, self.request.query_params, self.request.user)
        if self.action in ("retrieve",):
            qs = qs.prefetch_related("skills", "featured_videos", "portfolio_links", "guardians", "consents")
        return qs

    def get_serializer_class(self):
        if self.action == "list":
            return TalentListSerializer
        if self.action in ("create", "update", "partial_update"):
            return TalentWriteSerializer
        return TalentDetailSerializer

    def get_object(self):
        # Allow lookups by cast ID as well as numeric id
        pk = self.kwargs.get("pk", "")
        qs = self.get_queryset()
        if str(pk).upper().startswith("CH-"):
            obj = get_object_or_404(qs, cast_id=str(pk).upper())
        else:
            obj = get_object_or_404(qs, pk=pk)
        return obj

    def _detail(self, talent):
        t = self.get_queryset().prefetch_related("skills", "featured_videos", "portfolio_links", "guardians", "consents").get(pk=talent.pk)
        data = TalentDetailSerializer(t, context={"request": self.request}).data
        data["reminders"] = reminders_for(t)
        data["booking_blockers"] = services.booking_blockers(t)
        return data

    def retrieve(self, request, *args, **kwargs):
        return Response(self._detail(self.get_object()))

    # -- create (full form) --------------------------------------------
    def create(self, request, *args, **kwargs):
        ser = TalentWriteSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        for f in ("full_name", "phone", "city"):
            if not ser.validated_data.get(f):
                raise ValidationError({f: ["This field is required."]})
        if not ser.validated_data.get("categories"):
            raise ValidationError({"categories": ["Choose at least one category."]})
        check_duplicates_or_raise(request.data, request.data.get("acknowledge_duplicates"))
        talent = ser.save_with_relations(request.user)
        services.refresh_completeness(talent)
        audit.log(request, "talent.created", talent)
        return Response(self._detail(talent), status=201)

    # -- quick add (FR-005) -----------------------------------------------
    @action(detail=False, methods=["post"], url_path="quick-add")
    def quick_add(self, request):
        errors = {}
        name = (request.data.get("full_name") or "").strip()
        phone = (request.data.get("phone") or "").strip()
        city = (request.data.get("city") or "").strip()
        cats = _parse_list(request.data.get("categories"))
        photo = request.FILES.get("photo")
        if not name:
            errors["full_name"] = ["Full name is required."]
        if not phone:
            errors["phone"] = ["Primary phone number is required."]
        if not city:
            errors["city"] = ["Current location is required."]
        if not cats:
            errors["categories"] = ["Choose at least one category."]
        if not photo:
            errors["photo"] = ["A primary profile photo is required."]
        if errors:
            raise ValidationError(errors)
        payload = {
            "full_name": name,
            "phone": phone,
            "city": city,
            "district": request.data.get("district", ""),
            "gender": request.data.get("gender", ""),
            "instagram": request.data.get("instagram", ""),
            "categories": cats,
        }
        for opt in ("playing_age_min", "playing_age_max", "approx_age"):
            if request.data.get(opt) not in (None, ""):
                payload[opt] = request.data.get(opt)
        ser = TalentWriteSerializer(data=payload)
        ser.is_valid(raise_exception=True)
        check_duplicates_or_raise(payload, _parse_list(request.data.get("acknowledge_duplicates")))
        crop = request.data.get("crop")
        crop = json.loads(crop) if isinstance(crop, str) and crop else (crop or None)
        # validate the photo before anything is written
        try:
            with transaction.atomic():
                talent = ser.save_with_relations(request.user)
                photo.seek(0)
                services.add_photo(talent, photo, user=request.user, crop=crop, rotate=request.data.get("rotate", 0), make_primary=True)
        except services.PhotoError as e:
            raise ValidationError({"photo": [str(e)]})
        services.refresh_completeness(talent)
        audit.log(request, "talent.created", talent, message="Quick add")
        return Response(self._detail(talent), status=201)

    @action(detail=False, methods=["post"], url_path="duplicate-check")
    def duplicate_check(self, request):
        d = request.data
        matches = services.find_duplicates(
            full_name=d.get("full_name", ""),
            phone=d.get("phone", ""),
            alt_phone=d.get("alt_phone", ""),
            instagram=d.get("instagram", ""),
            city=d.get("city", ""),
            age=d.get("approx_age") or None,
            exclude_id=d.get("exclude_id"),
        )
        return Response({"duplicates": duplicate_payload(matches), "has_exact": any(m["strength"] == "exact" for m in matches)})

    # -- update (FR-006) --------------------------------------------------
    def partial_update(self, request, *args, **kwargs):
        talent = self.get_object()
        client_version = request.data.get("version")
        if client_version is not None and int(client_version) != talent.version:
            raise Conflict(
                "Someone else updated this profile while you were editing. Reload to see their changes, then re-apply yours.",
                code="stale_version",
                extra={"current_version": talent.version},
            )
        ser = TalentWriteSerializer(talent, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        contact_changed = {"phone", "alt_phone", "instagram", "full_name"} & set(ser.validated_data)
        if contact_changed:
            merged = {f: request.data.get(f, getattr(talent, f)) for f in ("full_name", "phone", "alt_phone", "instagram", "city")}
            # Only phone/instagram collisions matter on edit; ignore fuzzy name matches
            matches = [
                m
                for m in services.find_duplicates(**{k: merged[k] for k in ("phone", "alt_phone", "instagram")}, exclude_id=talent.id)
                if m["strength"] in ("exact", "strong")
            ]
            ack = {int(a) for a in _parse_list(request.data.get("acknowledge_duplicates")) if str(a).isdigit()}
            if [m for m in matches if m["talent"].id not in ack]:
                raise Conflict("Another profile already uses this phone number or Instagram.", code="duplicate", extra={"duplicates": duplicate_payload(matches)})
        before = audit.snapshot(talent, AUDITED_FIELDS)
        before_m2m = {k: sorted(getattr(talent, k).values_list("name", flat=True)) for k in ("categories", "tags", "skills")}
        talent = ser.save_with_relations(request.user)
        talent.refresh_from_db()
        changes = audit.diff(before, audit.snapshot(talent, AUDITED_FIELDS))
        for k in ("categories", "tags", "skills"):
            if k in ser.validated_data:
                after = sorted(getattr(talent, k).values_list("name", flat=True))
                if after != before_m2m[k]:
                    changes[k] = [before_m2m[k], after]
        if "languages" in ser.validated_data:
            changes["languages"] = ["…", [tl.language.name for tl in talent.languages.select_related("language")]]
        services.refresh_completeness(talent)
        if changes:
            audit.log(request, "talent.updated", talent, changes=changes)
        return Response(self._detail(talent))

    def update(self, request, *args, **kwargs):
        return self.partial_update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        talent = self.get_object()
        talent.soft_delete(request.user)
        audit.log(request, "talent.deleted", talent, message=request.data.get("reason", "") if hasattr(request, "data") else "")
        return Response(status=204)

    # -- archive / trash ------------------------------------------------------
    @action(detail=True, methods=["post"])
    def archive(self, request, pk=None):
        talent = self.get_object()
        talent.is_archived = True
        talent.archived_at = timezone.now()
        talent.archive_reason = (request.data.get("reason") or "")[:255]
        talent.save(update_fields=["is_archived", "archived_at", "archive_reason", "updated_at"])
        audit.log(request, "talent.archived", talent, message=talent.archive_reason)
        return Response(self._detail(talent))

    @action(detail=True, methods=["post"])
    def unarchive(self, request, pk=None):
        talent = self.get_object()
        talent.is_archived = False
        talent.archived_at = None
        talent.save(update_fields=["is_archived", "archived_at", "updated_at"])
        audit.log(request, "talent.unarchived", talent)
        return Response(self._detail(talent))

    @action(detail=False, methods=["get"])
    def trash(self, request):
        qs = Talent.all_objects.filter(deleted_at__isnull=False).order_by("-deleted_at")
        page = self.paginate_queryset(qs)
        rows = [
            {"id": t.id, "cast_id": t.cast_id, "full_name": t.full_name, "city": t.city, "deleted_at": t.deleted_at,
             "deleted_by": (t.deleted_by.get_username() if t.deleted_by else None)}
            for t in page
        ]
        return self.get_paginated_response(rows)

    @action(detail=False, methods=["post"], url_path=r"trash/(?P<tid>\d+)/restore")
    def restore(self, request, tid=None):
        talent = get_object_or_404(Talent.all_objects, pk=tid, deleted_at__isnull=False)
        talent.restore()
        audit.log(request, "talent.restored", talent)
        return Response({"ok": True, "id": talent.id})

    # -- favourites (FR-011) -------------------------------------------------
    @action(detail=True, methods=["post", "delete"])
    def favorite(self, request, pk=None):
        talent = self.get_object()
        if request.method == "POST":
            Favorite.objects.get_or_create(user=request.user, talent=talent)
            return Response({"is_favorite": True})
        Favorite.objects.filter(user=request.user, talent=talent).delete()
        return Response({"is_favorite": False})

    # -- review marks (FR-019) -------------------------------------------
    @action(detail=True, methods=["post"], url_path="mark-reviewed")
    def mark_reviewed(self, request, pk=None):
        talent = self.get_object()
        what = request.data.get("what")
        now = timezone.now()
        fields = []
        if what in ("rates", "all"):
            talent.rates_reviewed_at = now
            fields.append("rates_reviewed_at")
        if what in ("contact", "all"):
            talent.contact_verified_at = now
            fields.append("contact_verified_at")
        if not fields:
            raise ValidationError({"what": ["Use 'rates', 'contact' or 'all'."]})
        talent.save(update_fields=fields + ["updated_at"])
        audit.log(request, "talent.reviewed", talent, changes={"reviewed": what})
        return Response(self._detail(talent))

    @action(detail=True, methods=["post"])
    def publish(self, request, pk=None):
        """Move an import-staging record into the live directory."""
        talent = self.get_object()
        if talent.status != Talent.STATUS_STAGING:
            return Response(self._detail(talent))
        if not talent.photos.filter(is_primary=True).exists():
            raise Conflict("Add a primary photo before publishing this profile.", code="photo_required")
        talent.status = Talent.STATUS_NEEDS_DETAILS
        talent.save(update_fields=["status", "updated_at"])
        services.refresh_completeness(talent)
        audit.log(request, "talent.published", talent)
        return Response(self._detail(talent))

    # -- photos (FR-007) ------------------------------------------------------
    @action(detail=True, methods=["post"])
    def photos(self, request, pk=None):
        talent = self.get_object()
        files = request.FILES.getlist("photo") or request.FILES.getlist("photos")
        if not files:
            raise ValidationError({"photo": ["Choose a photo to upload."]})
        crop = request.data.get("crop")
        crop = json.loads(crop) if isinstance(crop, str) and crop else None
        created = []
        try:
            for f in files:
                created.append(
                    services.add_photo(
                        talent, f, user=request.user, crop=crop if len(files) == 1 else None, rotate=request.data.get("rotate", 0),
                        label=request.data.get("label", ""), make_primary=request.data.get("make_primary") in ("1", "true", True),
                    )
                )
        except services.PhotoError as e:
            raise ValidationError({"photo": [str(e)]})
        services.refresh_completeness(talent)
        audit.log(request, "talent.photo_added", talent, changes={"count": len(created)})
        return Response(PhotoSerializer(created, many=True).data, status=201)

    @action(detail=True, methods=["post"], url_path="videos/reorder")
    def reorder_videos(self, request, pk=None):
        talent = self.get_object()
        try:
            services.reorder_videos(talent, request.data.get("order") or [])
        except ValueError as e:
            raise ValidationError({"order": [str(e)]})
        audit.log(request, "talent.videos_reordered", talent)
        return Response(VideoSerializer(talent.featured_videos.all(), many=True).data)

    # -- history -------------------------------------------------------------
    @action(detail=True, methods=["get"])
    def history(self, request, pk=None):
        talent = self.get_object()
        entries = AuditLog.objects.filter(entity_type="talent", entity_id=str(talent.pk))[:200]
        return Response(
            [{"id": e.id, "at": e.created_at, "actor": e.actor_name or "system", "action": e.action, "changes": e.changes, "message": e.message} for e in entries]
        )

    @action(detail=True, methods=["get"])
    def casting(self, request, pk=None):
        """FR-016 projects & booking history for a profile."""
        from casting.models import Booking, ShortlistEntry

        talent = self.get_object()
        bookings = Booking.objects.filter(talent=talent).select_related("project", "role").order_by("-shoot_start")
        shortlists = ShortlistEntry.objects.filter(talent=talent).select_related("role__project").order_by("-created_at")
        return Response(
            {
                "bookings": [
                    {
                        "id": b.id, "project_id": b.project_id, "project": b.project.title, "project_code": b.project.code, "client": b.project.client_name,
                        "role": b.role.name, "status": b.status, "status_label": b.get_status_display(), "shoot_start": b.shoot_start, "shoot_end": b.shoot_end,
                        "proposed_fee": b.proposed_fee, "agreed_fee": b.agreed_fee, "fee_basis": b.fee_basis, "currency": b.currency,
                        "travel_charges": b.travel_charges, "accommodation_charges": b.accommodation_charges, "outcome": b.get_outcome_display(),
                        "completed_on": b.completed_on, "deliverable_url": b.deliverable_url,
                    }
                    for b in bookings
                ],
                "shortlists": [
                    {
                        "id": s.id, "role_id": s.role_id, "role": s.role.name, "project_id": s.role.project_id, "project": s.role.project.title,
                        "status": s.status, "status_label": s.get_status_display(), "is_removed": s.is_removed, "proposed_fee": s.proposed_fee, "created_at": s.created_at,
                    }
                    for s in shortlists
                ],
            }
        )

    @action(detail=False, methods=["get"])
    def cities(self, request):
        base = Talent.objects.filter(is_archived=False)
        cities = base.exclude(city="").values_list("city", flat=True).distinct().order_by("city")
        districts = base.exclude(district="").values_list("district", flat=True).distinct().order_by("district")
        return Response({"cities": sorted(set(c.strip().title() for c in cities)), "districts": sorted(set(d.strip().title() for d in districts))})


class _TalentChildViewSet(viewsets.ModelViewSet):
    """Shared behaviour for records hanging off a talent."""

    pagination_class = None
    audit_name = "item"

    def get_queryset(self):
        qs = self.model.objects.select_related("talent")
        tid = self.request.query_params.get("talent")
        if tid:
            qs = qs.filter(talent_id=tid)
        return qs

    def _after(self, obj, verb):
        services.refresh_completeness(obj.talent)
        audit.log(self.request, f"talent.{self.audit_name}_{verb}", obj.talent, message=str(getattr(obj, "title", "") or getattr(obj, "name", "") or ""))

    def perform_create(self, serializer):
        obj = serializer.save(created_by=self.request.user, updated_by=self.request.user)
        self._after(obj, "added")

    def perform_update(self, serializer):
        obj = serializer.save(updated_by=self.request.user)
        self._after(obj, "updated")

    def perform_destroy(self, instance):
        talent = instance.talent
        instance.delete()
        services.refresh_completeness(talent)
        audit.log(self.request, f"talent.{self.audit_name}_removed", talent)


class PhotoViewSet(mixins.RetrieveModelMixin, mixins.UpdateModelMixin, mixins.DestroyModelMixin, mixins.ListModelMixin, viewsets.GenericViewSet):
    serializer_class = PhotoSerializer
    pagination_class = None

    def get_queryset(self):
        qs = TalentPhoto.objects.select_related("talent")
        tid = self.request.query_params.get("talent")
        return qs.filter(talent_id=tid) if tid else qs

    def perform_update(self, serializer):
        photo = serializer.save(updated_by=self.request.user)
        if self.request.data.get("is_primary") in (True, "true", "1"):
            services.set_primary_photo(photo)
            audit.log(self.request, "talent.primary_photo_changed", photo.talent)
        if "is_outdated" in self.request.data:
            audit.log(self.request, "talent.photo_flagged" if photo.is_outdated else "talent.photo_unflagged", photo.talent)

    def destroy(self, request, *args, **kwargs):
        photo = self.get_object()
        ok, msg = services.can_delete_photo(photo)
        if not ok:
            raise Conflict(msg, code="primary_photo")
        talent = photo.talent
        photo.delete_files()
        photo.delete()
        services.refresh_completeness(talent)
        audit.log(request, "talent.photo_removed", talent)
        return Response(status=204)


class VideoViewSet(_TalentChildViewSet):
    serializer_class = VideoSerializer
    model = FeaturedVideo
    audit_name = "video"


class PortfolioLinkViewSet(_TalentChildViewSet):
    serializer_class = PortfolioLinkSerializer
    model = PortfolioLink
    audit_name = "link"


class GuardianViewSet(_TalentChildViewSet):
    serializer_class = GuardianSerializer
    model = Guardian
    audit_name = "guardian"


class ConsentViewSet(_TalentChildViewSet):
    serializer_class = ConsentSerializer
    model = Consent
    audit_name = "consent"

    def perform_create(self, serializer):
        obj = serializer.save(created_by=self.request.user, updated_by=self.request.user)
        services.on_consent_changed(obj, None, self.request.user)
        self._after(obj, "added")

    def perform_update(self, serializer):
        prev = serializer.instance.status
        obj = serializer.save(updated_by=self.request.user)
        services.on_consent_changed(obj, prev, self.request.user)
        if prev != obj.status:
            audit.log(self.request, "talent.consent_status_changed", obj.talent, changes={obj.consent_type: [prev, obj.status]})
        self._after(obj, "updated")

    def perform_destroy(self, instance):
        raise Conflict("Consent records can't be deleted. Mark them withdrawn or expired instead, so the history is kept.", code="consent_immutable")


class ContactNoteViewSet(viewsets.ModelViewSet):
    """FR-017."""

    serializer_class = ContactNoteSerializer

    def get_queryset(self):
        qs = ContactNote.objects.select_related("staff", "project", "talent")
        p = self.request.query_params
        if p.get("talent"):
            qs = qs.filter(talent_id=p["talent"])
        if p.get("project"):
            qs = qs.filter(project_id=p["project"])
        if p.get("follow_up") == "due":
            qs = qs.filter(follow_up_on__lte=timezone.localdate(), follow_up_done=False).order_by("follow_up_on")
        if p.get("kind"):
            qs = qs.filter(kind__in=p["kind"].split(","))
        return qs

    def perform_create(self, serializer):
        note = serializer.save(staff=self.request.user, created_by=self.request.user, updated_by=self.request.user)
        audit.log(self.request, "talent.note_added", note.talent, message=f"{note.get_kind_display()}" + (f" · {note.get_result_display()}" if note.result else ""))

    def perform_update(self, serializer):
        note = serializer.save(updated_by=self.request.user)
        audit.log(self.request, "talent.note_updated", note.talent)

    def perform_destroy(self, instance):
        audit.log(self.request, "talent.note_deleted", instance.talent, message=instance.content[:200])
        instance.delete()


class RetentionReviewViewSet(mixins.ListModelMixin, mixins.UpdateModelMixin, viewsets.GenericViewSet):
    serializer_class = RetentionReviewSerializer

    def get_queryset(self):
        qs = RetentionReview.objects.select_related("talent")
        if self.request.query_params.get("status"):
            qs = qs.filter(status=self.request.query_params["status"])
        return qs

    def perform_update(self, serializer):
        r = serializer.save(updated_by=self.request.user)
        if r.status != "open" and not r.resolved_at:
            r.resolved_at = timezone.now()
            r.resolved_by = self.request.user
            r.save(update_fields=["resolved_at", "resolved_by"])
        audit.log(self.request, "talent.retention_review", r.talent, changes={"status": r.status}, message=r.resolution_notes)
