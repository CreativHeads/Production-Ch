"""Delete expired export files and abandoned import uploads. Run hourly."""
from datetime import timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone

from dataio.models import ExportJob, ImportBatch


class Command(BaseCommand):
    help = "Purge expired private exports"

    def handle(self, *args, **opts):
        n = 0
        for job in ExportJob.objects.filter(purged=False, expires_at__lte=timezone.now()):
            if job.file:
                job.file.delete(save=False)
            job.purged = True
            job.save(update_fields=["purged", "file"])
            n += 1
        stale = list(ImportBatch.objects.filter(status__in=["uploaded", "mapped"], created_at__lte=timezone.now() - timedelta(days=7)))
        for b in stale:
            b.file.delete(save=False)
            if b.photos_zip:
                b.photos_zip.delete(save=False)
            b.status = "cancelled"
            b.save(update_fields=["status"])
        self.stdout.write(f"Purged {n} exports, cancelled {len(stale)} stale imports")
