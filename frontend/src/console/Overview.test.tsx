import { screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CommunityEvent, Hackathon } from '../api'
import { organiser, renderConsole } from '../test/console'
import { event, hackathon, membership } from '../test/fixtures'
import { currentPath } from '../test/render'

const page = <T,>(results: T[], count = results.length) => ({ count, next: null, results })

const lists = ({
  upcoming = [] as CommunityEvent[],
  past = [] as CommunityEvent[],
  drafts = [] as CommunityEvent[],
  hackathons = [] as Hackathon[],
} = {}) => ({
  'GET /events/?scope=managed&when=upcoming': page(upcoming),
  'GET /events/?scope=managed&when=past&status=published': page(past),
  'GET /events/?scope=managed&status=draft': page(drafts),
  'GET /hackathons/?scope=managed&ordering=-starts_at': page(hackathons),
})

// Sunday 22 Nov 2026, 09:00 where the browser is.
const at = (hour: number) => vi.setSystemTime(new Date(2026, 10, 22, hour))

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  at(9)
})

const panel = (name: string) => screen.getByRole('heading', { name }).closest('section') as HTMLElement

describe('Overview', () => {
  it('lists what needs attention and what is coming up', async () => {
    const { user } = renderConsole('/manage', lists({
      upcoming: [
        event({ slug: 'soon', title: 'Soon', starts_at: '2026-11-23T09:00:00Z', capacity: 40, registered_count: 10, spots_left: 30 }),
        event({ slug: 'almost', title: 'Almost', starts_at: '2026-12-02T09:00:00Z', capacity: 20, registered_count: 19, spots_left: 1 }),
        event({ slug: 'packed', title: 'Packed', starts_at: '2026-12-03T09:00:00Z', capacity: 10, registered_count: 10, spots_left: 0 }),
        event({ slug: 'open', title: 'Open house', starts_at: '2026-12-04T09:00:00Z', registered_count: 5 }),
        event({ slug: 'roomy', title: 'Roomy', starts_at: '2026-12-05T09:00:00Z', capacity: 100, registered_count: 2, spots_left: 98 }),
        event({ slug: 'unknown', title: 'Unknown', starts_at: '2026-12-06T09:00:00Z', capacity: 100, spots_left: null }),
        event({ slug: 'called-off', title: 'Called off', status: 'cancelled', starts_at: '2026-12-01T09:00:00Z' }),
        event({ slug: 'plan', title: 'Plan', status: 'draft', starts_at: '2026-11-24T09:00:00Z' }),
      ],
      past: [event({ slug: 'done', title: 'Meetup', ends_at: '2026-11-15T12:00:00Z' })],
      drafts: [event({ slug: 'plan', title: 'Plan', status: 'draft' })],
      hackathons: [
        hackathon({ slug: 'closed', title: 'Closed hack', submission_deadline: '2026-11-20T12:00:00Z', ends_at: '2026-11-25T12:00:00Z', starts_at: '2026-11-18T08:00:00Z', submission_count: 7, participant_count: 12, team_count: 3 }),
        hackathon({ slug: 'judged', title: 'Judged hack', status: 'judging', participant_count: 8 }),
        hackathon({ slug: 'idea', title: 'Idea hack', status: 'draft' }),
        hackathon({ slug: 'off', title: 'Off hack', status: 'cancelled' }),
        hackathon({ slug: 'old', title: 'Old hack', status: 'completed', ends_at: '2026-10-01T12:00:00Z' }),
      ],
    }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Good morning, Amina' })).toBeInTheDocument()
    expect(screen.getByText('8 things need your attention.')).toBeInTheDocument()

    expect(screen.getByRole('link', { name: /Upcoming events\s*6/ })).toHaveAttribute('href', '/manage/events')
    expect(screen.getByText('Registrations', { selector: 'span' }).parentElement?.parentElement).toHaveTextContent('Registrations46Across upcoming events')
    expect(screen.getByRole('link', { name: /Active hackathons\s*2/ })).toHaveTextContent('20 people taking part')
    expect(screen.getByText('Drafts', { selector: 'span' }).parentElement?.parentElement).toHaveTextContent('Drafts2Waiting to be published')

    const tasks = within(panel('Needs attention'))
    expect(tasks.getByText('Soon starts tomorrow')).toBeInTheDocument()
    expect(tasks.getByText('10 registered. Open check-in on the day to scan tickets.')).toBeInTheDocument()
    expect(tasks.getByText('Almost is almost full')).toBeInTheDocument()
    expect(tasks.getByText('Packed is full')).toBeInTheDocument()
    expect(tasks.getByText('10 of 10 places taken. New sign-ups go to the waiting list.')).toBeInTheDocument()
    expect(tasks.queryByText(/Roomy|Unknown|Open house/)).not.toBeInTheDocument()
    expect(tasks.getByText('Close Meetup')).toBeInTheDocument()
    expect(tasks.getByText(/It ended 7 days ago/)).toBeInTheDocument()
    expect(tasks.getByText('Start judging Closed hack')).toBeInTheDocument()
    expect(tasks.getByText('Submissions closed 2 days ago with 7 projects in.')).toBeInTheDocument()
    expect(tasks.getByText('Judged hack is being judged')).toBeInTheDocument()
    expect(tasks.getByText('Plan is a draft')).toBeInTheDocument()
    expect(tasks.getByText('Idea hack is a draft')).toBeInTheDocument()

    const schedule = within(panel('Coming up'))
    const items = schedule.getAllByRole('link')
    expect(items).toHaveLength(8)
    expect(items[0]).toHaveTextContent('Closed hack')
    expect(items[0]).toHaveTextContent('3 teams, 12 people')
    expect(items[1]).toHaveTextContent('Soon')
    expect(items[1]).toHaveTextContent('10 of 40')
    expect(within(items[2]).getByText('Draft')).toBeInTheDocument()
    expect(schedule.getByRole('meter', { name: 'Almost: places taken' })).toBeInTheDocument()
    expect(schedule.getByText('5 registered')).toBeInTheDocument()
    expect(schedule.queryByText('Called off')).not.toBeInTheDocument()
    expect(schedule.queryByText('Off hack')).not.toBeInTheDocument()
    expect(schedule.queryByText('Old hack')).not.toBeInTheDocument()

    await user.click(tasks.getAllByRole('link', { name: 'Check-in' })[0])
    expect(currentPath()).toBe('/manage/events/soon/check-in')
  })

  it('reports all clear, and offers to create something', async () => {
    at(14)
    const { user } = renderConsole('/manage', lists())
    expect(await screen.findByRole('heading', { level: 1, name: 'Good afternoon, Amina' })).toBeInTheDocument()
    expect(screen.getByText('Everything is on track.')).toBeInTheDocument()
    expect(screen.getByText('All caught up')).toBeInTheDocument()
    expect(screen.getByText('Nothing unpublished')).toBeInTheDocument()
    expect(screen.getByText('Nothing scheduled')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Create hackathon' })).toHaveAttribute('href', '/manage/hackathons/new')
    await user.click(screen.getByRole('link', { name: 'Create event' }))
    expect(currentPath()).toBe('/manage/events/new')
  })

  it('shows a hackathon manager only hackathons', async () => {
    at(19)
    renderConsole('/manage', lists({ hackathons: [hackathon({ status: 'judging' })] }), {
      member: organiser({ full_name: '', organizations: [membership({ roles: ['hackathon_manager'], can_manage_hackathons: true })] }),
    })
    expect(await screen.findByRole('heading', { level: 1, name: 'Good evening' })).toBeInTheDocument()
    expect(screen.getByText('1 thing needs your attention.')).toBeInTheDocument()
    expect(screen.queryByText('Upcoming events')).not.toBeInTheDocument()
    expect(screen.queryByText('Registrations')).not.toBeInTheDocument()
    expect(screen.getByText('Active hackathons')).toBeInTheDocument()
  })

  it('shows an event organiser only events', async () => {
    renderConsole('/manage', lists(), {
      member: organiser({ organizations: [membership({ roles: ['event_organiser'], can_manage_events: true })] }),
    })
    expect(await screen.findByText('Nothing scheduled')).toBeInTheDocument()
    expect(screen.queryByText('Active hackathons')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Create event' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Create hackathon' })).not.toBeInTheDocument()
  })
})
