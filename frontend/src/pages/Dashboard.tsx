/** The member's home: what is next, what needs doing, and what they have taken part in. */
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'

import { api } from '../api'
import type { CommunityEvent, Hackathon, Paginated } from '../api'
import { Icon } from '../components/icons'
import type { IconName } from '../components/icons'
import { Badge, LinkButton, Spinner, StatusBadge, formatDate, formatRange, label } from '../components/ui'
import { Kpi, Panel, relative } from '../console/shared'
import { useMe } from '../hooks'

const list = <T,>(path: string) => () => api<Paginated<T>>(path)

interface Todo {
  key: string
  icon: IconName
  tone: 'amber' | 'green' | 'blue'
  title: string
  detail: string
  to: string
  action: string
}

const toneStyle = {
  amber: 'bg-amber-50 text-amber-700',
  green: 'bg-brand-50 text-brand-700',
  blue: 'bg-sky-50 text-sky-700',
}

function greeting() {
  const hour = new Date().getHours()
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
}

function DateBlock({ iso, large = false }: { iso: string; large?: boolean }) {
  const d = new Date(iso)
  return (
    <span
      className={`shrink-0 rounded-lg border border-stone-200 bg-white text-center ${large ? 'w-16 py-2' : 'w-12 py-1'}`}
    >
      <span className="block font-mono text-[10px] font-semibold uppercase tracking-wider text-brand-700">
        {d.toLocaleString('en-GB', { month: 'short' })}
      </span>
      <span className={`block font-bold leading-tight tabular-nums ${large ? 'text-2xl' : 'text-lg'}`}>{d.getDate()}</span>
    </span>
  )
}

function EmptyState({ icon, title, text, to, action }: { icon: IconName; title: string; text: string; to: string; action: string }) {
  return (
    <div className="flex flex-col items-center px-5 py-10 text-center">
      <span className="mb-3 grid h-11 w-11 place-items-center rounded-full bg-stone-100 text-stone-500">
        <Icon name={icon} />
      </span>
      <p className="font-semibold">{title}</p>
      <p className="mb-4 text-sm text-stone-600">{text}</p>
      <LinkButton to={to} variant="secondary">{action}</LinkButton>
    </div>
  )
}

/** The soonest thing on the member's calendar, given pride of place. */
function NextUp({ event }: { event: CommunityEvent }) {
  const mine = event.my_registration
  const where = event.delivery_mode === 'online' ? 'Online' : event.venue || label(event.delivery_mode)
  return (
    <section className="relative overflow-hidden rounded-xl bg-ink p-6 text-white shadow-sm sm:p-7">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-brand-600/30 blur-3xl"
      />
      <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <p className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-brand-300">
            <span className="text-brand-500">// </span>
            {new Date(event.starts_at).getTime() <= Date.now() ? 'Happening now' : `Next up, ${relative(event.starts_at)}`}
          </p>
          <h2 className="mt-2 text-2xl font-bold tracking-tight">{event.title}</h2>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-stone-300">
            <span className="inline-flex items-center gap-1.5">
              <Icon name="clock" className="h-4 w-4 text-brand-400" />
              {formatRange(event.starts_at, event.ends_at)}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Icon name="target" className="h-4 w-4 text-brand-400" />
              {where}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Icon name="users" className="h-4 w-4 text-brand-400" />
              {event.organization.name}
            </span>
          </div>
          {mine?.status === 'waitlisted' && (
            <p className="mt-3 inline-block rounded-md bg-amber-400/15 px-2.5 py-1 text-sm text-amber-200">
              You are on the waiting list. We will email you if a place opens.
            </p>
          )}
        </div>
        <Link
          to={`/events/${event.slug}`}
          className="btn-prompt inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 font-mono text-[0.8125rem] font-semibold uppercase tracking-[0.06em] text-white transition hover:bg-brand-500"
        >
          {mine?.status === 'registered' ? 'View ticket' : 'View event'}
        </Link>
      </div>
    </section>
  )
}

