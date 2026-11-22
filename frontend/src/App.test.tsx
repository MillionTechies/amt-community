import { useQuery } from '@tanstack/react-query'
import { screen, waitFor, within } from '@testing-library/react'
import { useParams } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import App from './App'
import { api } from './api'
import { JUST_SIGNED_IN } from './auth'
import { auth, signIn } from './test/auth'
import { callsTo, mockFetch } from './test/fetch'
import { me, membership } from './test/fixtures'
import { currentPath, renderApp } from './test/render'

// The pages and the two admin areas have their own tests; here they only say where we are.
vi.mock('./pages/Home', () => ({
  default: function Home() {
    const stats = useQuery({ queryKey: ['stats'], queryFn: () => api<{ members: number }>('/stats/') })
    return <p>Home page, {stats.data?.members ?? 'no'} members</p>
  },
}))
vi.mock('./pages/Events', () => ({ default: () => <p>Events page</p> }))
vi.mock('./pages/EventDetail', () => ({
  default: function EventDetail() {
    return <p>Event {useParams().slug}</p>
  },
}))
vi.mock('./pages/Hackathons', () => ({ default: () => <p>Hackathons page</p> }))
vi.mock('./pages/HackathonDetail', () => ({ default: () => <p>Hackathon page</p> }))
vi.mock('./pages/Judging', () => ({ default: () => <p>Judging page</p> }))
vi.mock('./pages/Certificate', () => ({ default: () => <p>Certificate page</p> }))
vi.mock('./pages/Dashboard', () => ({ default: () => <p>Dashboard page</p> }))
vi.mock('./pages/Profile', () => ({
  default: function Profile() {
    throw new Error('Profile broke')
  },
}))
vi.mock('./console/ConsoleApp', () => ({ default: () => <p>Organiser console page</p> }))
vi.mock('./platform/PlatformApp', () => ({ default: () => <p>Platform page</p> }))

const header = () => within(screen.getByRole('banner'))

const showApp = (route: string) => renderApp(<App />, { route })

