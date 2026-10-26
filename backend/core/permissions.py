from rest_framework.permissions import BasePermission


class IsActiveStaff(BasePermission):
    """V1: every active staff account has the same operational permissions."""

    message = "Please sign in to continue."

    def has_permission(self, request, view):
        u = request.user
        return bool(u and u.is_authenticated and u.is_active)


class CanManageBackups(BasePermission):
    """FR-022: backup access is restricted separately from normal usage."""

    message = "Backup access is restricted to backup operators."

    def has_permission(self, request, view):
        u = request.user
        return bool(u and u.is_authenticated and u.is_active and (u.is_superuser or u.has_perm("core.manage_backups")))
