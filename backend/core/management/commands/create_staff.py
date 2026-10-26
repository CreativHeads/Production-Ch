"""Provision a staff account (there is no public sign-up).

    python manage.py create_staff anjali --email anjali@creativheads.com --name "Anjali Nair"
    python manage.py create_staff admin --admin --backup-operator
"""
import getpass

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Permission
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError

from core import audit


class Command(BaseCommand):
    help = "Create a staff account"

    def add_arguments(self, parser):
        parser.add_argument("username")
        parser.add_argument("--email", default="")
        parser.add_argument("--name", default="")
        parser.add_argument("--password", help="Omit to be prompted (recommended)")
        parser.add_argument("--admin", action="store_true", help="Can manage staff accounts and Django admin")
        parser.add_argument("--backup-operator", action="store_true", help="Can see backup status and download full backups")

    def handle(self, *args, **o):
        User = get_user_model()
        if User.objects.filter(username__iexact=o["username"]).exists():
            raise CommandError("That username already exists.")
        password = o["password"] or getpass.getpass("Password: ")
        user = User(username=o["username"], email=o["email"])
        if o["name"]:
            parts = o["name"].split(" ", 1)
            user.first_name = parts[0]
            user.last_name = parts[1] if len(parts) > 1 else ""
        try:
            validate_password(password, user)
        except ValidationError as e:
            raise CommandError(" ".join(e.messages))
        user.set_password(password)
        if o["admin"]:
            user.is_superuser = True
            user.is_staff = True
        user.save()
        if o["backup_operator"] and not user.is_superuser:
            user.user_permissions.add(Permission.objects.get(codename="manage_backups"))
        audit.log(None, "user.created", user, message="Provisioned from command line")
        self.stdout.write(self.style.SUCCESS(f"Created {user.username}"))
