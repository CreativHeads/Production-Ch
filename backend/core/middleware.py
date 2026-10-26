from .models import SystemSetting


class IdleSessionMiddleware:
    """FR-001: sessions expire after N hours of *inactivity* (configurable).

    SESSION_SAVE_EVERY_REQUEST already slides the window; this applies the
    staff-configured duration from SystemSetting on each authenticated request.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        user = getattr(request, "user", None)
        if user is not None and user.is_authenticated:
            try:
                hours = float(SystemSetting.get().session_idle_hours)
            except Exception:  # DB not ready (first migrate) — fall back
                hours = 8
            request.session.set_expiry(int(hours * 3600))
        return self.get_response(request)
