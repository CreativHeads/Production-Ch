"""FR-001 staff authentication. No public sign-up endpoint exists."""
from django.conf import settings
from django.contrib.auth import authenticate, get_user_model, login, logout, update_session_auth_hash
from django.contrib.auth.password_validation import validate_password
from django.contrib.auth.tokens import default_token_generator
from django.core.cache import cache
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.mail import send_mail
from django.shortcuts import get_object_or_404
from django.utils.encoding import force_bytes, force_str
from django.utils.http import urlsafe_base64_decode, urlsafe_base64_encode
from django.views.decorators.csrf import ensure_csrf_cookie
from django.utils.decorators import method_decorator
from rest_framework import serializers, status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from core import audit
from core.models import SystemSetting
from core.permissions import CanManageBackups

User = get_user_model()


def user_payload(u):
    return {
        "id": u.id,
        "username": u.username,
        "name": u.get_full_name() or u.username,
        "first_name": u.first_name,
        "email": u.email,
        "is_superuser": u.is_superuser,
        "can_manage_backups": u.is_superuser or u.has_perm("core.manage_backups"),
        "last_login": u.last_login,
    }


def _lock_key(username, ip):
    return f"login-fail:{(username or '').lower()}:{ip}"


@method_decorator(ensure_csrf_cookie, name="dispatch")
class CsrfView(APIView):
    """Sets the CSRF cookie so the SPA can POST the login form."""

    permission_classes = [AllowAny]

    def get(self, request):
        return Response({"ok": True})


class LoginView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        username = (request.data.get("username") or "").strip()
        password = request.data.get("password") or ""
        ip = audit._client_ip(request) or "?"
        key = _lock_key(username, ip)
        fails = cache.get(key, 0)
        if fails >= settings.LOGIN_MAX_ATTEMPTS:
            return Response(
                {"detail": f"Too many failed attempts. Please wait {settings.LOGIN_LOCKOUT_MINUTES} minutes and try again.", "code": "locked"},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )
        if not username or not password:
            return Response({"detail": "Enter your username and password.", "code": "invalid"}, status=400)
        user = authenticate(request, username=username, password=password)
        if user is None or not user.is_active:
            cache.set(key, fails + 1, settings.LOGIN_LOCKOUT_MINUTES * 60)
            audit.log(None, "auth.login_failed", entity_type="user", label=username[:150], message=f"IP {ip}")
            return Response({"detail": "That username and password don't match an active staff account.", "code": "invalid"}, status=400)
        cache.delete(key)
        login(request._request, user)
        request.session.set_expiry(int(float(SystemSetting.get().session_idle_hours) * 3600))
        audit.log(request, "auth.login", user)
        return Response(user_payload(user))


class LogoutView(APIView):
    def post(self, request):
        audit.log(request, "auth.logout", request.user)
        logout(request._request)
        return Response({"ok": True})


class MeView(APIView):
    def get(self, request):
        return Response(user_payload(request.user))

    def patch(self, request):
        u = request.user
        before = audit.snapshot(u, ["first_name", "last_name", "email"])
        for f in ("first_name", "last_name", "email"):
            if f in request.data:
                setattr(u, f, (request.data.get(f) or "").strip())
        u.save()
        changes = audit.diff(before, audit.snapshot(u, ["first_name", "last_name", "email"]))
        if changes:
            audit.log(request, "user.profile_changed", u, changes=changes)
        return Response(user_payload(u))


class ChangePasswordView(APIView):
    def post(self, request):
        u = request.user
        current = request.data.get("current_password") or ""
        new = request.data.get("new_password") or ""
        if not u.check_password(current):
            return Response({"detail": "Your current password is incorrect.", "errors": {"current_password": ["Incorrect password."]}}, status=400)
        try:
            validate_password(new, u)
        except DjangoValidationError as e:
            return Response({"detail": " ".join(e.messages), "errors": {"new_password": e.messages}}, status=400)
        u.set_password(new)
        u.save()
        update_session_auth_hash(request._request, u)
        audit.log(request, "auth.password_changed", u)
        return Response({"ok": True})