describe('the app', () => {
  it('waits while sign-in is being checked', () => {
    auth.isLoading = true
    showApp('/')
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()
  })

  it('shows a visitor the public site', async () => {
    mockFetch({ 'GET /stats/': { members: 120 } })
    const { user } = showApp('/')
    expect(await screen.findByText('Home page, 120 members')).toBeInTheDocument()
    expect(header().queryByRole('link', { name: 'My activity' })).not.toBeInTheDocument()
    expect(header().queryByRole('link', { name: 'Platform' })).not.toBeInTheDocument()
    expect(header().queryByRole('link', { name: /Organiser console/ })).not.toBeInTheDocument()
    expect(within(screen.getByRole('contentinfo')).getByRole('link', { name: 'For organisers' })).toHaveAttribute('href', '/manage')

    await user.click(header().getByRole('link', { name: 'Events' }))
    expect(screen.getByText('Events page')).toBeInTheDocument()
    await user.click(header().getByRole('link', { name: 'Hackathons' }))
    expect(screen.getByText('Hackathons page')).toBeInTheDocument()
  })

  it('lets a visitor sign in or join', async () => {
    mockFetch({ 'GET /stats/': { members: 1 } })
    const { user } = showApp('/events')
    await user.click(header().getByRole('button', { name: 'Sign in' }))
    expect(auth.signinRedirect).toHaveBeenLastCalledWith({ redirect_uri: `${window.location.origin}/` })
    await user.click(header().getByRole('button', { name: 'Join' }))
    expect(auth.signinRedirect).toHaveBeenLastCalledWith({ redirect_uri: `${window.location.origin}/`, prompt: 'create' })
  })

  it('opens the public pages at their addresses', () => {
    showApp('/events/react-workshop')
    expect(screen.getByText('Event react-workshop')).toBeInTheDocument()
  })

  it.each([
    ['/hackathons/climate-hack', 'Hackathon page'],
    ['/certificates/ABC123', 'Certificate page'],
  ])('opens %s', (route, text) => {
    showApp(route)
    expect(screen.getByText(text)).toBeInTheDocument()
  })

  it('says when a page does not exist', async () => {
    mockFetch({ 'GET /stats/': { members: 1 } })
    const { user } = showApp('/nowhere')
    expect(screen.getByText(/This page does not exist/)).toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: 'Go home' }))
    expect(currentPath()).toBe('/')
  })

  it.each(['/dashboard', '/profile', '/hackathons/climate-hack/judge'])('asks a visitor to sign in for %s', async (route) => {
    const { user } = showApp(route)
    expect(screen.getByText('Sign in to see this page.')).toBeInTheDocument()
    await user.click(within(screen.getByRole('main')).getByRole('button', { name: 'Sign in' }))
    expect(auth.signinRedirect).toHaveBeenCalled()
  })

  it.each([
    ['/events/new', '/manage/events/new'],
    ['/events/react-workshop/manage', '/manage/events/react-workshop'],
    ['/events/react-workshop/edit', '/manage/events/react-workshop/edit'],
    ['/hackathons/new', '/manage/hackathons/new'],
    ['/hackathons/climate-hack/manage', '/manage/hackathons/climate-hack'],
    ['/hackathons/climate-hack/edit', '/manage/hackathons/climate-hack/edit'],
    ['/organisation', '/manage/team'],
  ])('moves %s to the organiser console', async (from, to) => {
    showApp(from)
    expect(await screen.findByText('Organiser console page')).toBeInTheDocument()
    expect(currentPath()).toBe(to)
  })

  it('opens the platform admin area', async () => {
    showApp('/platform/members')
    expect(await screen.findByText('Platform page')).toBeInTheDocument()
  })

  it('shows what went wrong on a broken page, keeping the header to move on', async () => {
    signIn()
    mockFetch({ 'GET /me/': me() })
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { user } = showApp('/profile')
    expect(screen.getByRole('heading', { name: 'Something went wrong on this page' })).toBeInTheDocument()
    expect(screen.getByText('Profile broke')).toBeInTheDocument()

    await user.click(header().getByRole('link', { name: 'Events' }))
    expect(await screen.findByText('Events page')).toBeInTheDocument()
    expect(screen.queryByText('Profile broke')).not.toBeInTheDocument()
    error.mockRestore()
  })
})

describe('a signed-in member', () => {
  it('sees their pages and their name, and sends their token', async () => {
    signIn({ name: 'Token Name', token: 'abc' })
    const fetch = mockFetch({ 'GET /me/': me({ full_name: 'Wanjiru Kamau' }) })
    const { user } = showApp('/dashboard')
    expect(screen.getByText('Dashboard page')).toBeInTheDocument()
    expect(await header().findByRole('link', { name: 'Wanjiru Kamau' })).toHaveAttribute('href', '/profile')
    expect(callsTo(fetch, 'GET /me/')[0][1]?.headers).toEqual({ Authorization: 'Bearer abc' })

    await user.click(header().getByRole('link', { name: 'My activity' }))
    expect(currentPath()).toBe('/dashboard')
    await user.click(header().getByRole('button', { name: 'Sign out' }))
    expect(auth.signoutRedirect).toHaveBeenCalled()
  })

  it('opens judging for a hackathon', () => {
    signIn()
    mockFetch({ 'GET /me/': me() })
    showApp('/hackathons/climate-hack/judge')
    expect(screen.getByText('Judging page')).toBeInTheDocument()
  })

  it('is named from their sign-in until their profile loads', () => {
    signIn({ name: 'Token Name' })
    mockFetch({ 'GET /me/': () => new Promise(() => {}) })
    showApp('/dashboard')
    expect(header().getByRole('link', { name: 'Token Name' })).toBeInTheDocument()
  })

  it('is called Profile with no name anywhere', () => {
    signIn({ name: '' })
    mockFetch({ 'GET /me/': () => new Promise(() => {}) })
    showApp('/dashboard')
    expect(header().getByRole('link', { name: 'Profile' })).toBeInTheDocument()
  })

  it.each([
    [me({ is_platform_admin: true }), 'You are a platform admin'],
    [me({ organizations: [membership({ is_admin: true })] }), 'You are an organisation admin'],
    [me({ organizations: [membership({ roles: ['event_organiser'], can_manage_events: true })] }), 'You are an event organiser'],
    [me({ organizations: [membership({ roles: ['hackathon_manager'], can_manage_hackathons: true })] }), 'You are a hackathon manager'],
  ])('shows an organiser the way to their console', async (profile, title) => {
    signIn()
    mockFetch({ 'GET /me/': profile })
    showApp('/events')
    expect(await header().findByRole('link', { name: /Organiser console/ })).toHaveAttribute('title', title)
    expect(header().queryByRole('link', { name: 'Platform' }) !== null).toBe(profile.is_platform_admin)
  })

  it('takes a platform admin to the platform area', async () => {
    signIn()
    mockFetch({ 'GET /me/': me({ is_platform_admin: true }) })
    const { user } = showApp('/events')
    await user.click(await header().findByRole('link', { name: 'Platform' }))
    expect(await screen.findByText('Platform page')).toBeInTheDocument()
  })

  it('refetches what is on screen once they sign in', async () => {
    let members = 0
    const fetch = mockFetch({ 'GET /stats/': () => ({ members: ++members }), 'GET /me/': me() })
    const { user } = showApp('/')
    expect(await screen.findByText('Home page, 1 members')).toBeInTheDocument()

    signIn()
    await user.click(header().getByRole('link', { name: /Community/ }))
    expect(await screen.findByText('Home page, 2 members')).toBeInTheDocument()
    expect(callsTo(fetch, 'GET /me/')).toHaveLength(1)
  })
})

