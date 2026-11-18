/** Shapes returned by the platform admin API (/api/platform/...). */

export interface Overview {
  totals: Record<
    | 'organizations' | 'members' | 'new_members_30d' | 'organisers' | 'events' | 'upcoming_events'
    | 'hackathons' | 'active_hackathons' | 'registrations' | 'check_ins' | 'hackers' | 'projects',
    number
  >
  events_by_status: Record<string, number>
  hackathons_by_status: Record<string, number>
  emails: { sent_30d: number; queued: number; failed: number }
  registrations_30d: string[]
  recent_events: { slug: string; title: string; organization: string; status: string; starts_at: string; created_at: string }[]
  attention: { kind: string; title: string; detail: string; link: string }[]
}

export interface OrgRow {
  id: string
  name: string
  alias: string
  members: number
  admins: number
  organisers: number
  events: number
  upcoming_events: number
  last_event_at: string | null
  hackathons: number
  registrations: number
  own_apps: string[]
  synced_at: string
}

export interface OrgDetail extends OrgRow {
  admin_people: { sub: string; name: string; email: string }[]
  role_people: { name: string; email: string; role: string }[]
  event_list: { slug: string; title: string; status: string; starts_at: string; registered: number }[]
  hackathon_list: { slug: string; title: string; status: string; starts_at: string }[]
  overrides: { group: string; keys: string[] }[]
}

export interface MemberRow {
  sub: string
  name: string
  email: string
  institution: string
  joined: string
  organizations: { name: string; admin: boolean }[]
  roles: string[]
  registrations: number
  attended: number
}

export interface EmailRow {
  id: number
  kind: string
  to: string
  subject: string
  status: 'queued' | 'sending' | 'sent' | 'failed'
  attempts: number
  last_error: string
  created_at: string
  sent_at: string | null
  event: string
}