class PasswordResetRequestView(APIView):
    """Verified recovery: a single-use, time-limited link to the account's
    registered email. The response never reveals whether the account exists."""

    permission_classes = [AllowAny]

    def post(self, request):
        ident = (request.data.get("username") or request.data.get("email") or "").strip()
        generic = {"detail": "If that account exists and has a registered email, a reset link has been sent. Otherwise ask an administrator to reset your password."}
        if not ident:
            return Response(generic)
        ip = audit._client_ip(request) or "?"
        rl_key = f"pwreset:{ip}"
        if cache.get(rl_key, 0) >= 5:
            return Response(generic)
        cache.set(rl_key, cache.get(rl_key, 0) + 1, 3600)
        user = User.objects.filter(is_active=True).filter(username__iexact=ident).first() or User.objects.filter(
            is_active=True, email__iexact=ident
        ).first()
        if user and user.email:
            uid = urlsafe_base64_encode(force_bytes(user.pk))
            token = default_token_generator.make_token(user)
            link = f"{settings.APP_BASE_URL}/reset-password?uid={uid}&token={token}"
            send_mail(
                "Reset your CreativHeads Casting Manager password",
                f"Hi {user.get_full_name() or user.username},\n\nUse this link within one hour to set a new password:\n{link}\n\nIf you didn't ask for this, ignore this email and tell your administrator.",
                None,
                [user.email],
                fail_silently=True,
            )
            audit.log(None, "auth.password_reset_requested", user, message=f"IP {ip}")
        return Response(generic)


class PasswordResetConfirmView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        try:
            uid = force_str(urlsafe_base64_decode(request.data.get("uid", "")))
            user = User.objects.get(pk=uid, is_active=True)
        except Exception:
            user = None
        token = request.data.get("token", "")
        if not user or not default_token_generator.check_token(user, token):
            return Response({"detail": "This reset link is invalid or has expired. Please request a new one."}, status=400)
        new = request.data.get("new_password") or ""
        try:
            validate_password(new, user)
        except DjangoValidationError as e:
            return Response({"detail": " ".join(e.messages), "errors": {"new_password": e.messages}}, status=400)
        user.set_password(new)
        user.save()
        audit.log(None, "auth.password_reset_completed", user)
        return Response({"ok": True, "detail": "Password updated. You can sign in now."})


# ---------------------------------------------------------------------------
# Staff administration (superusers only). Accounts are provisioned internally.
# ---------------------------------------------------------------------------
class IsSuperuser(CanManageBackups):
    message = "Only administrators can manage staff accounts."

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and request.user.is_superuser)


class StaffSerializer(serializers.ModelSerializer):
    name = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ["id", "username", "first_name", "last_name", "email", "is_active", "is_superuser", "last_login", "date_joined", "name"]
        read_only_fields = ["last_login", "date_joined", "is_superuser"]

    def get_name(self, u):
        return u.get_full_name() or u.username


class StaffListView(APIView):
    permission_classes = [IsSuperuser]

    def get(self, request):
        return Response(StaffSerializer(User.objects.order_by("username"), many=True).data)

    def post(self, request):
        ser = StaffSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        password = request.data.get("password") or ""
        try:
            validate_password(password)
        except DjangoValidationError as e:
            return Response({"detail": " ".join(e.messages), "errors": {"password": e.messages}}, status=400)
        user = User(**{k: v for k, v in ser.validated_data.items()})
        user._skip_audit = True
        user.is_staff = False  # Django admin access is separate
        user.set_password(password)
        user.save()
        audit.log(request, "user.created", user)
        return Response(StaffSerializer(user).data, status=201)


class StaffDetailView(APIView):
    permission_classes = [IsSuperuser]

    def patch(self, request, pk):
        user = get_object_or_404(User, pk=pk)
        before = audit.snapshot(user, ["first_name", "last_name", "email", "is_active"])
        ser = StaffSerializer(user, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        if user == request.user and request.data.get("is_active") is False:
            return Response({"detail": "You can't deactivate your own account."}, status=400)
        ser.save()
        if request.data.get("password"):
            try:
                validate_password(request.data["password"], user)
            except DjangoValidationError as e:
                return Response({"detail": " ".join(e.messages), "errors": {"password": e.messages}}, status=400)
            user.set_password(request.data["password"])
            user.save()
            audit.log(request, "user.password_reset_by_admin", user)
        changes = audit.diff(before, audit.snapshot(user, ["first_name", "last_name", "email", "is_active"]))
        if "is_active" in changes:
            audit.log(request, "user.deactivated" if not user.is_active else "user.reactivated", user)
            if not user.is_active:
                _kill_sessions(user)
        if changes:
            audit.log(request, "user.updated", user, changes=changes)
        return Response(StaffSerializer(user).data)


def _kill_sessions(user):
    from django.contrib.sessions.models import Session
    from django.utils import timezone

    for s in Session.objects.filter(expire_date__gte=timezone.now()):
        if s.get_decoded().get("_auth_user_id") == str(user.pk):
            s.delete()
