from django.conf import settings
from django.db import models
from django.utils import timezone

from core.models import Sequence, SoftDeleteModel, TimeStampedModel
from talent.models import Talent, Term

FEE_BASIS_CHOICES = [
    ("per_day", "Per day"),
    ("per_shoot", "Per shoot"),
    ("per_project", "Per project"),
    ("per_hour", "Per hour"),
]


class Project(SoftDeleteModel, TimeStampedModel):
    """FR-012."""

    STATUS_CHOICES = [
        ("draft", "Draft"),
        ("casting", "Casting"),
        ("ready", "Ready"),
        ("in_production", "In Production"),
        ("completed", "Completed"),
        ("cancelled", "Cancelled"),
        ("archived", "Archived"),
    ]
    OPEN_STATUSES = ["draft", "casting", "ready", "in_production"]
    PRODUCTION_TYPES = [
        ("ad_film", "Ad film / TVC"),
        ("feature_film", "Feature film"),
        ("short_film", "Short film"),
        ("web_series", "Web series"),
        ("tv", "Television"),
        ("music_video", "Music video"),
        ("corporate", "Corporate video"),
        ("photo_shoot", "Photo shoot"),
        ("social", "Social / influencer content"),
        ("event", "Event"),
        ("other", "Other"),
    ]

    title = models.CharField(max_length=200)
    client_name = models.CharField(max_length=200, blank=True)
    code = models.CharField(max_length=30, unique=True, help_text="Leave blank to auto-generate")
    description = models.TextField(blank=True)
    production_type = models.CharField(max_length=20, choices=PRODUCTION_TYPES, default="ad_film")
    shoot_start = models.DateField(null=True, blank=True)
    shoot_end = models.DateField(null=True, blank=True)
    location = models.CharField(max_length=200, blank=True)
    budget = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    currency = models.CharField(max_length=3, default="INR")
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default="draft", db_index=True)
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.code} · {self.title}"

    def save(self, *args, **kwargs):
        if not self.code:
            year = timezone.localdate().year
            self.code = f"CH-PRJ-{year}-{Sequence.next(f'project_{year}'):04d}"
        super().save(*args, **kwargs)


class Role(TimeStampedModel):
    """FR-013."""

    GENDER_CHOICES = [("any", "Any"), ("female", "Female"), ("male", "Male"), ("non_binary", "Non-binary"), ("other", "Other")]

    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="roles")
    name = models.CharField(max_length=150)
    description = models.TextField(blank=True)
    positions_needed = models.PositiveSmallIntegerField(default=1)
    gender_preference = models.CharField(max_length=12, choices=GENDER_CHOICES, default="any")
    age_min = models.PositiveSmallIntegerField(null=True, blank=True)
    age_max = models.PositiveSmallIntegerField(null=True, blank=True)
    languages = models.ManyToManyField(Term, related_name="roles_requiring_language", blank=True)
    accent_requirements = models.CharField(max_length=200, blank=True)
    categories = models.ManyToManyField(Term, related_name="roles_in_category", blank=True)
    tags = models.ManyToManyField(Term, related_name="roles_with_tag", blank=True)
    skills = models.ManyToManyField(Term, related_name="roles_requiring_skill", blank=True)
    location = models.CharField(max_length=150, blank=True)
    travel_requirement = models.CharField(max_length=16, choices=Talent.TRAVEL_CHOICES, blank=True)
    travel_notes = models.CharField(max_length=255, blank=True)
    budget = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    fee_basis = models.CharField(max_length=16, choices=FEE_BASIS_CHOICES, blank=True)
    shoot_start = models.DateField(null=True, blank=True)
    shoot_end = models.DateField(null=True, blank=True)
    notes = models.TextField(blank=True)
    sort_order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["sort_order", "id"]

    def __str__(self):
        return f"{self.name} — {self.project.title}"


class ShortlistEntry(TimeStampedModel):
    """FR-014. Removal is a flag so history is always retained."""

    STATUS_CHOICES = [
        ("shortlisted", "Shortlisted"),
        ("contacted", "Contacted"),
        ("interested", "Interested"),
        ("unavailable", "Unavailable"),
        ("selected", "Selected"),
        ("rejected", "Rejected"),
        ("withdrawn", "Withdrawn"),
    ]
    role = models.ForeignKey(Role, on_delete=models.CASCADE, related_name="shortlist")
    talent = models.ForeignKey(Talent, on_delete=models.PROTECT, related_name="shortlist_entries")
    priority = models.PositiveIntegerField(default=0)
    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default="shortlisted", db_index=True)
    notes = models.TextField(blank=True)
    proposed_fee = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    fee_basis = models.CharField(max_length=16, choices=FEE_BASIS_CHOICES, blank=True)
    availability_confirmed = models.BooleanField(default=False)
    availability_confirmed_at = models.DateTimeField(null=True, blank=True)
    availability_notes = models.CharField(max_length=255, blank=True)
    is_removed = models.BooleanField(default=False, db_index=True)
    removed_at = models.DateTimeField(null=True, blank=True)
    removed_reason = models.CharField(max_length=255, blank=True)

    class Meta:
        ordering = ["priority", "id"]
        constraints = [models.UniqueConstraint(fields=["role", "talent"], name="uniq_shortlist_role_talent")]