export default function Dashboard() {
  const me = useMe()
  const upcoming = useQuery({
    queryKey: ['events', 'mine', 'upcoming'],
    queryFn: list<CommunityEvent>('/events/?scope=mine&when=upcoming&ordering=starts_at'),
  })
  const past = useQuery({
    queryKey: ['events', 'mine', 'past'],
    queryFn: list<CommunityEvent>('/events/?scope=mine&when=past'),
  })
  const hackathons = useQuery({
    queryKey: ['hackathons', 'mine'],
    queryFn: list<Hackathon>('/hackathons/?scope=mine&ordering=-starts_at'),
  })

  if (upcoming.isLoading || past.isLoading || hackathons.isLoading) return <Spinner />

  const now = Date.now()
  const coming = (upcoming.data?.results ?? []).filter((e) => e.status !== 'cancelled')
  const history = past.data?.results ?? []
  const attended = history.filter((e) => e.my_registration?.checked_in_at)
  const certificates = history.filter((e) => e.my_registration?.certificate_available)
  const allHackathons = hackathons.data?.results ?? []
  const activeHackathons = allHackathons.filter(
    (h) => (h.status === 'published' || h.status === 'judging') && new Date(h.ends_at).getTime() >= now - 7 * 86_400_000,
  )
  const [next, ...later] = coming

  const todos: Todo[] = []
  for (const h of allHackathons) {
    if (h.is_judge && h.status === 'judging')
      todos.push({
        key: `judge-${h.slug}`, icon: 'gavel', tone: 'amber', title: `Score the projects for ${h.title}`,
        detail: `${h.submission_count} projects are waiting for judges.`, to: `/hackathons/${h.slug}/judge`, action: 'Judge',
      })
    if (h.my_team_id && h.submissions_open)
      todos.push({
        key: `submit-${h.slug}`, icon: 'clock', tone: 'amber', title: `Submit your project for ${h.title}`,
        detail: `Submissions close ${relative(h.submission_deadline)}, on ${formatDate(h.submission_deadline)}.`,
        to: `/hackathons/${h.slug}`, action: 'Open',
      })
    if (!h.my_team_id && !h.is_judge && h.registration_open)
      todos.push({
        key: `team-${h.slug}`, icon: 'users', tone: 'blue', title: `Join a team for ${h.title}`,
        detail: 'Create a team or join one with an invite code.', to: `/hackathons/${h.slug}`, action: 'Open',
      })
  }
  for (const e of attended) {
    if (!e.my_registration?.has_feedback)
      todos.push({
        key: `feedback-${e.slug}`, icon: 'star', tone: 'blue', title: `How was ${e.title}?`,
        detail: 'Rate it and tell the organisers what to keep or change.', to: `/events/${e.slug}`, action: 'Rate',
      })
  }
  for (const e of certificates)
    todos.push({
      key: `cert-${e.slug}`, icon: 'trophy', tone: 'green', title: `Your certificate for ${e.title} is ready`,
      detail: 'Download it or share the link on your CV.', to: `/events/${e.slug}`, action: 'Get it',
    })
  if (me && (!me.headline || !me.skills.length))
    todos.push({
      key: 'profile', icon: 'pencil', tone: 'blue', title: 'Finish your profile',
      detail: 'Add a headline and your skills so teammates and organisers know you.', to: '/profile', action: 'Edit',
    })

  const firstName = me?.full_name.split(' ')[0]
  const summary = [
    `${coming.length} upcoming ${coming.length === 1 ? 'event' : 'events'}`,
    `${activeHackathons.length} active ${activeHackathons.length === 1 ? 'hackathon' : 'hackathons'}`,
  ].join(' and ')

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow mb-2">My dashboard</p>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            {greeting()}{firstName ? `, ${firstName}` : ''}
          </h1>
          <p className="mt-1 text-stone-600">You have {summary}.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <LinkButton to="/events">Find events</LinkButton>
          <LinkButton to="/hackathons" variant="secondary">Hackathons</LinkButton>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi label="Upcoming" value={coming.length} icon="calendar" note="Events you are going to" />
        <Kpi
          label="Attended"
          value={attended.length}
          icon="check"
          note={history.length ? `Of ${history.length} past ${history.length === 1 ? 'event' : 'events'}` : 'No past events yet'}
        />
        <Kpi label="Hackathons" value={allHackathons.length} icon="trophy" note={`${activeHackathons.length} active now`} to="/hackathons" />
        <Kpi label="Certificates" value={certificates.length} icon="star" note="Ready to download" />
      </div>

      {next && <NextUp event={next} />}

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-3">
          <Panel title="Your schedule" flush>
            {later.length || activeHackathons.length ? (
              <ul className="divide-y divide-stone-100">
                {[
                  ...later.map((e) => ({
                    key: `e-${e.slug}`, date: e.starts_at, title: e.title, to: `/events/${e.slug}`,
                    meta: `${label(e.event_type)} · ${e.organization.name}`,
                    badge: e.my_registration?.status === 'waitlisted' ? <StatusBadge status="waitlisted" /> : null,
                  })),
                  ...activeHackathons.map((h) => ({
                    key: `h-${h.slug}`, date: h.starts_at, title: h.title, to: `/hackathons/${h.slug}`,
                    meta: `Hackathon · ${formatDate(h.starts_at)} to ${formatDate(h.ends_at)}`,
                    badge: h.is_judge ? <Badge tone="amber">Judge</Badge> : <StatusBadge status={h.status} />,
                  })),
                ]
                  .sort((a, b) => a.date.localeCompare(b.date))
                  .map((s) => (
                    <li key={s.key}>
                      <Link to={s.to} className="group flex items-center gap-4 px-5 py-3 transition hover:bg-stone-50">
                        <DateBlock iso={s.date} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold group-hover:text-brand-700">{s.title}</span>
                          <span className="block truncate text-xs text-stone-500">{s.meta}</span>
                        </span>
                        {s.badge}
                        <Icon name="chevronRight" className="h-4 w-4 text-stone-400" />
                      </Link>
                    </li>
                  ))}
              </ul>
            ) : (
              <EmptyState
                icon="calendar"
                title={next ? 'Nothing else booked' : 'Nothing booked yet'}
                text="Workshops, meetups and hackathons are added every week."
                to="/events"
                action="Browse events"
              />
            )}
          </Panel>

          <Panel title="Past events" flush>
            {history.length ? (
              <ul className="divide-y divide-stone-100">
                {history.slice(0, 6).map((e) => {
                  const reg = e.my_registration
                  return (
                    <li key={e.slug}>
                      <Link to={`/events/${e.slug}`} className="group flex items-center gap-4 px-5 py-3 transition hover:bg-stone-50">
                        <span
                          className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${
                            reg?.checked_in_at ? 'bg-brand-50 text-brand-700' : 'bg-stone-100 text-stone-400'
                          }`}
                        >
                          <Icon name={reg?.checked_in_at ? 'check' : 'close'} className="h-4 w-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold group-hover:text-brand-700">{e.title}</span>
                          <span className="block text-xs text-stone-500">
                            {formatDate(e.starts_at)} · {reg?.checked_in_at ? 'Attended' : 'Not checked in'}
                          </span>
                        </span>
                        {reg?.certificate_available && <Badge tone="green">Certificate</Badge>}
                      </Link>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="px-5 py-6 text-sm text-stone-500">Events you have been to will show up here.</p>
            )}
          </Panel>
        </div>

        <div className="space-y-6 lg:col-span-2">
          <Panel title="To do" flush>
            {todos.length ? (
              <ul className="divide-y divide-stone-100">
                {todos.slice(0, 6).map((t) => (
                  <li key={t.key} className="flex items-start gap-3 px-5 py-3.5">
                    <span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg ${toneStyle[t.tone]}`}>
                      <Icon name={t.icon} className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold">{t.title}</p>
                      <p className="text-xs text-stone-600">{t.detail}</p>
                    </div>
                    <Link to={t.to} className="shrink-0 text-sm font-semibold text-brand-700 hover:underline">
                      {t.action}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="flex flex-col items-center px-5 py-10 text-center">
                <span className="mb-3 grid h-11 w-11 place-items-center rounded-full bg-brand-50 text-brand-700">
                  <Icon name="check" />
                </span>
                <p className="font-semibold">All caught up</p>
                <p className="text-sm text-stone-600">Nothing is waiting on you right now.</p>
              </div>
            )}
          </Panel>

          <Panel title="My hackathons" flush>
            {allHackathons.length ? (
              <ul className="divide-y divide-stone-100">
                {allHackathons.slice(0, 5).map((h) => (
                  <li key={h.slug}>
                    <Link to={`/hackathons/${h.slug}`} className="group block px-5 py-3.5 transition hover:bg-stone-50">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-semibold group-hover:text-brand-700">{h.title}</span>
                        <StatusBadge status={h.status} />
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone-500">
                        <span>{formatDate(h.starts_at)} to {formatDate(h.ends_at)}</span>
                        {h.my_team_id && <span className="font-semibold text-brand-700">Taking part</span>}
                        {h.is_judge && <span className="font-semibold text-amber-700">Judge</span>}
                        {h.results_published && <span>Results out</span>}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                icon="trophy"
                title="No hackathons yet"
                text="Build something with a team and win prizes."
                to="/hackathons"
                action="See hackathons"
              />
            )}
          </Panel>
        </div>
      </div>
    </div>
  )
}
