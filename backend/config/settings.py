"""Settings for the A Million Techies Community API."""

import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")


def env_list(name: str, default: str = "") -> list[str]:
    return [item.strip() for item in os.environ.get(name, default).split(",") if item.strip()]


DEBUG = os.environ.get("DJANGO_DEBUG", "false").lower() == "true"
SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "")
if not SECRET_KEY:
    if not DEBUG:
        raise RuntimeError("Set DJANGO_SECRET_KEY (or DJANGO_DEBUG=true for local development).")
    SECRET_KEY = "dev-only-insecure-key"

ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1")

# In production the API sits behind Caddy, which terminates HTTPS and forwards the
# original scheme and host, so absolute URLs (uploaded images) come out right.
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
USE_X_FORWARDED_HOST = True
CSRF_TRUSTED_ORIGINS = env_list("CSRF_TRUSTED_ORIGINS")
SESSION_COOKIE_SECURE = not DEBUG
CSRF_COOKIE_SECURE = not DEBUG

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "corsheaders",
    "rest_framework",
    "django_filters",
    "drf_spectacular",
    "amt_auth.django",
    "apps.accounts",
    "apps.events",
    "apps.hackathons",
    "apps.invitations",
    "apps.content",
    "apps.integrations",
    "apps.notifications",
    "apps.configuration",
    "apps.platform_admin",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    # Serves the admin's and the API docs' static files from STATIC_ROOT.
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": os.environ.get("DB_NAME", "community"),
        "USER": os.environ.get("DB_USER", "community"),
        "PASSWORD": os.environ.get("DB_PASSWORD", "community"),
        "HOST": os.environ.get("DB_HOST", "localhost"),
        "PORT": os.environ.get("DB_PORT", "5433"),
    }
}

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-gb"
TIME_ZONE = "Africa/Nairobi"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

# The member-facing site, for links in emails and calendar invites.
COMMUNITY_URL = os.environ.get("COMMUNITY_URL", "http://localhost:5173").rstrip("/")

# --- email ------------------------------------------------------------------
# Any SMTP service works (Google Workspace, Microsoft 365, SendGrid, Mailgun, Amazon SES).
# Locally, docker-compose runs Mailpit: mail goes to http://localhost:8025, never out.
# The SMTP server, login and sender can also be set on the console's Configuration page,
# which wins over these environment variables.
EMAIL_BACKEND = os.environ.get("EMAIL_BACKEND", "apps.configuration.mail.ConfiguredEmailBackend")
EMAIL_HOST = os.environ.get("EMAIL_HOST", "localhost")
EMAIL_PORT = int(os.environ.get("EMAIL_PORT", "1025"))
EMAIL_HOST_USER = os.environ.get("EMAIL_HOST_USER", "")
EMAIL_HOST_PASSWORD = os.environ.get("EMAIL_HOST_PASSWORD", "")
EMAIL_USE_TLS = os.environ.get("EMAIL_USE_TLS", "false").lower() == "true"
EMAIL_USE_SSL = os.environ.get("EMAIL_USE_SSL", "false").lower() == "true"
EMAIL_TIMEOUT = 20
# How queued emails leave: "thread" sends right after the request on a background thread,
# "worker" leaves everything to `manage.py run_worker`. The worker also sends reminders and
# retries failures, so run it in every environment.
EMAIL_DELIVERY = os.environ.get("EMAIL_DELIVERY", "thread")
DEFAULT_FROM_EMAIL = os.environ.get(
    "DEFAULT_FROM_EMAIL", "A Million Techies Community <community@amilliontechies.com>"
)

