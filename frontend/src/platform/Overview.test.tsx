import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { mockFetch, reply } from '../test/fetch'
import { overview } from '../test/platform'
import { currentPath, renderApp } from '../test/render'
import Overview from './Overview'

const panel = (title: string) => screen.getByRole('heading', { name: title }).closest('section') as HTMLElement

describe('platform overview', () => {
  it('shows the whole community at a glance and leads to what needs attention', async () => {
    const today = new Date().toISOString()
    mockFetch({
      'GET /platform/overview/': overview({
        registrations_30d: [today, today],
        attention: [
          ...overview().attention,
          { kind: 'something_new', title: 'Something odd', detail: 'Have a look.', link: '/platform/configuration' },
        ],
      }),
    })
    const { user } = renderApp(<Overview />, { route: '/platform' })
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()

    expect(await screen.findByRole('link', { name: /Organisations\s*4/ })).toHaveAttribute('href', '/platform/organizations')
    expect(screen.getByRole('link', { name: /Members\s*120/ })).toHaveAttribute('href', '/platform/members')
    expect(screen.getByText('150 check-ins · 75% attended')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Email problems\s*1\s*2 waiting to send/ })).toHaveAttribute('href', '/platform/emails')
    expect(screen.getByText(/2 sign-ups in the last 7 days/)).toBeInTheDocument()

    const events = panel('Events by status')
    expect(within(events).getAllByRole('meter').map((m) => m.getAttribute('aria-label'))).toEqual(['published', 'draft', 'completed'])
    expect(within(events).getByRole('meter', { name: 'completed' })).toHaveAttribute('aria-valuemax', '15')
    expect(within(panel('Newest events')).getByRole('link', { name: /React workshop/ })).toHaveAttribute('href', '/events/react-workshop')
    expect(screen.getByRole('link', { name: /Something odd/ })).toHaveAttribute('href', '/platform/configuration')

    await user.click(screen.getByRole('link', { name: /Acme Labs has no admin/ }))
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
    expect(screen.getByText('No sign-ups in the last 30 days.')).toBeInTheDocument()
    expect(screen.getAllByText('None yet.')).toHaveLength(2)
    expect(screen.getByText('Nothing needs you right now.')).toBeInTheDocument()
    expect(within(panel('Newest events')).getByText('No events yet.')).toBeInTheDocument()
  })

  it('explains when the overview cannot load', async () => {
    mockFetch({ 'GET /platform/overview/': reply(500, { detail: 'The database is down.' }) })
    renderApp(<Overview />, { route: '/platform' })
    expect(await screen.findByRole('alert')).toHaveTextContent('The database is down.')
  })
})
