"""An SMTP email backend that reads its server and login from the Configuration page."""

from email.utils import formataddr, parseaddr

from django.core.mail.backends.smtp import EmailBackend

from apps.configuration import config


class ConfiguredEmailBackend(EmailBackend):
    def __init__(self, **kwargs):
        port = config.get("email.port")
        super().__init__(
            host=config.get("email.host") or "localhost",
            port=int(port) if port else 25,
            username=config.get("email.username"),
            password=config.get("email.password"),
            use_tls=config.get_bool("email.use_tls"),
            use_ssl=config.get_bool("email.use_ssl"),
            **{k: v for k, v in kwargs.items() if k not in ("host", "port", "username", "password", "use_tls", "use_ssl")},
        )


def sender(organization_id=None) -> tuple[str, list[str]]:
    """(From header, Reply-To list) for an email about an organisation's event."""
    address = parseaddr(config.get("email.from_address"))[1] or "community@amilliontechies.com"
    name = config.get("email.from_name", organization_id) or "A Million Techies Community"
    reply_to = config.get("email.reply_to", organization_id)
    return formataddr((name, address)), [reply_to] if reply_to else []
