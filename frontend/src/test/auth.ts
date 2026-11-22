/**
 * A stand-in for react-oidc-context's useAuth (wired up in setup.ts for every test file).
 *
 *   signIn({ name: 'Wanjiru', token: 'abc' })   // later useAuth() calls see a signed-in member
 *   signOut()                                   // the state before each test
 *   expect(auth.signinRedirect).toHaveBeenCalled()
 *
 * Roles and organisations come from the API (GET /me/), so stub that with the `me()` fixture.
 */
import { vi } from 'vitest'

interface SignInOptions {
  /** Shown as the member's name (auth.user.profile.name). */
  name?: string
  sub?: string
  email?: string
  /** The access token sent to the API. */
  token?: string
}

// The object every useAuth() call returns; tests may read or tweak it directly.
export const auth = {
  isAuthenticated: false,
  isLoading: false,
  user: null as null | { access_token: string; profile: { sub: string; name: string; email: string } },
  signinRedirect: vi.fn((_args?: unknown) => Promise.resolve()),
  signoutRedirect: vi.fn((_args?: unknown) => Promise.resolve()),
}

// Sign a member in with the given profile and token.
export function signIn({ name = 'Test Member', sub = 'user-1', email = 'member@example.com', token = 'test-token' }: SignInOptions = {}) {
  auth.isAuthenticated = true
  auth.isLoading = false
  auth.user = { access_token: token, profile: { sub, name, email } }
}

// Back to a signed-out visitor, with fresh redirect spies.
export function signOut() {
  auth.isAuthenticated = false
  auth.isLoading = false
  auth.user = null
  auth.signinRedirect = vi.fn((_args?: unknown) => Promise.resolve())
  auth.signoutRedirect = vi.fn((_args?: unknown) => Promise.resolve())
}
