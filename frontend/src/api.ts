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
  organizations: MyOrganization[]
}

export interface Person {
  sub: string
  name: string
  headline: string
  institution: string
}

export type EventStatus = 'draft' | 'published' | 'completed' | 'cancelled'

export interface MyRegistration {
  id: number
  status: 'registered' | 'waitlisted' | 'cancelled'
  ticket_code: string
  checked_in_at: string | null
  certificate_available: boolean
  has_feedback: boolean
}

export interface CommunityEvent {
  id: number
  organization: Organization
  title: string
  summary: string
  description: string
  event_type: string
  delivery_mode: string
  venue: string
  online_url: string
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

export interface Hackathon {
  id: number
  organization: Organization
  title: string
  tagline: string
  description: string
  theme: string
  rules: string
  eligibility: string
  prizes: string
  venue: string
  starts_at: string
  ends_at: string
  registration_deadline: string
  submission_deadline: string
  min_team_size: number
  max_team_size: number
  status: HackathonStatus
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
}

export interface TeamMember {
  id: number
  person: Person
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
}

export interface MyTeam extends Team {
  invite_code: string
  submission: Submission | null
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

export interface RoleAssignment {
  id: number
  role: string
  person: Person
  email: string
}
