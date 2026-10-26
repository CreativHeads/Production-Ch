from rest_framework import serializers

from talent.models import Term
from talent.serializers import MiniTermSerializer, media_url

from .models import Availability, Booking, Project, Role, ShortlistEntry, ShortlistEvent


class ProjectSerializer(serializers.ModelSerializer):
    status_label = serializers.CharField(source="get_status_display", read_only=True)
    production_type_label = serializers.CharField(source="get_production_type_display", read_only=True)
    role_count = serializers.IntegerField(read_only=True, default=None)
    positions_needed = serializers.IntegerField(read_only=True, default=None)
    selected_count = serializers.IntegerField(read_only=True, default=None)
    booking_count = serializers.IntegerField(read_only=True, default=None)
    code = serializers.CharField(required=False, allow_blank=True, max_length=30)

    class Meta:
        model = Project
        fields = [
            "id", "title", "client_name", "code", "description", "production_type", "production_type_label", "shoot_start", "shoot_end",
            "location", "budget", "currency", "status", "status_label", "notes", "role_count", "positions_needed", "selected_count",
            "booking_count", "created_at", "updated_at",
        ]

    def validate_code(self, v):
        v = (v or "").strip().upper()
        if v:
            qs = Project.all_objects.filter(code=v)
            if self.instance:
                qs = qs.exclude(pk=self.instance.pk)
            if qs.exists():
                raise serializers.ValidationError("Another project already uses this code.")
        return v

    def validate(self, attrs):
        s = attrs.get("shoot_start", getattr(self.instance, "shoot_start", None))
        e = attrs.get("shoot_end", getattr(self.instance, "shoot_end", None))
        if s and e and e < s:
            raise serializers.ValidationError({"shoot_end": ["The shoot end date must be on or after the start date."]})
        return attrs


class RoleSerializer(serializers.ModelSerializer):
    languages = serializers.PrimaryKeyRelatedField(many=True, queryset=Term.objects.filter(kind=Term.LANGUAGE), required=False)
    categories = serializers.PrimaryKeyRelatedField(many=True, queryset=Term.objects.filter(kind=Term.CATEGORY), required=False)
    tags = serializers.PrimaryKeyRelatedField(many=True, queryset=Term.objects.filter(kind=Term.TAG), required=False)
    skills = serializers.PrimaryKeyRelatedField(many=True, queryset=Term.objects.filter(kind=Term.SKILL), required=False)
    language_names = serializers.SerializerMethodField()
    category_names = serializers.SerializerMethodField()
    tag_names = serializers.SerializerMethodField()
    skill_names = serializers.SerializerMethodField()
    shortlist_count = serializers.IntegerField(read_only=True, default=None)
    selected_count = serializers.IntegerField(read_only=True, default=None)
    project_title = serializers.CharField(source="project.title", read_only=True)

    class Meta:
        model = Role
        fields = [
            "id", "project", "project_title", "name", "description", "positions_needed", "gender_preference", "age_min", "age_max",
            "languages", "language_names", "accent_requirements", "categories", "category_names", "tags", "tag_names", "skills", "skill_names",
            "location", "travel_requirement", "travel_notes", "budget", "fee_basis", "shoot_start", "shoot_end", "notes", "sort_order",
            "shortlist_count", "selected_count",
        ]

    def _names(self, qs):
        return [t.name for t in qs.all()]

    def get_language_names(self, o):
        return self._names(o.languages)

    def get_category_names(self, o):
        return self._names(o.categories)

    def get_tag_names(self, o):
        return self._names(o.tags)

    def get_skill_names(self, o):
        return self._names(o.skills)

    def validate(self, attrs):
        lo = attrs.get("age_min", getattr(self.instance, "age_min", None))
        hi = attrs.get("age_max", getattr(self.instance, "age_max", None))
        if lo is not None and hi is not None and lo > hi:
            raise serializers.ValidationError({"age_max": ["The upper age must be at least the lower age."]})
        s = attrs.get("shoot_start", getattr(self.instance, "shoot_start", None))
        e = attrs.get("shoot_end", getattr(self.instance, "shoot_end", None))
        if s and e and e < s:
            raise serializers.ValidationError({"shoot_end": ["The end date must be on or after the start date."]})
        return attrs


class ShortlistTalentSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    cast_id = serializers.CharField()
    full_name = serializers.CharField()
    city = serializers.CharField()
    phone = serializers.CharField()
    expected_fee = serializers.DecimalField(max_digits=12, decimal_places=2)
    fee_type = serializers.CharField()
    playing_age_min = serializers.IntegerField()
    playing_age_max = serializers.IntegerField()
    gender = serializers.CharField()
    consent_hold = serializers.BooleanField()
    photo = serializers.SerializerMethodField()

    def get_photo(self, t):
        p = next((p for p in t.photos.all() if p.is_primary), None)
        return media_url(p.thumb) if p else None