describe('right after signing in', () => {
  const justSignedIn = () => sessionStorage.setItem(JUST_SIGNED_IN, '1')

  it.each([
    ['a platform admin', me({ is_platform_admin: true }), '/', '/platform'],
    ['an organiser', me({ organizations: [membership({ can_manage_events: true })] }), '/dashboard', '/manage'],
    ['a member', me(), '/', '/dashboard'],
  ])('sends %s to where they work', async (_who, profile, from, to) => {
    signIn()
    justSignedIn()
    mockFetch({ 'GET /me/': profile, 'GET /stats/': { members: 1 } })
    showApp(from)
    await waitFor(() => expect(currentPath()).toBe(to))
    expect(sessionStorage.getItem(JUST_SIGNED_IN)).toBeNull()
  })

  it('leaves a member on their activity', async () => {
    signIn()
    justSignedIn()
    mockFetch({ 'GET /me/': me() })
    showApp('/dashboard')
    await waitFor(() => expect(sessionStorage.getItem(JUST_SIGNED_IN)).toBeNull())
    expect(currentPath()).toBe('/dashboard')
  })

  it('returns an organiser to the page they signed in from', async () => {
    signIn()
    justSignedIn()
    mockFetch({ 'GET /me/': me({ is_platform_admin: true }) })
    showApp('/events')
    await waitFor(() => expect(sessionStorage.getItem(JUST_SIGNED_IN)).toBeNull())
    expect(currentPath()).toBe('/events')
  })

  it('leaves someone who was already signed in where they are', async () => {
    signIn()
    mockFetch({ 'GET /me/': me({ is_platform_admin: true }), 'GET /stats/': { members: 1 } })
    showApp('/')
    expect(await header().findByRole('link', { name: 'Platform' })).toBeInTheDocument()
    expect(currentPath()).toBe('/')
  })

  it('leaves everyone where they are without session storage', async () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Storage is disabled', 'SecurityError')
    })
    signIn()
    mockFetch({ 'GET /me/': me({ is_platform_admin: true }), 'GET /stats/': { members: 1 } })
    showApp('/')
    expect(await header().findByRole('link', { name: 'Platform' })).toBeInTheDocument()
    expect(getItem).toHaveBeenCalledWith(JUST_SIGNED_IN)
    expect(currentPath()).toBe('/')
    getItem.mockRestore()
  })
})
