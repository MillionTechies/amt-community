import type { UserManagerSettings } from 'oidc-client-ts'
import { describe, expect, it, vi } from 'vitest'
import { JUST_SIGNED_IN, oidcConfig, signInArgs } from './auth'

describe('oidcConfig', () => {
  it('signs in with the realm and client from the environment', () => {
    const settings = oidcConfig as UserManagerSettings
    expect(settings.authority).toBe('https://auth.test/realms/amilliontechies')
    expect(settings.client_id).toBe('community-frontend')
    expect(settings.redirect_uri).toBe(`${window.location.origin}/`)
    expect(settings.scope).toContain('organization')
  })

  it('drops the code from the address bar and remembers the sign-in, even when storage is blocked', () => {
    window.history.replaceState({}, '', '/events?code=abc&state=xyz')
    oidcConfig.onSigninCallback?.(undefined)
    expect(window.location.search).toBe('')
    expect(window.location.pathname).toBe('/events')
    expect(sessionStorage.getItem(JUST_SIGNED_IN)).toBe('1')

    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    window.history.replaceState({}, '', '/?code=abc')
    expect(() => oidcConfig.onSigninCallback?.(undefined)).not.toThrow()
    expect(window.location.search).toBe('')
    setItem.mockRestore()
  })
})

describe('signInArgs', () => {
  it('returns to the current page, or to the given path', () => {
    window.history.replaceState({}, '', '/hackathons/demo')
    expect(signInArgs()).toEqual({ redirect_uri: `${window.location.origin}/hackathons/demo` })
    expect(signInArgs('/console')).toEqual({ redirect_uri: `${window.location.origin}/console` })
  })
})
