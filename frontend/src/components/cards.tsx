import { Link } from 'react-router-dom'

import type { CommunityEvent, Hackathon } from '../api'
import { Badge, StatusBadge, formatDate, formatRange, label } from './ui'

const cardStyle =
  'flex flex-col rounded-xl border border-stone-200 bg-white p-5 shadow-sm transition hover:border-brand-500 hover:shadow-md'

export function EventCard({ event }: { event: CommunityEvent }) {
  const mine = event.my_registration
  return (
    <Link to={`/events/${event.id}`} className={cardStyle}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Badge tone="blue">{label(event.event_type)}</Badge>
        <Badge>{label(event.delivery_mode)}</Badge>
        {event.status !== 'published' && <StatusBadge status={event.status} />}
        {mine && mine.status !== 'cancelled' && <StatusBadge status={mine.status} />}
      </div>
      <h3 className="text-lg font-semibold">{event.title}</h3>
      <p className="mt-1 text-sm text-stone-600">{formatRange(event.starts_at, event.ends_at)}</p>
      {event.summary && <p className="mt-2 line-clamp-2 text-sm text-stone-700">{event.summary}</p>}
      <div className="mt-auto flex items-center justify-between pt-4 text-sm text-stone-600">
        <span>{event.organization.name}</span>
        <span>
          {event.spots_left === null
            ? `${event.registered_count} going`
            : event.spots_left === 0
              ? 'Full'
              : `${event.spots_left} places left`}
        </span>
      </div>
    </Link>
  )
}

export function HackathonCard({ hackathon }: { hackathon: Hackathon }) {
  return (
    <Link to={`/hackathons/${hackathon.id}`} className={cardStyle}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <StatusBadge status={hackathon.status} />
        {hackathon.theme && <Badge tone="blue">{hackathon.theme}</Badge>}
        {hackathon.my_team_id && <Badge tone="green">Taking part</Badge>}
        {hackathon.is_judge && <Badge tone="amber">Judge</Badge>}
      </div>
      <h3 className="text-lg font-semibold">{hackathon.title}</h3>
      <p className="mt-1 text-sm text-stone-600">
        {formatDate(hackathon.starts_at)} to {formatDate(hackathon.ends_at)}
      </p>
      {hackathon.tagline && <p className="mt-2 line-clamp-2 text-sm text-stone-700">{hackathon.tagline}</p>}
      <div className="mt-auto flex items-center justify-between pt-4 text-sm text-stone-600">
        <span>{hackathon.organization.name}</span>
        <span>
          {hackathon.team_count} {hackathon.team_count === 1 ? 'team' : 'teams'}
        </span>
      </div>
    </Link>
  )
}

export const grid = 'grid gap-4 sm:grid-cols-2 lg:grid-cols-3'
