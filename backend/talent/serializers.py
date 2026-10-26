from django.conf import settings
from django.db import transaction
from rest_framework import serializers

from core.normalize import instagram_url, whatsapp_digits

from .models import (
    Consent,
    ContactNote,
    FeaturedVideo,
    Guardian,
    PortfolioLink,
    RetentionReview,
    Talent,
    TalentLanguage,
    TalentPhoto,
    Term,
)
from .services import detect_platform, missing_labels, video_thumbnail


def media_url(f):
    if not f:
        return None
    return f"{settings.MEDIA_URL}{f.name}"


class TermSerializer(serializers.ModelSerializer):
    usage = serializers.IntegerField(read_only=True, required=False)
    merged_into_name = serializers.CharField(source="merged_into.name", read_only=True, default=None)

    class Meta:
        model = Term
        fields = ["id", "kind", "name", "slug", "description", "color", "sort_order", "is_archived", "merged_into", "merged_into_name", "system_key", "usage"]
        read_only_fields = ["slug", "merged_into", "system_key"]

    def validate(self, attrs):
        from django.utils.text import slugify

        kind = attrs.get("kind") or getattr(self.instance, "kind", None)
        name = attrs.get("name") or getattr(self.instance, "name", "")
        qs = Term.objects.filter(kind=kind, slug=slugify(name)[:90])
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError({"name": [f"A {kind} named “{name}” already exists. Use merge instead."]})
        return attrs


class MiniTermSerializer(serializers.ModelSerializer):
    class Meta:
        model = Term
        fields = ["id", "name", "color", "system_key"]


class PhotoSerializer(serializers.ModelSerializer):
    profile_url = serializers.SerializerMethodField()
    card_url = serializers.SerializerMethodField()
    thumb_url = serializers.SerializerMethodField()
    has_master = serializers.SerializerMethodField()

    class Meta:
        model = TalentPhoto
        fields = ["id", "label", "is_primary", "is_outdated", "taken_on", "sort_order", "width", "height", "profile_url", "card_url", "thumb_url", "has_master", "created_at"]
        read_only_fields = ["is_primary", "width", "height", "created_at"]

    def get_profile_url(self, o):
        return media_url(o.profile)

    def get_card_url(self, o):
        return media_url(o.card)

    def get_thumb_url(self, o):
        return media_url(o.thumb)

    def get_has_master(self, o):
        return bool(o.master)


class VideoSerializer(serializers.ModelSerializer):
    file_url = serializers.SerializerMethodField()

    class Meta:
        model = FeaturedVideo
        fields = ["id", "talent", "position", "title", "platform", "url", "file", "file_url", "description", "thumbnail_url"]
        extra_kwargs = {"file": {"write_only": True, "required": False}}

    def get_file_url(self, o):
        return media_url(o.file)

    def validate(self, attrs):
        talent = attrs.get("talent") or getattr(self.instance, "talent", None)
        position = attrs.get("position") or getattr(self.instance, "position", None)
        url = attrs.get("url", getattr(self.instance, "url", ""))
        file = attrs.get("file", getattr(self.instance, "file", None))
        if not url and not file:
            raise serializers.ValidationError({"url": ["Add a video link or upload a file."]})
        if position not in (1, 2, 3):
            raise serializers.ValidationError({"position": ["Featured videos use positions 1, 2 and 3."]})
        clash = FeaturedVideo.objects.filter(talent=talent, position=position)
        if self.instance:
            clash = clash.exclude(pk=self.instance.pk)
        if clash.exists():
            raise serializers.ValidationError({"position": [f"Slot {position} is already used. Reorder or replace it."]})
        if url and not attrs.get("platform"):
            attrs["platform"] = detect_platform(url)
        if file:
            attrs["platform"] = "upload"
        if url and not attrs.get("thumbnail_url"):
            attrs["thumbnail_url"] = video_thumbnail(url)
        return attrs


class PortfolioLinkSerializer(serializers.ModelSerializer):
    class Meta:
        model = PortfolioLink
        fields = ["id", "talent", "title", "url", "kind"]