# --- connected accounts: Google, Microsoft, Zoom ---------------------------------------
# Organisers connect these to create Meet, Teams or Zoom meetings and to keep events in
# their own calendars. Each needs an OAuth app registered with the provider; see README.
# The redirect URI to register is <API_URL>/api/integrations/<google|microsoft|zoom>/callback/
API_URL = os.environ.get("API_URL", "http://localhost:8000").rstrip("/")
GOOGLE_OAUTH_CLIENT_ID = os.environ.get("GOOGLE_OAUTH_CLIENT_ID", "")
GOOGLE_OAUTH_CLIENT_SECRET = os.environ.get("GOOGLE_OAUTH_CLIENT_SECRET", "")
MICROSOFT_OAUTH_CLIENT_ID = os.environ.get("MICROSOFT_OAUTH_CLIENT_ID", "")
MICROSOFT_OAUTH_CLIENT_SECRET = os.environ.get("MICROSOFT_OAUTH_CLIENT_SECRET", "")
MICROSOFT_OAUTH_TENANT = os.environ.get("MICROSOFT_OAUTH_TENANT", "common")
ZOOM_OAUTH_CLIENT_ID = os.environ.get("ZOOM_OAUTH_CLIENT_ID", "")
ZOOM_OAUTH_CLIENT_SECRET = os.environ.get("ZOOM_OAUTH_CLIENT_SECRET", "")
# Encrypts their tokens at rest. Defaults to one derived from DJANGO_SECRET_KEY.
INTEGRATIONS_ENCRYPTION_KEY = os.environ.get("INTEGRATIONS_ENCRYPTION_KEY", "")
# "thread" calls the providers after the request; "inline" (tests) calls them straight away.
BACKGROUND_TASKS = os.environ.get("BACKGROUND_TASKS", "thread")

# --- uploaded images ---------------------------------------------------------
# On local disk until a bucket is set, on the Configuration page or with MEDIA_S3_BUCKET:
# then in S3-compatible storage (AWS S3, DigitalOcean Spaces, Cloudflare R2).
MEDIA_URL = "media/"
MEDIA_ROOT = BASE_DIR / "media"
MEDIA_S3_BUCKET = os.environ.get("MEDIA_S3_BUCKET", "")
MEDIA_S3_ENDPOINT_URL = os.environ.get("MEDIA_S3_ENDPOINT_URL", "")
MEDIA_S3_REGION = os.environ.get("MEDIA_S3_REGION", "")
MEDIA_S3_ACCESS_KEY_ID = os.environ.get("MEDIA_S3_ACCESS_KEY_ID", "")
MEDIA_S3_SECRET_ACCESS_KEY = os.environ.get("MEDIA_S3_SECRET_ACCESS_KEY", "")
MEDIA_S3_CUSTOM_DOMAIN = os.environ.get("MEDIA_S3_CUSTOM_DOMAIN", "")
STORAGES = {
    "default": {"BACKEND": "apps.configuration.storage.ConfiguredStorage"},
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedStaticFilesStorage"},
}

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# --- API -------------------------------------------------------------------
# Sign-in is Keycloak's job. amt-auth validates the Bearer token; ProfileAuthentication
# also keeps a local Profile row for the token's user.
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ["apps.accounts.authentication.ProfileAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticatedOrReadOnly"],
    "DEFAULT_FILTER_BACKENDS": [
        "django_filters.rest_framework.DjangoFilterBackend",
        "rest_framework.filters.SearchFilter",
        "rest_framework.filters.OrderingFilter",
    ],
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "PAGE_SIZE": 24,
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
}

SPECTACULAR_SETTINGS = {
    "TITLE": "A Million Techies Community API",
    "VERSION": "0.1.0",
    "SERVE_INCLUDE_SCHEMA": False,
}

CORS_ALLOWED_ORIGINS = env_list("CORS_ALLOWED_ORIGINS", "http://localhost:5173")

# amt-auth reads AMT_KEYCLOAK_URL, AMT_REALM, AMT_CLIENT_ID and AMT_CLIENT_SECRET
# from the environment itself. The webhook secret is a Django setting.
AMT_WEBHOOK_SECRET = os.environ.get("AMT_WEBHOOK_SECRET", "")
