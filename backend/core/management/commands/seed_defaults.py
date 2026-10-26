"""Idempotently create default categories, tags, skills and languages (FR-009)."""
from django.core.management.base import BaseCommand
from django.utils.text import slugify

from core.models import DEFAULT_COMPLETENESS_FIELDS, SystemSetting
from talent.models import Term

CATEGORIES = [
    ("Actor", ""), ("Model", ""), ("Child Artist", "child"), ("Senior Artist", ""), ("Supporting Artist", ""),
    ("Extra", ""), ("Voice Artist", ""), ("Presenter", ""), ("Content Creator", ""), ("Dancer", ""), ("Anchor", ""),
]
TAGS = [
    "Father Role", "Mother Role", "Corporate Look", "Comedy", "Emotional Acting", "Strong Dialogue Delivery",
    "Natural Malayalam Accent", "Experienced in Advertisements", "Village Look", "Urban Look", "Doctor Look", "Police Look",
    "Student Look", "Grandparent Role", "Fitness Look",
]
SKILLS = [
    "Dialogue delivery", "Improvisation", "Classical dance", "Contemporary dance", "Singing", "Dubbing", "Swimming", "Driving (car)",
    "Riding (two-wheeler)", "Martial arts", "Horse riding", "Musical instrument", "Mimicry", "Anchoring", "Ramp walk",
]
LANGUAGES = ["Malayalam", "English", "Tamil", "Hindi", "Kannada", "Telugu", "Arabic", "Urdu", "Tulu", "Konkani"]


class Command(BaseCommand):
    help = "Create default taxonomy terms and settings (safe to run repeatedly)."

    def handle(self, *args, **opts):
        made = 0
        for i, (name, key) in enumerate(CATEGORIES):
            t, c = Term.objects.get_or_create(kind=Term.CATEGORY, slug=slugify(name),
                                              defaults={"name": name, "sort_order": i, "system_key": key})
            if key and t.system_key != key:
                t.system_key = key
                t.save(update_fields=["system_key"])
            made += c
        for kind, names in ((Term.TAG, TAGS), (Term.SKILL, SKILLS), (Term.LANGUAGE, LANGUAGES)):
            for i, name in enumerate(names):
                _, c = Term.objects.get_or_create(kind=kind, slug=slugify(name), defaults={"name": name, "sort_order": i})
                made += c
        s = SystemSetting.get()
        if not s.completeness_fields:
            s.completeness_fields = list(DEFAULT_COMPLETENESS_FIELDS)
            s.save()
        self.stdout.write(self.style.SUCCESS(f"Defaults ready ({made} new terms)."))
