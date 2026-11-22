import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { mockFetch, reply } from '../test/fetch'
import { overview } from '../test/platform'
import { currentPath, renderApp } from '../test/render'
import Overview from './Overview'

const panel = (title: string) => screen.getByRole('heading', { name: title }).closest('section') as HTMLElement

describe('platform overview', () => {
  it('shows the whole community at a glance', async () => {
    mockFetch({ 'GET /platform/overview/': overview() })
    renderApp(<Overview />, { route: '/platform' })
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()

    expect(await screen.findByRole('heading', { name: 'The whole community' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Organisations\s*4\s*9 organisers and admins/ })).toHaveAttribute('href', '/platform/organizations')
    expect(screen.getByRole('link', { name: /Members\s*120\s*12 joined in the last 30 days/ })).toHaveAttribute('href', '/platform/members')
    expect(screen.getByText('150 check-ins · 75% attended')).toBeInTheDocument()
    expect(screen.getByText('3 upcoming')).toBeInTheDocument()
    expect(screen.getByText('1 open or judging')).toBeInTheDocument()
    expect(screen.getByText('11 projects submitted')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Email problems\s*1\s*2 waiting to send/ })).toHaveAttribute('href', '/platform/emails')
    expect(screen.getByText('No sign-ups in the last 30 days.')).toBeInTheDocument()

    const events = panel('Events by status')
    expect(within(events).getAllByRole('meter').map((m) => m.getAttribute('aria-label'))).toEqual(['published', 'draft', 'completed'])
    expect(within(events).getByRole('meter', { name: 'completed' })).toHaveAttribute('aria-valuemax', '15')
    const hackathons = panel('Hackathons by status')
    expect(within(hackathons).getAllByRole('meter').map((m) => m.getAttribute('aria-label'))).toEqual(['published', 'completed'])

    const newest = within(panel('Newest events')).getByRole('link', { name: /React workshop/ })
    expect(newest).toHaveAttribute('href', '/events/react-workshop')
    expect(newest).toHaveTextContent('Acme Labs · 30 Nov 2026 · added today')
  })

  it('takes the admin to what needs attention', async () => {
    mockFetch({ 'GET /platform/overview/': overview() })
    const { user } = renderApp(<Overview />, { route: '/platform' })
    await user.click(await screen.findByRole('link', { name: /Acme Labs has no admin\s*Add one in Keycloak\./ }))
    expect(currentPath()).toBe('/platform/organizations/org-1')
  })

  it('says when a quiet community has nothing to show', async () => {
    mockFetch({
      'GET /platform/overview/': overview({
        totals: { ...overview().totals, registrations: 0, check_ins: 0 },
        emails: { sent_30d: 0, queued: 0, failed: 0 },
        events_by_status: { published: 0 },
        hackathons_by_status: {},
        recent_events: [],
        attention: [],
      }),
    })
    renderApp(<Overview />, { route: '/platform' })
    expect(await screen.findByText('0 check-ins · No registrations yet')).toBeInTheDocument()
    expect(screen.getByText('Nothing waiting')).toBeInTheDocument()
    expect(screen.getAllByText('None yet.')).toHaveLength(2)
    expect(screen.getByText('Nothing needs you right now.')).toBeInTheDocument()
    expect(within(panel('Newest events')).getByText('No events yet.')).toBeInTheDocument()
  })

  it('charts sign-ups and flags things of any kind', async () => {
    const today = new Date().toISOString()
    mockFetch({
      'GET /platform/overview/': overview({
        registrations_30d: [today, today],
        attention: [{ kind: 'something_new', title: 'Something odd', detail: 'Have a look.', link: '/platform/configuration' }],
      }),
    })
    renderApp(<Overview />, { route: '/platform' })
    expect(await screen.findByText(/2 sign-ups in the last 7 days/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Something odd/ })).toHaveAttribute('href', '/platform/configuration')
  })

  it('explains when the overview cannot load', async () => {
    mockFetch({ 'GET /platform/overview/': reply(500, { detail: 'The database is down.' }) })
    renderApp(<Overview />, { route: '/platform' })
    expect(await screen.findByRole('alert')).toHaveTextContent('The database is down.')
  })
})
