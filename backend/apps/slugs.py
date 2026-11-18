"""Public addresses for events and hackathons: the title, then a short random code.

`react-workshop-nairobi-k3x9qa` reads well when shared, and unlike a numeric id it does
not reveal how many there are or let anyone step to the next one. It is set once, so
links keep working when the title is edited.
"""

import secrets
import string

from django.utils.text import slugify

ALPHABET = string.ascii_lowercase + string.digits
CODE_LENGTH = 6
MAX_LENGTH = 80


def make_slug(title: str, model) -> str:
    base = slugify(title)[: MAX_LENGTH - CODE_LENGTH - 1].strip("-") or model._meta.model_name
    while True:
        code = "".join(secrets.choice(ALPHABET) for _ in range(CODE_LENGTH))
        slug = f"{base}-{code}"
        if not model._default_manager.filter(slug=slug).exists():
            return slug