class TalentLanguageSerializer(serializers.ModelSerializer):
    name = serializers.CharField(source="language.name", read_only=True)

    class Meta:
        model = TalentLanguage
        fields = ["id", "language", "name", "fluency", "accents", "can_dub"]


class GuardianSerializer(serializers.ModelSerializer):
    class Meta:
        model = Guardian
        fields = ["id", "talent", "name", "relationship", "phone", "alt_phone", "email", "address", "id_verified", "is_primary", "notes"]


class ConsentSerializer(serializers.ModelSerializer):
    evidence_url = serializers.SerializerMethodField()
    is_effective = serializers.BooleanField(read_only=True)
    type_label = serializers.CharField(source="get_consent_type_display", read_only=True)
    status_label = serializers.CharField(source="get_status_display", read_only=True)

    class Meta:
        model = Consent
        fields = [
            "id", "talent", "consent_type", "type_label", "status", "status_label", "obtained_on", "method", "evidence", "evidence_url",
            "scope", "given_by", "expires_on", "withdrawn_on", "notes", "is_effective", "created_at", "updated_at",
        ]
        extra_kwargs = {"evidence": {"write_only": True, "required": False}}

    def get_evidence_url(self, o):
        return media_url(o.evidence)

    def validate(self, attrs):
        status = attrs.get("status", getattr(self.instance, "status", "pending"))
        if status == "granted" and not attrs.get("obtained_on", getattr(self.instance, "obtained_on", None)):
            raise serializers.ValidationError({"obtained_on": ["Record the date the consent was obtained."]})
        if status == "granted" and not attrs.get("method", getattr(self.instance, "method", "")):
            raise serializers.ValidationError({"method": ["Record how the consent was obtained."]})
        return attrs


class StaffMiniSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    name = serializers.SerializerMethodField()

    def get_name(self, u):
        return u.get_full_name() or u.username


class ContactNoteSerializer(serializers.ModelSerializer):
    staff_name = serializers.SerializerMethodField()
    project_title = serializers.CharField(source="project.title", read_only=True, default=None)
    talent_name = serializers.CharField(source="talent.full_name", read_only=True)
    talent_cast_id = serializers.CharField(source="talent.cast_id", read_only=True)

    class Meta:
        model = ContactNote
        fields = [
            "id", "talent", "talent_name", "talent_cast_id", "kind", "result", "content", "staff", "staff_name", "interaction_at", "project", "project_title",
            "follow_up_on", "follow_up_done", "created_at", "updated_at",
        ]
        read_only_fields = ["staff", "created_at", "updated_at"]

    def get_staff_name(self, o):
        return (o.staff.get_full_name() or o.staff.username) if o.staff else "—"


class RetentionReviewSerializer(serializers.ModelSerializer):
    talent_name = serializers.CharField(source="talent.full_name", read_only=True)
    talent_cast_id = serializers.CharField(source="talent.cast_id", read_only=True)

    class Meta:
        model = RetentionReview
        fields = ["id", "talent", "talent_name", "talent_cast_id", "consent", "reason", "status", "due_on", "resolution_notes", "resolved_at", "created_at"]
        read_only_fields = ["talent", "consent", "reason", "resolved_at", "created_at"]


