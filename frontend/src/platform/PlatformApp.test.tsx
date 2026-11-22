import { fireEvent, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { auth, signIn } from '../test/auth'
import { mockFetch } from '../test/fetch'
import { me, membership } from '../test/fixtures'
import { orgDetail, orgRow, overview } from '../test/platform'
import { currentPath, renderApp } from '../test/render'
import PlatformApp from './PlatformApp'

// The configuration screen belongs to the console and has its own tests.
vi.mock('../console/Configuration', () => ({
  default: ({ mode }: { mode: string }) => <p>Configuration for {mode}</p>,
}))

const admin = me({ full_name: 'Achieng Odhiambo', is_platform_admin: true })

const renderPlatform = (route: string) => renderApp(<PlatformApp />, { route, path: '/platform/*' })

const crumbs = () => screen.getByRole('banner').querySelector('ol') as HTMLElement

describe('platform admin area', () => {
  beforeEach(() => {
    vi.stubGlobal('scrollTo', vi.fn())
  })

  it.each([
    ['a visitor to sign in', null, 'Go to sign in', '/manage'],
    ['a member back to their activity', me(), 'Go to my activity', '/dashboard'],
    ['an organiser back to the console', me({ organizations: [membership({ can_manage_events: true })] }), 'Go to the organiser console', '/manage'],
  ])('sends %s', async (_who, profile, link, path) => {
    if (profile) signIn()
    mockFetch({ 'GET /me/': profile })
    const { user } = renderPlatform('/platform')
    await user.click(await screen.findByRole('link', { name: link }))
    expect(currentPath()).toBe(path)
  })

  it('lets a platform admin move between every section, then leave', async () => {
    signIn()
    mockFetch({
      'GET /me/': admin,
      'GET /platform/overview/': overview(),
      'GET /platform/organizations/': [orgRow()],
      'GET /platform/organizations/org-1/': orgDetail(),
      'GET /platform/members/': [],
      'GET /platform/emails/': [],
    })
    const { user } = renderPlatform('/platform')

    expect(await screen.findByRole('heading', { name: 'The whole community' })).toBeInTheDocument()
    expect(screen.getByText('Achieng Odhiambo')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page')
    expect(within(crumbs()).getByText('Platform')).not.toHaveAttribute('href')
    expect(window.scrollTo).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('link', { name: 'Organisations' }))
    fireEvent.click(await screen.findByText('Acme Labs'))
    expect(await screen.findByRole('heading', { name: 'Acme Labs' })).toBeInTheDocument()
    expect(within(crumbs()).getByText('Details')).not.toHaveAttribute('href')
    await user.click(within(crumbs()).getByRole('link', { name: 'Organisations' }))
    expect(currentPath()).toBe('/platform/organizations')
    expect(window.scrollTo).toHaveBeenCalledTimes(4)

    await user.click(screen.getByRole('link', { name: 'Members' }))
    expect(await screen.findByRole('heading', { name: 'Members' })).toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: 'Email delivery' }))
    expect(await screen.findByRole('heading', { name: 'Email delivery' })).toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: 'Configuration' }))
    expect(screen.getByText('Configuration for platform')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(auth.signoutRedirect).toHaveBeenCalled()
    await user.click(screen.getByRole('link', { name: 'Organiser console' }))
    expect(currentPath()).toBe('/manage')
  })

  it('opens the menu on a small screen, and closes it on the way somewhere or beside it', async () => {
    signIn()
    mockFetch({ 'GET /me/': admin, 'GET /platform/overview/': overview(), 'GET /platform/organizations/': [] })
    const { user } = renderPlatform('/platform')

    await user.click(await screen.findByRole('button', { name: 'Open menu' }))
    await user.click(within(screen.getByRole('dialog', { name: 'Menu' })).getByRole('link', { name: 'Organisations' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(currentPath()).toBe('/platform/organizations')

    await user.click(screen.getByRole('button', { name: 'Open menu' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('link', { name: /A Million Techies/ }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(currentPath()).toBe('/platform')

    await user.click(screen.getByRole('button', { name: 'Open menu' }))
    await user.click(screen.getByRole('dialog').firstElementChild as HTMLElement)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('names a nameless admin by their role, and leads back from a page that does not exist', async () => {
    signIn()
    mockFetch({ 'GET /me/': me({ full_name: '', is_platform_admin: true }), 'GET /platform/overview/': overview() })
    const { user } = renderPlatform('/platform/nowhere')
    expect(await screen.findByText(/This page does not exist/)).toBeInTheDocument()
    // The logo, the role under the name, and the name itself.
    expect(screen.getAllByText('Platform admin')).toHaveLength(3)
    expect(within(crumbs()).getByText('Details')).toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: 'Back to the overview' }))
    expect(await screen.findByRole('heading', { name: 'The whole community' })).toBeInTheDocument()
  })
})
