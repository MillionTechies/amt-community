from django.contrib import admin
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

from config.stats import community_stats

urlpatterns = [
    path("admin/", admin.site.urls),
    # amt-auth: Keycloak webhook, organization creation and invitations.
    path("auth/", include("amt_auth.django.urls")),
    path("api/stats/", community_stats),
    path("api/", include("apps.accounts.urls")),
    path("api/", include("apps.events.urls")),
    path("api/", include("apps.hackathons.urls")),
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="docs"),
]
