import { fireEvent, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { auth } from '../test/auth'
import { organiser, renderConsole } from '../test/console'
import { event, hackathon, me, membership } from '../test/fixtures'
import { currentPath, renderApp } from '../test/render'
import ConsoleApp from './ConsoleApp'

const sidebar = () => screen.getAllByRole('complementary')[0]
const loaded = () => screen.findAllByRole('complementary')
const crumbs = () => screen.getByRole('navigation', { name: 'Breadcrumb' })

// A page with nothing of its own to load, so these tests see only the shell.
const SHELL = '/manage/somewhere'

describe('signed out', () => {
  it('offers the organiser sign-in, coming back to the console', async () => {
    const { user } = renderApp(<ConsoleApp />, { route: '/manage', path: '/manage/*' })
    expect(screen.getByRole('heading', { name: 'Organiser console' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Sign in as an organiser' }))
    expect(auth.signinRedirect).toHaveBeenCalledWith({ redirect_uri: `${window.location.origin}/manage` })
    await user.click(screen.getByRole('link', { name: 'Back to Community' }))
    expect(currentPath()).toBe('/')
  })

  it('waits while the sign-in is still settling', () => {
    auth.isLoading = true
    renderApp(<ConsoleApp />, { route: '/manage', path: '/manage/*' })
    expect(screen.getByRole('button', { name: 'Sign in as an organiser' })).toBeDisabled()
  })
})

describe('signed in', () => {
  it('waits for the member’s roles', () => {
    renderConsole(SHELL)
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()
  })

  it('turns away a member without a role', async () => {
    const { user } = renderConsole(SHELL, {}, { member: me({ organizations: [membership()] }) })
    expect(await screen.findByText('You are signed in as a member')).toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: 'Go to my activity' }))
    expect(currentPath()).toBe('/dashboard')
  })

  it('shows an organiser their sections, name and role', async () => {
    const { user } = renderConsole(SHELL)
    expect(await screen.findByText('Amina Odhiambo')).toBeInTheDocument()
    const nav = within(sidebar())
    expect(nav.getByText('AO')).toBeInTheDocument()
    expect(nav.getByText('Event organiser and hackathon manager')).toBeInTheDocument()
    expect(nav.getByRole('link', { name: 'Events' })).toBeInTheDocument()
    expect(nav.getByRole('link', { name: 'Hackathons' })).toBeInTheDocument()
    expect(nav.getByRole('link', { name: 'Connected accounts' })).toBeInTheDocument()
    expect(nav.queryByText('Organisation')).not.toBeInTheDocument()
    expect(nav.queryByRole('link', { name: 'Platform admin' })).not.toBeInTheDocument()

    await user.click(nav.getByRole('link', { name: 'Events' }))
    expect(currentPath()).toBe('/manage/events')
    await user.click(nav.getByRole('link', { name: 'Switch to member view' }))
    expect(currentPath()).toBe('/dashboard')
  })

  it('names each kind of role', async () => {
    const roles = [
      [membership({ roles: ['event_organiser'], can_manage_events: true }), 'Event organiser'],
      [membership({ roles: ['hackathon_manager'], can_manage_hackathons: true }), 'Hackathon manager'],
      [membership({ is_admin: true, can_manage_events: true, can_manage_hackathons: true }), 'Organisation admin'],
    ] as const
    for (const [organization, role] of roles) {
      const { unmount } = renderConsole(SHELL, {}, { member: organiser({ organizations: [organization] }) })
      await loaded()
      expect(await within(sidebar()).findByText(role)).toBeInTheDocument()
      unmount()
    }
  })

  it('shows only what an event organiser can create', async () => {
    renderConsole(SHELL, {}, { member: organiser({ organizations: [membership({ roles: ['event_organiser'], can_manage_events: true })] }) })
    const nav = within(await screen.findByRole('complementary'))
    expect(nav.queryByRole('link', { name: 'Hackathons' })).not.toBeInTheDocument()
  })

  it('gives an organisation admin the team and configuration pages', async () => {
    const { user } = renderConsole(SHELL, {}, { member: organiser({ organizations: [membership({ is_admin: true })] }) })
    const nav = within(await screen.findByRole('complementary'))
    expect(nav.getByText('Organisation admin')).toBeInTheDocument()
    expect(nav.queryByRole('link', { name: 'Events' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Create' })).not.toBeInTheDocument()
    await user.click(nav.getByRole('link', { name: 'Team and roles' }))
    expect(currentPath()).toBe('/manage/team')
    expect(nav.getByRole('link', { name: 'Configuration' })).toHaveAttribute('href', '/manage/configuration')
  })

  it('takes a platform admin to the platform area', async () => {
    const { user } = renderConsole(SHELL, {}, { member: me({ full_name: 'Root', is_platform_admin: true }) })
    const nav = within(await screen.findByRole('complementary'))
    expect(nav.getByText('Platform admin', { selector: 'span' })).toBeInTheDocument()
    expect(nav.getByRole('link', { name: 'Team and roles' })).toBeInTheDocument()
    await user.click(nav.getByRole('link', { name: 'Platform admin' }))
    expect(currentPath()).toBe('/platform')
  })

  it('falls back to the sign-in name, then to “Organiser”', async () => {
    const { unmount } = renderConsole(SHELL, {}, { member: organiser({ full_name: '' }), name: 'Kip Rono' })
    await loaded()
    expect(await within(sidebar()).findByText('Kip Rono')).toBeInTheDocument()
    expect(within(sidebar()).getByText('KR')).toBeInTheDocument()
    unmount()

    renderConsole(SHELL, {}, { member: organiser({ full_name: '' }), name: '' })
    await loaded()
    expect(await within(sidebar()).findByText('Organiser')).toBeInTheDocument()
  })

  it('signs out', async () => {
    const { user } = renderConsole(SHELL)
    await user.click(await within(await screen.findByRole('complementary')).findByRole('button', { name: 'Sign out' }))
    expect(auth.signoutRedirect).toHaveBeenCalled()
  })

  it('scrolls to the top on each new page', async () => {
    const { user } = renderConsole(SHELL)
    const nav = within(await screen.findByRole('complementary'))
    expect(window.scrollTo).toHaveBeenCalledTimes(1)
    await user.click(nav.getByRole('link', { name: 'Connected accounts' }))
    expect(window.scrollTo).toHaveBeenCalledTimes(2)
  })
})

describe('the mobile menu', () => {
  it('opens, and closes from its button, the backdrop, or a link', async () => {
    const { user } = renderConsole(SHELL)
    const openMenu = async () => {
      await user.click(await screen.findByRole('button', { name: 'Open menu' }))
      return screen.getByRole('dialog', { name: 'Menu' })
    }

    await openMenu()
    await user.click(screen.getByRole('button', { name: 'Close menu' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    const menu = await openMenu()
    await user.click(menu.firstElementChild as HTMLElement)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await user.click(within(await openMenu()).getByRole('link', { name: 'Hackathons' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(currentPath()).toBe('/manage/hackathons')

    await user.click(within(await openMenu()).getByRole('link', { name: /A Million Techies/ }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(currentPath()).toBe('/manage')
  })

  it('closes when switching to the member view or the platform area', async () => {
    const { user } = renderConsole(SHELL, {}, { member: me({ is_platform_admin: true }) })
    await user.click(await screen.findByRole('button', { name: 'Open menu' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('link', { name: 'Platform admin' }))
    expect(currentPath()).toBe('/platform')
  })
})

describe('the create menu', () => {
  it('offers events and hackathons, and closes on Escape or a click outside', async () => {
    const { user } = renderConsole(SHELL)
    const toggle = await screen.findByRole('button', { name: 'Create' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')

    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const menu = screen.getByRole('menu')
    expect(within(menu).getByRole('menuitem', { name: /Hackathon/ })).toHaveAttribute('href', '/manage/hackathons/new')

    // A press inside the menu leaves it open.
    fireEvent.mouseDown(menu)
    expect(screen.getByRole('menu')).toBeInTheDocument()
    await user.keyboard('a')
    expect(screen.getByRole('menu')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()

    await user.click(toggle)
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()

    await user.click(toggle)
    await user.click(toggle)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()

    await user.click(toggle)
    await user.click(screen.getByRole('menuitem', { name: /Event/ }))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(currentPath()).toBe('/manage/events/new')
  })

  it('offers only hackathons to a hackathon manager', async () => {
    const { user } = renderConsole(SHELL, {}, { member: organiser({ organizations: [membership({ roles: ['hackathon_manager'], can_manage_hackathons: true })] }) })
    await user.click(await screen.findByRole('button', { name: 'Create' }))
    expect(screen.getAllByRole('menuitem')).toHaveLength(1)
    expect(screen.getByRole('menuitem', { name: /Hackathon/ })).toBeInTheDocument()
  })
})

describe('breadcrumbs and the item menu', () => {
  it('names each part of the address', async () => {
    renderConsole('/manage/events/new')
    const trail = within(await screen.findByRole('navigation', { name: 'Breadcrumb' }))
    expect(trail.getByRole('link', { name: 'Console' })).toHaveAttribute('href', '/manage')
    expect(trail.getByRole('link', { name: 'Events' })).toHaveAttribute('href', '/manage/events')
    expect(trail.getByText('New')).toHaveAttribute('aria-current', 'page')
    expect(screen.queryByText('This event')).not.toBeInTheDocument()
  })

  it('treats a new hackathon as a form, not an item', async () => {
    renderConsole('/manage/hackathons/new')
    const trail = within(await screen.findByRole('navigation', { name: 'Breadcrumb' }))
    expect(trail.getByRole('link', { name: 'Hackathons' })).toBeInTheDocument()
    expect(trail.getByText('New')).toBeInTheDocument()
    expect(screen.queryByText('This hackathon')).not.toBeInTheDocument()
  })

  it('shows the event being managed, with its sections', async () => {
    const { user } = renderConsole('/manage/events/react-workshop/check-in', {
      'GET /events/react-workshop/': event({ can_manage: true, status: 'draft' }),
    })
    await loaded()
    expect(within(crumbs()).getByRole('link', { name: '…' })).toBeInTheDocument()
    const nav = within(sidebar())
    expect(await nav.findByText('This event')).toBeInTheDocument()
    expect(within(crumbs()).getByRole('link', { name: 'React workshop' })).toHaveAttribute('href', '/manage/events/react-workshop')
    expect(within(crumbs()).getByText('Check-in')).toHaveAttribute('aria-current', 'page')
    expect(nav.getByText('Draft')).toBeInTheDocument()
    expect(nav.getByRole('link', { name: 'Check-in' })).toHaveAttribute('aria-current', 'page')
    expect(nav.getByRole('link', { name: 'Feedback' })).toHaveAttribute('href', '/manage/events/react-workshop/feedback')

    await user.click(nav.getAllByRole('link', { name: 'Overview' })[1])
    expect(currentPath()).toBe('/manage/events/react-workshop')
  })

  it('shows the hackathon being managed, with its sections', async () => {
    renderConsole('/manage/hackathons/climate-hack/somewhere', {
      'GET /hackathons/climate-hack/': hackathon({ can_manage: true }),
    })
    await loaded()
    const nav = within(sidebar())
    expect(await nav.findByText('This hackathon')).toBeInTheDocument()
    expect(nav.getByRole('link', { name: 'Leaderboard' })).toHaveAttribute('href', '/manage/hackathons/climate-hack/leaderboard')
    expect(within(crumbs()).getByText('somewhere')).toBeInTheDocument()
  })
})
