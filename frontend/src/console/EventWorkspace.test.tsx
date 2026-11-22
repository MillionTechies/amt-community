import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import type { UserEvent } from '@testing-library/user-event'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CommunityEvent } from '../api'
import {
  announcement, attendee, captureDownloads, eventStats, feedback, person, renderConsole, resource,
} from '../test/console'
import { callsTo, reply, sentBody } from '../test/fetch'
import { event } from '../test/fixtures'
import { currentPath } from '../test/render'

// The camera cannot run in jsdom: this stand-in reports whatever code a test "shows" it.
vi.mock('@yudiel/react-qr-scanner', () => ({
  Scanner: ({ onScan, onError }: { onScan: (codes: { rawValue: string }[]) => void; onError: (error: unknown) => void }) => (
    <div>
      {['TICKET-1', 'TICKET-2', 'BAD'].map((code) => (
        <button key={code} type="button" onClick={() => onScan([{ rawValue: code }])}>Show {code}</button>
      ))}
      <button type="button" onClick={() => onScan([])}>Show nothing</button>
      <button type="button" onClick={() => onError(new Error('NotAllowedError'))}>Block the camera</button>
    </div>
  ),
}))

// ProseMirror measures the page to place the cursor; jsdom has no layout, so give it empty boxes.
beforeAll(() => {
  const rect = () => new DOMRect(0, 0, 0, 0)
  const list = () => Object.assign([rect()], { item: () => rect() }) as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = rect
  Range.prototype.getClientRects = list
  Element.prototype.getClientRects = list
  document.elementFromPoint = () => null
})

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-22T12:00:00Z'))
})

const BASE = '/manage/events/react-workshop'
const API = '/events/react-workshop'

const open = (section: string, item: Partial<CommunityEvent> = {}, routes: Record<string, unknown> = {}) =>
  renderConsole(`${BASE}${section}`, { [`GET ${API}/`]: event({ can_manage: true, ...item }), ...routes })

const title = () => screen.findByRole('heading', { level: 1, name: 'React workshop' })
const dialog = () => screen.getByRole('alertdialog')
const answer = (user: UserEvent, choice: string) => user.click(within(dialog()).getByRole('button', { name: choice }))
const bodyRows = () => within(screen.getByRole('table')).getAllByRole('row').slice(1)
// A headline tile: its label sits beside an icon.
const kpi = (label: string) => screen.getAllByText(label, { selector: 'span' }).find((el) => el.nextElementSibling)!.parentElement!.parentElement!
const detail = (term: string) => screen.getByText(term, { selector: 'dt' }).nextElementSibling

