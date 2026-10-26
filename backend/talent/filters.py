"""FR-003 / FR-010 directory search.

AND across different fields; OR within a multi-select field (comma-separated ids/values).
"""
from datetime import datetime, time, timedelta

from django.db.models import Exists, F, OuterRef, Q, Subquery
from django.utils import timezone
from django.utils.dateparse import parse_date

from casting.models import Availability, Booking
from talent.models import ContactNote, Favorite, Talent, TalentLanguage
from talent.reminders import apply_reminder

SORTS = {
    "name": ["full_name", "id"],
    "-name": ["-full_name", "-id"],
    "newest": ["-created_at", "-id"],
    "oldest": ["created_at", "id"],
    "updated": ["-updated_at", "-id"],
    "age": [F("playing_age_min").asc(nulls_last=True), "full_name"],
    "-age": [F("playing_age_max").desc(nulls_last=True), "full_name"],
    "fee": [F("expected_fee").asc(nulls_last=True), "full_name"],
    "-fee": [F("expected_fee").desc(nulls_last=True), "full_name"],
    "completeness": ["completeness", "full_name"],
    "last_contact": [F("last_contact_at").desc(nulls_last=True), "full_name"],
}


def _multi(params, key):
    raw = params.get(key, "")
    if isinstance(raw, list):
        vals = raw
    else:
        vals = [v.strip() for v in str(raw).split(",")]
    return [v for v in vals if v]


def _ints(params, key):
    out = []
    for v in _multi(params, key):
        try:
            out.append(int(v))
        except ValueError:
            pass
    return out


def _int(params, key):
    try:
        return int(params.get(key))
    except (TypeError, ValueError):
        return None


def _dec(params, key):
    try:
        return float(params.get(key))
    except (TypeError, ValueError):
        return None


def _day_bounds(d):
    tz = timezone.get_current_timezone()
    start = timezone.make_aware(datetime.combine(d, time.min), tz)
    return start, start + timedelta(days=1)


def annotate_for_user(qs, user):
    last_contact = (
        ContactNote.objects.filter(talent=OuterRef("pk")).exclude(kind="note").order_by("-interaction_at").values("interaction_at")[:1]
    )
    return qs.annotate(
        is_favorite=Exists(Favorite.objects.filter(user=user, talent=OuterRef("pk"))),
        last_contact_at=Subquery(last_contact),
    )


