/** Every organisation, with its people and activity, and one organisation in detail. */
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { api } from '../api'
import { DataTable, downloadCsv } from '../components/DataTable'
import type { Col } from '../components/DataTable'
import { Icon } from '../components/icons'
import { Badge, Button, Empty, ErrorNote, Notice, Spinner, StatusBadge, formatDate, formatDateTime, label } from '../components/ui'
import { ConsoleHeader, Kpi, Panel } from '../console/shared'
import { useAct } from '../hooks'
import type { OrgDetail, OrgRow } from './types'

const num = (n: number) => <span className="font-mono tabular-nums">{n}</span>

export function Organizations() {
  const navigate = useNavigate()
  const orgs = useQuery({ queryKey: ['platform', 'organizations'], queryFn: () => api<OrgRow[]>('/platform/organizations/') })
  const sync = useAct(() => api<{ organizations: number }>('/organizations/sync/', { method: 'POST' }))

  const columns: Col<OrgRow>[] = [
    {
      title: 'Organisation',
      value: (o) => `${o.name} ${o.alias}`,
      cell: (o) => (
        <>
          <p className="font-semibold">{o.name}</p>
          <p className="font-mono text-xs text-stone-500">{o.alias}</p>
        </>
      ),
      priority: 1,
    },
    { title: 'Members', value: (o) => o.members, cell: (o) => num(o.members), align: 'right', priority: 2 },
    {
      title: 'Admins',
      value: (o) => o.admins,
      cell: (o) => (o.admins ? num(o.admins) : <Badge tone="amber">None</Badge>),
      align: 'right',
      priority: 3,
    },
    { title: 'Organisers', value: (o) => o.organisers, cell: (o) => num(o.organisers), align: 'right', priority: 6 },
    { title: 'Events', value: (o) => o.events, cell: (o) => <span className="font-mono tabular-nums">{o.events}{o.upcoming_events ? <span className="text-stone-500"> ({o.upcoming_events} upcoming)</span> : null}</span>, align: 'right', priority: 4 },
    { title: 'Hackathons', value: (o) => o.hackathons, cell: (o) => num(o.hackathons), align: 'right', priority: 7 },
    { title: 'Registrations', value: (o) => o.registrations, cell: (o) => num(o.registrations), align: 'right', priority: 5 },
    {
      title: 'Own apps',
      value: (o) => o.own_apps.join(', '),
      cell: (o) => (o.own_apps.length ? <span className="text-xs">{o.own_apps.join(', ')}</span> : <span className="text-xs text-stone-400">Platform</span>),
      priority: 8,
    },
  ]

  return (
    <>
      <ConsoleHeader
        title="Organisations"
        subtitle="Organisations and their members come from Keycloak. Refresh after changing them there."
        actions={
          <Button variant="secondary" disabled={sync.isPending} onClick={() => sync.mutate()}>
            <Icon name="refresh" className="h-4 w-4" />{sync.isPending ? 'Refreshing…' : 'Refresh from Keycloak'}
          </Button>
        }
      />
      <div className="mb-4 space-y-3 empty:hidden">
        {sync.data && <Notice>Refreshed {sync.data.organizations} organisations from Keycloak.</Notice>}
        <ErrorNote error={sync.error ?? orgs.error} />
      </div>
      <div className="overflow-hidden rounded-xl border border-stone-200 bg-white">
        {orgs.data ? (
          <DataTable
            rows={orgs.data}
            columns={columns}
            order={[0, 'asc']}
            onOpen={(o) => navigate(`/platform/organizations/${encodeURIComponent(o.id)}`)}
            searchPlaceholder="Search organisations"
            empty="No organisations yet. Create them in Keycloak, then refresh."
            toolbar={
              <>
                <p className="text-sm text-stone-600"><span className="font-semibold text-ink">{orgs.data.length}</span> organisations</p>
                <Button
                  variant="secondary"
                  disabled={!orgs.data.length}
                  onClick={() =>
                    downloadCsv('organisations.csv', ['Name', 'Alias', 'Members', 'Admins', 'Organisers', 'Events', 'Upcoming', 'Hackathons', 'Registrations'],
                      orgs.data.map((o) => [o.name, o.alias, o.members, o.admins, o.organisers, o.events, o.upcoming_events, o.hackathons, o.registrations]))
                  }
                >
                  Export CSV
                </Button>
              </>
            }
          />
        ) : (
          <Spinner />
        )}
      </div>
    </>
  )
}

