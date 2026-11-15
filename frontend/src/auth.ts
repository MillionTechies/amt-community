import type { AuthProviderProps } from 'react-oidc-context'

const keycloak = import.meta.env.VITE_KEYCLOAK_URL
const realm = import.meta.env.VITE_KEYCLOAK_REALM

/** Sign-in is Keycloak's job: authorization code flow with PKCE. */
export const oidcConfig: AuthProviderProps = {
  authority: `${keycloak}/realms/${realm}`,
  client_id: import.meta.env.VITE_KEYCLOAK_CLIENT_ID,
  redirect_uri: window.location.origin + '/',
  post_logout_redirect_uri: window.location.origin + '/',
  // `organization` puts the member's organizations and groups in the token,
  // which is what the API (amt-auth) reads roles from.
  scope: 'openid profile email organization',
  automaticSilentRenew: true,
  // Keycloak redirects back with ?code=...; drop it from the address bar.
  onSigninCallback: () => {
    window.history.replaceState({}, document.title, window.location.pathname)
  },
}

/** Where to return after signing in: the page the member was on. */
export function signInArgs() {
  return { redirect_uri: window.location.origin + window.location.pathname }
}
