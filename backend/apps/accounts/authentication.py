from amt_auth.django.authentication import KeycloakAuthentication

from apps.accounts.models import Profile
from apps.accounts.sync import sync_new_organizations
from apps.notifications import emails


class ProfileAuthentication(KeycloakAuthentication):
    """amt-auth's Keycloak authentication, plus a local Profile for the user.

    `request.user` stays amt-auth's `KeycloakUser`; the profile hangs off it as
    `request.user.profile`. Name and email follow the token. A new member gets a
    welcome email, and organizations the mirror has not seen yet are synced.
    """

    def authenticate(self, request):
        result = super().authenticate(request)
        if result is None:
            return None
        user, claims = result
        name = claims.name or " ".join(filter(None, [claims.given_name, claims.family_name]))
        profile, created = Profile.objects.get_or_create(
            sub=claims.sub, defaults={"email": claims.email or "", "full_name": name}
        )
        if created:
            emails.welcome(profile)
        elif (profile.email, profile.full_name) != (claims.email or "", name):
            profile.email, profile.full_name = claims.email or "", name
            profile.save(update_fields=["email", "full_name", "updated_at"])
        sync_new_organizations(claims)
        user.profile = profile
        return user, claims