def filter_talent(qs, params, user):
    """Apply every supported filter. `params` is a QueryDict or dict."""
    # Scope -------------------------------------------------------------
    archived = params.get("archived", "exclude")
    if archived == "only":
        qs = qs.filter(is_archived=True)
    elif archived != "include":
        qs = qs.filter(is_archived=False)
    status = params.get("status")
    if status == "staging":
        qs = qs.filter(status=Talent.STATUS_STAGING)
    else:
        qs = qs.exclude(status=Talent.STATUS_STAGING)
        if status in (Talent.STATUS_ACTIVE, Talent.STATUS_NEEDS_DETAILS):
            qs = qs.filter(status=status)

    # Text search -------------------------------------------------------
    q = (params.get("q") or "").strip()
    if q:
        for word in q.split()[:6]:
            qs = qs.filter(
                Q(full_name__icontains=word)
                | Q(screen_name__icontains=word)
                | Q(cast_id__icontains=word)
                | Q(city__icontains=word)
                | Q(district__icontains=word)
                | Q(phone_normalized__contains=word)
                | Q(categories__name__icontains=word)
                | Q(tags__name__icontains=word)
                | Q(skills__name__icontains=word)
                | Q(languages__language__name__icontains=word)
                | Q(languages__accents__icontains=word)
            )
        qs = qs.distinct()

    # Taxonomy (OR within field) -----------------------------------------
    for key, rel in (("category", "categories"), ("tag", "tags"), ("skill", "skills")):
        ids = _ints(params, key)
        if ids:
            qs = qs.filter(Exists(Talent.objects.filter(pk=OuterRef("pk"), **{f"{rel}__in": ids})))
    lang_ids = _ints(params, "language")
    if lang_ids:
        qs = qs.filter(Exists(TalentLanguage.objects.filter(talent=OuterRef("pk"), language_id__in=lang_ids)))
    accents = _multi(params, "accent")
    if accents:
        acc_q = Q()
        for a in accents:
            acc_q |= Q(accents__icontains=a)
        qs = qs.filter(Exists(TalentLanguage.objects.filter(acc_q, talent=OuterRef("pk"))))

    # Simple multi-value fields ------------------------------------------
    for key, field in (("gender", "gender"), ("experience", "experience_level"), ("fee_type", "fee_type"), ("travel", "travel_willingness")):
        vals = _multi(params, key)
        if vals:
            qs = qs.filter(**{f"{field}__in": vals})
    cities = _multi(params, "city")
    if cities:
        cq = Q()
        for c in cities:
            cq |= Q(city__iexact=c)
        qs = qs.filter(cq)
    districts = _multi(params, "district")
    if districts:
        dq = Q()
        for d in districts:
            dq |= Q(district__iexact=d)
        qs = qs.filter(dq)
    location = (params.get("location") or "").strip()
    if location:
        qs = qs.filter(Q(city__icontains=location) | Q(district__icontains=location) | Q(state__icontains=location))

    # Travel willingness: "at least" semantics when travel_min given
    travel_min = params.get("travel_min")
    order = [c[0] for c in Talent.TRAVEL_CHOICES]
    if travel_min in order:
        qs = qs.filter(travel_willingness__in=order[order.index(travel_min):])

    # Playing age: overlap of talent range with requested range ------------
    amin, amax = _int(params, "age_min"), _int(params, "age_max")
    if amin is not None:
        qs = qs.filter(Q(playing_age_max__gte=amin) | Q(playing_age_max__isnull=True, playing_age_min__gte=amin))
    if amax is not None:
        qs = qs.filter(Q(playing_age_min__lte=amax) | Q(playing_age_min__isnull=True, playing_age_max__lte=amax))
    if (amin is not None or amax is not None) and params.get("age_strict") == "1":
        qs = qs.exclude(playing_age_min__isnull=True, playing_age_max__isnull=True)

    # Fee range -------------------------------------------------------------
    fmin, fmax = _dec(params, "fee_min"), _dec(params, "fee_max")
    if fmin is not None:
        qs = qs.filter(Q(expected_fee__gte=fmin) | Q(expected_fee_max__gte=fmin))
    if fmax is not None:
        qs = qs.filter(expected_fee__lte=fmax)
    if params.get("fee_unknown") == "1":
        qs = qs.filter(fee_unknown=True)

    # Favourites --------------------------------------------------------------
    if params.get("favorite") in ("1", "true"):
        qs = qs.filter(is_favorite=True)

    # Completeness ---------------------------------------------------------
    comp = params.get("completeness")
    if comp == "complete":
        qs = qs.filter(completeness__gte=100)
    elif comp == "incomplete":
        qs = qs.filter(completeness__lt=100)
    cmin = _int(params, "completeness_min")
    if cmin is not None:
        qs = qs.filter(completeness__gte=cmin)

    # Availability on a date ----------------------------------------------
    d = parse_date(params.get("available_on") or "")
    if d:
        start, end = _day_bounds(d)
        blocked = Availability.objects.filter(
            talent=OuterRef("pk"), start__lt=end, end__gt=start, kind__in=["unavailable", "confirmed_booking"]
        )
        qs = qs.filter(~Exists(blocked))
        if params.get("available_strict") == "1":
            explicit = Availability.objects.filter(talent=OuterRef("pk"), start__lt=end, end__gt=start, kind="available")
            qs = qs.filter(Exists(explicit))

    # Booking status --------------------------------------------------------
    bs = params.get("booking_status")
    now = timezone.now()
    if bs == "booked_upcoming":
        qs = qs.filter(Exists(Booking.objects.filter(talent=OuterRef("pk"), status="confirmed", shoot_end__gte=now)))
    elif bs == "on_hold":
        qs = qs.filter(Exists(Booking.objects.filter(talent=OuterRef("pk"), status="tentative", shoot_end__gte=now)))
    elif bs == "previously_booked":
        qs = qs.filter(Exists(Booking.objects.filter(talent=OuterRef("pk"), status__in=["confirmed", "completed"])))
    elif bs == "never_booked":
        qs = qs.filter(~Exists(Booking.objects.filter(talent=OuterRef("pk"), status__in=["confirmed", "completed"])))

    # Last contact ----------------------------------------------------------
    lc_before = parse_date(params.get("last_contact_before") or "")
    lc_after = parse_date(params.get("last_contact_after") or "")
    if lc_before:
        qs = qs.filter(Q(last_contact_at__lt=_day_bounds(lc_before)[0]) | Q(last_contact_at__isnull=True))
    if lc_after:
        qs = qs.filter(last_contact_at__gte=_day_bounds(lc_after)[0])
    if params.get("never_contacted") == "1":
        qs = qs.filter(last_contact_at__isnull=True)

    # Added date --------------------------------------------------------
    added_after = parse_date(params.get("added_after") or "")
    if added_after:
        qs = qs.filter(created_at__gte=_day_bounds(added_after)[0])

    # Review reminders (FR-019) ------------------------------------------
    review = params.get("review")
    if review:
        qs = apply_reminder(qs, review)

    ids = _ints(params, "ids")
    if ids:
        qs = qs.filter(pk__in=ids)

    sort = params.get("sort") or "name"
    qs = qs.order_by(*SORTS.get(sort, SORTS["name"]))
    return qs
