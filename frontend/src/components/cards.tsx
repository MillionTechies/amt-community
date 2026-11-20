import { Link } from 'react-router-dom'

import type { CommunityEvent, Hackathon } from '../api'
import { Icon } from './icons'
import { Badge, StatusBadge, formatDate, label } from './ui'

const cardStyle =
  'group flex flex-col rounded-xl border border-stone-200 bg-white p-4 shadow-sm transition hover:border-brand-500 hover:shadow-md active:scale-[0.99] sm:p-5'

const timeFormat = new Intl.DateTimeFormat('en-GB', { timeStyle: 'short' })

/** A small calendar leaf: "NOV / 30". */
export function DateBlock({ iso, large = false }: { iso: string; large?: boolean }) {
  const d = new Date(iso)
  return (
    <span className={`shrink-0 rounded-lg border border-stone-200 bg-white text-center ${large ? 'w-16 py-2' : 'w-12 py-1'}`}>
      <span className="block font-mono text-[10px] font-semibold uppercase tracking-wider text-brand-700">
        {d.toLocaleString('en-GB', { month: 'short' })}
      </span>
      <span className={`block font-bold leading-tight tabular-nums ${large ? 'text-2xl' : 'text-lg'}`}>{d.getDate()}</span>
    </span>
  )
}

/** "30 Nov 2026", or "30 Nov 2026 to 2 Dec 2026" when it spans days. */
export function dateSpan(start: string, end: string) {
  const same = new Date(start).toDateString() === new Date(end).toDateString()
  return same ? formatDate(start) : `${formatDate(start)} to ${formatDate(end)}`
}

/** "Online", the venue, or both. */
export function eventPlace(event: CommunityEvent) {
  if (event.delivery_mode === 'online') return 'Online'
  if (event.delivery_mode === 'hybrid') return event.venue ? `${event.venue} or online` : 'In person or online'
  return event.venue || 'Venue to be confirmed'
}

export function EventCard({ event }: { event: CommunityEvent }) {
  const mine = event.my_registration && event.my_registration.status !== 'cancelled' ? event.my_registration : null
  const start = new Date(event.starts_at)
  const sameDay = start.toDateString() === new Date(event.ends_at).toDateString()
  return (
    <Link to={`/events/${event.slug}`} className={cardStyle}>
      <div className="flex gap-4">
        <DateBlock iso={event.starts_at} />
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold leading-snug group-hover:text-brand-700 sm:text-lg">{event.title}</h3>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-stone-600">
            <Icon name="clock" className="h-4 w-4 text-stone-400" />
            {start.toLocaleDateString('en-GB', { weekday: 'short' })} {timeFormat.format(start)}
            {sameDay ? ` to ${timeFormat.format(new Date(event.ends_at))}` : ` to ${formatDate(event.ends_at)}`}
          </p>
          <p className="mt-0.5 flex items-center gap-1.5 truncate text-sm text-stone-600">
            <Icon name="pin" className="h-4 w-4 text-stone-400" />
            <span className="truncate">{eventPlace(event)}</span>
          </p>
        </div>
      </div>
      {event.summary && <p className="mt-3 line-clamp-2 text-sm text-stone-700">{event.summary}</p>}
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
        <Badge tone="blue">{label(event.event_type)}</Badge>
        {event.status !== 'published' && <StatusBadge status={event.status} />}
        <span className="ml-auto text-xs font-semibold">
          {mine ? (
            mine.status === 'waitlisted' ? (
              <span className="text-amber-700">On the waiting list</span>
            ) : (
              <span className="inline-flex items-center gap-1 text-brand-700"><Icon name="check" className="h-4 w-4" />You're going</span>
            )
          ) : event.spots_left === 0 ? (
            <span className="text-amber-700">Full, join the waiting list</span>
          ) : event.spots_left !== null && event.spots_left <= 10 ? (
            <span className="text-amber-700">Only {event.spots_left} {event.spots_left === 1 ? 'place' : 'places'} left</span>
          ) : (
            <span className="text-stone-500">{event.registered_count} going</span>
          )}
        </span>
      </div>
    </Link>
  )
}

export function HackathonCard({ hackathon }: { hackathon: Hackathon }) {
  const prize = hackathon.prizes[0]
  return (
    <Link to={`/hackathons/${hackathon.slug}`} className={cardStyle}>
      <div className="flex gap-4">
        <DateBlock iso={hackathon.starts_at} />
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold leading-snug group-hover:text-brand-700 sm:text-lg">{hackathon.title}</h3>
          <p className="mt-1 text-sm text-stone-600">{dateSpan(hackathon.starts_at, hackathon.ends_at)}</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-sm text-stone-600">
            <Icon name="pin" className="h-4 w-4 text-stone-400" />
            <span className="truncate">{hackathon.venue || 'Online'}</span>
          </p>
        </div>
      </div>
      {hackathon.tagline && <p className="mt-3 line-clamp-2 text-sm text-stone-700">{hackathon.tagline}</p>}
      {prize && (
        <p className="mt-3 flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm">
          <Icon name="trophy" className="h-4 w-4 text-amber-700" />
          <span className="font-semibold text-amber-900">{prize.title}</span>
          {prize.value && <span className="ml-auto font-mono font-bold tabular-nums">{prize.value}</span>}
        </p>
      )}
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
        <StatusBadge status={hackathon.status} />
        {hackathon.theme && <Badge tone="blue">{hackathon.theme}</Badge>}
        <span className="ml-auto text-xs font-semibold">
          {hackathon.my_team_id ? (
            <span className="inline-flex items-center gap-1 text-brand-700"><Icon name="check" className="h-4 w-4" />You're taking part</span>
          ) : hackathon.is_judge ? (
            <span className="text-amber-700">You're a judge</span>
          ) : hackathon.registration_open ? (
            <span className="text-brand-700">Open to join</span>
          ) : (
            <span className="text-stone-500">{hackathon.team_count} {hackathon.team_count === 1 ? 'team' : 'teams'}</span>
          )}
        </span>
      </div>
    </Link>
  )
}

export const grid = 'grid gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3'
