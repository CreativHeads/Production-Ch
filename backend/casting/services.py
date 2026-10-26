"""Booking conflicts, availability sync and shortlist history (FR-014–016)."""
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from core import audit
from core.exceptions import Conflict
from talent.services import booking_blockers

from .models import Availability, Booking, ShortlistEntry, ShortlistEvent


def overlapping(qs, start, end):
    return qs.filter(start__lt=end, end__gt=start)


def find_conflicts(talent, start, end, exclude_booking_id=None):
    """Return (blocking, warnings). Blocking = other confirmed bookings."""
    blocking, warnings = [], []
    bookings = Booking.objects.filter(talent=talent, shoot_start__lt=end, shoot_end__gt=start).exclude(
        status="cancelled"
    ).select_related("project", "role")
    if exclude_booking_id:
        bookings = bookings.exclude(pk=exclude_booking_id)
    for b in bookings:
        item = {
            "type": "booking",
            "id": b.id,
            "status": b.status,
            "label": f"{b.project.title} — {b.role.name}",
            "start": b.shoot_start.isoformat(),
            "end": b.shoot_end.isoformat(),
        }
        (blocking if b.status in ("confirmed", "completed") else warnings).append(item)

    avail = overlapping(Availability.objects.filter(talent=talent, booking__isnull=True), start, end).filter(
        kind__in=["unavailable", "tentative_hold", "confirmed_booking"]
    )
    for a in avail:
        warnings.append(
            {
                "type": "availability",
                "id": a.id,
                "status": a.kind,
                "label": f"{a.get_kind_display()}" + (f" — {a.notes[:60]}" if a.notes else ""),
                "start": a.start.isoformat(),
                "end": a.end.isoformat(),
            }
        )
    return blocking, warnings


def sync_availability(booking, user=None):
    """Keep one availability row mirroring each active booking."""
    if booking.status in ("cancelled",):
        Availability.objects.filter(booking=booking).delete()
        return
    kind = "confirmed_booking" if booking.status in ("confirmed", "completed") else "tentative_hold"
    Availability.objects.update_or_create(
        booking=booking,
        defaults={
            "talent": booking.talent,
            "start": booking.shoot_start,
            "end": booking.shoot_end,
            "kind": kind,
            "confirmed_at": booking.confirmed_at,
            "source": booking.confirmation_source or "system",
            "notes": f"{booking.project.title} — {booking.role.name}",
            "project": booking.project,
            "updated_by": user,
        },
    )


@transaction.atomic
def save_booking(booking, user, request=None, override=False, override_reason="", acknowledge_warnings=False, is_new=False):
    """Validate and persist a booking.

    - Overlapping *confirmed* bookings block unless override=True with a reason.
    - Other overlaps (holds, unavailability) require acknowledge_warnings.
    - Child artists need guardian consent etc. before confirmation.
    """
    if booking.shoot_end <= booking.shoot_start:
        raise Conflict("The shoot must end after it starts.", code="invalid_dates")

    if booking.status in ("tentative", "confirmed"):
        problems = booking_blockers(booking.talent)
        if problems:
            raise Conflict("This talent can't be booked yet: " + " ".join(problems), code="booking_blocked", extra={"blockers": problems})

    blocking, warnings = find_conflicts(booking.talent, booking.shoot_start, booking.shoot_end, booking.pk)
    becoming_confirmed = booking.status in ("confirmed", "completed")
    if becoming_confirmed and blocking:
        if not override:
            raise Conflict(
                "This talent already has a confirmed booking on these dates. Use an override with a reason to proceed.",
                code="booking_conflict",
                extra={"conflicts": blocking, "warnings": warnings, "can_override": True},
            )
        if not override_reason.strip():
            raise Conflict("Please give a reason for overriding the booking conflict.", code="override_reason_required")
        booking.conflict_override = True
        booking.override_reason = override_reason.strip()
        booking.override_by = user
        booking.override_at = timezone.now()
    elif (warnings or blocking) and not acknowledge_warnings and not override:
        raise Conflict(
            "There are overlapping holds or unavailability on these dates.",
            code="booking_warning",
            extra={"conflicts": blocking, "warnings": warnings, "can_override": bool(blocking)},
        )

    if becoming_confirmed and not booking.confirmed_at:
        booking.confirmed_at = timezone.now()
    if booking.status == "completed" and booking.outcome == "pending":
        booking.outcome = "completed"
    if booking.status == "completed" and not booking.completed_on:
        booking.completed_on = timezone.localdate()
    booking.updated_by = user
    if is_new:
        booking.created_by = user
    booking.save()
    sync_availability(booking, user)
    if booking.conflict_override:
        audit.log(request or user, "booking.conflict_override", booking, message=booking.override_reason)
    return booking, warnings


def record_event(entry, action, user, from_value="", to_value="", note=""):
    return ShortlistEvent.objects.create(
        entry=entry, action=action, from_value=str(from_value or "")[:120], to_value=str(to_value or "")[:120], note=note, actor=user
    )


def shortlist_blockers(talent):
    problems = []
    if talent.consent_hold:
        problems.append("Consent has been withdrawn for this talent, so they can't be shortlisted.")
    if talent.is_archived:
        problems.append("This talent is archived. Restore them first.")
    if talent.status == talent.STATUS_STAGING:
        problems.append("This talent is still in import staging. Add a primary photo to publish them first.")
    return problems


@transaction.atomic
def add_to_shortlist(role, talent, user, notes="", proposed_fee=None):
    problems = shortlist_blockers(talent)
    if problems:
        raise Conflict(" ".join(problems), code="shortlist_blocked")
    entry = ShortlistEntry.objects.filter(role=role, talent=talent).first()
    if entry:
        if entry.is_removed:
            entry.is_removed = False
            entry.removed_at = None
            entry.status = "shortlisted"
            entry.updated_by = user
            entry.save()
            record_event(entry, "restored", user, note=notes)
        return entry, False
    max_p = role.shortlist.order_by("-priority").values_list("priority", flat=True).first() or 0
    entry = ShortlistEntry.objects.create(
        role=role,
        talent=talent,
        priority=max_p + 1,
        notes=notes,
        proposed_fee=proposed_fee if proposed_fee is not None else talent.expected_fee,
        fee_basis=talent.fee_type or role.fee_basis,
        created_by=user,
        updated_by=user,
    )
    record_event(entry, "added", user, to_value="shortlisted", note=notes)
    return entry, True
