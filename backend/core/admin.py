from django.contrib import admin

from .models import AuditLog, SystemSetting


@admin.register(AuditLog)
class AuditLogAdmin(admin.ModelAdmin):
    list_display = ["created_at", "actor_name", "action", "entity_type", "entity_label", "ip_address"]
    list_filter = ["action", "entity_type"]
    search_fields = ["entity_label", "actor_name", "message"]
    readonly_fields = [f.name for f in AuditLog._meta.fields]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(SystemSetting)
class SystemSettingAdmin(admin.ModelAdmin):
    list_display = ["session_idle_hours", "review_interval_days", "export_expiry_hours"]
