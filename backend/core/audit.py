"""Helpers for writing audit entries and computing field diffs."""
import datetime
import decimal

from django.db import models

from .models import AuditLog


def _client_ip(request):
    if request is None:
        return None
    fwd = request.META.get("HTTP_X_FORWARDED_FOR")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR")


def _jsonable(value):
    if isinstance(value, (datetime.date, datetime.datetime)):
        return value.isoformat()
    if isinstance(value, decimal.Decimal):
        return str(value)
    if isinstance(value, models.Model):
        return str(value)
    if isinstance(value, (list, tuple, set)):
        return [_jsonable(v) for v in value]
    if hasattr(value, "name") and hasattr(value, "url"):  # FieldFile
        return value.name or None
    return value


def snapshot(instance, fields):
    data = {}
    for f in fields:
        val = getattr(instance, f, None)
        data[f] = _jsonable(val)
    return data


def diff(before, after):
    return {k: [before.get(k), after.get(k)] for k in after if before.get(k) != after.get(k)}


def log(request_or_user, action, obj=None, changes=None, message="", entity_type=None, entity_id=None, label=None):
    request = None
    user = request_or_user
    if hasattr(request_or_user, "META"):
        request = request_or_user
        user = getattr(request, "user", None)
    if user is not None and not getattr(user, "is_authenticated", False):
        user = None
    if obj is not None:
        entity_type = entity_type or obj._meta.model_name
        entity_id = entity_id or str(obj.pk)
        label = label or str(obj)[:255]
    return AuditLog.objects.create(
        actor=user,
        actor_name=(user.get_username() if user else ""),
        action=action,
        entity_type=entity_type or "",
        entity_id=str(entity_id or ""),
        entity_label=(label or "")[:255],
        changes={k: _jsonable(v) for k, v in (changes or {}).items()},
        message=message,
        ip_address=_client_ip(request),
        user_agent=(request.META.get("HTTP_USER_AGENT", "")[:255] if request else ""),
    )
