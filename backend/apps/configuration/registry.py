"""Every setting an admin can change on the Configuration page, grouped as the page shows them.

`scope` says who can set it: "platform" (platform admins only) or "both" (platform admins
set the default, an organisation's admins may override it for their organisation).
`env` is the environment variable (or Django setting) used when nobody has set it here.
"""

from dataclasses import dataclass, field


@dataclass(frozen=True)
class Field:
    key: str
    label: str
    kind: str = "text"  # text, secret, number, boolean, email, url
    scope: str = "platform"
    env: str = ""
    default: str = ""
    help: str = ""
    placeholder: str = ""


@dataclass(frozen=True)
class Group:
    id: str
    title: str
    description: str
    fields: tuple[Field, ...] = field(default_factory=tuple)
    # The fields that must all be set for the group to count as "set up".
    required: tuple[str, ...] = ()


GROUPS = (
    Group(
        "google", "Google (Meet and Calendar)",
        "Lets organisers create Google Meet links and keep events in their Google Calendar. "
        "Create an OAuth client (Web application) in the Google Cloud console with the Google "
        "Calendar API enabled.",
        (
            Field("google.client_id", "Client ID", scope="both", env="GOOGLE_OAUTH_CLIENT_ID",
                  placeholder="1234-abc.apps.googleusercontent.com"),
            Field("google.client_secret", "Client secret", kind="secret", scope="both", env="GOOGLE_OAUTH_CLIENT_SECRET"),
        ),
        required=("google.client_id", "google.client_secret"),
    ),
    Group(
        "microsoft", "Microsoft (Teams and Outlook)",
        "Lets organisers create Microsoft Teams meetings and keep events in their Outlook "
        "calendar. Register an app in Microsoft Entra ID with the delegated Graph permissions "
        "User.Read and Calendars.ReadWrite.",
        (
            Field("microsoft.client_id", "Application (client) ID", scope="both", env="MICROSOFT_OAUTH_CLIENT_ID"),
            Field("microsoft.client_secret", "Client secret", kind="secret", scope="both", env="MICROSOFT_OAUTH_CLIENT_SECRET"),
            Field("microsoft.tenant", "Tenant", scope="both", env="MICROSOFT_OAUTH_TENANT", default="common",
                  help="'common' for any work, school or personal account, or your directory's ID to allow only your organisation."),
        ),
        required=("microsoft.client_id", "microsoft.client_secret"),
    ),
    Group(
        "zoom", "Zoom",
        "Lets organisers create Zoom meetings. Build a General app with user-managed OAuth in "
        "the Zoom App Marketplace.",
        (
            Field("zoom.client_id", "Client ID", scope="both", env="ZOOM_OAUTH_CLIENT_ID"),
            Field("zoom.client_secret", "Client secret", kind="secret", scope="both", env="ZOOM_OAUTH_CLIENT_SECRET"),
        ),
        required=("zoom.client_id", "zoom.client_secret"),
    ),
    Group(
        "email", "Email",
        "How Community sends email: confirmations, reminders, announcements and updates. Any "
        "SMTP service works (Google Workspace, Microsoft 365, SendGrid, Mailgun, Amazon SES).",
        (
            Field("email.host", "SMTP server", env="EMAIL_HOST", placeholder="smtp.gmail.com"),
            Field("email.port", "Port", kind="number", env="EMAIL_PORT", help="587 with TLS, or 465 with SSL."),
            Field("email.username", "Username", env="EMAIL_HOST_USER"),
            Field("email.password", "Password", kind="secret", env="EMAIL_HOST_PASSWORD",
                  help="For Gmail or Google Workspace, an app password."),
            Field("email.use_tls", "Use TLS (STARTTLS)", kind="boolean", env="EMAIL_USE_TLS"),
            Field("email.use_ssl", "Use SSL", kind="boolean", env="EMAIL_USE_SSL"),
            Field("email.from_address", "Send from", kind="email", env="DEFAULT_FROM_EMAIL",
                  help="The address emails come from. Your SMTP service must allow it."),
            Field("email.from_name", "Sender name", scope="both", default="A Million Techies Community",
                  help="Shown as who the email is from. An organisation can use its own name."),
            Field("email.reply_to", "Reply-to address", kind="email", scope="both",
                  help="Where replies go. Leave empty to reply to the sending address."),
        ),
        required=("email.host",),
    ),
    Group(
        "storage", "Image storage",
        "Where images uploaded to descriptions are kept. Leave the bucket empty to keep them on "
        "the server's disk. Any S3-compatible storage works (AWS S3, DigitalOcean Spaces, Cloudflare R2).",
        (
            Field("storage.bucket", "Bucket", env="MEDIA_S3_BUCKET"),
            Field("storage.endpoint_url", "Endpoint URL", kind="url", env="MEDIA_S3_ENDPOINT_URL",
                  help="Leave empty for AWS. For R2 or Spaces, the endpoint they give you."),
            Field("storage.region", "Region", env="MEDIA_S3_REGION"),
            Field("storage.access_key_id", "Access key ID", env="MEDIA_S3_ACCESS_KEY_ID"),
            Field("storage.secret_access_key", "Secret access key", kind="secret", env="MEDIA_S3_SECRET_ACCESS_KEY"),
            Field("storage.custom_domain", "Public domain", env="MEDIA_S3_CUSTOM_DOMAIN",
                  help="Optional, if images are served from your own domain or a CDN."),
        ),
        required=("storage.bucket", "storage.access_key_id", "storage.secret_access_key"),
    ),
)

FIELDS = {f.key: f for g in GROUPS for f in g.fields}
