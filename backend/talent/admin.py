from django.contrib import admin

from .models import Consent, ContactNote, Talent, Term


@admin.register(Term)
class TermAdmin(admin.ModelAdmin):
    list_display = ["name", "kind", "is_archived", "system_key"]
    list_filter = ["kind", "is_archived"]
    search_fields = ["name"]


@admin.register(Talent)
class TalentAdmin(admin.ModelAdmin):
    list_display = ["cast_id", "full_name", "city", "status", "completeness", "is_archived"]
    list_filter = ["status", "is_archived"]
    search_fields = ["cast_id", "full_name", "phone_normalized"]
    readonly_fields = ["cast_id", "phone_normalized", "alt_phone_normalized", "instagram_normalized", "name_normalized"]

    def get_queryset(self, request):
        return Talent.all_objects.all()


admin.site.register(Consent)
admin.site.register(ContactNote)
