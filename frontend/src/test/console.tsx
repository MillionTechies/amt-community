/**
 * Helpers for the organiser console (src/console): API objects it reads, and a way to open
 * a console page the way an organiser does, signed in and inside the console's layout.
 *
 *   const { user, fetch } = renderConsole('/manage/events/react-workshop', {
 *     'GET /events/react-workshop/': event({ can_manage: true }),
 *     'GET /events/react-workshop/stats/': eventStats({ registered: 12 }),
 *   })
 *
 * The member is an event organiser and hackathon manager at Acme Labs unless `me` says otherwise.
 */
import { onTestFinished, vi } from 'vitest'

import type {
  Announcement,
  ConfigField,
  ConfigGroup,
  ConfigScope,
  EventLink,
  EventStats,
  Feedback,
  Integration,
  Judge,
  Me,
  Person,
  Registration,
  Resource,
  RoleAssignment,
  Team,
} from '../api'
import ConsoleApp from '../console/ConsoleApp'
import { signIn } from './auth'
import { mockFetch } from './fetch'
import { me, membership } from './fixtures'
import { renderApp } from './render'

// --- people and access ------------------------------------------------------------

// Someone shown in a list: a registration, a judge, a team member.
export const person = (overrides: Partial<Person> = {}): Person => ({
  sub: 'user-2',
  name: 'Wanjiru Kamau',
  headline: '',
  institution: '',
  ...overrides,
})

// A member who runs both events and hackathons at Acme Labs.
export const organiser = (overrides: Partial<Me> = {}): Me =>
  me({
    full_name: 'Amina Odhiambo',
    organizations: [
      membership({ roles: ['event_organiser', 'hackathon_manager'], can_manage_events: true, can_manage_hackathons: true }),
    ],
    ...overrides,
  })

// --- events ------------------------------------------------------------------------

export const eventStats = (overrides: Partial<EventStats> = {}): EventStats => ({
  registered: 0,
  waitlisted: 0,
  cancelled: 0,
  checked_in: 0,
  capacity: null,
  attendance_rate: null,
  feedback_count: 0,
  average_rating: null,
  ...overrides,
})

// A registration as organisers see it (the member's own is `registration` in ./fixtures).
export const attendee = (overrides: Partial<Registration> = {}): Registration => ({
  id: 1,
  person: person(),
  email: 'wanjiru@example.com',
  status: 'registered',
  checked_in_at: null,
  created_at: '2026-11-20T08:00:00Z',
  ...overrides,
})

export const announcement = (overrides: Partial<Announcement> = {}): Announcement => ({
  id: 1,
  title: 'Welcome',
  body: '<p>Bring a laptop.</p>',
  created_at: '2026-11-21T08:00:00Z',
  ...overrides,
})

export const resource = (overrides: Partial<Resource> = {}): Resource => ({
  id: 1,
  title: 'Slides',
  url: 'https://example.com/slides',
  description: '',
  ...overrides,
})

export const feedback = (overrides: Partial<Feedback> = {}): Feedback => ({
  id: 1,
  rating: 5,
  comment: '',
  created_at: '2026-11-21T08:00:00Z',
  ...overrides,
})

// --- hackathons ----------------------------------------------------------------------

export const judge = (overrides: Partial<Judge> = {}): Judge => ({
  id: 1,
  person: person({ name: 'Otieno Barasa' }),
  email: 'otieno@example.com',
  evaluations: 0,
  ...overrides,
})

export const team = (overrides: Partial<Team> = {}): Team => ({
  id: 1,
  name: 'Team Rocket',
  members: [{ id: 1, person: person(), is_leader: true }],
  has_submission: false,
  ...overrides,
})

// --- organisation ----------------------------------------------------------------------

export const roleAssignment = (overrides: Partial<RoleAssignment> = {}): RoleAssignment => ({
  id: 1,
  role: 'event_organiser',
  person: person(),
  email: 'wanjiru@example.com',
  ...overrides,
})

// Google, set up on the server but not connected by this organiser.
export const integration = (overrides: Partial<Integration> = {}): Integration => ({
  id: 'google',
  name: 'Google',
  app: null,
  app_name: '',
  meeting_name: 'Google Meet',
  has_calendar: true,
  configured: true,
  connected: false,
  account_email: '',
  ...overrides,
})

export const eventLink = (overrides: Partial<EventLink> = {}): EventLink => ({
  id: 1,
  provider: 'google',
  provider_name: 'Google',
  account_email: 'amina@example.com',
  is_meeting: false,
  join_url: '',
  mine: true,
  synced_at: '2026-11-21T08:00:00Z',
  ...overrides,
})

export const configScope = (overrides: Partial<ConfigScope> = {}): ConfigScope => ({
  id: 'org-1',
  name: 'Acme Labs',
  kind: 'organization',
  ...overrides,
})

export const configField = (overrides: Partial<ConfigField> = {}): ConfigField => ({
  key: 'sender_name',
  label: 'Sender name',
  kind: 'text',
  help: '',
  placeholder: '',
  source: '',
  is_set: false,
  value: '',
  inherited: '',
  ...overrides,
})

export const configGroup = (overrides: Partial<ConfigGroup> = {}): ConfigGroup => ({
  id: 'email',
  title: 'Email',
  description: 'How emails are sent.',
  fields: [configField()],
  ready: false,
  own: false,
  ...overrides,
})

// --- rendering --------------------------------------------------------------------------

/**
 * Open the console at `route` as a signed-in member (an organiser by default), with the
 * API answering from `routes`. `name` is the name on the Keycloak profile (the member's by default). Returns renderApp's result plus the fetch mock.
 */
export function renderConsole(
  route: string,
  routes: Record<string, unknown> = {},
  { member = organiser(), name = member.full_name }: { member?: Me; name?: string } = {},
) {
  signIn({ name })
  // The console scrolls to the top on every page; jsdom has no scrolling.
  vi.stubGlobal('scrollTo', vi.fn())
  const fetch = mockFetch({ 'GET /me/': member, ...routes })
  return { ...renderApp(<ConsoleApp />, { route, path: '/manage/*' }), fetch }
}

/**
 * Catch files the page offers for download (CSV exports) instead of saving them.
 *
 *   const downloads = captureDownloads()
 *   await user.click(screen.getByRole('button', { name: 'Export CSV' }))
 *   expect(downloads.name()).toBe('events.csv')
 *   expect(await downloads.text()).toContain('"React workshop"')
 */
export function captureDownloads() {
  const files: Blob[] = []
  vi.stubGlobal('URL', Object.assign(URL, {
    createObjectURL: (blob: Blob) => {
      files.push(blob)
      return `blob:file-${files.length}`
    },
    revokeObjectURL: () => undefined,
  }))
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
  onTestFinished(() => click.mockRestore())
  return {
    /** The file name of the latest download. */
    name: () => (click.mock.contexts.at(-1) as HTMLAnchorElement).download,
    /** The contents of the latest download. */
    text: () => files[files.length - 1].text(),
  }
}
