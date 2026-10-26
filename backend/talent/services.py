"""Business rules for talent: completeness, duplicates, photos, consent."""
import difflib
import io
import os
import re
import uuid
from datetime import timedelta

from django.core.files.base import ContentFile
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from PIL import Image, ImageOps, UnidentifiedImageError

from core.models import COMPLETENESS_LABELS, SystemSetting
from core.normalize import normalize_instagram, normalize_name, normalize_phone

from .models import Consent, RetentionReview, Talent, TalentPhoto

# ---------------------------------------------------------------------------
# Completeness (FR-019)
# ---------------------------------------------------------------------------


def consent_ok(talent):
    consents = list(talent.consents.all())
    effective = {c.consent_type for c in consents if c.is_effective}
    if talent.is_child:
        return "guardian" in effective and talent.guardians.exists()
    if SystemSetting.get().require_consent_for_all:
        return "data_storage" in effective
    return True


def _checks(talent):
    return {
        "primary_photo": lambda t: t.photos.filter(is_primary=True).exists(),
        "name": lambda t: bool(t.full_name.strip()),
        "phone": lambda t: bool(t.phone_normalized),
        "location": lambda t: bool(t.city.strip()),
        "category": lambda t: t.categories.exists(),
        "age": lambda t: bool(t.date_of_birth or t.approx_age or (t.playing_age_min and t.playing_age_max)),
        "fee": lambda t: t.expected_fee is not None or t.fee_unknown,
        "languages": lambda t: t.languages.exists(),
        "featured_video": lambda t: t.featured_videos.exists(),
        "consent": consent_ok,
        "gender": lambda t: bool(t.gender),
        "height": lambda t: bool(t.height_cm),
        "skills": lambda t: t.skills.exists(),
        "instagram": lambda t: bool(t.instagram_normalized),
        "experience": lambda t: bool(t.experience_level),
    }


def compute_completeness(talent):
    fields = SystemSetting.get().completeness_fields or []
    checks = _checks(talent)
    fields = [f for f in fields if f in checks]
    # Consent is only "required" when the rules say so
    missing = []
    for f in fields:
        try:
            ok = checks[f](talent)
        except Exception:
            ok = False
        if not ok:
            missing.append(f)
    score = round(100 * (len(fields) - len(missing)) / len(fields)) if fields else 100
    return score, missing


def refresh_completeness(talent, save=True):
    """Recalculate completeness and move between Active / Needs Details."""
    score, missing = compute_completeness(talent)
    talent.completeness = score
    talent.missing_fields = missing
    if talent.status != Talent.STATUS_STAGING:
        talent.status = Talent.STATUS_ACTIVE if not missing else Talent.STATUS_NEEDS_DETAILS
    if save:
        Talent.all_objects.filter(pk=talent.pk).update(
            completeness=score, missing_fields=missing, status=talent.status
        )
    return score, missing


def missing_labels(missing):
    return [COMPLETENESS_LABELS.get(m, m) for m in missing]


# ---------------------------------------------------------------------------
# Duplicate detection (FR-021)
# ---------------------------------------------------------------------------


def _age_of(t):
    return t.age if t.age is not None else (t.playing_age_min or None)


def find_duplicates(full_name="", phone="", alt_phone="", instagram="", city="", age=None, exclude_id=None, limit=10):
    """Return a list of {talent, reasons[], strength} sorted strongest first.

    strength: "exact" (normalised phone match — never silently created),
              "strong" (alt phone / Instagram), "possible" (similar name + location/age).
    Archived and soft-deleted records are included and flagged.
    """
    cc = SystemSetting.get().default_country_code
    phones = {p for p in (normalize_phone(phone, cc), normalize_phone(alt_phone, cc)) if p}
    insta = normalize_instagram(instagram)
    name_n = normalize_name(full_name)

    qs = Talent.all_objects.all()
    if exclude_id:
        qs = qs.exclude(pk=exclude_id)

    found = {}

    def add(t, reason, strength):
        rec = found.setdefault(t.pk, {"talent": t, "reasons": [], "strength": strength})
        rec["reasons"].append(reason)
        order = {"exact": 0, "strong": 1, "possible": 2}
        if order[strength] < order[rec["strength"]]:
            rec["strength"] = strength

    if phones:
        primary = normalize_phone(phone, cc)
        for t in qs.filter(Q(phone_normalized__in=phones) | Q(alt_phone_normalized__in=phones)):
            if primary and t.phone_normalized == primary:
                add(t, "Same phone number", "exact")
            elif primary and t.alt_phone_normalized == primary:
                add(t, "Phone matches their alternate phone", "exact")
            else:
                add(t, "Alternate phone number matches", "strong")
    if insta:
        for t in qs.filter(instagram_normalized=insta):
            add(t, "Same Instagram profile", "strong")

    if name_n and len(name_n) >= 3:
        first = name_n.split()[0]
        cand = qs.filter(Q(name_normalized__icontains=first) | Q(name_normalized__icontains=name_n[:4]))
        city_l = (city or "").strip().lower()
        for t in cand[:500]:
            ratio = difflib.SequenceMatcher(None, name_n, t.name_normalized).ratio()
            if ratio < 0.82:
                continue
            same_city = city_l and (t.city.strip().lower() == city_l or t.district.strip().lower() == city_l)
            t_age = _age_of(t)
            close_age = age is not None and t_age is not None and abs(int(age) - int(t_age)) <= 3
            if same_city:
                add(t, f"Similar name in {t.city}", "possible")
            elif close_age:
                add(t, "Similar name and age", "possible")
            elif ratio > 0.97:
                add(t, "Same name", "possible")

    results = sorted(found.values(), key=lambda r: {"exact": 0, "strong": 1, "possible": 2}[r["strength"]])
    for r in results:
        t = r["talent"]
        if t.deleted_at:
            r["reasons"].append("Record is in Trash")
        elif t.is_archived:
            r["reasons"].append("Record is archived")
    return results[:limit]


