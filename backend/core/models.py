from django.conf import settings
from django.core.cache import cache
from django.db import models, transaction
from django.utils import timezone

DEFAULT_COMPLETENESS_FIELDS = [
    "primary_photo",
    "name",
    "phone",
    "location",
    "category",
    "age",
    "fee",
    "languages",
    "featured_video",
    "consent",
]

COMPLETENESS_LABELS = {
    "primary_photo": "Primary photo",
    "name": "Name",
    "phone": "Phone",
    "location": "Location",
    "category": "Category",
    "age": "Age information",
    "fee": "Expected fee (or marked Unknown)",
    "languages": "Languages",
    "featured_video": "At least one featured video",
    "consent": "Consent verification",
    "gender": "Gender",
    "height": "Height",
    "skills": "Skills",
    "instagram": "Instagram",
    "experience": "Experience level",
}


class TimeStampedModel(models.Model):
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )

    class Meta:
        abstract = True


class LiveManager(models.Manager):
    """Default manager: hides soft-deleted rows."""

    def get_queryset(self):
        return super().get_queryset().filter(deleted_at__isnull=True)


class SoftDeleteModel(models.Model):
    """FR-022: soft-deleted records are recoverable from the Trash."""

    deleted_at = models.DateTimeField(null=True, blank=True, db_index=True)
    deleted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )

    objects = LiveManager()
    all_objects = models.Manager()

    class Meta:
        abstract = True

    def soft_delete(self, user=None):
        self.deleted_at = timezone.now()
        self.deleted_by = user
        self.save(update_fields=["deleted_at", "deleted_by"])

    def restore(self):
        self.deleted_at = None
        self.deleted_by = None
        self.save(update_fields=["deleted_at", "deleted_by"])


class AuditLog(models.Model):
    """Operational audit trail (FR-001, FR-006, FR-022)."""

    created_at = models.DateTimeField(default=timezone.now, db_index=True)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="audit_entries"
    )
    actor_name = models.CharField(max_length=150, blank=True)
    action = models.CharField(max_length=64, db_index=True)
    entity_type = models.CharField(max_length=64, blank=True, db_index=True)
    entity_id = models.CharField(max_length=64, blank=True, db_index=True)
    entity_label = models.CharField(max_length=255, blank=True)
    changes = models.JSONField(default=dict, blank=True)
    message = models.TextField(blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.CharField(max_length=255, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["entity_type", "entity_id", "-created_at"])]

    def __str__(self):
        return f"{self.created_at:%Y-%m-%d %H:%M} {self.actor_name} {self.action} {self.entity_label}"


class SystemSetting(models.Model):
    """Single-row table of staff-configurable behaviour."""

    session_idle_hours = models.DecimalField(max_digits=5, decimal_places=2, default=8)
    review_interval_days = models.PositiveIntegerField(default=180)
    contact_review_interval_days = models.PositiveIntegerField(default=180)
    export_expiry_hours = models.PositiveIntegerField(default=24)
    completeness_fields = models.JSONField(default=list, blank=True)
    require_consent_for_all = models.BooleanField(default=True)
    default_currency = models.CharField(max_length=3, default="INR")
    default_country_code = models.CharField(max_length=4, default="91")
    whatsapp_template = models.TextField(
        default="Hi {first_name}, this is {staff_name} from CreativHeads. We have a casting opportunity you may be interested in."
    )
    updated_at = models.DateTimeField(auto_now=True)

    CACHE_KEY = "system-settings-v1"

    class Meta:
        permissions = [("manage_backups", "Can view backup status and download full backups")]

    def save(self, *args, **kwargs):
        self.pk = 1
        super().save(*args, **kwargs)
        cache.delete(self.CACHE_KEY)

    @classmethod
    def get(cls):
        obj = cache.get(cls.CACHE_KEY)
        if obj is None:
            obj, _ = cls.objects.get_or_create(
                pk=1, defaults={"completeness_fields": list(DEFAULT_COMPLETENESS_FIELDS)}
            )
            if not obj.completeness_fields:
                obj.completeness_fields = list(DEFAULT_COMPLETENESS_FIELDS)
            cache.set(cls.CACHE_KEY, obj, 60)
        return obj


class Sequence(models.Model):
    """Gap-tolerant, concurrency-safe counter for human-readable IDs."""

    name = models.CharField(max_length=32, primary_key=True)
    value = models.PositiveBigIntegerField(default=0)

    @classmethod
    def next(cls, name):
        with transaction.atomic():
            seq, _ = cls.objects.select_for_update().get_or_create(name=name)
            seq.value += 1
            seq.save(update_fields=["value"])
            return seq.value
