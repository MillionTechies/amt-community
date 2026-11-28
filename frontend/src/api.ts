/** The Community API: one fetch helper and the shapes it returns. */

const BASE = import.meta.env.VITE_API_URL
let currentToken: string | undefined

export function setToken(token: string | undefined) {
  currentToken = token
}

export class ApiError extends Error {
  status: number
  fields: Record<string, string>

  constructor(status: number, message: string, fields: Record<string, string> = {}) {
    super(message)
    this.status = status
    this.fields = fields
  }
}

/** Turn Django REST Framework's error bodies into one message and per-field messages. */
function toError(status: number, body: unknown): ApiError {
  const first = (v: unknown): string => (Array.isArray(v) ? first(v[0]) : String(v))
  if (Array.isArray(body)) return new ApiError(status, first(body))
  if (body && typeof body === 'object') {
    const data = body as Record<string, unknown>
    if (data.detail) return new ApiError(status, first(data.detail))
    const fields = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, first(v)]))
    const message = fields.non_field_errors ?? Object.values(fields)[0] ?? 'Something went wrong.'
    return new ApiError(status, message, fields)
  }
  return new ApiError(status, status === 404 ? 'Not found.' : 'Something went wrong.')
}

export async function api<T = unknown>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const headers: Record<string, string> = {}
  if (currentToken) headers.Authorization = `Bearer ${currentToken}`
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  let response: Response
  try {
    response = await fetch(`${BASE}/api${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    })
  } catch {
    throw new ApiError(0, 'Could not reach the server. Check your connection and try again.')
  }
  if (response.status === 204) return undefined as T
  const body = await response.json().catch(() => null)
  if (!response.ok) throw toError(response.status, body)
  return body as T
}

/** Upload an image for a description or announcement; returns its address. */
export async function uploadImage(file: File): Promise<string> {
  const body = new FormData()
  body.append('file', file)
  const headers: Record<string, string> = {}
  if (currentToken) headers.Authorization = `Bearer ${currentToken}`
  let response: Response
  try {
    response = await fetch(`${BASE}/api/uploads/`, { method: 'POST', headers, body })
  } catch {
    throw new ApiError(0, 'Could not reach the server. Check your connection and try again.')
  }
  const data = await response.json().catch(() => null)
  if (!response.ok) throw toError(response.status, data)
  return (data as { url: string }).url
}

/** Public, community-wide counts (GET /api/stats/). */
export interface CommunityStats {
  members: number
  events: number
  check_ins: number
  hackathons: number
  projects: number
  organizations: number
}

export interface Paginated<T> {
  count: number
  next: string | null
  results: T[]
}

export interface Organization {
  id: string
  name: string
  alias: string
}

export interface MyOrganization extends Organization {
  is_admin: boolean
  roles: string[]
  can_manage_events: boolean
  can_manage_hackathons: boolean
}

export interface Me {
  sub: string
  email: string
  full_name: string
  headline: string
  bio: string
  institution: string
  skills: string[]
  github_url: string
  linkedin_url: string
  is_platform_admin: boolean
  /** Judges at least one hackathon, so the header shows the judging area. */
  judges_anything: boolean
  organizations: MyOrganization[]
}

export type ApplicationStatus = 'pending' | 'approved' | 'declined'
export type OrganizationKind = 'institution' | 'company' | 'community' | 'group' | 'nonprofit' | 'other'

/** An application to bring an organisation onto Community (/api/organizations/applications/). */
export interface OrganizationApplication {
  id: number
  name: string
  kind: OrganizationKind
  kind_label: string
  website: string
  location: string
  about: string
  plans: string
  contact_phone: string
  status: ApplicationStatus
  review_note: string
  organization_id: string
  created_at: string
  reviewed_at: string | null
}

export interface Person {
  sub: string
  name: string
  headline: string
  institution: string
}

/** A person as fellow hackers see them, to pick teammates. */
export interface Teammate extends Person {
  skills: string[]
  github_url: string
  linkedin_url: string
}

export type EventStatus = 'draft' | 'published' | 'completed' | 'cancelled'

export interface MyRegistration {
  id: number
  status: 'registered' | 'waitlisted' | 'cancelled'
  ticket_code: string
  /** Short reference printed on the ticket, like AMT-7K3Q9X2M. */
  order_number: string
  checked_in_at: string | null
  certificate_available: boolean
  has_feedback: boolean
}

export interface CommunityEvent {
  /** The public address, e.g. "react-workshop-nairobi-k3x9qa". */
  slug: string
  organization: Organization
  title: string
  summary: string
  /** Banner image address, or '' for the drawn fallback. */
  cover_image: string
  description: string
  event_type: string
  delivery_mode: string
  venue: string
  online_url: string
  /** The web-conferencing service the meeting link is on, if we recognise it. */
  meeting_provider: { id: string; name: string } | null
  starts_at: string
  ends_at: string
  registration_deadline: string | null
  capacity: number | null
  eligibility: string
  status: EventStatus
  registered_count: number
  spots_left: number | null
  registration_open: boolean
  can_manage: boolean
  my_registration: MyRegistration | null
  /** Initials of the first few people going. */
  attendee_preview: string[]
}

export interface Registration {
  id: number
  person: Person
  email: string
  status: 'registered' | 'waitlisted' | 'cancelled'
  checked_in_at: string | null
  created_at: string
}

export interface Announcement {
  id: number
  title: string
  body: string
  created_at: string
}

export interface Resource {
  id: number
  title: string
  url: string
  description: string
}

export interface Feedback {
  id: number
  rating: number
  comment: string
  created_at: string
}

export interface EventStats {
  registered: number
  waitlisted: number
  cancelled: number
  checked_in: number
  capacity: number | null
  attendance_rate: number | null
  feedback_count: number
  average_rating: number | null
}

export interface Certificate {
  certificate_code: string
  recipient: string
  event: string
  event_type: string
  organization: string
  starts_at: string
  ends_at: string
}

export type HackathonStatus = 'draft' | 'published' | 'judging' | 'completed' | 'cancelled'

export interface Challenge {
  id: number
  title: string
  description: string
}

export interface Criterion {
  id: number
  name: string
  description: string
  max_score: number
  weight: number
}

export interface Prize {
  title: string
  value: string
}

export interface Hackathon {
  /** The public address, e.g. "react-workshop-nairobi-k3x9qa". */
  slug: string
  organization: Organization
  title: string
  tagline: string
  cover_image: string
  description: string
  theme: string
  rules: string
  eligibility: string
  prizes: Prize[]
  venue: string
  starts_at: string
  ends_at: string
  registration_deadline: string
  submission_deadline: string
  min_team_size: number
  max_team_size: number
  status: HackathonStatus
  /** Where a cancelled hackathon was, and so where restoring puts it back. */
  cancelled_from: HackathonStatus | ''
  challenges: Challenge[]
  criteria: Criterion[]
  team_count: number
  participant_count: number
  submission_count: number
  registration_open: boolean
  submissions_open: boolean
  results_published: boolean
  can_manage: boolean
  is_judge: boolean
  my_team_id: number | null
  is_registered: boolean
  /** The 6-digit code that registers people; only its managers see it. */
  join_code: string | null
  /** Projects the member has scored, when they judge this hackathon. */
  my_scores: number | null
  /** Off the public list when false; the page and code still work. */
  listed: boolean
  /** Initials of the first few people taking part. */
  participant_preview: string[]
}

/** The member's own registration for a hackathon. */
export interface HackathonRegistration {
  id: number
  looking_for_team: boolean
  registered_at: string
}

/** Someone registered for a hackathon, as other participants see them. */
export interface Participant {
  id: number
  person: Teammate
  looking_for_team: boolean
  team_name: string | null
  registered_at: string
}

export interface TeamMember {
  id: number
  person: Teammate
  is_leader: boolean
}

export interface Submission {
  id: number
  team_name: string
  challenge: Challenge | null
  title: string
  description: string
  repository_url: string
  demo_url: string
  video_url: string
  submitted_at: string
  updated_at: string
}

export interface Team {
  id: number
  name: string
  members: TeamMember[]
  has_submission: boolean
  /** Anyone registered may join with one click while there is room. */
  is_open: boolean
  spots_left: number
}

export interface MyTeam extends Team {
  invite_code: string
  submission: Submission | null
  /** Invitations the leader sent that are still waiting for an answer. */
  pending_invitations: TeamInvitation[]
}

export type InvitationKind = 'org_role' | 'position' | 'judge' | 'participant' | 'team'
export type InvitationStatus = 'pending' | 'accepted' | 'declined' | 'revoked'

/** An invitation as the people who sent it see it. */
export interface SentInvitation {
  id: number
  kind: InvitationKind
  email: string
  /** The invitee's name when they were picked from a list, else their email. */
  name: string
  role: string
  status: InvitationStatus
  sent_count: number
  created_at: string
}

/** A team's pending invitation: a member's name, never their email. */
export interface TeamInvitation {
  id: number
  name: string
  created_at: string
}

/** What the link in an invitation email shows (/api/invitations/<token>/). */
export interface Invitation {
  token: string
  kind: InvitationKind
  status: InvitationStatus
  /** The invited address, masked: "w***@example.com". */
  email_hint: string
  /** Finishes "You are invited to …": "judge Climate hack". */
  summary: string
  invited_by: string
  organization: string | null
  role: string
  hackathon: { slug: string; title: string } | null
  team: string | null
  /** Whether the signed-in member has the invited address. */
  is_for_you: boolean
  created_at: string
}

export interface Evaluation {
  id: number
  comment: string
  scores: { criterion: number; value: number }[]
}

export interface JudgedSubmission extends Submission {
  members: string[]
  my_evaluation: Evaluation | null
}

export interface Judge {
  id: number
  person: Person
  email: string
  evaluations: number
}

export interface LeaderboardRow {
  rank: number | null
  score: number | null
  evaluations: number
  judges: number
  submission: Submission
}

/** An office in an organisation's leadership, as its admins manage it. */
export interface Position {
  id: number
  title: string
  order: number
  /** Roles its holder gets while they hold it. */
  roles: string[]
  is_public: boolean
  holder: Person | null
  holder_email: string | null
  /** The invitation waiting for an answer, if someone was asked to take it. */
  invitation: TeamInvitation | null
}

/** An organisation's public page (/api/organizations/<alias>/page/). */
export interface OrganizationPage extends Organization {
  leadership: { id: number; title: string; person: Person }[]
}

export interface RoleAssignment {
  id: number
  role: string
  person: Person
  email: string
}

/** A service organisers can connect: Google, Microsoft or Zoom. */
export interface Integration {
  id: 'google' | 'microsoft' | 'zoom'
  name: string
  /** Whose OAuth app: an organisation's id when it set up its own, or null for the platform's. */
  app: string | null
  app_name: string
  /** What its meetings are called ("Google Meet"), or "" if it makes none. */
  meeting_name: string
  has_calendar: boolean
  /** Whether this server has the provider's OAuth app set up. */
  configured: boolean
  connected: boolean
  account_email: string
}

/** An event's copy in an organiser's calendar or meeting tool. */
export interface EventLink {
  id: number
  provider: Integration['id']
  provider_name: string
  account_email: string
  is_meeting: boolean
  join_url: string
  /** Added through the signed-in organiser's own account. */
  mine: boolean
  synced_at: string
}

/** A place settings can be changed: the platform, or one organisation. */
export interface ConfigScope {
  id: string
  name: string
  kind: 'platform' | 'organization'
}

export interface ConfigField {
  key: string
  label: string
  kind: 'text' | 'secret' | 'number' | 'boolean' | 'email' | 'url'
  help: string
  placeholder: string
  /** Where the value in use comes from. */
  source: 'organization' | 'platform' | 'environment' | 'default' | ''
  /** Set at this scope (for secrets, the value itself is never sent). */
  is_set: boolean
  value: string
  /** The value used when nothing is set here (for secrets, "set" or ""). */
  inherited: string
}

export interface ConfigGroup {
  id: string
  title: string
  description: string
  fields: ConfigField[]
  /** Everything it needs is set, here or inherited. */
  ready: boolean
  /** The organisation set up its own (rather than using the platform's). */
  own: boolean
  redirect_uri?: string
}
