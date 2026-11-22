/**
 * Ready-made platform admin API objects (/api/platform/...), like ./fixtures for the rest.
 *
 *   overview({ attention: [] })
 *   orgDetail({ admins: 0, admin_people: [] })
 *   emailRow({ status: 'failed', last_error: 'Mailbox full' })
 */
import type { EmailRow, MemberRow, OrgDetail, OrgRow, Overview } from '../platform/types'

// A busy community: everything counted, one thing needing attention, one recent event.
export const overview = (overrides: Partial<Overview> = {}): Overview => ({
  totals: {
    organizations: 4,
    members: 120,
    new_members_30d: 12,
    organisers: 9,
    events: 15,
    upcoming_events: 3,
    hackathons: 2,
    active_hackathons: 1,
    registrations: 200,
    check_ins: 150,
    hackers: 40,
    projects: 11,
  },
  events_by_status: { published: 3, draft: 1, completed: 11, cancelled: 0 },
  hackathons_by_status: { published: 1, judging: 0, draft: 0, completed: 1, cancelled: 0 },
  emails: { sent_30d: 310, queued: 2, failed: 1 },
  registrations_30d: [],
  recent_events: [
    {
      slug: 'react-workshop',
      title: 'React workshop',
      organization: 'Acme Labs',
      status: 'published',
      starts_at: '2026-11-30T06:00:00Z',
      created_at: new Date().toISOString(),
    },
  ],
  attention: [{ kind: 'organization', title: 'Acme Labs has no admin', detail: 'Add one in Keycloak.', link: '/platform/organizations/org-1' }],
  ...overrides,
})

// An organisation in the platform's list.
export const orgRow = (overrides: Partial<OrgRow> = {}): OrgRow => ({
  id: 'org-1',
  name: 'Acme Labs',
  alias: 'acme',
  members: 30,
  admins: 2,
  organisers: 4,
  events: 6,
  upcoming_events: 0,
  last_event_at: null,
  hackathons: 1,
  registrations: 80,
  own_apps: [],
  synced_at: '2026-11-20T08:00:00Z',
  ...overrides,
})

// One organisation in detail, with nobody and nothing listed yet.
export const orgDetail = (overrides: Partial<OrgDetail> = {}): OrgDetail => ({
  ...orgRow(),
  admin_people: [],
  role_people: [],
  event_list: [],
  hackathon_list: [],
  overrides: [],
  ...overrides,
})

// A member of the community, in no organisation.
export const memberRow = (overrides: Partial<MemberRow> = {}): MemberRow => ({
  sub: 'user-1',
  name: 'Wanjiru Kamau',
  email: 'wanjiru@example.com',
  institution: '',
  joined: '2026-10-01T08:00:00Z',
  organizations: [],
  roles: [],
  registrations: 0,
  attended: 0,
  ...overrides,
})

// An email that was sent.
export const emailRow = (overrides: Partial<EmailRow> = {}): EmailRow => ({
  id: 1,
  kind: 'registration_confirmation',
  to: 'wanjiru@example.com',
  subject: 'You are registered',
  status: 'sent',
  attempts: 1,
  last_error: '',
  created_at: '2026-11-20T08:00:00Z',
  sent_at: '2026-11-20T08:00:05Z',
  event: 'React workshop',
  ...overrides,
})
