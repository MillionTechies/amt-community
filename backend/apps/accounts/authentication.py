from amt_auth.django.authentication import KeycloakAuthentication

from apps.accounts.models import Profile


class ProfileAuthentication(KeycloakAuthentication):
    """amt-auth's Keycloak authentication, plus a local Profile for the user.

    `request.user` stays amt-auth's `KeycloakUser`; the profile hangs off it as
    `request.user.profile`. Name and email follow the token.
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
        if not created and (profile.email, profile.full_name) != (claims.email or "", name):
            profile.email, profile.full_name = claims.email or "", name
            profile.save(update_fields=["email", "full_name", "updated_at"])
        user.profile = profile
        return user, claims
