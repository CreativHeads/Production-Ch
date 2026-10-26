from django.urls import path

from . import views

urlpatterns = [
    path("csrf/", views.CsrfView.as_view()),
    path("login/", views.LoginView.as_view()),
    path("logout/", views.LogoutView.as_view()),
    path("me/", views.MeView.as_view()),
    path("password/change/", views.ChangePasswordView.as_view()),
    path("password/reset/", views.PasswordResetRequestView.as_view()),
    path("password/reset/confirm/", views.PasswordResetConfirmView.as_view()),
    path("staff/", views.StaffListView.as_view()),
    path("staff/<int:pk>/", views.StaffDetailView.as_view()),
]