describe('the event header', () => {
  it('waits, then says when the event cannot be found', async () => {
    renderConsole(BASE, { [`GET ${API}/`]: null })
    expect(await screen.findByText('Event not found.')).toBeInTheDocument()
  })

  it('shows why the event did not load', async () => {
    renderConsole(BASE, { [`GET ${API}/`]: reply(500, { detail: 'Server error.' }) })
    expect(await screen.findByRole('alert')).toHaveTextContent('Server error.')
  })

  it('turns away someone who does not organise it', async () => {
    renderConsole(BASE, { [`GET ${API}/`]: event() })
    expect(await screen.findByText('You do not organise this event.')).toBeInTheDocument()
  })

  it('publishes a draft after asking', async () => {
    const { user, fetch } = open('', { status: 'draft' }, { [`POST ${API}/transition/`]: reply(200, {}) })
    await title()
    expect(screen.getByText('This is a draft. Only organisers can see it until you publish.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Public page' })).toHaveAttribute('href', '/events/react-workshop')

    await user.click(screen.getByRole('button', { name: 'Publish' }))
    expect(within(dialog()).getByText('Publish this event?')).toBeInTheDocument()
    await answer(user, 'Cancel')
    expect(callsTo(fetch, `POST ${API}/transition/`)).toHaveLength(0)

    await user.click(screen.getByRole('button', { name: 'Publish' }))
    await answer(user, 'Publish')
    expect(await screen.findByText('Event published')).toBeInTheDocument()
    expect(sentBody(fetch, `POST ${API}/transition/`)).toEqual({ status: 'published' })
  })

  it('says when publishing fails', async () => {
    const { user } = open('', { status: 'draft' }, { [`POST ${API}/transition/`]: reply(400, { detail: 'Add a date first.' }) })
    await title()
    await user.click(screen.getByRole('button', { name: 'Publish' }))
    await answer(user, 'Publish')
    expect(await screen.findByText('Could not update the event')).toBeInTheDocument()
    expect(screen.getByText('Add a date first.')).toBeInTheDocument()
  })

  it('deletes a draft after asking, then goes back to the list', async () => {
    const { user, fetch } = open('', { status: 'draft' }, { [`DELETE ${API}/`]: reply(204) })
    await title()
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    expect(within(dialog()).getByText('“React workshop” is removed for good.')).toBeInTheDocument()
    await answer(user, 'Cancel')
    expect(callsTo(fetch, `DELETE ${API}/`)).toHaveLength(0)

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await answer(user, 'Delete draft')
    expect(await screen.findByText('Draft deleted')).toBeInTheDocument()
    await waitFor(() => expect(currentPath()).toBe('/manage/events'))
  })

  it('says when deleting fails', async () => {
    const { user } = open('', { status: 'draft' }, { [`DELETE ${API}/`]: reply(403, { detail: 'Not yours.' }) })
    await title()
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await answer(user, 'Delete draft')
    expect(await screen.findByText('Could not delete the draft')).toBeInTheDocument()
    expect(currentPath()).toBe(BASE)
  })

  it('cancels or completes a published event', async () => {
    const { user, fetch } = open('', {}, { [`POST ${API}/transition/`]: reply(200, {}) })
    await title()
    expect(screen.queryByText(/This is a draft/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Publish' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Cancel event' }))
    await answer(user, 'Yes, cancel it')
    expect(await screen.findByText('Event cancelled')).toBeInTheDocument()
    expect(sentBody(fetch, `POST ${API}/transition/`)).toEqual({ status: 'cancelled' })

    await user.click(screen.getByRole('button', { name: 'Mark completed' }))
    await answer(user, 'Mark completed')
    expect(await screen.findByText('Event completed')).toBeInTheDocument()
    expect(sentBody(fetch, `POST ${API}/transition/`)).toEqual({ status: 'completed' })
  })

  it('offers no lifecycle actions once completed', async () => {
    open('', { status: 'completed' })
    await title()
    expect(within(screen.getByRole('main')).queryAllByRole('button')).toHaveLength(0)
  })
})