# ---------------------------------------------------------------------------
# Talent
# ---------------------------------------------------------------------------
class TalentListSerializer(serializers.ModelSerializer):
    """Light payload for the directory cards / list rows."""

    photo = serializers.SerializerMethodField()
    categories = MiniTermSerializer(many=True, read_only=True)
    tags = MiniTermSerializer(many=True, read_only=True)
    languages = serializers.SerializerMethodField()
    age = serializers.IntegerField(read_only=True)
    is_favorite = serializers.BooleanField(read_only=True, default=False)
    last_contact_at = serializers.DateTimeField(read_only=True, default=None)
    whatsapp = serializers.SerializerMethodField()
    instagram_url = serializers.SerializerMethodField()
    status_label = serializers.CharField(source="get_status_display", read_only=True)

    class Meta:
        model = Talent
        fields = [
            "id", "cast_id", "full_name", "screen_name", "photo", "categories", "tags", "languages", "gender", "age",
            "playing_age_min", "playing_age_max", "city", "district", "phone", "whatsapp", "instagram_url",
            "expected_fee", "expected_fee_max", "fee_unknown", "fee_type", "currency", "experience_level",
            "completeness", "status", "status_label", "is_archived", "is_favorite", "consent_hold", "last_contact_at", "created_at", "updated_at",
        ]

    def get_photo(self, o):
        p = next((p for p in o.photos.all() if p.is_primary), None)
        if not p:
            return None
        return {"card": media_url(p.card), "thumb": media_url(p.thumb), "label": p.label}

    def get_languages(self, o):
        return [tl.language.name for tl in o.languages.all()]

    def get_whatsapp(self, o):
        return whatsapp_digits(o.whatsapp_phone or o.phone)

    def get_instagram_url(self, o):
        return instagram_url(o.instagram) if o.instagram else None


class TalentDetailSerializer(TalentListSerializer):
    skills = MiniTermSerializer(many=True, read_only=True)
    languages = TalentLanguageSerializer(many=True, read_only=True)
    photos = PhotoSerializer(many=True, read_only=True)
    featured_videos = VideoSerializer(many=True, read_only=True)
    portfolio_links = PortfolioLinkSerializer(many=True, read_only=True)
    guardians = GuardianSerializer(many=True, read_only=True)
    consents = ConsentSerializer(many=True, read_only=True)
    is_child = serializers.BooleanField(read_only=True)
    missing = serializers.SerializerMethodField()
    created_by_name = serializers.SerializerMethodField()
    updated_by_name = serializers.SerializerMethodField()

    class Meta(TalentListSerializer.Meta):
        fields = TalentListSerializer.Meta.fields + [
            "version", "archived_at", "archive_reason", "date_of_birth", "age_verified", "approx_age", "height_cm", "weight_kg",
            "measurements", "complexion", "hair", "eye_color", "appearance_notes", "alt_phone", "whatsapp_phone", "email", "instagram",
            "address", "state", "country", "contact_verified_at", "skills", "experience_summary", "fee_negotiable", "fee_notes",
            "rates_reviewed_at", "travel_willingness", "has_passport", "travel_notes", "internal_notes", "child_safety_verified",
            "child_safety_verified_at", "child_safety_notes", "missing_fields", "missing", "photos", "featured_videos", "portfolio_links",
            "guardians", "consents", "is_child", "created_by_name", "updated_by_name",
        ]

    def get_missing(self, o):
        return missing_labels(o.missing_fields or [])

    def get_created_by_name(self, o):
        return (o.created_by.get_full_name() or o.created_by.username) if o.created_by else None

    def get_updated_by_name(self, o):
        return (o.updated_by.get_full_name() or o.updated_by.username) if o.updated_by else None


class LanguageInput(serializers.Serializer):
    language = serializers.PrimaryKeyRelatedField(queryset=Term.objects.filter(kind=Term.LANGUAGE))
    fluency = serializers.ChoiceField(choices=TalentLanguage.FLUENCY_CHOICES, required=False, allow_blank=True)
    accents = serializers.CharField(required=False, allow_blank=True, max_length=200)
    can_dub = serializers.BooleanField(required=False, default=False)


AUDITED_FIELDS = [
    "full_name", "screen_name", "gender", "date_of_birth", "approx_age", "playing_age_min", "playing_age_max", "height_cm",
    "phone", "alt_phone", "whatsapp_phone", "email", "instagram", "address", "city", "district", "state",
    "expected_fee", "expected_fee_max", "fee_unknown", "fee_type", "fee_negotiable", "travel_willingness",
    "experience_level", "child_safety_verified", "age_verified", "internal_notes",
]


