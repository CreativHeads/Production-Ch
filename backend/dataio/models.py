from django.conf import settings
from django.db import models
from django.utils import timezone

from .storage import export_storage, import_storage


class ImportBatch(models.Model):
    STATUS_CHOICES = [
        ("uploaded", "Uploaded"),
        ("mapped", "Mapped & validated"),
        ("importing", "Importing"),
        ("completed", "Completed"),
        ("failed", "Failed"),
        ("cancelled", "Cancelled"),
    ]
    created_at = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    original_name = models.CharField(max_length=255)
    file = models.FileField(upload_to="%Y/%m/", storage=import_storage)
    photos_zip = models.FileField(upload_to="%Y/%m/", storage=import_storage, blank=True)
    headers = models.JSONField(default=list)
    mapping = models.JSONField(default=dict, blank=True)  # column header -> field key
    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default="uploaded")
    total_rows = models.PositiveIntegerField(default=0)
    summary = models.JSONField(default=dict, blank=True)
    error = models.TextField(blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]


class ImportRow(models.Model):
    ACTION_CHOICES = [
        ("create", "Create active profile"),
        ("staging", "Create in import staging (no photo)"),
        ("skip", "Skip"),
    ]
    batch = models.ForeignKey(ImportBatch, on_delete=models.CASCADE, related_name="rows")
    row_number = models.PositiveIntegerField()
    raw = models.JSONField(default=dict)
    data = models.JSONField(default=dict, blank=True)
    errors = models.JSONField(default=list, blank=True)
    warnings = models.JSONField(default=list, blank=True)
    duplicates = models.JSONField(default=list, blank=True)
    action = models.CharField(max_length=10, choices=ACTION_CHOICES, default="create")
    duplicate_acknowledged = models.BooleanField(default=False)
    result = models.CharField(max_length=20, blank=True)  # created / staged / skipped / failed
    result_message = models.CharField(max_length=255, blank=True)
    talent = models.ForeignKey("talent.Talent", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")

    class Meta:
        ordering = ["row_number"]


class ExportJob(models.Model):
    FORMAT_CHOICES = [("csv", "CSV"), ("xlsx", "Excel (XLSX)"), ("backup", "Full structured backup (ZIP)")]
    created_at = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    format = models.CharField(max_length=8, choices=FORMAT_CHOICES)
    params = models.JSONField(default=dict, blank=True)
    include_internal = models.BooleanField(default=False)
    file = models.FileField(upload_to="%Y/%m/", storage=export_storage, blank=True)
    filename = models.CharField(max_length=200, blank=True)
    row_count = models.PositiveIntegerField(default=0)
    expires_at = models.DateTimeField()
    download_count = models.PositiveIntegerField(default=0)
    last_downloaded_at = models.DateTimeField(null=True, blank=True)
    purged = models.BooleanField(default=False)

    class Meta:
        ordering = ["-created_at"]

    @property
    def is_expired(self):
        return self.purged or timezone.now() >= self.expires_at