export function OrganizationDetail() {
  const { id = '' } = useParams()
  const org = useQuery({ queryKey: ['platform', 'organization', id], queryFn: () => api<OrgDetail>(`/platform/organizations/${encodeURIComponent(id)}/`) })
  if (org.isLoading) return <Spinner />
  if (!org.data) return <ErrorNote error={org.error ?? 'Organisation not found.'} />
  const o = org.data

  return (
    <>
      <ConsoleHeader
        title={o.name}
        subtitle={<span className="font-mono text-xs">{o.alias} · synced {formatDateTime(o.synced_at)}</span>}
        actions={<Link to="/platform/organizations" className="text-sm font-semibold text-brand-700 hover:underline">All organisations</Link>}
      />
      {!o.admins && <div className="mb-4"><Notice tone="amber">This organisation has no admin. Add someone to its admins group in Keycloak, then refresh.</Notice></div>}
      <div className="mb-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Kpi label="Members" value={o.members} icon="users" note={`${o.admins} admins, ${o.organisers} with roles`} />
        <Kpi label="Events" value={o.events} icon="calendar" note={`${o.upcoming_events} upcoming`} />
        <Kpi label="Registrations" value={o.registrations} icon="list" note="Across all its events" />
        <Kpi label="Hackathons" value={o.hackathons} icon="trophy" note={o.last_event_at ? `Last event ${formatDate(o.last_event_at)}` : 'No events yet'} />
      </div>
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Panel title={`Events (${o.event_list.length})`} flush>
            {o.event_list.length ? (
              <ul className="divide-y divide-stone-100">
                {o.event_list.map((e) => (
                  <li key={e.slug}>
                    <Link to={`/manage/events/${e.slug}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-stone-50">
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold">{e.title}</span>
                        <span className="block text-xs text-stone-500">{formatDate(e.starts_at)} · {e.registered} registered</span>
                      </span>
                      <StatusBadge status={e.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : <p className="px-5 py-8 text-center text-sm text-stone-600">No events yet.</p>}
          </Panel>
          {o.hackathon_list.length > 0 && (
            <Panel title={`Hackathons (${o.hackathon_list.length})`} flush>
              <ul className="divide-y divide-stone-100">
                {o.hackathon_list.map((h) => (
                  <li key={h.slug}>
                    <Link to={`/manage/hackathons/${h.slug}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-stone-50">
                      <span className="truncate text-sm font-semibold">{h.title}</span>
                      <StatusBadge status={h.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
        <div className="space-y-6">
          <Panel title="Admins" flush>
            {o.admin_people.length ? (
              <ul className="divide-y divide-stone-100">
                {o.admin_people.map((p) => (
                  <li key={p.sub} className="px-5 py-2.5 text-sm">
                    <span className="block font-semibold">{p.name}</span>
                    <span className="block text-xs text-stone-500">{p.email}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="px-5 py-6 text-center text-sm text-stone-600">None.</p>}
          </Panel>
          <Panel title="Organisers and managers" flush>
            {o.role_people.length ? (
              <ul className="divide-y divide-stone-100">
                {o.role_people.map((p) => (
                  <li key={`${p.email}-${p.role}`} className="flex items-center justify-between gap-2 px-5 py-2.5 text-sm">
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{p.name}</span>
                      <span className="block truncate text-xs text-stone-500">{p.email}</span>
                    </span>
                    <Badge tone="blue">{label(p.role)}</Badge>
                  </li>
                ))}
              </ul>
            ) : <p className="px-5 py-6 text-center text-sm text-stone-600">Nobody has a role yet.</p>}
          </Panel>
          <Panel title="Its own settings">
            {o.overrides.length ? (
              <ul className="space-y-2 text-sm">
                {o.overrides.map((g) => <li key={g.group}><span className="font-semibold">{g.group}:</span> {g.keys.join(', ')}</li>)}
              </ul>
            ) : <p className="text-sm text-stone-600">Uses the platform's settings for everything.</p>}
            <p className="mt-3 text-xs text-stone-500">Its admins change these in the organiser console, under Configuration.</p>
          </Panel>
        </div>
      </div>
    </>
  )
}

export function NotFound() {
  return <Empty>This page does not exist. <Link className="font-semibold text-brand-700" to="/platform">Back to the overview</Link></Empty>
}