describe('EventOverview', () => {
  const registrations = [
    attendee({ id: 1, person: person({ name: 'Ann One', institution: 'Strathmore' }), created_at: '2026-11-21T08:00:00Z', checked_in_at: '2026-11-21T09:00:00Z' }),
    ...[2, 3, 4, 5, 6, 7].map((id) => attendee({ id, person: person({ name: `Person ${id}` }), email: `p${id}@example.com`, created_at: `2026-11-1${id}T08:00:00Z` })),
  ]

  it('shows sign-ups, places, recent registrations and what is left to do', async () => {
    const { user } = open('', { capacity: 40 }, {
      [`GET ${API}/stats/`]: eventStats({ registered: 30, capacity: 40, waitlisted: 2, cancelled: 3 }),
      [`GET ${API}/registrations/`]: registrations,
      [`GET ${API}/resources/`]: [resource()],
      [`GET ${API}/announcements/`]: [],
    })
    expect(await screen.findByText('10 of 40 places left')).toBeInTheDocument()
    expect(kpi('Registered')).toHaveAttribute('href', `${BASE}/registrations`)
    expect(kpi('Waiting list')).toHaveTextContent('Waiting list23 cancelled')
    expect(kpi('Checked in')).toHaveTextContent('Starts in 8 days')
    expect(kpi('Average rating')).toHaveTextContent('Average rating–No feedback yet')
    expect(await screen.findByText(/7 sign-ups in the last/)).toBeInTheDocument()

    const latest = within(screen.getByRole('heading', { name: 'Latest registrations' }).closest('section')!)
    expect(latest.getAllByRole('listitem')).toHaveLength(6)
    expect(latest.getByText('Strathmore')).toBeInTheDocument()
    expect(latest.getByText('Checked in')).toBeInTheDocument()
    expect(latest.getByText('p6@example.com')).toBeInTheDocument()
    expect(latest.queryByText('Person 2')).not.toBeInTheDocument()

    const steps = within(screen.getByRole('heading', { name: 'Getting it right' }).closest('section')!)
    expect(await steps.findByText('3 of 6')).toBeInTheDocument()
    expect(steps.queryByRole('link', { name: 'Publish the event so people can register' })).not.toBeInTheDocument()
    expect(steps.getByRole('link', { name: 'Post a welcome announcement' })).toHaveAttribute('href', `${BASE}/content`)

    expect(detail('Type')).toHaveTextContent('Technical workshop')
    expect(detail('Format')).toHaveTextContent('In person')
    expect(detail('Venue')).toHaveTextContent('Nairobi Garage')
    expect(detail('Online')).toHaveTextContent('No')
    expect(detail('Places')).toHaveTextContent('40')
    expect(detail('Registration closes')).toHaveTextContent('When the event ends')
    expect(detail('Registration')).toHaveTextContent('Open')

    await user.click(steps.getByRole('link', { name: 'Check people in on the day' }))
    expect(currentPath()).toBe(`${BASE}/check-in`)
  })

  it('reports attendance and ratings once the event has happened', async () => {
    open('', {
      status: 'completed', starts_at: '2026-11-20T06:00:00Z', ends_at: '2026-11-20T09:00:00Z', summary: '', event_type: 'hack_night',
      venue: '', delivery_mode: 'online', meeting_provider: { id: 'zoom', name: 'Zoom' }, registration_deadline: '2026-11-19T21:00:00Z',
      registration_open: false,
    }, {
      [`GET ${API}/stats/`]: eventStats({ registered: 10, checked_in: 5, attendance_rate: 0.5, average_rating: 4.25, feedback_count: 4 }),
      [`GET ${API}/registrations/`]: [],
      [`GET ${API}/resources/`]: [],
      [`GET ${API}/announcements/`]: [announcement()],
    })
    expect(await screen.findByText('No limit on places')).toBeInTheDocument()
    expect(kpi('Waiting list')).toHaveTextContent('Nobody has cancelled')
    expect(kpi('Checked in')).toHaveTextContent('50% of those registered')
    expect(kpi('Average rating')).toHaveTextContent('4.3From 4 responses, out of 5')
    expect(screen.getByText('Sign-ups will show here once people register.')).toBeInTheDocument()
    expect(screen.getByText('Nobody has registered yet.')).toBeInTheDocument()
    expect(await screen.findByText('Post a welcome announcement', { selector: 'span' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Write a summary and description' })).toHaveAttribute('href', `${BASE}/edit`)
    expect(screen.getByText('Mark it completed to release certificates', { selector: 'span' })).toBeInTheDocument()

    expect(detail('Type')).toHaveTextContent('Hack night')
    expect(detail('Format')).toHaveTextContent('Online')
    expect(detail('Venue')).toHaveTextContent('Not set')
    expect(detail('Online')).toHaveTextContent('Zoom')
    expect(detail('Places')).toHaveTextContent('No limit')
    expect(detail('Registration closes')).not.toHaveTextContent('When the event ends')
    expect(detail('Registration')).toHaveTextContent('Closed')
  })

  it('says whether an online event has a link yet', async () => {
    const stats = { [`GET ${API}/stats/`]: eventStats({ attendance_rate: null }) }
    const { unmount } = open('', { delivery_mode: 'hybrid', online_url: 'https://meet.example.com/x' }, stats)
    expect(await screen.findByText('Link added')).toBeInTheDocument()
    unmount()

    open('', { delivery_mode: 'online', starts_at: '2026-11-22T06:00:00Z' }, stats)
    expect(await screen.findByText('No link yet')).toBeInTheDocument()
    expect(kpi('Checked in')).toHaveTextContent('Nobody checked in yet')
  })

  it('waits for the numbers', async () => {
    open('', {}, { [`GET ${API}/stats/`]: () => new Promise(() => undefined) })
    await title()
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()
  })
})

describe('EventRegistrations', () => {
  const people = [
    attendee({ id: 1, person: person({ name: 'Ann Waiting' }), email: 'ann@example.com', status: 'registered', created_at: '2026-11-18T08:00:00Z' }),
    attendee({ id: 2, person: person({ name: 'Ben Here', institution: 'Strathmore' }), status: 'registered', checked_in_at: '2026-11-21T09:00:00Z', created_at: '2026-11-19T08:00:00Z' }),
    attendee({ id: 3, person: person({ name: 'Cy Later' }), status: 'waitlisted', created_at: '2026-11-20T08:00:00Z' }),
    attendee({ id: 4, person: person({ name: 'Di Gone' }), status: 'cancelled', created_at: '2026-11-21T08:00:00Z' }),
  ]
  const rowOf = (name: string) => bodyRows().find((r) => r.textContent?.includes(name))!

  it('filters, checks people in and undoes it', async () => {
    const { user, fetch } = open('/registrations', {}, {
      [`GET ${API}/registrations/`]: people,
      [`POST ${API}/check-in/`]: reply(200, {}),
      [`DELETE ${API}/check-in/?registration=2`]: reply(204),
    })
    expect(await screen.findByText('Ann Waiting')).toBeInTheDocument()
    const tab = (name: RegExp) => screen.getByRole('tab', { name })
    expect(tab(/^All/)).toHaveTextContent('All4')
    expect(tab(/^Not yet in/)).toHaveTextContent('1')
    expect(tab(/^Checked in/)).toHaveTextContent('1')
    expect(tab(/^Waiting list/)).toHaveTextContent('1')
    expect(tab(/^Cancelled/)).toHaveTextContent('1')

    // Newest first.
    expect(bodyRows()[0]).toHaveTextContent('Di Gone')
    expect(within(rowOf('Ben Here')).getByText('Strathmore')).toBeInTheDocument()
    expect(within(rowOf('Ben Here')).getAllByText('Checked in')).toHaveLength(1)
    expect(within(rowOf('Cy Later')).queryByRole('button')).not.toBeInTheDocument()

    fireEvent.click(within(rowOf('Ann Waiting')).getByRole('button', { name: 'Check in' }))
    await waitFor(() => expect(sentBody(fetch, `POST ${API}/check-in/`)).toEqual({ registration: 1 }))
    fireEvent.click(within(rowOf('Ben Here')).getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(callsTo(fetch, `DELETE ${API}/check-in/?registration=2`)).toHaveLength(1))

    await user.click(tab(/^Waiting list/))
    expect(bodyRows()).toHaveLength(1)
    expect(bodyRows()[0]).toHaveTextContent('Cy Later')
    for (const [name, who] of [[/^Not yet in/, 'Ann Waiting'], [/^Checked in/, 'Ben Here'], [/^Cancelled/, 'Di Gone']] as const) {
      await user.click(tab(name))
      expect(bodyRows()[0]).toHaveTextContent(who)
    }
  })

  it('shows why a check-in failed', async () => {
    open('/registrations', {}, {
      [`GET ${API}/registrations/`]: people,
      [`POST ${API}/check-in/`]: reply(400, { detail: 'The event has not started.' }),
      [`DELETE ${API}/check-in/?registration=2`]: reply(400, { detail: 'Too late to undo.' }),
    })
    fireEvent.click(within(await screen.findByRole('row', { name: /Ann Waiting/ })).getByRole('button', { name: 'Check in' }))
    expect(await screen.findByText('The event has not started.')).toBeInTheDocument()
  })

  it('shows why undoing a check-in failed', async () => {
    open('/registrations', {}, {
      [`GET ${API}/registrations/`]: people,
      [`DELETE ${API}/check-in/?registration=2`]: reply(400, { detail: 'Too late to undo.' }),
    })
    fireEvent.click(within(await screen.findByRole('row', { name: /Ben Here/ })).getByRole('button', { name: 'Undo' }))
    expect(await screen.findByText('Too late to undo.')).toBeInTheDocument()
  })

  it('exports the people shown as CSV', async () => {
    const downloads = captureDownloads()
    const { user } = open('/registrations', {}, { [`GET ${API}/registrations/`]: people })
    await user.click(await screen.findByRole('tab', { name: /^Checked in/ }))
    await user.click(screen.getByRole('button', { name: 'Export CSV' }))
    expect(downloads.name()).toBe('react-workshop-registrations.csv')
    expect(await downloads.text()).toBe(
      '"Name","Email","Institution","Status","Registered","Checked in"\n' +
        '"Ben Here","wanjiru@example.com","Strathmore","registered","2026-11-19T08:00:00Z","2026-11-21T09:00:00Z"',
    )
  })

  it('has nothing to export before anyone registers', async () => {
    open('/registrations', {}, { [`GET ${API}/registrations/`]: [] })
    expect(await screen.findByRole('button', { name: 'Export CSV' })).toBeDisabled()
    expect(screen.getAllByText('Nobody has registered yet.').length).toBeGreaterThan(0)
  })

  it('waits for the list', async () => {
    open('/registrations', {}, { [`GET ${API}/registrations/`]: () => new Promise(() => undefined) })
    await title()
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()
  })
})

describe('EventCheckIn', () => {
  const checkIn = (init: RequestInit) => {
    const { ticket_code } = JSON.parse(String(init.body))
    return ticket_code === 'BAD'
      ? reply(404, { detail: 'No ticket with that code' })
      : attendee({ person: person({ name: ticket_code === 'TICKET-1' ? 'Wanjiru Kamau' : 'Otieno Barasa' }), already_checked_in: ticket_code === 'TICKET-2' } as never)
  }

  it('scans tickets once each and logs the result', async () => {
    const { user, fetch } = open('/check-in', {}, {
      [`GET ${API}/stats/`]: eventStats({ registered: 20, checked_in: 4 }),
      [`POST ${API}/check-in/`]: checkIn,
    })
    expect(await screen.findByText('of 20 registered')).toBeInTheDocument()
    expect(screen.getByText('4')).toBeInTheDocument()
    expect(screen.getByText('Scans will be listed here.')).toBeInTheDocument()
    expect(within(screen.getByRole('main')).getByRole('link', { name: 'Registrations' })).toHaveAttribute('href', `${BASE}/registrations`)

    await user.click(screen.getByRole('button', { name: 'Start scanning' }))
    await user.click(screen.getByRole('button', { name: 'Show nothing' }))
    await user.click(screen.getByRole('button', { name: 'Show TICKET-1' }))
    expect(await screen.findByText('Wanjiru Kamau checked in.')).toBeInTheDocument()
    expect(sentBody(fetch, `POST ${API}/check-in/`)).toEqual({ ticket_code: 'TICKET-1' })

    // The camera keeps seeing the same ticket: it is checked in once.
    await user.click(screen.getByRole('button', { name: 'Show TICKET-1' }))
    expect(callsTo(fetch, `POST ${API}/check-in/`)).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'Show TICKET-2' }))
    expect(await screen.findByText('Otieno Barasa was already checked in.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Show BAD' }))
    expect(await screen.findByText('No ticket with that code.')).toBeInTheDocument()

    const session = within(screen.getByRole('heading', { name: 'This session' }).closest('section')!)
    expect(session.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      expect.stringContaining('No ticket with that code'),
      expect.stringContaining('Otieno Barasa was already checked in'),
      expect.stringContaining('Wanjiru Kamau checked in'),
    ])

    // Stopping and starting again lets the same ticket be read again.
    await user.click(screen.getByRole('button', { name: 'Stop scanning' }))
    await user.click(screen.getByRole('button', { name: 'Start scanning' }))
    await user.click(screen.getByRole('button', { name: 'Show TICKET-1' }))
    await waitFor(() => expect(callsTo(fetch, `POST ${API}/check-in/`)).toHaveLength(4))
  })

  it('ignores other tickets while one is being checked in', async () => {
    const { user, fetch } = open('/check-in', {}, {
      [`GET ${API}/stats/`]: eventStats(),
      [`POST ${API}/check-in/`]: () => new Promise(() => undefined),
    })
    await user.click(await screen.findByRole('button', { name: 'Start scanning' }))
    await user.click(screen.getByRole('button', { name: 'Show TICKET-1' }))
    await user.click(screen.getByRole('button', { name: 'Show TICKET-2' }))
    expect(callsTo(fetch, `POST ${API}/check-in/`)).toHaveLength(1)
  })

  it('explains when the camera cannot be used', async () => {
    const { user } = open('/check-in')
    await user.click(await screen.findByRole('button', { name: 'Start scanning' }))
    await user.click(screen.getByRole('button', { name: 'Block the camera' }))
    expect(screen.getByText('Could not use the camera. Allow camera access in your browser and try again.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start scanning' })).toBeInTheDocument()
    // The door count is still loading.
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()
  })
})

