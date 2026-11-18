/** Console home: headline numbers, what needs the organiser's attention, and what is coming up. */
import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { api } from '../api'
import type { CommunityEvent, Hackathon, Paginated } from '../api'
import { Icon } from '../components/icons'
import type { IconName } from '../components/icons'
import { LinkButton, Spinner, StatusBadge, formatDate, label } from '../components/ui'
import { ConsoleHeader, Kpi, Meter, Panel, relative, useAccess } from './shared'

function useList<T>(path: string, enabled: boolean) {
  return useQuery({ queryKey: ['console', path], queryFn: () => api<Paginated<T>>(path), enabled })
}

interface Task {
  key: string
  tone: 'amber' | 'green' | 'blue'
  icon: IconName
  title: string
  detail: string
  to: string
  action: string
}

const taskTone = {
  amber: 'bg-amber-50 text-amber-700',
  green: 'bg-brand-50 text-brand-700',
  blue: 'bg-sky-50 text-sky-700',
}

function greeting() {
  const hour = new Date().getHours()
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
}

export default function Overview() {
  const access = useAccess()
  const upcoming = useList<CommunityEvent>('/events/?scope=managed&when=upcoming', access.events)
  const past = useList<CommunityEvent>('/events/?scope=managed&when=past&status=published', access.events)
  const eventDrafts = useList<CommunityEvent>('/events/?scope=managed&status=draft', access.events)
  const hackathons = useList<Hackathon>('/hackathons/?scope=managed&ordering=-starts_at', access.hackathons)

  const loading = upcoming.isLoading || past.isLoading || eventDrafts.isLoading || hackathons.isLoading
  if (loading) return <Spinner />

  const now = Date.now()
  const events = upcoming.data?.results ?? []
  const live = events.filter((e) => e.status === 'published')
  const registrations = live.reduce((sum, e) => sum + e.registered_count, 0)
  const allHackathons = hackathons.data?.results ?? []
  const activeHackathons = allHackathons.filter((h) => h.status === 'published' || h.status === 'judging')
  const hackathonDrafts = allHackathons.filter((h) => h.status === 'draft')
  const drafts = (eventDrafts.data?.count ?? 0) + hackathonDrafts.length

  const tasks: Task[] = []
  for (const e of live) {
    const startsIn = new Date(e.starts_at).getTime() - now
    if (startsIn < 2 * 86_400_000)
      tasks.push({
        key: `checkin-${e.id}`, tone: 'green', icon: 'scan', title: `${e.title} starts ${relative(e.starts_at)}`,
        detail: `${e.registered_count} registered. Open check-in on the day to scan tickets.`,
        to: `/manage/events/${e.id}/check-in`, action: 'Check-in',
      })
    else if (e.capacity && e.spots_left !== null && e.spots_left <= Math.max(1, e.capacity * 0.1))
      tasks.push({
        key: `full-${e.id}`, tone: 'blue', icon: 'users', title: `${e.title} is ${e.spots_left ? 'almost full' : 'full'}`,
        detail: `${e.registered_count} of ${e.capacity} places taken. New sign-ups go to the waiting list.`,
        to: `/manage/events/${e.id}/registrations`, action: 'Registrations',
      })
  }
  for (const e of past.data?.results ?? [])
    tasks.push({
      key: `complete-${e.id}`, tone: 'amber', icon: 'check', title: `Close ${e.title}`,
      detail: `It ended ${relative(e.ends_at)}. Mark it completed so attendees can download certificates.`,
      to: `/manage/events/${e.id}`, action: 'Review',
    })
  for (const h of allHackathons) {
    if (h.status === 'published' && new Date(h.submission_deadline).getTime() < now)
      tasks.push({
        key: `judge-${h.id}`, tone: 'amber', icon: 'gavel', title: `Start judging ${h.title}`,
        detail: `Submissions closed ${relative(h.submission_deadline)} with ${h.submission_count} projects in.`,
        to: `/manage/hackathons/${h.id}`, action: 'Review',
      })
    if (h.status === 'judging')
      tasks.push({
        key: `results-${h.id}`, tone: 'blue', icon: 'podium', title: `${h.title} is being judged`,
        detail: 'Check every judge has scored, then publish the results.',
        to: `/manage/hackathons/${h.id}/judges`, action: 'Judges',
      })
  }
  for (const e of eventDrafts.data?.results ?? [])
    tasks.push({
      key: `draft-e-${e.id}`, tone: 'amber', icon: 'pencil', title: `${e.title} is a draft`,
      detail: 'Only organisers can see it. Publish it to open registration.',
      to: `/manage/events/${e.id}`, action: 'Open',
    })
  for (const h of hackathonDrafts)
    tasks.push({
      key: `draft-h-${h.id}`, tone: 'amber', icon: 'pencil', title: `${h.title} is a draft`,
      detail: 'Add challenges and judging criteria, then publish it.',
      to: `/manage/hackathons/${h.id}`, action: 'Open',
    })

  const schedule: { key: string; date: string; title: string; kind: string; status: string; to: string; fill: ReactNode }[] = [
    ...events.filter((e) => e.status !== 'cancelled').map((e) => ({
      key: `e${e.id}`, date: e.starts_at, title: e.title, kind: label(e.event_type), status: e.status, to: `/manage/events/${e.id}`,
      fill: e.capacity ? (
        <div className="w-36">
          <div className="mb-1 text-xs tabular-nums text-stone-600">{e.registered_count} of {e.capacity}</div>
          <Meter value={e.registered_count} max={e.capacity} label={`${e.title}: places taken`} warn />
        </div>
      ) : (
        <span className="text-xs tabular-nums text-stone-600">{e.registered_count} registered</span>
      ),
    })),
    ...allHackathons.filter((h) => new Date(h.ends_at).getTime() >= now && h.status !== 'cancelled').map((h) => ({
      key: `h${h.id}`, date: h.starts_at, title: h.title, kind: 'Hackathon', status: h.status, to: `/manage/hackathons/${h.id}`,
      fill: <span className="text-xs tabular-nums text-stone-600">{h.team_count} teams, {h.participant_count} people</span>,
    })),
  ].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 8)

  const firstName = access.me?.full_name.split(' ')[0]

  return (
    <>
      <ConsoleHeader
        title={`${greeting()}${firstName ? `, ${firstName}` : ''}`}
        subtitle={tasks.length ? `${tasks.length} ${tasks.length === 1 ? 'thing needs' : 'things need'} your attention.` : 'Everything is on track.'}
      />

      <div className="mb-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
        {access.events && <Kpi label="Upcoming events" value={live.length} icon="calendar" note="Published and open" to="/manage/events" />}
        {access.events && <Kpi label="Registrations" value={registrations} icon="users" note="Across upcoming events" />}
        {access.hackathons && <Kpi label="Active hackathons" value={activeHackathons.length} icon="trophy" note={`${activeHackathons.reduce((s, h) => s + h.participant_count, 0)} people taking part`} to="/manage/hackathons" />}
        <Kpi label="Drafts" value={drafts} icon="pencil" note={drafts ? 'Waiting to be published' : 'Nothing unpublished'} />
      </div>

      <div className="grid gap-6 xl:grid-cols-5">
        <div className="xl:col-span-2">
          <Panel title="Needs attention" flush>
            {tasks.length ? (
              <ul className="divide-y divide-stone-100">
                {tasks.slice(0, 8).map((t) => (
                  <li key={t.key} className="flex items-start gap-3 px-5 py-3.5">
                    <span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg ${taskTone[t.tone]}`}>
                      <Icon name={t.icon} className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold">{t.title}</p>
                      <p className="text-xs text-stone-600">{t.detail}</p>
                    </div>
                    <Link to={t.to} className="shrink-0 text-sm font-semibold text-brand-700 hover:underline">{t.action}</Link>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="flex flex-col items-center px-5 py-10 text-center">
                <span className="mb-3 grid h-11 w-11 place-items-center rounded-full bg-brand-50 text-brand-700"><Icon name="check" /></span>
                <p className="font-semibold">All caught up</p>
                <p className="text-sm text-stone-600">Nothing is waiting on you right now.</p>
              </div>
            )}
          </Panel>
        </div>

        <div className="xl:col-span-3">
          <Panel title="Coming up" flush>
            {schedule.length ? (
              <ul className="divide-y divide-stone-100">
                {schedule.map((s) => {
                  const d = new Date(s.date)
                  return (
                    <li key={s.key}>
                      <Link to={s.to} className="flex items-center gap-4 px-5 py-3 hover:bg-stone-50">
                        <span className="w-12 shrink-0 rounded-lg border border-stone-200 bg-white py-1 text-center">
                          <span className="block text-[10px] font-semibold uppercase text-brand-700">{d.toLocaleString('en-GB', { month: 'short' })}</span>
                          <span className="block text-lg font-bold leading-tight">{d.getDate()}</span>
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold">{s.title}</span>
                          <span className="flex items-center gap-2 text-xs text-stone-500">
                            {s.kind} · {formatDate(s.date)} {s.status !== 'published' && <StatusBadge status={s.status} />}
                          </span>
                        </span>
                        <span className="hidden sm:block">{s.fill}</span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <div className="flex flex-col items-center px-5 py-10 text-center">
                <span className="mb-3 grid h-11 w-11 place-items-center rounded-full bg-stone-100 text-stone-500"><Icon name="calendar" /></span>
                <p className="font-semibold">Nothing scheduled</p>
                <p className="mb-4 text-sm text-stone-600">Plan your next workshop, meetup or hackathon.</p>
                <div className="flex gap-2">
                  {access.events && <LinkButton to="/manage/events/new">Create event</LinkButton>}
                  {access.hackathons && <LinkButton to="/manage/hackathons/new" variant="secondary">Create hackathon</LinkButton>}
                </div>
              </div>
            )}
          </Panel>
        </div>
      </div>
    </>
  )
}
