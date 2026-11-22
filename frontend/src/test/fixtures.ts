/**
 * Ready-made API objects with sensible defaults; pass only what a test cares about.
 *
 *   me({ organizations: [membership({ is_admin: true })] })
 *   event({ spots_left: 3, my_registration: registration({ status: 'waitlisted' }) })
 *   hackathon({ prizes: [{ title: 'First', value: 'KES 50,000' }] })
 */
import type {
  CommunityEvent,
  Hackathon,
  LeaderboardRow,
  Me,
  MyOrganization,
  MyRegistration,
  Organization,
  OrganizationApplication,
  Submission,
} from '../api'

// An organisation as it appears inside events and hackathons.
export const organization = (overrides: Partial<Organization> = {}): Organization => ({
  id: 'org-1',
  name: 'Acme Labs',
  alias: 'acme',
  ...overrides,
})

// The member's place in an organisation: plain member by default; set roles or is_admin for more.
export const membership = (overrides: Partial<MyOrganization> = {}): MyOrganization => ({
  ...organization(),
  is_admin: false,
  roles: [],
  can_manage_events: false,
  can_manage_hackathons: false,
  ...overrides,
})

// The signed-in member (GET /me/).
export const me = (overrides: Partial<Me> = {}): Me => ({
  sub: 'user-1',
  email: 'member@example.com',
  full_name: 'Test Member',
  headline: '',
  bio: '',
  institution: '',
  skills: [],
  github_url: '',
  linkedin_url: '',
  is_platform_admin: false,
  organizations: [],
  ...overrides,
})

// The member's registration for an event.
export const registration = (overrides: Partial<MyRegistration> = {}): MyRegistration => ({
  id: 1,
  status: 'registered',
  ticket_code: 'TICKET-1',
  order_number: 'AMT-7K3Q9X2M',
  checked_in_at: null,
  certificate_available: false,
  has_feedback: false,
  ...overrides,
})

// A published, in-person workshop on 30 Nov 2026 that the member has not joined.
export const event = (overrides: Partial<CommunityEvent> = {}): CommunityEvent => ({
  slug: 'react-workshop',
  organization: organization(),
  title: 'React workshop',
  summary: 'Build an app in a day.',
  cover_image: '',
  description: 'All about React.',
  event_type: 'workshop',
  delivery_mode: 'in_person',
  venue: 'Nairobi Garage',
  online_url: '',
  meeting_provider: null,
  starts_at: '2026-11-30T06:00:00Z',
  ends_at: '2026-11-30T09:00:00Z',
  registration_deadline: null,
  capacity: null,
  eligibility: '',
  status: 'published',
  registered_count: 0,
  spots_left: null,
  registration_open: true,
  can_manage: false,
  my_registration: null,
  attendee_preview: [],
  ...overrides,
})

// A published hackathon from 1 to 3 Dec 2026 that the member has not joined.
export const hackathon = (overrides: Partial<Hackathon> = {}): Hackathon => ({
  slug: 'climate-hack',
  organization: organization(),
  title: 'Climate hack',
  tagline: 'Code for the planet.',
  cover_image: '',
  description: '',
  theme: '',
  rules: '',
  eligibility: '',
  prizes: [],
  venue: '',
  starts_at: '2026-12-01T06:00:00Z',
  ends_at: '2026-12-03T15:00:00Z',
  registration_deadline: '2026-11-30T21:00:00Z',
  submission_deadline: '2026-12-03T12:00:00Z',
  min_team_size: 1,
  max_team_size: 4,
  status: 'published',
  cancelled_from: '',
  challenges: [],
  criteria: [],
  team_count: 0,
  participant_count: 0,
  submission_count: 0,
  registration_open: false,
  submissions_open: false,
  results_published: false,
  can_manage: false,
  is_judge: false,
  my_team_id: null,
  participant_preview: [],
  ...overrides,
})

// A team's project, with a repository link only.
export const submission = (overrides: Partial<Submission> = {}): Submission => ({
  id: 1,
  team_name: 'Team Rocket',
  challenge: null,
  title: 'Solar tracker',
  description: '',
  repository_url: 'https://github.com/example/solar',
  demo_url: '',
  video_url: '',
  submitted_at: '2026-12-03T10:00:00Z',
  updated_at: '2026-12-03T10:00:00Z',
  ...overrides,
})

// A leaderboard line for a submission.
export const leaderboardRow = (overrides: Partial<LeaderboardRow> = {}): LeaderboardRow => ({
  rank: 1,
  score: 87.25,
  evaluations: 3,
  judges: 3,
  submission: submission(),
  ...overrides,
})

// The member's own application to bring an organisation onto Community.
export const organizationApplication = (overrides: Partial<OrganizationApplication> = {}): OrganizationApplication => ({
  id: 1,
  name: 'Moi University',
  kind: 'institution',
  kind_label: 'University, college or school',
  website: '',
  location: '',
  about: 'A public university.',
  plans: '',
  contact_phone: '',
  status: 'pending',
  review_note: '',
  organization_id: '',
  created_at: '2026-11-20T08:00:00Z',
  reviewed_at: null,
  ...overrides,
})
