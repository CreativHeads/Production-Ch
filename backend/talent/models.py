import datetime

from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.utils import timezone
from django.utils.text import slugify

from core.models import Sequence, SoftDeleteModel, TimeStampedModel
from core.normalize import normalize_instagram, normalize_name, normalize_phone


# ---------------------------------------------------------------------------
# Taxonomy (FR-009): categories, tags, skills, languages share one model.
# Relationships point at the term's id, so renaming a term changes its display
# everywhere without touching historical relationship rows.
# ---------------------------------------------------------------------------
class Term(TimeStampedModel):
    CATEGORY, TAG, SKILL, LANGUAGE = "category", "tag", "skill", "language"
    KIND_CHOICES = [(CATEGORY, "Category"), (TAG, "Tag"), (SKILL, "Skill"), (LANGUAGE, "Language")]

    kind = models.CharField(max_length=16, choices=KIND_CHOICES, db_index=True)
    name = models.CharField(max_length=80)
    slug = models.SlugField(max_length=90)
    description = models.CharField(max_length=255, blank=True)
    color = models.CharField(max_length=16, blank=True)
    sort_order = models.PositiveIntegerField(default=0)
    is_archived = models.BooleanField(default=False)
    merged_into = models.ForeignKey("self", null=True, blank=True, on_delete=models.SET_NULL, related_name="merged_from")
    # System terms drive behaviour (e.g. the "Child Artist" category triggers guardian rules)
    system_key = models.CharField(max_length=32, blank=True, db_index=True)

    class Meta:
        ordering = ["kind", "sort_order", "name"]
        constraints = [models.UniqueConstraint(fields=["kind", "slug"], name="uniq_term_kind_slug")]

    def save(self, *args, **kwargs):
        self.slug = slugify(self.name)[:90] or "term"
        super().save(*args, **kwargs)

    def __str__(self):
        return self.name


