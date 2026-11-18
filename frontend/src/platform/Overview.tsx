/** The whole community at a glance, from the platform's point of view. */
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'

import { api } from '../api'
import { Icon } from '../components/icons'
import type { IconName } from '../components/icons'
import { ErrorNote, Spinner, StatusBadge, formatDate } from '../components/ui'
import { DailyBars } from '../console/charts'
import { ConsoleHeader, Kpi, Meter, Panel, relative } from '../console/shared'
import type { Overview as Data } from './types'

const ATTENTION_ICON: Record<string, IconName> = { organization: 'home', email: 'inbox', event: 'calendar', config: 'shield' }

function StatusMeters({ counts, order }: { counts: Record<string, number>; order: string[] }) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  if (!total) return <p className="text-sm text-stone-500">None yet.</p>
  return (
    <ul className="space-y-2.5">
      {order.filter((s) => counts[s]).map((s) => (
        <li key={s} className="grid grid-cols-[6.5rem_1fr_2.5rem] items-center gap-3 text-sm">
          <StatusBadge status={s} />
          <Meter value={counts[s]} max={total} label={s} />
          <span className="text-right font-mono tabular-nums">{counts[s]}</span>
        </li>
      ))}
    </ul>
  )
}

export default function Overview() {
  const overview = useQuery({ queryKey: ['platform', 'overview'], queryFn: () => api<Data>('/platform/overview/') })
  if (overview.isLoading) return <Spinner />
  if (!overview.data) return <ErrorNote error={overview.error} />
  const { totals: t, emails, attention } = overview.data
  const attendance = t.registrations ? `${Math.round((t.check_ins / t.registrations) * 100)}% attended` : 'No registrations yet'

  return (
    <>
      <ConsoleHeader title="The whole community" subtitle="Every organisation, member, event and hackathon on A Million Techies Community." />

      <div className="mb-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Kpi label="Organisations" value={t.organizations} icon="home" note={`${t.organisers} organisers and admins`} to="/platform/organizations" />
        <Kpi label="Members" value={t.members} icon="users" note={`${t.new_members_30d} joined in the last 30 days`} to="/platform/members" />
        <Kpi label="Events" value={t.events} icon="calendar" note={`${t.upcoming_events} upcoming`} />
        <Kpi label="Registrations" value={t.registrations} icon="list" note={`${t.check_ins} check-ins · ${attendance}`} />
        <Kpi label="Hackathons" value={t.hackathons} icon="trophy" note={`${t.active_hackathons} open or judging`} />
        <Kpi label="Hackers" value={t.hackers} icon="target" note={`${t.projects} projects submitted`} />
        <Kpi label="Emails sent" value={emails.sent_30d} icon="inbox" note="In the last 30 days" to="/platform/emails" />
        <Kpi label="Email problems" value={emails.failed} icon="alert" note={emails.queued ? `${emails.queued} waiting to send` : 'Nothing waiting'} to="/platform/emails" />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Panel title="Sign-ups per day, all events">
            {overview.data.registrations_30d.length ? (
              <DailyBars dates={overview.data.registrations_30d} noun="sign-up" />
            ) : (
              <p className="py-8 text-center text-sm text-stone-600">No sign-ups in the last 30 days.</p>
            )}
          </Panel>
          <div className="grid gap-6 md:grid-cols-2">
            <Panel title="Events by status">
              <StatusMeters counts={overview.data.events_by_status} order={['published', 'draft', 'completed', 'cancelled']} />
            </Panel>
            <Panel title="Hackathons by status">
              <StatusMeters counts={overview.data.hackathons_by_status} order={['published', 'judging', 'draft', 'completed', 'cancelled']} />
            </Panel>
          </div>
        </div>

        <div className="space-y-6">
          <Panel title="Needs attention" flush>
            {attention.length ? (
              <ul className="divide-y divide-stone-100">
                {attention.map((a) => (
                  <li key={a.title}>
                    <Link to={a.link} className="flex items-start gap-3 px-5 py-3.5 hover:bg-stone-50">
                      <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-amber-50 text-amber-700">
                        <Icon name={ATTENTION_ICON[a.kind] ?? 'alert'} className="h-4 w-4" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold">{a.title}</span>
                        <span className="block text-xs text-stone-600">{a.detail}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-5 py-8 text-center text-sm text-stone-600">Nothing needs you right now.</p>
            )}
          </Panel>
          <Panel title="Newest events" flush>
            {overview.data.recent_events.length ? (
              <ul className="divide-y divide-stone-100">
                {overview.data.recent_events.map((e) => (
                  <li key={e.slug}>
                    <Link to={`/manage/events/${e.slug}`} className="block px-5 py-3 hover:bg-stone-50">
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-semibold">{e.title}</span>
                        <StatusBadge status={e.status} />
                      </span>
                      <span className="block text-xs text-stone-500">{e.organization} · {formatDate(e.starts_at)} · added {relative(e.created_at)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-5 py-8 text-center text-sm text-stone-600">No events yet.</p>
            )}
          </Panel>
        </div>
      </div>
    </>
  )
}