class ShortlistEntrySerializer(serializers.ModelSerializer):
    talent_detail = ShortlistTalentSerializer(source="talent", read_only=True)
    status_label = serializers.CharField(source="get_status_display", read_only=True)
    role_name = serializers.CharField(source="role.name", read_only=True)
    project_id = serializers.IntegerField(source="role.project_id", read_only=True)
    has_booking = serializers.SerializerMethodField()

    class Meta:
        model = ShortlistEntry
        fields = [
            "id", "role", "role_name", "project_id", "talent", "talent_detail", "priority", "status", "status_label", "notes", "proposed_fee", "fee_basis",
            "availability_confirmed", "availability_confirmed_at", "availability_notes", "is_removed", "removed_at", "removed_reason",
            "has_booking", "created_at", "updated_at",
        ]
        read_only_fields = ["role", "talent", "is_removed", "removed_at", "availability_confirmed_at", "created_at", "updated_at"]

    def get_has_booking(self, o):
        return any(b.status != "cancelled" for b in o.bookings.all())


class ShortlistEventSerializer(serializers.ModelSerializer):
    actor_name = serializers.SerializerMethodField()

    class Meta:
        model = ShortlistEvent
        fields = ["id", "action", "from_value", "to_value", "note", "actor_name", "created_at"]

    def get_actor_name(self, o):
        return (o.actor.get_full_name() or o.actor.username) if o.actor else "system"


class AvailabilitySerializer(serializers.ModelSerializer):
    kind_label = serializers.CharField(source="get_kind_display", read_only=True)
    talent_name = serializers.CharField(source="talent.full_name", read_only=True)
    is_booking = serializers.SerializerMethodField()

    class Meta:
        model = Availability
        fields = ["id", "talent", "talent_name", "start", "end", "kind", "kind_label", "confirmed_at", "source", "notes", "booking", "project", "is_booking", "created_at"]
        read_only_fields = ["booking", "created_at"]

    def get_is_booking(self, o):
        return o.booking_id is not None

    def validate(self, attrs):
        s = attrs.get("start", getattr(self.instance, "start", None))
        e = attrs.get("end", getattr(self.instance, "end", None))
        if s and e and e <= s:
            raise serializers.ValidationError({"end": ["End must be after start."]})
        kind = attrs.get("kind", getattr(self.instance, "kind", None))
        if kind == "confirmed_booking" and not (self.instance and self.instance.booking_id):
            raise serializers.ValidationError({"kind": ["Confirmed bookings are created from a project role booking, so fee and schedule are recorded."]})
        return attrs


class BookingSerializer(serializers.ModelSerializer):
    talent_name = serializers.CharField(source="talent.full_name", read_only=True)
    talent_cast_id = serializers.CharField(source="talent.cast_id", read_only=True)
    talent_phone = serializers.CharField(source="talent.phone", read_only=True)
    talent_photo = serializers.SerializerMethodField()
    project_title = serializers.CharField(source="project.title", read_only=True)
    project_code = serializers.CharField(source="project.code", read_only=True)
    role_name = serializers.CharField(source="role.name", read_only=True)
    status_label = serializers.CharField(source="get_status_display", read_only=True)
    outcome_label = serializers.CharField(source="get_outcome_display", read_only=True)
    override_by_name = serializers.SerializerMethodField()

    class Meta:
        model = Booking
        fields = [
            "id", "project", "project_title", "project_code", "role", "role_name", "talent", "talent_name", "talent_cast_id", "talent_phone", "talent_photo",
            "shortlist_entry", "shoot_start", "shoot_end", "schedule_notes", "status", "status_label", "proposed_fee", "agreed_fee", "fee_basis", "currency",
            "travel_charges", "accommodation_charges", "other_charges_notes", "confirmed_at", "confirmation_source", "confirmation_notes",
            "outcome", "outcome_label", "completed_on", "deliverable_url", "conflict_override", "override_reason", "override_by_name", "override_at",
            "created_at", "updated_at",
        ]
        read_only_fields = ["project", "confirmed_at", "conflict_override", "override_reason", "override_at", "created_at", "updated_at"]

    def get_talent_photo(self, o):
        p = next((p for p in o.talent.photos.all() if p.is_primary), None)
        return media_url(p.thumb) if p else None

    def get_override_by_name(self, o):
        return o.override_by.get_username() if o.override_by else None

    def validate(self, attrs):
        role = attrs.get("role", getattr(self.instance, "role", None))
        talent = attrs.get("talent", getattr(self.instance, "talent", None))
        if self.instance and "talent" in attrs and attrs["talent"] != self.instance.talent:
            raise serializers.ValidationError({"talent": ["A booking's talent can't be changed. Cancel it and create a new booking."]})
        if role is None or talent is None:
            raise serializers.ValidationError({"role": ["Choose the project role and talent."]})
        return attrs
