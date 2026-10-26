"""FR-019 review reminders. Each reminder is a named queryset filter so the
dashboard, reminders page and directory (?review=<key>) share one definition."""
from datetime import timedelta

from django.db.models import Exists, OuterRef, Q
from django.utils import timezone

from core.models import SystemSetting

from .models import ContactNote, Talent, TalentPhoto

REMINDERS = [
    ("incomplete", "Incomplete profiles"),
    ("rates_stale", "Rates not reviewed recently"),
    ("contact_stale", "Contact details not re-verified recently"),
    ("photo_outdated", "Photos flagged as outdated"),
    ("consent_missing", "Missing guardian / consent details"),
    ("follow_up_due", "Follow-ups due"),
    ("consent_withdrawn", "Consent withdrawn — retention review"),
]
REMINDER_LABELS = dict(REMINDERS)


def base_queryset():
    return Talent.objects.filter(is_archived=False).exclude(status=Talent.STATUS_STAGING)


def apply_reminder(qs, key):
    s = SystemSetting.get()
    now = timezone.now()
    if key == "incomplete":
        return qs.filter(completeness__lt=100)
    if key == "rates_stale":
        cutoff = now - timedelta(days=s.review_interval_days)
        return qs.filter(Q(rates_reviewed_at__isnull=True) | Q(rates_reviewed_at__lt=cutoff))
    if key == "contact_stale":
        cutoff = now - timedelta(days=s.contact_review_interval_days)
        return qs.filter(Q(contact_verified_at__isnull=True) | Q(contact_verified_at__lt=cutoff))
    if key == "photo_outdated":
        return qs.filter(Exists(TalentPhoto.objects.filter(talent=OuterRef("pk"), is_outdated=True)))
    if key == "consent_missing":
        return qs.filter(missing_fields__contains=["consent"]) if _json_contains_supported() else qs.filter(
            pk__in=[t.pk for t in qs.only("pk", "missing_fields") if "consent" in (t.missing_fields or [])]
        )
    if key == "follow_up_due":
        due = ContactNote.objects.filter(
            talent=OuterRef("pk"), follow_up_on__isnull=False, follow_up_on__lte=timezone.localdate(), follow_up_done=False
        )
        return qs.filter(Exists(due))
    if key == "consent_withdrawn":
        return qs.filter(consent_hold=True)
    return qs


def _json_contains_supported():
    from django.db import connection

    return connection.vendor == "postgresql"


def reminder_counts():
    qs = base_queryset()
    return [{"key": k, "label": label, "count": apply_reminder(qs, k).count()} for k, label in REMINDERS]


def reminders_for(talent):
    out = []
    qs = Talent.objects.filter(pk=talent.pk)
    for key, label in REMINDERS:
        if apply_reminder(qs, key).exists():
            out.append({"key": key, "label": label})
    return out
