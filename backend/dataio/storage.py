from django.conf import settings
from django.core.files.storage import FileSystemStorage


def export_storage():
    return FileSystemStorage(location=settings.EXPORT_ROOT, base_url=None)


def import_storage():
    return FileSystemStorage(location=settings.IMPORT_ROOT, base_url=None)