describe('EventContent', () => {
  const editor = () => document.querySelector<HTMLElement>('.ProseMirror')!
  const announcementsPanel = async () => within((await screen.findByRole('heading', { name: 'Announcements' })).closest('section')!)
  const resourcesPanel = async () => within((await screen.findByRole('heading', { name: 'Resources' })).closest('section')!)

  it('posts an announcement, emailing everyone by default', async () => {
    const { user, fetch } = open('/content', {}, {
      [`GET ${API}/announcements/`]: [],
      [`GET ${API}/resources/`]: [],
      [`POST ${API}/announcements/`]: announcement(),
    })
    const panel = await announcementsPanel()
    const post = await panel.findByRole('button', { name: 'Post announcement' })
    expect(post).toBeDisabled()
    await user.type(panel.getByLabelText('Title'), 'Welcome')
    await user.click(editor())
    await user.paste('Bring a laptop')
    expect(post).toBeEnabled()
    await user.click(post)
    expect(await screen.findByText('Announcement posted')).toBeInTheDocument()
    expect(screen.getByText('It is on the event page and was emailed to everyone registered.')).toBeInTheDocument()
    expect(sentBody(fetch, `POST ${API}/announcements/`)).toEqual({ title: 'Welcome', body: '<p>Bring a laptop</p>', notify: true })
    expect(panel.getByLabelText('Title')).toHaveValue('')
  })

  it('posts without email when asked, and shows a failure', async () => {
    let attempts = 0
    const { user, fetch } = open('/content', {}, {
      [`GET ${API}/announcements/`]: [],
      [`GET ${API}/resources/`]: [],
      [`POST ${API}/announcements/`]: () => (attempts++ ? announcement() : reply(400, { title: ['Too long.'] })),
    })
    const panel = await announcementsPanel()
    await user.type(await panel.findByLabelText('Title'), 'Quiet note')
    await user.click(editor())
    await user.paste('No email')
    await user.click(panel.getByRole('checkbox', { name: 'Also email everyone registered' }))
    await user.click(panel.getByRole('button', { name: 'Post announcement' }))
    expect(await panel.findByText('Too long.')).toBeInTheDocument()

    await user.click(panel.getByRole('button', { name: 'Post announcement' }))
    expect(await screen.findByText('It is on the event page.')).toBeInTheDocument()
    expect(sentBody(fetch, `POST ${API}/announcements/`)).toMatchObject({ notify: false })
    expect(panel.getByRole('checkbox', { name: 'Also email everyone registered' })).not.toBeChecked()
  })

  it('removes an announcement after asking', async () => {
    const { user, fetch } = open('/content', {}, {
      [`GET ${API}/announcements/`]: [announcement({ id: 9, title: 'Parking' })],
      [`GET ${API}/resources/`]: [],
      [`DELETE ${API}/announcements/9/`]: reply(204),
    })
    const panel = await announcementsPanel()
    expect(await panel.findByText('Parking')).toBeInTheDocument()
    expect(panel.getByText('Bring a laptop.')).toBeInTheDocument()

    await user.click(panel.getByRole('button', { name: 'Remove' }))
    expect(within(dialog()).getByText(/“Parking” disappears from the event page/)).toBeInTheDocument()
    await answer(user, 'Cancel')
    expect(callsTo(fetch, `DELETE ${API}/announcements/9/`)).toHaveLength(0)

    await user.click(panel.getByRole('button', { name: 'Remove' }))
    await answer(user, 'Remove')
    expect(await screen.findByText('Announcement removed')).toBeInTheDocument()
  })

  it('adds and removes resources', async () => {
    let added = 0
    const { user, fetch } = open('/content', {}, {
      [`GET ${API}/announcements/`]: [],
      [`GET ${API}/resources/`]: [resource({ id: 3, title: 'Slides' })],
      [`POST ${API}/resources/`]: () => (added++ ? resource() : reply(400, { url: ['Enter a valid URL.'] })),
      [`DELETE ${API}/resources/3/`]: reply(204),
    })
    const panel = await resourcesPanel()
    expect(await panel.findByRole('link', { name: 'Slides' })).toHaveAttribute('href', 'https://example.com/slides')

    await user.type(panel.getByLabelText('Title'), 'Repo')
    await user.type(panel.getByLabelText('Link'), 'https://github.com/example/repo')
    await user.click(panel.getByRole('button', { name: 'Add resource' }))
    expect(await panel.findByText('Enter a valid URL.')).toBeInTheDocument()
    await user.click(panel.getByRole('button', { name: 'Add resource' }))
    expect(await screen.findByText('Resource added')).toBeInTheDocument()
    expect(sentBody(fetch, `POST ${API}/resources/`)).toEqual({ title: 'Repo', url: 'https://github.com/example/repo', description: '' })
    expect(panel.getByLabelText('Title')).toHaveValue('')

    await user.click(panel.getByRole('button', { name: 'Remove' }))
    expect(await screen.findByText('Resource removed')).toBeInTheDocument()
    expect(callsTo(fetch, `DELETE ${API}/resources/3/`)).toHaveLength(1)
  })
})

