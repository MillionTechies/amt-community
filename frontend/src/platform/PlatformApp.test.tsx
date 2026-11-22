import { screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { auth, signIn } from '../test/auth'
import { mockFetch } from '../test/fetch'
import { me, membership } from '../test/fixtures'
import { memberRow, orgDetail, overview } from '../test/platform'
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

  it('asks a visitor to sign in', async () => {
    const { user } = renderPlatform('/platform')
    expect(screen.getByText('Sign in as a platform admin to see the whole community.')).toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: 'Go to sign in' }))
    expect(currentPath()).toBe('/manage')
  })

  it('waits for the member’s roles', () => {
    signIn()
    mockFetch({ 'GET /me/': () => new Promise(() => {}) })
    renderPlatform('/platform')
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()
  })

  it('sends a member back to their activity', async () => {
    signIn()
    mockFetch({ 'GET /me/': me() })
    const { user } = renderPlatform('/platform')
    expect(await screen.findByText('This area is for platform admins.')).toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: 'Go to my activity' }))
    expect(currentPath()).toBe('/dashboard')
  })

  it('sends an organiser back to the console', async () => {
    signIn()
    mockFetch({ 'GET /me/': me({ organizations: [membership({ can_manage_events: true })] }) })
    const { user } = renderPlatform('/platform')
    await user.click(await screen.findByRole('link', { name: 'Go to the organiser console' }))
    expect(currentPath()).toBe('/manage')
  })

  it('shows a platform admin the overview, and moves between sections', async () => {
    signIn()
    mockFetch({ 'GET /me/': admin, 'GET /platform/overview/': overview(), 'GET /platform/members/': [memberRow()] })
    const { user } = renderPlatform('/platform')

    expect(await screen.findByRole('heading', { name: 'The whole community' })).toBeInTheDocument()
    expect(screen.getByText('Achieng Odhiambo')).toBeInTheDocument()
    expect(screen.getByText('Whole platform')).toBeInTheDocument()
    expect(within(crumbs()).getByText('Platform')).not.toHaveAttribute('href')
    expect(screen.getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page')
    expect(window.scrollTo).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('link', { name: 'Members' }))
    expect(await screen.findByRole('heading', { name: 'Members' })).toBeInTheDocument()
    expect(currentPath()).toBe('/platform/members')
    expect(within(crumbs()).getByRole('link', { name: 'Platform' })).toHaveAttribute('href', '/platform')
    expect(within(crumbs()).getByText('Members')).not.toHaveAttribute('href')
    expect(window.scrollTo).toHaveBeenCalledTimes(2)
  })

  it('names an admin without a name by their role', async () => {
    signIn()
    mockFetch({ 'GET /me/': me({ full_name: '', is_platform_admin: true }), 'GET /platform/overview/': overview() })
    renderPlatform('/platform')
    await screen.findByRole('heading', { name: 'The whole community' })
    // The logo, the role under the name, and the name itself.
    expect(screen.getAllByText('Platform admin')).toHaveLength(3)
  })

  it('signs the admin out', async () => {
    signIn()
    mockFetch({ 'GET /me/': admin, 'GET /platform/overview/': overview() })
    const { user } = renderPlatform('/platform')
    await user.click(await screen.findByRole('button', { name: 'Sign out' }))
    expect(auth.signoutRedirect).toHaveBeenCalled()
  })

  it('opens the menu on a small screen, and closes it on the way somewhere', async () => {
    signIn()
    mockFetch({ 'GET /me/': admin, 'GET /platform/overview/': overview(), 'GET /platform/organizations/': [] })
    const { user } = renderPlatform('/platform')

    await user.click(await screen.findByRole('button', { name: 'Open menu' }))
    const menu = screen.getByRole('dialog', { name: 'Menu' })
    await user.click(within(menu).getByRole('link', { name: 'Organisations' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(currentPath()).toBe('/platform/organizations')

    await user.click(screen.getByRole('button', { name: 'Open menu' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('link', { name: /A Million Techies/ }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(currentPath()).toBe('/platform')
  })

  it('closes the menu when tapping beside it', async () => {
    signIn()
    mockFetch({ 'GET /me/': admin, 'GET /platform/overview/': overview() })
    const { user } = renderPlatform('/platform')
    await user.click(await screen.findByRole('button', { name: 'Open menu' }))
    await user.click(screen.getByRole('dialog').firstElementChild as HTMLElement)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(currentPath()).toBe('/platform')
  })

  it('leaves for the organiser console or the community site', async () => {
    signIn()
    mockFetch({ 'GET /me/': admin, 'GET /platform/overview/': overview() })
    const { user } = renderPlatform('/platform')
    await user.click(await screen.findByRole('link', { name: 'Organiser console' }))
    expect(currentPath()).toBe('/manage')
  })

  it('links back up from an organisation', async () => {
    signIn()
    mockFetch({ 'GET /me/': admin, 'GET /platform/organizations/org-1/': orgDetail(), 'GET /platform/organizations/': [] })
    const { user } = renderPlatform('/platform/organizations/org-1')
    expect(await screen.findByRole('heading', { name: 'Acme Labs' })).toBeInTheDocument()
    expect(within(crumbs()).getByText('Details')).not.toHaveAttribute('href')
    await user.click(within(crumbs()).getByRole('link', { name: 'Organisations' }))
    expect(currentPath()).toBe('/platform/organizations')
  })

  it('shows the email log and the platform configuration', async () => {
    signIn()
    mockFetch({ 'GET /me/': admin, 'GET /platform/emails/': [] })
    const { user } = renderPlatform('/platform/emails')
    expect(await screen.findByRole('heading', { name: 'Email delivery' })).toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: 'Configuration' }))
    expect(screen.getByText('Configuration for platform')).toBeInTheDocument()
    expect(within(crumbs()).getByText('Configuration')).toBeInTheDocument()
  })

  it('says when a page does not exist', async () => {
    signIn()
    mockFetch({ 'GET /me/': admin })
    renderPlatform('/platform/nowhere')
    expect(await screen.findByText(/This page does not exist/)).toBeInTheDocument()
    expect(within(crumbs()).getByText('Details')).toBeInTheDocument()
  })
})
