import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

import { setToken } from '../api'
import { auth, signOut } from './auth'

// Every test talks to the stand-in in ./auth instead of a real Keycloak session.
vi.mock('react-oidc-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-oidc-context')>()),
  useAuth: () => auth,
}))

afterEach(() => {
  cleanup()
  sessionStorage.clear()
  signOut()
  setToken(undefined)
  vi.unstubAllGlobals()
  vi.useRealTimers()
})
