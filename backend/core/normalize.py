"""Normalisation used for duplicate detection (FR-021) and search."""
import re
import unicodedata
from urllib.parse import urlparse

HONORIFICS = {"mr", "mrs", "ms", "miss", "dr", "master", "baby", "kumari", "shri", "smt", "sri"}


def normalize_phone(raw, default_cc="91"):
    """Return E.164-like digits ("919876543210") or "" if unusable.

    Handles +91 98765 43210, 098765-43210, 0091..., 9876543210.
    """
    if not raw:
        return ""
    s = str(raw).strip()
    has_plus = s.startswith("+")
    digits = re.sub(r"\D", "", s)
    if not digits:
        return ""
    if digits.startswith("00"):
        digits = digits[2:]
        has_plus = True
    if has_plus:
        return digits
    if len(digits) == 11 and digits.startswith("0"):
        digits = digits[1:]
    if len(digits) == 10:
        return default_cc + digits
    if len(digits) == 12 and digits.startswith(default_cc):
        return digits
    return digits


def normalize_instagram(raw):
    """Canonical handle (lower-case) from a URL, @handle or bare handle."""
    if not raw:
        return ""
    s = str(raw).strip()
    if s.startswith("@"):
        return s[1:].lower().strip("/")
    if "instagram.com" in s or "instagr.am" in s:
        if not s.startswith("http"):
            s = "https://" + s
        path = urlparse(s).path.strip("/")
        handle = path.split("/")[0] if path else ""
        return handle.lower()
    if re.fullmatch(r"[A-Za-z0-9._]{1,30}", s):
        return s.lower()
    return s.lower()


def instagram_url(handle_or_url):
    h = normalize_instagram(handle_or_url)
    return f"https://www.instagram.com/{h}/" if h else ""


def normalize_name(raw):
    if not raw:
        return ""
    s = unicodedata.normalize("NFKD", str(raw)).encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-zA-Z\s]", " ", s).lower()
    tokens = [t for t in s.split() if t not in HONORIFICS and len(t) > 0]
    return " ".join(tokens)


def whatsapp_digits(phone, default_cc="91"):
    return normalize_phone(phone, default_cc)
