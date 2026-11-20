/** Event and hackathon cards for lists: a cover, the essentials, and who is going. */
import type { CSSProperties, ReactNode } from 'react'
import { Link } from 'react-router-dom'

import type { CommunityEvent, Hackathon } from '../api'
import { Icon } from './icons'
import type { IconName } from './icons'
import { StatusBadge, formatDate, label } from './ui'

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
  const places: Record<string, string> = {
    online: 'Online',
    hybrid: event.venue ? `${event.venue} or online` : 'In person or online',
    in_person: event.venue || 'Venue to be confirmed',
  }
  return places[event.delivery_mode] ?? event.venue
}

/** "Sat, 28 Nov · 08:00" in the visitor's time zone. */
export function when(iso: string) {
  const d = new Date(iso)
  const day = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  return `${day} · ${time}`
}

export const EVENT_TYPE_ICONS: Record<string, IconName> = {
  workshop: 'code',
  outreach: 'school',
  conference: 'mic',
  meetup: 'users',
  webinar: 'video',
  training: 'book',
  networking: 'link',
  hackathon: 'trophy',
}

// Each kind of event gets its own glow on the drawn cover.
const GLOWS: Record<string, string> = {
  workshop: 'bg-brand-500/45',
  outreach: 'bg-sky-500/45',
  conference: 'bg-amber-500/45',
  meetup: 'bg-violet-500/45',
  webinar: 'bg-rose-500/40',
  training: 'bg-teal-500/45',
  networking: 'bg-indigo-500/45',
  hackathon: 'bg-amber-400/45',
}

const GRID: CSSProperties = {
  backgroundImage:
    'linear-gradient(rgb(255 255 255 / 0.06) 1px, transparent 1px), linear-gradient(90deg, rgb(255 255 255 / 0.06) 1px, transparent 1px)',
  backgroundSize: '22px 22px',
}

/**
 * The organiser's banner, or a drawn one in the house style when there is none,
 * so a list never looks empty. Overlays (pills) go in `children`.
 */
export function Cover({
  image,
  kind,
  title,
  className = '',
  children,
}: {
  image: string
  kind: string
  title: string
  className?: string
  children?: ReactNode
}) {
  return (
    <div className={`relative aspect-[16/9] overflow-hidden rounded-xl bg-ink ${className}`}>
      {image ? (
        <img src={image} alt="" loading="lazy" className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]" />
      ) : (
        <div className="absolute inset-0" style={GRID} aria-hidden="true">
          <div className={`absolute -right-10 -top-12 h-44 w-44 rounded-full blur-3xl ${GLOWS[kind] ?? GLOWS.workshop}`} />
          <Icon name={EVENT_TYPE_ICONS[kind] ?? 'calendar'} className="absolute right-5 top-5 h-12 w-12 text-white/25" />
          <div className="absolute inset-x-5 bottom-4">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-brand-300">
              <span className="text-brand-500">// </span>{label(kind)}
            </p>
            <p className="mt-1 line-clamp-2 text-lg font-bold leading-tight text-white">{title}</p>
          </div>
        </div>
      )}
      {children && <div className="absolute inset-x-3 top-3 flex flex-wrap items-start gap-1.5">{children}</div>}
    </div>
  )
}