# ---------------------------------------------------------------------------
# Talent (FR-004 – FR-006)
# ---------------------------------------------------------------------------
class Talent(SoftDeleteModel, TimeStampedModel):
    STATUS_ACTIVE = "active"
    STATUS_NEEDS_DETAILS = "needs_details"
    STATUS_STAGING = "staging"  # FR-018: imported without required photo
    STATUS_CHOICES = [
        (STATUS_ACTIVE, "Active"),
        (STATUS_NEEDS_DETAILS, "Needs Details"),
        (STATUS_STAGING, "Import staging"),
    ]

    GENDER_CHOICES = [
        ("female", "Female"),
        ("male", "Male"),
        ("non_binary", "Non-binary"),
        ("other", "Other"),
        ("unspecified", "Prefer not to say"),
    ]
    EXPERIENCE_CHOICES = [
        ("fresher", "Fresher"),
        ("beginner", "Beginner"),
        ("intermediate", "Intermediate"),
        ("experienced", "Experienced"),
        ("professional", "Professional"),
    ]
    FEE_TYPE_CHOICES = [
        ("per_day", "Per day"),
        ("per_shoot", "Per shoot"),
        ("per_project", "Per project"),
        ("per_hour", "Per hour"),
    ]
    TRAVEL_CHOICES = [
        ("local", "Local only"),
        ("district", "Within district"),
        ("state", "Within state"),
        ("national", "Anywhere in India"),
        ("international", "International"),
    ]

    cast_id = models.CharField(max_length=20, unique=True, editable=False)
    version = models.PositiveIntegerField(default=1)  # optimistic locking
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default=STATUS_NEEDS_DETAILS, db_index=True)
    is_archived = models.BooleanField(default=False, db_index=True)
    archived_at = models.DateTimeField(null=True, blank=True)
    archive_reason = models.CharField(max_length=255, blank=True)

    # 1. Personal & appearance
    full_name = models.CharField(max_length=150)
    name_normalized = models.CharField(max_length=150, db_index=True, editable=False)
    screen_name = models.CharField(max_length=150, blank=True)
    gender = models.CharField(max_length=16, choices=GENDER_CHOICES, blank=True)
    date_of_birth = models.DateField(null=True, blank=True)
    age_verified = models.BooleanField(default=False)
    approx_age = models.PositiveSmallIntegerField(null=True, blank=True, validators=[MaxValueValidator(120)])
    playing_age_min = models.PositiveSmallIntegerField(null=True, blank=True, validators=[MaxValueValidator(120)])
    playing_age_max = models.PositiveSmallIntegerField(null=True, blank=True, validators=[MaxValueValidator(120)])
    height_cm = models.PositiveSmallIntegerField(null=True, blank=True, validators=[MinValueValidator(30), MaxValueValidator(260)])
    weight_kg = models.PositiveSmallIntegerField(null=True, blank=True)
    measurements = models.JSONField(default=dict, blank=True)  # chest, waist, hips, shoe, shirt, trouser, dress...
    complexion = models.CharField(max_length=40, blank=True)
    hair = models.CharField(max_length=60, blank=True)
    eye_color = models.CharField(max_length=30, blank=True)
    appearance_notes = models.TextField(blank=True)

    # 2. Contact
    phone = models.CharField(max_length=32)
    phone_normalized = models.CharField(max_length=20, db_index=True, editable=False)
    alt_phone = models.CharField(max_length=32, blank=True)
    alt_phone_normalized = models.CharField(max_length=20, blank=True, db_index=True, editable=False)
    whatsapp_phone = models.CharField(max_length=32, blank=True, help_text="Only if different from primary phone")
    email = models.EmailField(blank=True)
    instagram = models.CharField(max_length=200, blank=True)
    instagram_normalized = models.CharField(max_length=60, blank=True, db_index=True, editable=False)
    address = models.TextField(blank=True)
    city = models.CharField(max_length=80, db_index=True)
    district = models.CharField(max_length=80, blank=True, db_index=True)
    state = models.CharField(max_length=80, blank=True, default="Kerala")
    country = models.CharField(max_length=60, blank=True, default="India")
    contact_verified_at = models.DateTimeField(null=True, blank=True)

    # 3. Taxonomy
    categories = models.ManyToManyField(Term, related_name="talent_in_category", blank=True)
    tags = models.ManyToManyField(Term, related_name="talent_with_tag", blank=True)
    skills = models.ManyToManyField(Term, related_name="talent_with_skill", blank=True)
    experience_level = models.CharField(max_length=16, choices=EXPERIENCE_CHOICES, blank=True)
    experience_summary = models.TextField(blank=True)

    # 6. Rates & travel
    expected_fee = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    expected_fee_max = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    fee_unknown = models.BooleanField(default=False)
    fee_type = models.CharField(max_length=16, choices=FEE_TYPE_CHOICES, blank=True)
    currency = models.CharField(max_length=3, default="INR")
    fee_negotiable = models.BooleanField(null=True, blank=True)
    fee_notes = models.CharField(max_length=255, blank=True)
    rates_reviewed_at = models.DateTimeField(null=True, blank=True)
    travel_willingness = models.CharField(max_length=16, choices=TRAVEL_CHOICES, blank=True)
    has_passport = models.BooleanField(null=True, blank=True)
    travel_notes = models.TextField(blank=True)

    # 8. Internal performance notes
    internal_notes = models.TextField(blank=True)

    # 10. Child safety (FR-020)
    child_safety_verified = models.BooleanField(default=False)
    child_safety_verified_at = models.DateTimeField(null=True, blank=True)
    child_safety_notes = models.TextField(blank=True)
    consent_hold = models.BooleanField(default=False, help_text="Set when consent is withdrawn; blocks shortlisting, booking and client exports")

    # Derived (recomputed on save)
    completeness = models.PositiveSmallIntegerField(default=0, db_index=True)
    missing_fields = models.JSONField(default=list, blank=True)

    class Meta:
        ordering = ["full_name"]
        indexes = [
            models.Index(fields=["is_archived", "status"]),
            models.Index(fields=["created_at"]),
            models.Index(fields=["updated_at"]),
        ]

    def __str__(self):
        return f"{self.full_name} ({self.cast_id})"

    # -- identity --------------------------------------------------------
    @staticmethod
    def generate_cast_id():
        return f"CH-CAST-{Sequence.next('cast_id'):06d}"

    def save(self, *args, **kwargs):
        from core.models import SystemSetting

        cc = SystemSetting.get().default_country_code
        if not self.cast_id:
            self.cast_id = self.generate_cast_id()
        self.name_normalized = normalize_name(self.full_name)
        self.phone_normalized = normalize_phone(self.phone, cc)
        self.alt_phone_normalized = normalize_phone(self.alt_phone, cc)
        self.instagram_normalized = normalize_instagram(self.instagram)
        super().save(*args, **kwargs)

    # -- derived ---------------------------------------------------------
    @property
    def age(self):
        if self.date_of_birth:
            today = timezone.localdate()
            dob = self.date_of_birth
            return today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))
        return self.approx_age

    @property
    def is_child(self):
        a = self.age
        if a is not None and a < 18:
            return True
        return any(c.system_key == "child" for c in self.categories.all())

    @property
    def primary_photo(self):
        for p in self.photos.all():
            if p.is_primary:
                return p
        return None


