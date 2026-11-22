import { fireEvent, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { captureDownloads, organiser, renderConsole } from '../test/console'
import { callsTo, reply } from '../test/fetch'
import { event, hackathon, membership } from '../test/fixtures'
import { currentPath } from '../test/render'

const bodyRows = () => within(screen.getByRole('table')).getAllByRole('row').slice(1)
const tab = (name: RegExp) => screen.getByRole('tab', { name })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-22T12:00:00Z'))
})

describe('EventsList', () => {
  const events = [
    event({ slug: 'react', title: 'React workshop', capacity: 40, registered_count: 12 }),
    event({ slug: 'plan', title: 'Planning', status: 'draft', event_type: 'hack_night', delivery_mode: 'online', registered_count: 0 }),
    event({ slug: 'old', title: 'Old meetup', event_type: 'meetup', starts_at: '2026-10-01T06:00:00Z', ends_at: '2026-10-01T09:00:00Z', registered_count: 30 }),
    event({ slug: 'off', title: 'Called off', status: 'cancelled' }),
  ]

  it('reads every page, filters by status and opens an event', async () => {
    const { user, fetch } = renderConsole('/manage/events', {
      'GET /events/?scope=managed&page=1': { count: 4, next: 'page 2', results: events.slice(0, 2) },
      'GET /events/?scope=managed&page=2': { count: 4, next: null, results: events.slice(2) },
    })
    expect(await screen.findByText('React workshop')).toBeInTheDocument()
    expect(callsTo(fetch, 'GET /events/?scope=managed&page=2')).toHaveLength(1)
    expect(tab(/^Upcoming/)).toHaveTextContent('Upcoming2')
    expect(tab(/^Drafts/)).toHaveTextContent('Drafts1')
    expect(tab(/^Past/)).toHaveTextContent('Past1')
    expect(tab(/^Cancelled/)).toHaveTextContent('Cancelled1')
    expect(tab(/^All/)).toHaveTextContent('All4')

    // Upcoming, soonest first.
    expect(bodyRows().map((r) => r.textContent)).toEqual([
      expect.stringContaining('React workshop'),
      expect.stringContaining('Planning'),
    ])
    expect(within(bodyRows()[0]).getByText('12/40')).toBeInTheDocument()
    expect(within(bodyRows()[0]).getByRole('meter', { name: 'React workshop: places taken' })).toBeInTheDocument()
    expect(within(bodyRows()[0]).getByText('Technical workshop')).toBeInTheDocument()
    expect(within(bodyRows()[1]).getByText('Hack night')).toBeInTheDocument()
    expect(within(bodyRows()[1]).getByText('Acme Labs · Online')).toBeInTheDocument()

    await user.click(tab(/^Past/))
    expect(bodyRows()).toHaveLength(1)
    expect(bodyRows()[0]).toHaveTextContent('Old meetup')
    expect(within(bodyRows()[0]).getByText('30')).toBeInTheDocument()

    await user.click(tab(/^Cancelled/))
    expect(bodyRows()[0]).toHaveTextContent('Called off')
    await user.click(tab(/^Drafts/))
    expect(bodyRows()[0]).toHaveTextContent('Planning')
    await user.click(tab(/^All/))
    expect(bodyRows()).toHaveLength(4)

    fireEvent.click(within(bodyRows().find((r) => r.textContent?.includes('Old meetup'))!).getAllByRole('cell')[1])
    expect(currentPath()).toBe('/manage/events/old')
  })

  it('exports the rows shown as CSV', async () => {
    const downloads = captureDownloads()
    const { user } = renderConsole('/manage/events', {
      'GET /events/?scope=managed&page=1': { count: 1, next: null, results: [events[0], events[1]] },
    })
    await screen.findByText('React workshop')
    await user.click(tab(/^Drafts/))
    await user.click(screen.getByRole('button', { name: 'Export CSV' }))
    expect(downloads.name()).toBe('events.csv')
    expect(await downloads.text()).toBe(
      '"Title","Organisation","Starts","Ends","Type","Format","Status","Registered","Places","Address"\n' +
        `"Planning","Acme Labs","2026-11-30T06:00:00Z","2026-11-30T09:00:00Z","hack_night","online","draft","0","","${location.origin}/events/plan"`,
    )
  })

  it('says when there is nothing to show', async () => {
    renderConsole('/manage/events', { 'GET /events/?scope=managed&page=1': { count: 0, next: null, results: [] } })
    expect(await screen.findByText('No upcoming events. Create one to get started.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeDisabled()
    expect(screen.getByRole('link', { name: 'New event' })).toHaveAttribute('href', '/manage/events/new')
  })

  it('shows a load failure, without the create button for someone who cannot create', async () => {
    renderConsole('/manage/events', { 'GET /events/?scope=managed&page=1': reply(500, { detail: 'Server error.' }) }, {
      member: organiser({ organizations: [membership({ is_admin: true })] }),
    })
    expect(await screen.findByRole('alert')).toHaveTextContent('Server error.')
    expect(screen.queryByRole('link', { name: 'New event' })).not.toBeInTheDocument()
  })

  it('waits for the list', async () => {
    renderConsole('/manage/events', { 'GET /events/?scope=managed&page=1': () => new Promise(() => undefined) })
    expect(await screen.findByRole('heading', { name: 'Events' })).toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()
  })
})

describe('HackathonsList', () => {
  const hackathons = [
    hackathon({ slug: 'climate', title: 'Climate hack', theme: 'Climate', participant_count: 12, team_count: 3, submission_count: 2 }),
    hackathon({ slug: 'idea', title: 'Idea hack', status: 'draft' }),
    hackathon({ slug: 'judge', title: 'Judge hack', status: 'judging' }),
    hackathon({ slug: 'done', title: 'Done hack', status: 'completed' }),
  ]

  it('filters by stage and opens a hackathon', async () => {
    const { user } = renderConsole('/manage/hackathons', {
      'GET /hackathons/?scope=managed&page=1': { count: 4, next: null, results: hackathons },
    })
    expect(await screen.findByText('Climate hack')).toBeInTheDocument()
    expect(screen.getByText('Acme Labs · Climate')).toBeInTheDocument()
    expect(within(bodyRows().find((r) => r.textContent?.includes('Idea hack'))!).getByText('Acme Labs')).toBeInTheDocument()
    expect(tab(/^All/)).toHaveTextContent('All4')
    expect(screen.getByRole('link', { name: 'New hackathon' })).toHaveAttribute('href', '/manage/hackathons/new')

    for (const [name, title] of [[/^Drafts/, 'Idea hack'], [/^Open/, 'Climate hack'], [/^Judging/, 'Judge hack'], [/^Completed/, 'Done hack']] as const) {
      await user.click(tab(name))
      expect(bodyRows()).toHaveLength(1)
      expect(bodyRows()[0]).toHaveTextContent(title)
    }

    await user.click(tab(/^Open/))
    expect(within(bodyRows()[0]).getByText('12')).toBeInTheDocument()
    fireEvent.click(within(bodyRows()[0]).getAllByRole('cell')[1])
    expect(currentPath()).toBe('/manage/hackathons/climate')
  })

  it('shows a load failure, and waits while loading', async () => {
    renderConsole('/manage/hackathons', { 'GET /hackathons/?scope=managed&page=1': reply(500, { detail: 'Server error.' }) }, {
      member: organiser({ organizations: [membership({ is_admin: true })] }),
    })
    expect(await screen.findByRole('alert')).toHaveTextContent('Server error.')
    expect(screen.queryByRole('link', { name: 'New hackathon' })).not.toBeInTheDocument()
  })

  it('waits for the list', async () => {
    renderConsole('/manage/hackathons', { 'GET /hackathons/?scope=managed&page=1': () => new Promise(() => undefined) })
    expect(await screen.findByRole('heading', { name: 'Hackathons' })).toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()
  })
})