describe('EventFeedback', () => {
  it('summarises ratings and lists comments', async () => {
    open('/feedback', {}, {
      [`GET ${API}/feedback/`]: [
        feedback({ id: 1, rating: 5, comment: 'Loved it' }),
        feedback({ id: 2, rating: 4 }),
        feedback({ id: 3, rating: 1, comment: 'Too long' }),
      ],
    })
    expect(await screen.findByText('3.3')).toBeInTheDocument()
    expect(screen.getByText('out of 5, from 3 responses')).toBeInTheDocument()
    expect(screen.getByRole('meter', { name: '5 stars' })).toHaveAttribute('aria-valuenow', '1')
    expect(screen.getByRole('meter', { name: '2 stars' })).toHaveAttribute('aria-valuenow', '0')
    expect(screen.getByText('1 star')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Comments (2)' })).toBeInTheDocument()
    expect(screen.getByText('Loved it')).toBeInTheDocument()
    expect(screen.getByText('1 of 5')).toBeInTheDocument()
  })

  it('says when ratings came without comments', async () => {
    open('/feedback', {}, { [`GET ${API}/feedback/`]: [feedback({ rating: 4 })] })
    expect(await screen.findByText('out of 5, from 1 response')).toBeInTheDocument()
    expect(screen.getByText('Ratings came in without comments.')).toBeInTheDocument()
  })

  it('points to the event page before any feedback', async () => {
    const { user } = open('/feedback', {}, { [`GET ${API}/feedback/`]: [] })
    expect(await screen.findByText(/No feedback yet/)).toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: 'View the page' }))
    expect(currentPath()).toBe('/events/react-workshop')
  })

  it('waits for the feedback', async () => {
    open('/feedback', {}, { [`GET ${API}/feedback/`]: () => new Promise(() => undefined) })
    await title()
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()
  })
})