class TalentLanguage(models.Model):
    FLUENCY_CHOICES = [("native", "Native"), ("fluent", "Fluent"), ("conversational", "Conversational"), ("basic", "Basic")]
    talent = models.ForeignKey(Talent, on_delete=models.CASCADE, related_name="languages")
    language = models.ForeignKey(Term, on_delete=models.PROTECT, related_name="talent_languages")
    fluency = models.CharField(max_length=16, choices=FLUENCY_CHOICES, blank=True)
    accents = models.CharField(max_length=200, blank=True, help_text="Comma-separated accents/dialects, e.g. Malabar, Thrissur")
    can_dub = models.BooleanField(default=False)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["talent", "language"], name="uniq_talent_language")]


def _photo_path(instance, filename, variant):
    return f"talent/{instance.talent.cast_id}/photos/{variant}/{filename}"


def photo_master_path(instance, filename):
    return _photo_path(instance, filename, "master")


def photo_profile_path(instance, filename):
    return _photo_path(instance, filename, "profile")


def photo_card_path(instance, filename):
    return _photo_path(instance, filename, "card")


def photo_thumb_path(instance, filename):
    return _photo_path(instance, filename, "thumb")


class TalentPhoto(TimeStampedModel):
    """FR-007. Variants are generated server-side; the master is optional."""

    talent = models.ForeignKey(Talent, on_delete=models.CASCADE, related_name="photos")
    master = models.ImageField(upload_to=photo_master_path, blank=True)
    profile = models.ImageField(upload_to=photo_profile_path)
    card = models.ImageField(upload_to=photo_card_path)
    thumb = models.ImageField(upload_to=photo_thumb_path)
    width = models.PositiveIntegerField(default=0)
    height = models.PositiveIntegerField(default=0)
    label = models.CharField(max_length=120, blank=True, help_text="Image label / alt text")
    is_primary = models.BooleanField(default=False)
    is_outdated = models.BooleanField(default=False)
    taken_on = models.DateField(null=True, blank=True)
    sort_order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["-is_primary", "sort_order", "id"]

    def delete_files(self):
        for f in (self.master, self.profile, self.card, self.thumb):
            if f:
                f.delete(save=False)


def video_upload_path(instance, filename):
    return f"talent/{instance.talent.cast_id}/videos/{filename}"


class FeaturedVideo(TimeStampedModel):
    """FR-008: exactly three slots per talent (rows exist only for filled slots)."""

    PLATFORM_CHOICES = [
        ("youtube", "YouTube"),
        ("instagram", "Instagram"),
        ("vimeo", "Vimeo"),
        ("google_drive", "Google Drive"),
        ("facebook", "Facebook"),
        ("upload", "Uploaded file"),
        ("other", "Other"),
    ]
    talent = models.ForeignKey(Talent, on_delete=models.CASCADE, related_name="featured_videos")
    position = models.PositiveSmallIntegerField(validators=[MinValueValidator(1), MaxValueValidator(3)])
    title = models.CharField(max_length=150)
    platform = models.CharField(max_length=16, choices=PLATFORM_CHOICES, default="youtube")
    url = models.URLField(max_length=500, blank=True)
    file = models.FileField(upload_to=video_upload_path, blank=True)
    description = models.TextField(blank=True)
    thumbnail_url = models.URLField(max_length=500, blank=True)

    class Meta:
        ordering = ["position"]
        constraints = [models.UniqueConstraint(fields=["talent", "position"], name="uniq_video_position")]


class PortfolioLink(TimeStampedModel):
    """Additional links, stored apart from the three featured slots."""

    talent = models.ForeignKey(Talent, on_delete=models.CASCADE, related_name="portfolio_links")
    title = models.CharField(max_length=150)
    url = models.URLField(max_length=500)
    kind = models.CharField(max_length=30, blank=True)

    class Meta:
        ordering = ["id"]


class Favorite(models.Model):
    """FR-011: personal favourites per staff member."""

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="favorites")
    talent = models.ForeignKey(Talent, on_delete=models.CASCADE, related_name="favorited_by")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["user", "talent"], name="uniq_favorite")]