/** A small pill laid over a cover. */
export function Pill({ children, tone = 'light' }: { children: ReactNode; tone?: 'light' | 'green' | 'amber' | 'dark' }) {
  const tones = {
    light: 'bg-white/95 text-ink',
    green: 'bg-brand-600 text-white',
    amber: 'bg-amber-400 text-amber-950',
    dark: 'bg-ink/80 text-white',
  }
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold shadow-sm backdrop-blur ${tones[tone]}`}>
      {children}
    </span>
  )
}

const FACE_COLOURS = ['bg-brand-600', 'bg-sky-600', 'bg-amber-500', 'bg-violet-600', 'bg-rose-500', 'bg-teal-600']

/** Overlapping initials and a count: the "169 attendees" line. */
export function Faces({ initials, count, noun }: { initials: string[]; count: number; noun: string }) {
  return (
    <div className="flex items-center gap-2">
      {initials.length > 0 && (
        <span className="flex -space-x-1.5">
          {initials.map((text, i) => (
            <span
              key={i}
              className={`grid h-8 w-8 place-items-center rounded-full text-[11px] font-bold tracking-tight text-white ring-2 ring-stone-50 ${FACE_COLOURS[(text.charCodeAt(0) + i) % FACE_COLOURS.length]}`}
            >
              {text}
            </span>
          ))}
        </span>
      )}
      <span className="text-sm font-semibold text-stone-700">
        {count > 0 ? `${count} ${noun}` : 'Be the first to join'}
      </span>
    </div>
  )
}

const cardStyle = 'group flex flex-col rounded-xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-600'

export function EventCard({ event }: { event: CommunityEvent }) {
  const mine = event.my_registration?.status === 'cancelled' ? null : event.my_registration
  const left = event.spots_left
  return (
    <Link to={`/events/${event.slug}`} className={cardStyle}>
      <Cover image={event.cover_image} kind={event.event_type} title={event.title}>
        {mine?.status === 'registered' && <Pill tone="green"><Icon name="check" className="h-3.5 w-3.5" />Going</Pill>}
        {mine?.status === 'waitlisted' && <Pill tone="amber">Waiting list</Pill>}
        {event.status !== 'published' && <Pill tone="dark">{label(event.status)}</Pill>}
        {mine === null && left === 0 && <Pill tone="amber">Full</Pill>}
        {mine === null && left !== null && left > 0 && left <= 10 && (
          <Pill><Icon name="alert" className="h-3.5 w-3.5 text-amber-600" />{left} {left === 1 ? 'seat' : 'seats'} left</Pill>
        )}
        {event.delivery_mode === 'online' && <Pill tone="dark"><Icon name="video" className="h-3.5 w-3.5" />Online</Pill>}
      </Cover>
      <h3 className="mt-3 line-clamp-2 text-lg font-bold leading-snug group-hover:text-brand-700">{event.title}</h3>
      <p className="mt-1 text-sm font-medium text-stone-700">{when(event.starts_at)}</p>
      <p className="mt-0.5 truncate text-sm text-stone-500">
        by {event.organization.name} · {eventPlace(event)}
      </p>
      <div className="mt-2.5">
        <Faces initials={event.attendee_preview} count={event.registered_count} noun="going" />
      </div>
    </Link>
  )
}

export function HackathonCard({ hackathon: h }: { hackathon: Hackathon }) {
  const prize = h.prizes[0]
  return (
    <Link to={`/hackathons/${h.slug}`} className={cardStyle}>
      <Cover image={h.cover_image} kind="hackathon" title={h.title}>
        {h.my_team_id && <Pill tone="green"><Icon name="check" className="h-3.5 w-3.5" />Taking part</Pill>}
        {h.is_judge && <Pill tone="amber">Judge</Pill>}
        {h.registration_open && h.my_team_id === null && <Pill>Open to join</Pill>}
        {prize && <Pill tone="dark"><Icon name="trophy" className="h-3.5 w-3.5 text-amber-300" />{prize.value || prize.title}</Pill>}
      </Cover>
      <div className="mt-3 flex items-start justify-between gap-2">
        <h3 className="line-clamp-2 text-lg font-bold leading-snug group-hover:text-brand-700">{h.title}</h3>
        <span className="mt-1 shrink-0"><StatusBadge status={h.status} /></span>
      </div>
      <p className="mt-1 text-sm font-medium text-stone-700">{dateSpan(h.starts_at, h.ends_at)}</p>
      <p className="mt-0.5 truncate text-sm text-stone-500">by {h.organization.name} · {h.venue || 'Online'}</p>
      <div className="mt-2.5">
        <Faces initials={h.participant_preview} count={h.participant_count} noun={`taking part in ${h.team_count} ${h.team_count === 1 ? 'team' : 'teams'}`} />
      </div>
    </Link>
  )
}

export const grid = 'grid gap-x-5 gap-y-8 sm:grid-cols-2 lg:grid-cols-3'
