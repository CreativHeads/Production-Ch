from django.contrib import admin
from django.urls import include, path, re_path
from rest_framework.routers import DefaultRouter

from casting import views as cv
from core import views as core_views
from dataio import views as dv
from talent import views as tv

router = DefaultRouter(trailing_slash=True)
router.register("terms", tv.TermViewSet, basename="term")
router.register("talent", tv.TalentViewSet, basename="talent")
router.register("photos", tv.PhotoViewSet, basename="photo")
router.register("videos", tv.VideoViewSet, basename="video")
router.register("portfolio-links", tv.PortfolioLinkViewSet, basename="portfolio-link")
router.register("guardians", tv.GuardianViewSet, basename="guardian")
router.register("consents", tv.ConsentViewSet, basename="consent")
router.register("notes", tv.ContactNoteViewSet, basename="note")
router.register("retention-reviews", tv.RetentionReviewViewSet, basename="retention-review")
router.register("projects", cv.ProjectViewSet, basename="project")
router.register("roles", cv.RoleViewSet, basename="role")
router.register("shortlist", cv.ShortlistViewSet, basename="shortlist")
router.register("availability", cv.AvailabilityViewSet, basename="availability")
router.register("bookings", cv.BookingViewSet, basename="booking")

api = [
    path("auth/", include("accounts.urls")),
    path("dashboard/", core_views.DashboardView.as_view()),
    path("reminders/", core_views.RemindersView.as_view()),
    path("settings/", core_views.SettingsView.as_view()),
    path("audit/", core_views.AuditListView.as_view()),
    path("meta/", core_views.MetaView.as_view()),
    path("backups/status/", core_views.BackupStatusView.as_view()),
    path("health/", core_views.health),
    path("imports/", dv.ImportListView.as_view()),
    path("imports/template/", dv.TemplateView.as_view()),
    path("imports/<int:pk>/", dv.ImportDetailView.as_view()),
    path("imports/<int:pk>/validate/", dv.ImportValidateView.as_view()),
    path("imports/<int:pk>/rows/<int:row_id>/", dv.ImportRowView.as_view()),
    path("imports/<int:pk>/confirm/", dv.ImportConfirmView.as_view()),
    path("exports/", dv.ExportListView.as_view()),
    path("exports/<int:pk>/download/", dv.ExportDownloadView.as_view()),
    path("", include(router.urls)),
]

admin.site.site_header = "CreativHeads Casting Manager — Administration"

urlpatterns = [
    path("api/", include(api)),
    path("django-admin/", admin.site.urls),
    re_path(r"^media/(?P<path>.+)$", core_views.protected_media),
]