class ContactNote(TimeStampedModel):
    """FR-017: internal notes and contact history. Never exported to clients by default."""

    KIND_CHOICES = [
        ("note", "Note"),
        ("call", "Call"),
        ("whatsapp", "WhatsApp"),
        ("email", "Email"),
        ("in_person", "In Person"),
        ("audition", "Audition"),
        ("other", "Other"),
    ]
    RESULT_CHOICES = [
        ("connected", "Connected"),
        ("no_answer", "No Answer"),
        ("interested", "Interested"),
        ("follow_up", "Follow Up"),
        ("declined", "Declined"),
        ("unavailable", "Unavailable"),
        ("other", "Other"),
    ]
    talent = models.ForeignKey(Talent, on_delete=models.CASCADE, related_name="contact_notes")
    kind = models.CharField(max_length=16, choices=KIND_CHOICES, default="note")
    result = models.CharField(max_length=16, choices=RESULT_CHOICES, blank=True)
    content = models.TextField()
    staff = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="contact_notes")
    interaction_at = models.DateTimeField(default=timezone.now, db_index=True)
    project = models.ForeignKey("casting.Project", null=True, blank=True, on_delete=models.SET_NULL, related_name="contact_notes")
    follow_up_on = models.DateField(null=True, blank=True, db_index=True)
    follow_up_done = models.BooleanField(default=False)

    class Meta:
        ordering = ["-interaction_at", "-id"]

    @property
    def is_contact(self):
        return self.kind != "note"


class Guardian(TimeStampedModel):
    talent = models.ForeignKey(Talent, on_delete=models.CASCADE, related_name="guardians")
    name = models.CharField(max_length=150)
    relationship = models.CharField(max_length=40)
    phone = models.CharField(max_length=32)
    alt_phone = models.CharField(max_length=32, blank=True)
    email = models.EmailField(blank=True)
    address = models.TextField(blank=True)
    id_verified = models.BooleanField(default=False)
    is_primary = models.BooleanField(default=True)
    notes = models.TextField(blank=True)


def consent_evidence_path(instance, filename):
    return f"talent/{instance.talent.cast_id}/consent/{filename}"


class Consent(TimeStampedModel):
    """FR-020."""

    TYPE_CHOICES = [
        ("data_storage", "Store personal details"),
        ("portfolio_use", "Use photos/videos for casting submissions"),
        ("client_sharing", "Share profile with clients"),
        ("marketing", "Use in CreativHeads marketing"),
        ("guardian", "Parent/guardian consent (minor)"),
    ]
    STATUS_CHOICES = [
        ("pending", "Pending"),
        ("granted", "Granted"),
        ("refused", "Refused"),
        ("withdrawn", "Withdrawn"),
        ("expired", "Expired"),
    ]
    METHOD_CHOICES = [
        ("signed_form", "Signed form"),
        ("digital_form", "Digital form"),
        ("email", "Email"),
        ("whatsapp", "WhatsApp message"),
        ("verbal", "Verbal (recorded by staff)"),
        ("other", "Other"),
    ]
    talent = models.ForeignKey(Talent, on_delete=models.CASCADE, related_name="consents")
    consent_type = models.CharField(max_length=20, choices=TYPE_CHOICES)
    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default="pending")
    obtained_on = models.DateField(null=True, blank=True)
    method = models.CharField(max_length=16, choices=METHOD_CHOICES, blank=True)
    evidence = models.FileField(upload_to=consent_evidence_path, blank=True)
    scope = models.TextField(blank=True, help_text="What use is allowed, and any limits")
    given_by = models.CharField(max_length=150, blank=True, help_text="Talent or guardian name")
    expires_on = models.DateField(null=True, blank=True)
    withdrawn_on = models.DateField(null=True, blank=True)
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ["consent_type", "-obtained_on", "-id"]

    @property
    def is_effective(self):
        if self.status != "granted":
            return False
        if self.expires_on and self.expires_on < timezone.localdate():
            return False
        return True


class RetentionReview(TimeStampedModel):
    """Opened automatically when consent is withdrawn (FR-020)."""

    STATUS_CHOICES = [("open", "Open"), ("retained", "Retained (lawful basis recorded)"), ("anonymised", "Anonymised"), ("deleted", "Deleted")]
    talent = models.ForeignKey(Talent, on_delete=models.CASCADE, related_name="retention_reviews")
    consent = models.ForeignKey(Consent, null=True, blank=True, on_delete=models.SET_NULL)
    reason = models.CharField(max_length=255)
    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default="open")
    due_on = models.DateField(default=datetime.date.today)
    resolution_notes = models.TextField(blank=True)
    resolved_at = models.DateTimeField(null=True, blank=True)
    resolved_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")

    class Meta:
        ordering = ["status", "due_on"]
