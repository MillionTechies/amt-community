/** The console's events and hackathons tables: status filters with counts, then a DataTable. */
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { api } from '../api'
import type { CommunityEvent, Hackathon, Paginated } from '../api'
import { DataTable, downloadCsv } from '../components/DataTable'
import type { Col } from '../components/DataTable'
import { Icon } from '../components/icons'
import { Button, ErrorNote, LinkButton, Spinner, StatusBadge, formatDate, label } from '../components/ui'
import { EVENT_TYPE_LABELS } from '../pages/Events'
import { ConsoleHeader, FilterChips, Meter, useAccess } from './shared'

/** Every page of a list endpoint. The managed sets are small enough to sort and search here. */
async function fetchAll<T>(path: string): Promise<T[]> {
  const rows: T[] = []
  for (let page = 1; ; page++) {
    const data = await api<Paginated<T>>(`${path}${path.includes('?') ? '&' : '?'}page=${page}`)
    rows.push(...data.results)
    if (!data.next) return rows
  }
}

function useManaged<T>(kind: 'events' | 'hackathons') {
  return useQuery({ queryKey: ['console', kind, 'all'], queryFn: () => fetchAll<T>(`/${kind}/?scope=managed`) })
}

// --- events --------------------------------------------------------------------

const EVENT_FILTERS = {
  upcoming: (e: CommunityEvent) => e.status !== 'cancelled' && new Date(e.ends_at).getTime() >= Date.now(),
  draft: (e: CommunityEvent) => e.status === 'draft',
  past: (e: CommunityEvent) => e.status !== 'cancelled' && new Date(e.ends_at).getTime() < Date.now(),
  cancelled: (e: CommunityEvent) => e.status === 'cancelled',
  all: () => true,
}
type EventFilter = keyof typeof EVENT_FILTERS

export function EventsList() {
  const access = useAccess()
  const navigate = useNavigate()
  const [filter, setFilter] = useState<EventFilter>('upcoming')
  const events = useManaged<CommunityEvent>('events')
  const all = useMemo(() => events.data ?? [], [events.data])
  const rows = useMemo(() => all.filter(EVENT_FILTERS[filter]), [all, filter])
  const count = (f: EventFilter) => all.filter(EVENT_FILTERS[f]).length

  const columns: Col<CommunityEvent>[] = [
    {
      title: 'Event',
      value: (e) => `${e.title} ${e.organization.name} ${e.venue}`,
      cell: (e) => (
        <>
          <p className="font-semibold">{e.title}</p>
          <p className="text-xs text-stone-500">{e.organization.name} · {label(e.delivery_mode)}</p>
        </>
      ),
      priority: 1,
    },
    { title: 'Date', value: (e) => e.starts_at, cell: (e) => <span className="whitespace-nowrap font-mono text-xs">{formatDate(e.starts_at)}</span>, priority: 2 },
    { title: 'Type', value: (e) => EVENT_TYPE_LABELS[e.event_type] ?? label(e.event_type), priority: 5 },
    { title: 'Status', value: (e) => e.status, cell: (e) => <StatusBadge status={e.status} />, priority: 3 },
    {
      title: 'Registrations',
      value: (e) => e.registered_count,
      cell: (e) =>
        e.capacity ? (
          <div className="w-32">
            <div className="mb-1 font-mono text-xs tabular-nums text-stone-600">{e.registered_count}/{e.capacity}</div>
            <Meter value={e.registered_count} max={e.capacity} label={`${e.title}: places taken`} warn />
          </div>
        ) : (
          <span className="font-mono tabular-nums">{e.registered_count}</span>
        ),
      priority: 4,
    },
  ]

  const exportCsv = () =>
    downloadCsv(
      'events.csv',
      ['Title', 'Organisation', 'Starts', 'Ends', 'Type', 'Format', 'Status', 'Registered', 'Places', 'Address'],
      rows.map((e) => [e.title, e.organization.name, e.starts_at, e.ends_at, e.event_type, e.delivery_mode, e.status, e.registered_count, e.capacity, `${location.origin}/events/${e.slug}`]),
    )

  return (
    <>
      <ConsoleHeader
        title="Events"
        subtitle="Every event in the organisations you run."
        actions={access.events && <LinkButton to="/manage/events/new"><Icon name="plus" className="h-4 w-4" />New event</LinkButton>}
      />
      <ErrorNote error={events.error} />
      <div className="overflow-hidden rounded-xl border border-stone-200 bg-white">
        {events.isLoading ? (
          <Spinner />
        ) : (
          <DataTable
            rows={rows}
            columns={columns}
            order={[1, filter === 'upcoming' || filter === 'draft' ? 'asc' : 'desc']}
            onOpen={(e) => navigate(`/manage/events/${e.slug}`)}
            searchPlaceholder="Search events"
            empty={filter === 'upcoming' ? 'No upcoming events. Create one to get started.' : 'No events here.'}
            toolbar={
              <>
                <FilterChips
                  current={filter}
                  onChange={setFilter}
                  options={[
                    { id: 'upcoming', label: 'Upcoming', count: count('upcoming') },
                    { id: 'draft', label: 'Drafts', count: count('draft') },
                    { id: 'past', label: 'Past', count: count('past') },
                    { id: 'cancelled', label: 'Cancelled', count: count('cancelled') },
                    { id: 'all', label: 'All', count: all.length },
                  ]}
                />
                <Button variant="secondary" onClick={exportCsv} disabled={!rows.length}>Export CSV</Button>
              </>
            }
          />
        )}
      </div>
    </>
  )
}