class ShortlistEvent(models.Model):
    """Immutable history row for a shortlist entry."""

    entry = models.ForeignKey(ShortlistEntry, on_delete=models.CASCADE, related_name="events")
    action = models.CharField(max_length=24)  # added, status, removed, restored, fee, priority, note, availability
    from_value = models.CharField(max_length=120, blank=True)
    to_value = models.CharField(max_length=120, blank=True)
    note = models.TextField(blank=True)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-created_at", "-id"]


class Availability(TimeStampedModel):
    """FR-015 — tracked separately from shortlist status."""

    TYPE_CHOICES = [
        ("available", "Available"),
        ("unavailable", "Unavailable"),
        ("tentative_hold", "Tentative Hold"),
        ("confirmed_booking", "Confirmed Booking"),
    ]
    SOURCE_CHOICES = [
        ("call", "Phone call"),
        ("whatsapp", "WhatsApp"),
        ("email", "Email"),
        ("in_person", "In person"),
        ("agent", "Agent / manager"),
        ("system", "Booking (system)"),
        ("other", "Other"),
    ]
    talent = models.ForeignKey(Talent, on_delete=models.CASCADE, related_name="availability")
    start = models.DateTimeField(db_index=True)
    end = models.DateTimeField(db_index=True)
    kind = models.CharField(max_length=20, choices=TYPE_CHOICES)
    confirmed_at = models.DateTimeField(null=True, blank=True)
    source = models.CharField(max_length=12, choices=SOURCE_CHOICES, blank=True)
    notes = models.TextField(blank=True)
    booking = models.OneToOneField("Booking", null=True, blank=True, on_delete=models.CASCADE, related_name="availability_entry")
    project = models.ForeignKey(Project, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")

    class Meta:
        ordering = ["start"]


class Booking(TimeStampedModel):
    """FR-015/016. Fees are snapshots — never derived from the profile later."""

    STATUS_CHOICES = [
        ("tentative", "Tentative hold"),
        ("confirmed", "Confirmed"),
        ("completed", "Completed"),
        ("cancelled", "Cancelled"),
    ]
    OUTCOME_CHOICES = [
        ("pending", "Pending"),
        ("completed", "Shoot completed"),
        ("partially_completed", "Partially completed"),
        ("no_show", "No-show"),
        ("cancelled_client", "Cancelled by client"),
        ("cancelled_talent", "Cancelled by talent"),
        ("replaced", "Replaced"),
    ]
    project = models.ForeignKey(Project, on_delete=models.PROTECT, related_name="bookings")
    role = models.ForeignKey(Role, on_delete=models.PROTECT, related_name="bookings")
    talent = models.ForeignKey(Talent, on_delete=models.PROTECT, related_name="bookings")
    shortlist_entry = models.ForeignKey(ShortlistEntry, null=True, blank=True, on_delete=models.SET_NULL, related_name="bookings")
    shoot_start = models.DateTimeField()
    shoot_end = models.DateTimeField()
    schedule_notes = models.TextField(blank=True)
    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default="tentative", db_index=True)

    proposed_fee = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    agreed_fee = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    fee_basis = models.CharField(max_length=16, choices=FEE_BASIS_CHOICES, blank=True)
    currency = models.CharField(max_length=3, default="INR")
    travel_charges = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    accommodation_charges = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    other_charges_notes = models.CharField(max_length=255, blank=True)

    confirmed_at = models.DateTimeField(null=True, blank=True)
    confirmation_source = models.CharField(max_length=12, choices=Availability.SOURCE_CHOICES, blank=True)
    confirmation_notes = models.TextField(blank=True)

    outcome = models.CharField(max_length=20, choices=OUTCOME_CHOICES, default="pending")
    completed_on = models.DateField(null=True, blank=True)
    deliverable_url = models.URLField(max_length=500, blank=True)

    conflict_override = models.BooleanField(default=False)
    override_reason = models.TextField(blank=True)
    override_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    override_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-shoot_start"]

    def __str__(self):
        return f"{self.talent.full_name} · {self.role.name} ({self.project.code})"
