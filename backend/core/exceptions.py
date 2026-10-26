"""Turn every API error into a consistent, human-readable payload.

Shape: {"detail": "<sentence for a person>", "errors": {field: [msgs]}, "code": "..."}
"""
import logging

from django.core.exceptions import PermissionDenied, ValidationError as DjangoValidationError
from django.db import IntegrityError
from django.http import Http404
from rest_framework import exceptions, status
from rest_framework.response import Response
from rest_framework.views import exception_handler

logger = logging.getLogger(__name__)


class Conflict(exceptions.APIException):
    status_code = status.HTTP_409_CONFLICT
    default_detail = "This change conflicts with existing data."
    default_code = "conflict"

    def __init__(self, detail=None, code=None, extra=None):
        super().__init__(detail, code)
        self.extra = extra or {}


def _flatten(errors):
    if isinstance(errors, dict):
        return {k: (v if isinstance(v, list) else [v]) for k, v in errors.items()}
    if isinstance(errors, list):
        return {"non_field_errors": errors}
    return {"non_field_errors": [errors]}


def friendly_exception_handler(exc, context):
    if isinstance(exc, DjangoValidationError):
        exc = exceptions.ValidationError(exc.message_dict if hasattr(exc, "message_dict") else exc.messages)
    elif isinstance(exc, Http404):
        exc = exceptions.NotFound("We couldn't find that record. It may have been deleted or archived.")
    elif isinstance(exc, PermissionDenied):
        exc = exceptions.PermissionDenied()
    elif isinstance(exc, IntegrityError):
        logger.warning("Integrity error: %s", exc)
        return Response(
            {"detail": "This would create a duplicate or conflicting record. Please check and try again.", "code": "integrity"},
            status=status.HTTP_409_CONFLICT,
        )

    response = exception_handler(exc, context)
    if response is None:
        logger.exception("Unhandled API error", exc_info=exc)
        return Response(
            {"detail": "Something went wrong on our side. Your data was not changed. Please try again.", "code": "server_error"},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    data = response.data
    payload = {"code": getattr(exc, "default_code", "error")}
    if isinstance(exc, exceptions.ValidationError):
        errors = _flatten(data)
        payload["errors"] = errors
        first = next(iter(errors.values()), ["Please check the highlighted fields."])
        payload["detail"] = "Please check the highlighted fields: " + str(first[0]) if first else "Please check the form."
    elif isinstance(data, dict) and "detail" in data:
        payload["detail"] = str(data["detail"])
    else:
        payload["detail"] = str(data)
    if isinstance(exc, exceptions.NotAuthenticated):
        payload["detail"] = "Your session has ended. Please sign in again."
    if isinstance(exc, Conflict):
        payload.update(exc.extra)
    response.data = payload
    return response