class TalentWriteSerializer(serializers.ModelSerializer):
    """PATCH-friendly: only fields sent are touched (FR-006)."""

    categories = serializers.PrimaryKeyRelatedField(many=True, queryset=Term.objects.filter(kind=Term.CATEGORY), required=False)
    tags = serializers.PrimaryKeyRelatedField(many=True, queryset=Term.objects.filter(kind=Term.TAG), required=False)
    skills = serializers.PrimaryKeyRelatedField(many=True, queryset=Term.objects.filter(kind=Term.SKILL), required=False)
    languages = LanguageInput(many=True, required=False)
    version = serializers.IntegerField(required=False)

    class Meta:
        model = Talent
        fields = [
            "version", "full_name", "screen_name", "gender", "date_of_birth", "age_verified", "approx_age", "playing_age_min", "playing_age_max",
            "height_cm", "weight_kg", "measurements", "complexion", "hair", "eye_color", "appearance_notes",
            "phone", "alt_phone", "whatsapp_phone", "email", "instagram", "address", "city", "district", "state", "country",
            "categories", "tags", "skills", "languages", "experience_level", "experience_summary",
            "expected_fee", "expected_fee_max", "fee_unknown", "fee_type", "currency", "fee_negotiable", "fee_notes",
            "travel_willingness", "has_passport", "travel_notes", "internal_notes",
            "child_safety_verified", "child_safety_notes",
        ]

    def validate(self, attrs):
        inst = self.instance
        get = lambda k: attrs.get(k, getattr(inst, k, None) if inst else None)  # noqa: E731
        lo, hi = get("playing_age_min"), get("playing_age_max")
        if lo is not None and hi is not None and lo > hi:
            raise serializers.ValidationError({"playing_age_max": ["Playing age 'to' must be at least the 'from' age."]})
        fmin, fmax = get("expected_fee"), get("expected_fee_max")
        if fmin is not None and fmax is not None and fmax < fmin:
            raise serializers.ValidationError({"expected_fee_max": ["The upper fee must be at least the lower fee."]})
        if "phone" in attrs and not (attrs["phone"] or "").strip():
            raise serializers.ValidationError({"phone": ["A primary phone number is required."]})
        if "city" in attrs and not (attrs["city"] or "").strip():
            raise serializers.ValidationError({"city": ["Current location is required."]})
        if "categories" in attrs and not attrs["categories"]:
            raise serializers.ValidationError({"categories": ["Choose at least one category."]})
        dob = get("date_of_birth")
        if dob:
            from django.utils import timezone

            if dob > timezone.localdate():
                raise serializers.ValidationError({"date_of_birth": ["Date of birth can't be in the future."]})
        langs = attrs.get("languages")
        if langs is not None:
            ids = [l["language"].id for l in langs]
            if len(ids) != len(set(ids)):
                raise serializers.ValidationError({"languages": ["Each language can only be listed once."]})
        return attrs

    @transaction.atomic
    def save_with_relations(self, user):
        data = dict(self.validated_data)
        data.pop("version", None)
        m2m = {k: data.pop(k) for k in ("categories", "tags", "skills") if k in data}
        langs = data.pop("languages", None)
        inst = self.instance
        if inst is None:
            inst = Talent(**data, created_by=user, updated_by=user)
            inst.save()
        else:
            for k, v in data.items():
                setattr(inst, k, v)
            if "expected_fee" in data or "fee_unknown" in data or "fee_type" in data:
                from django.utils import timezone

                inst.rates_reviewed_at = timezone.now()
            if {"phone", "alt_phone", "email"} & set(data):
                from django.utils import timezone

                inst.contact_verified_at = timezone.now()
            if data.get("child_safety_verified") and not inst.child_safety_verified_at:
                from django.utils import timezone

                inst.child_safety_verified_at = timezone.now()
            inst.updated_by = user
            inst.version = (inst.version or 1) + 1
            inst.save()
        for k, v in m2m.items():
            getattr(inst, k).set(v)
        if langs is not None:
            inst.languages.all().delete()
            for l in langs:
                TalentLanguage.objects.create(
                    talent=inst, language=l["language"], fluency=l.get("fluency", ""), accents=l.get("accents", ""), can_dub=l.get("can_dub", False)
                )
        return inst