// --- hackathons ----------------------------------------------------------------

const HACKATHON_FILTERS = {
  all: () => true,
  draft: (h: Hackathon) => h.status === 'draft',
  published: (h: Hackathon) => h.status === 'published',
  judging: (h: Hackathon) => h.status === 'judging',
  completed: (h: Hackathon) => h.status === 'completed',
}
type HackathonFilter = keyof typeof HACKATHON_FILTERS

export function HackathonsList() {
  const access = useAccess()
  const navigate = useNavigate()
  const [filter, setFilter] = useState<HackathonFilter>('all')
  const hackathons = useManaged<Hackathon>('hackathons')
  const all = useMemo(() => hackathons.data ?? [], [hackathons.data])
  const rows = useMemo(() => all.filter(HACKATHON_FILTERS[filter]), [all, filter])
  const count = (f: HackathonFilter) => all.filter(HACKATHON_FILTERS[f]).length
  const number = (n: number) => <span className="font-mono tabular-nums">{n}</span>

  const columns: Col<Hackathon>[] = [
    {
      title: 'Hackathon',
      value: (h) => `${h.title} ${h.organization.name} ${h.theme}`,
      cell: (h) => (
        <>
          <p className="font-semibold">{h.title}</p>
          <p className="text-xs text-stone-500">{h.organization.name}{h.theme && ` · ${h.theme}`}</p>
        </>
      ),
      priority: 1,
    },
    { title: 'Starts', value: (h) => h.starts_at, cell: (h) => <span className="whitespace-nowrap font-mono text-xs">{formatDate(h.starts_at)}</span>, priority: 2 },
    { title: 'Status', value: (h) => h.status, cell: (h) => <StatusBadge status={h.status} />, priority: 3 },
    { title: 'People', value: (h) => h.participant_count, cell: (h) => number(h.participant_count), align: 'right', priority: 4 },
    { title: 'Teams', value: (h) => h.team_count, cell: (h) => number(h.team_count), align: 'right', priority: 5 },
    { title: 'Projects', value: (h) => h.submission_count, cell: (h) => number(h.submission_count), align: 'right', priority: 6 },
  ]

  return (
    <>
      <ConsoleHeader
        title="Hackathons"
        subtitle="Run registration, teams, judging and results."
        actions={access.hackathons && <LinkButton to="/manage/hackathons/new"><Icon name="plus" className="h-4 w-4" />New hackathon</LinkButton>}
      />
      <ErrorNote error={hackathons.error} />
      <div className="overflow-hidden rounded-xl border border-stone-200 bg-white">
        {hackathons.isLoading ? (
          <Spinner />
        ) : (
          <DataTable
            rows={rows}
            columns={columns}
            order={[1, 'desc']}
            onOpen={(h) => navigate(`/manage/hackathons/${h.slug}`)}
            searchPlaceholder="Search hackathons"
            empty="No hackathons here."
            toolbar={
              <FilterChips
                current={filter}
                onChange={setFilter}
                options={[
                  { id: 'all', label: 'All', count: all.length },
                  { id: 'draft', label: 'Drafts', count: count('draft') },
                  { id: 'published', label: 'Open', count: count('published') },
                  { id: 'judging', label: 'Judging', count: count('judging') },
                  { id: 'completed', label: 'Completed', count: count('completed') },
                ]}
              />
            }
          />
        )}
      </div>
    </>
  )
}