# ---------------------------------------------------------------------------
# Photos (FR-007)
# ---------------------------------------------------------------------------
ALLOWED_FORMATS = {"JPEG": "jpg", "PNG": "png", "WEBP": "webp", "MPO": "jpg"}
VARIANTS = {"profile": (1200, 1600), "card": (480, 600), "thumb": (160, 200)}


class PhotoError(ValueError):
    pass


def _fit(img, box):
    im = img.copy()
    im.thumbnail(box, Image.Resampling.LANCZOS)
    return im


def _crop_to_ratio(img, ratio=0.8):
    """Centre-crop to 4:5 portrait for card/thumb variants."""
    w, h = img.size
    if w / h > ratio:
        nw = int(h * ratio)
        left = (w - nw) // 2
        return img.crop((left, 0, left + nw, h))
    nh = int(w / ratio)
    top = max(0, (h - nh) // 4)  # bias toward the top (faces)
    return img.crop((0, top, w, top + nh))


def _encode(img):
    buf = io.BytesIO()
    if img.mode not in ("RGB", "L"):
        bg = Image.new("RGB", img.size, (255, 255, 255))
        if img.mode in ("RGBA", "LA", "P"):
            img = img.convert("RGBA")
            bg.paste(img, mask=img.split()[-1])
        img = bg
    # Re-encoding without passing exif strips all metadata (GPS, device, etc.)
    img.save(buf, format="WEBP", quality=84, method=4)
    return buf.getvalue()


def process_photo(upload, crop=None, rotate=0):
    """Validate + normalise an uploaded image. Returns dict of ContentFiles.

    crop: dict(x, y, width, height) in pixels of the EXIF-corrected image.
    rotate: degrees clockwise (multiples of 90).
    """
    raw = upload.read()
    if not raw:
        raise PhotoError("The photo file is empty.")
    try:
        probe = Image.open(io.BytesIO(raw))
        fmt = probe.format
        probe.verify()
    except (UnidentifiedImageError, OSError):
        raise PhotoError("This file isn't a readable image. Please upload a JPG, PNG or WebP photo.")
    if fmt not in ALLOWED_FORMATS:
        raise PhotoError(f"{fmt or 'This'} images aren't supported. Please upload a JPG, PNG or WebP photo.")

    img = Image.open(io.BytesIO(raw))
    img = ImageOps.exif_transpose(img)  # fix phone-camera orientation
    rotate = int(rotate or 0) % 360
    if rotate:
        img = img.rotate(-rotate, expand=True)
    if crop:
        try:
            x, y = int(float(crop["x"])), int(float(crop["y"]))
            w, h = int(float(crop["width"])), int(float(crop["height"]))
        except (KeyError, TypeError, ValueError):
            raise PhotoError("The crop area is invalid.")
        x, y = max(0, x), max(0, y)
        w, h = min(w, img.width - x), min(h, img.height - y)
        if w < 50 or h < 50:
            raise PhotoError("The crop area is too small.")
        img = img.crop((x, y, x + w, y + h))
    if img.width < 200 or img.height < 200:
        raise PhotoError("This photo is too small. Please use an image at least 200×200 pixels.")

    stem = uuid.uuid4().hex[:16]
    out = {
        "profile": ContentFile(_encode(_fit(img, VARIANTS["profile"])), name=f"{stem}.webp"),
        "card": ContentFile(_encode(_fit(_crop_to_ratio(img), VARIANTS["card"])), name=f"{stem}.webp"),
        "thumb": ContentFile(_encode(_fit(_crop_to_ratio(img), VARIANTS["thumb"])), name=f"{stem}.webp"),
        "width": img.width,
        "height": img.height,
    }
    from django.conf import settings

    if settings.KEEP_MASTER_IMAGES:
        out["master"] = ContentFile(raw, name=f"{stem}.{ALLOWED_FORMATS[fmt]}")
    return out


@transaction.atomic
def add_photo(talent, upload, user=None, crop=None, rotate=0, label="", make_primary=False):
    data = process_photo(upload, crop=crop, rotate=rotate)
    has_primary = talent.photos.filter(is_primary=True).exists()
    photo = TalentPhoto(
        talent=talent,
        label=label or talent.full_name,
        width=data["width"],
        height=data["height"],
        sort_order=talent.photos.count(),
        is_primary=make_primary or not has_primary,
        created_by=user,
        updated_by=user,
    )
    for key in ("profile", "card", "thumb", "master"):
        if key in data:
            getattr(photo, key).save(data[key].name, data[key], save=False)
    if photo.is_primary:
        talent.photos.filter(is_primary=True).update(is_primary=False)
    photo.save()
    return photo


@transaction.atomic
def set_primary_photo(photo):
    TalentPhoto.objects.filter(talent=photo.talent, is_primary=True).exclude(pk=photo.pk).update(is_primary=False)
    photo.is_primary = True
    photo.save(update_fields=["is_primary", "updated_at"])


def can_delete_photo(photo):
    if photo.is_primary:
        return False, "This is the primary photo. Choose or upload another primary photo before deleting it."
    return True, ""


# ---------------------------------------------------------------------------
# Videos (FR-008)
# ---------------------------------------------------------------------------
YOUTUBE_RE = re.compile(r"(?:youtu\.be/|youtube\.com/(?:watch\?v=|embed/|shorts/|live/))([A-Za-z0-9_-]{6,})")


def detect_platform(url):
    u = (url or "").lower()
    if "youtu" in u:
        return "youtube"
    if "instagram.com" in u:
        return "instagram"
    if "vimeo.com" in u:
        return "vimeo"
    if "drive.google.com" in u:
        return "google_drive"
    if "facebook.com" in u or "fb.watch" in u:
        return "facebook"
    return "other"


def video_thumbnail(url):
    m = YOUTUBE_RE.search(url or "")
    if m:
        return f"https://img.youtube.com/vi/{m.group(1)}/hqdefault.jpg"
    return ""


@transaction.atomic
def reorder_videos(talent, order):
    """order: list of video ids in desired position order (max 3)."""
    videos = {v.id: v for v in talent.featured_videos.select_for_update()}
    ids = [int(i) for i in order]
    if len(ids) != len(set(ids)) or any(i not in videos for i in ids) or len(ids) > 3:
        raise ValueError("Invalid video order.")
    # move out of the 1..3 range first so the unique constraint never trips
    for v in videos.values():
        v.position += 10
        v.save(update_fields=["position"])
    for pos, vid in enumerate(ids, start=1):
        videos[vid].position = pos
        videos[vid].save(update_fields=["position"])
    leftover = [v for v in videos.values() if v.id not in ids]
    free = [p for p in (1, 2, 3) if p > len(ids)]
    for v, p in zip(leftover, free):
        v.position = p
        v.save(update_fields=["position"])


# ---------------------------------------------------------------------------
# Consent (FR-020)
# ---------------------------------------------------------------------------
BLOCKING_CONSENTS = {"data_storage", "portfolio_use", "client_sharing", "guardian"}


def on_consent_changed(consent, previous_status, user=None):
    talent = consent.talent
    if consent.status == "withdrawn" and previous_status != "withdrawn":
        if not consent.withdrawn_on:
            consent.withdrawn_on = timezone.localdate()
            consent.save(update_fields=["withdrawn_on"])
        if consent.consent_type in BLOCKING_CONSENTS:
            Talent.all_objects.filter(pk=talent.pk).update(consent_hold=True)
        RetentionReview.objects.create(
            talent=talent,
            consent=consent,
            reason=f"{consent.get_consent_type_display()} consent withdrawn",
            due_on=timezone.localdate() + timedelta(days=30),
            created_by=user,
        )
    elif consent.status == "granted":
        still_withdrawn = talent.consents.filter(status="withdrawn", consent_type__in=BLOCKING_CONSENTS).exclude(
            consent_type__in=talent.consents.filter(status="granted").values("consent_type")
        )
        if not still_withdrawn.exists():
            Talent.all_objects.filter(pk=talent.pk).update(consent_hold=False)


def booking_blockers(talent):
    """Reasons a talent cannot currently be booked (child safety + consent)."""
    problems = []
    if talent.consent_hold:
        problems.append("Consent has been withdrawn for this talent.")
    if talent.is_child:
        if not talent.guardians.exists():
            problems.append("Child artist: parent/guardian details are required.")
        if not talent.consents.filter(consent_type="guardian", status="granted").exists():
            problems.append("Child artist: guardian consent must be recorded before booking.")
        if not (talent.date_of_birth or talent.age_verified):
            problems.append("Child artist: date of birth or verified age is required.")
        if not talent.child_safety_verified:
            problems.append("Child artist: child-safety restrictions and production compliance must be verified.")
    return problems


def child_validation_errors(talent):
    """Soft checks shown in the profile for child artists."""
    if not talent.is_child:
        return []
    return booking_blockers(talent)
