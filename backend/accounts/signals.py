"""Audit account creation/deactivation done through the Django admin or shell."""
from django.contrib.auth import get_user_model
from django.db.models.signals import post_save, pre_save
from django.dispatch import receiver

from core import audit

User = get_user_model()


@receiver(pre_save, sender=User)
def _remember_state(sender, instance, **kwargs):
    if instance.pk:
        prev = sender.objects.filter(pk=instance.pk).values("is_active", "is_superuser").first()
        instance._prev_state = prev
    else:
        instance._prev_state = None


@receiver(post_save, sender=User)
def _audit_user(sender, instance, created, **kwargs):
    if getattr(instance, "_skip_audit", False):
        return
    if created:
        audit.log(None, "user.provisioned", instance, message="Account created")
        return
    prev = getattr(instance, "_prev_state", None) or {}
    if prev and prev.get("is_active") != instance.is_active:
        audit.log(None, "user.active_changed", instance, changes={"is_active": [prev.get("is_active"), instance.is_active]})
    if prev and prev.get("is_superuser") != instance.is_superuser:
        audit.log(None, "user.superuser_changed", instance, changes={"is_superuser": [prev.get("is_superuser"), instance.is_superuser]})
