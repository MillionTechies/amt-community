import { screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { signIn } from '../test/auth'
import { mockFetch, page, reply } from '../test/fetch'
import { event, hackathon, me, registration } from '../test/fixtures'
import { renderApp } from '../test/render'
import Dashboard from './Dashboard'

const UPCOMING = 'GET /events/?scope=mine&when=upcoming&ordering=starts_at'
const PAST = 'GET /events/?scope=mine&when=past'
const HACKATHONS = 'GET /hackathons/?scope=mine&ordering=-starts_at'

// Pretend it is a given hour on 22 Nov 2026, local time; only Date is faked so the UI still runs.
const at = (hour: number) => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 10, 22, hour))
}

const panel = (title: string) => screen.getByRole('heading', { name: title }).closest('section')!
const kpi = (label: string) => screen.getByText(label, { selector: 'span' }).parentElement!.parentElement!

describe('Dashboard', () => {
  it('greets the member and lays out what is next and what needs doing', async () => {
    at(9)
    signIn()
    mockFetch({
      'GET /me/': me({ full_name: 'Wanjiru Kamau', headline: '', skills: ['Go'] }),
      [UPCOMING]: page([
        event({ slug: 'next', title: 'Go meetup', delivery_mode: 'online', my_registration: registration() }),
        event({ slug: 'later', title: 'Design day', starts_at: '2026-12-10T06:00:00Z', my_registration: registration({ status: 'waitlisted' }) }),
        event({ slug: 'off', title: 'Called off', status: 'cancelled' }),
        event({ slug: 'last', title: 'Year end', starts_at: '2026-12-20T06:00:00Z', my_registration: registration() }),
      ]),
      [PAST]: page([
        event({ slug: 'p1', title: 'Rust intro', my_registration: registration({ checked_in_at: '2026-10-01T06:00:00Z', certificate_available: true }) }),
        event({ slug: 'p2', title: 'SQL night', my_registration: registration({ checked_in_at: '2026-10-02T06:00:00Z', has_feedback: true }) }),
        event({ slug: 'p3', title: 'Missed it' }),
      ]),
      [HACKATHONS]: page([
        hackathon({ slug: 'h1', title: 'Judge hack', is_judge: true, status: 'judging', submission_count: 4 }),
        hackathon({ slug: 'h2', title: 'Team hack', my_team_id: 5, submissions_open: true }),
        hackathon({ slug: 'h3', title: 'Open hack', registration_open: true }),
        hackathon({ slug: 'h4', title: 'Done hack', status: 'completed', results_published: true }),
        hackathon({ slug: 'h5', title: 'Old hack', ends_at: '2026-11-01T06:00:00Z' }),
      ]),
    })
    renderApp(<Dashboard />)
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Good morning, Wanjiru' })).toBeInTheDocument()
    expect(screen.getByText('You have 3 upcoming events and 3 active hackathons.')).toBeInTheDocument()

    expect(within(kpi('Upcoming')).getByText('3')).toBeInTheDocument()
    expect(within(kpi('Attended')).getByText('Of 3 past events')).toBeInTheDocument()
    expect(within(kpi('Hackathons')).getByText('3 active now')).toBeInTheDocument()
    expect(within(kpi('Certificates')).getByText('1')).toBeInTheDocument()

    expect(screen.getByText('Next up, in 8 days')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Go meetup' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View ticket' })).toHaveAttribute('href', '/events/next')
    expect(screen.queryByText(/You are on the waiting list/)).not.toBeInTheDocument()

    const schedule = within(panel('Your schedule')).getAllByRole('link')
    expect(schedule.map((l) => l.getAttribute('href'))).toEqual(['/hackathons/h1', '/hackathons/h2', '/hackathons/h3', '/events/later', '/events/last'])
    expect(schedule[0]).toHaveTextContent('Judge')
    expect(schedule[1]).toHaveTextContent('Open')
    expect(schedule[3]).toHaveTextContent('Waitlisted')

    const past = within(panel('Past events')).getAllByRole('link')
    expect(past[0]).toHaveTextContent('Attended')
    expect(past[0]).toHaveTextContent('Certificate')
    expect(past[2]).toHaveTextContent('Not checked in')
    expect(past[2]).not.toHaveTextContent('Certificate')

    const todos = within(panel('To do')).getAllByRole('listitem')
    expect(todos.map((t) => t.querySelector('p')!.textContent)).toEqual([
      'Score the projects for Judge hack',
      'Submit your project for Team hack',
      'Join a team for Open hack',
      'How was Rust intro?',
      'Your certificate for Rust intro is ready',
      'Finish your profile',
    ])
    expect(within(todos[0]).getByRole('link', { name: 'Judge' })).toHaveAttribute('href', '/hackathons/h1/judge')
    expect(within(todos[5]).getByRole('link', { name: 'Edit' })).toHaveAttribute('href', '/profile')

    const mine = within(panel('My hackathons')).getAllByRole('link')
    expect(mine[0]).toHaveTextContent('Judge')
    expect(mine[1]).toHaveTextContent('Taking part')
    expect(mine[3]).toHaveTextContent('Results out')
  })

  it('shows an event under way and a waiting-list place', async () => {
    at(14)
    signIn()
    mockFetch({
      'GET /me/': me({ full_name: 'Otieno', headline: 'Dev', skills: [] }),
      [UPCOMING]: page([
        event({ venue: '', starts_at: '2026-11-22T06:00:00Z', ends_at: '2026-11-22T20:00:00Z', my_registration: registration({ status: 'waitlisted' }) }),
      ]),
      [PAST]: page([event({ slug: 'p', title: 'Past one', my_registration: registration() })]),
      [HACKATHONS]: page([hackathon()]),
    })
    renderApp(<Dashboard />)
    expect(await screen.findByRole('heading', { name: 'Good afternoon, Otieno' })).toBeInTheDocument()
    expect(screen.getByText('You have 1 upcoming event and 1 active hackathon.')).toBeInTheDocument()
    expect(screen.getByText('Of 1 past event')).toBeInTheDocument()
    expect(screen.getByText('Happening now')).toBeInTheDocument()
    expect(screen.getByText('You are on the waiting list. We will email you if a place opens.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View event' })).toBeInTheDocument()
    expect(screen.queryByText('Nothing else booked')).not.toBeInTheDocument()
    expect(screen.getByText('Finish your profile')).toBeInTheDocument()
  })

  it('says nothing else is booked after the next event', async () => {
    at(9)
    signIn()
    mockFetch({
      'GET /me/': me({ headline: 'Dev', skills: ['Go'] }),
      [UPCOMING]: page([event()]),
      [PAST]: page([]),
      [HACKATHONS]: page([]),
    })
    renderApp(<Dashboard />)
    expect(await screen.findByText('Nothing else booked')).toBeInTheDocument()
  })

  it('points a member with nothing loaded to events and hackathons', async () => {
    at(19)
    mockFetch({ [UPCOMING]: reply(500), [PAST]: reply(500), [HACKATHONS]: reply(500) })
    renderApp(<Dashboard />)
    expect(await screen.findByRole('heading', { name: 'Good evening' })).toBeInTheDocument()
    expect(screen.getByText('You have 0 upcoming events and 0 active hackathons.')).toBeInTheDocument()
    expect(screen.getByText('Nothing booked yet')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Browse events' })).toHaveAttribute('href', '/events')
    expect(screen.getByText('Events you have been to will show up here.')).toBeInTheDocument()
    expect(screen.getByText('All caught up')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'See hackathons' })).toHaveAttribute('href', '/hackathons')
  })

})
