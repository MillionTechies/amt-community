/** The console's events and hackathons tables, with status filters, search and paging. */
import { useQueries } from '@tanstack/react-query'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'

import { api } from '../api'
import type { CommunityEvent, Hackathon, Paginated } from '../api'
import { Icon } from '../components/icons'
import { Button, ErrorNote, Input, LinkButton, Spinner, StatusBadge, formatDate, label } from '../components/ui'
import { EVENT_TYPE_LABELS } from '../pages/Events'
import { ConsoleHeader, FilterChips, Meter, table, useAccess } from './shared'

const PAGE_SIZE = 24

/** One query per filter so every chip shows its count; the selected one also pages and searches. */
function useFiltered<T, F extends string>(base: string, filters: Record<F, string>, current: F, search: string, page: number) {
  const ids = Object.keys(filters) as F[]
  const results = useQueries({
    queries: ids.map((id) => {
      const params = new URLSearchParams(filters[id])
      if (id === current) {
        if (search) params.set('search', search)
        params.set('page', String(page))
      }
      const path = `${base}?${params}`
      return { queryKey: ['console', path], queryFn: () => api<Paginated<T>>(path) }
    }),
  })
  const counts = Object.fromEntries(ids.map((id, i) => [id, results[i].data?.count])) as Record<F, number | undefined>
  return { selected: results[ids.indexOf(current)], counts }
}

function ListShell({
  title,
  subtitle,
  create,
  chips,
  search,
  onSearch,
  children,
  page,
  count,
  onPage,
}: {
  title: string
  subtitle: string
  create?: ReactNode
  chips: ReactNode
  search: string
  onSearch: (value: string) => void
  children: ReactNode
  page: number
  count: number
  onPage: (page: number) => void
}) {
  const pages = Math.max(1, Math.ceil(count / PAGE_SIZE))
  return (
    <>
      <ConsoleHeader title={title} subtitle={subtitle} actions={create} />
      <div className="overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-stone-200 px-5 py-3 lg:flex-row lg:items-center lg:justify-between">
          {chips}
          <label className="relative block lg:w-72">
            <span className="sr-only">Search</span>
            <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
            <Input type="search" placeholder="Search by title" value={search} onChange={(e) => onSearch(e.target.value)} className="pl-9" />
          </label>
        </div>
        {children}
        {pages > 1 && (
          <div className="flex items-center justify-between border-t border-stone-200 px-5 py-3 text-sm text-stone-600">
            <span>Page {page} of {pages}</span>
            <div className="flex gap-2">
              <Button variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</Button>
              <Button variant="secondary" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</Button>
            </div>
          </div>
        )}
      </div>
    </>
  )
}

function EmptyRows({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-5 py-14 text-center text-stone-600">
      <span className="mb-3 grid h-11 w-11 place-items-center rounded-full bg-stone-100 text-stone-500"><Icon name="inbox" /></span>
      {children}
    </div>
  )
}

// --- events --------------------------------------------------------------------

const EVENT_FILTERS = {
  upcoming: 'scope=managed&when=upcoming',
  draft: 'scope=managed&status=draft',
  past: 'scope=managed&when=past',
  cancelled: 'scope=managed&status=cancelled',
  all: 'scope=managed&ordering=-starts_at',
}
type EventFilter = keyof typeof EVENT_FILTERS

export function EventsList() {
  const access = useAccess()
  const navigate = useNavigate()
  const [filter, setFilter] = useState<EventFilter>('upcoming')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const { selected, counts } = useFiltered<CommunityEvent, EventFilter>('/events/', EVENT_FILTERS, filter, search, page)
  const rows = selected.data?.results ?? []

  return (
    <ListShell
      title="Events"
      subtitle="Every event in the organisations you run."
      create={access.events && <LinkButton to="/manage/events/new"><Icon name="plus" className="h-4 w-4" />New event</LinkButton>}
      chips={
        <FilterChips
          current={filter}
          onChange={(f) => { setFilter(f); setPage(1) }}
          options={[
            { id: 'upcoming', label: 'Upcoming', count: counts.upcoming },
            { id: 'draft', label: 'Drafts', count: counts.draft },
            { id: 'past', label: 'Past', count: counts.past },
            { id: 'cancelled', label: 'Cancelled', count: counts.cancelled },
            { id: 'all', label: 'All', count: counts.all },
          ]}
        />
      }
      search={search}
      onSearch={(v) => { setSearch(v); setPage(1) }}
      page={page}
      count={selected.data?.count ?? 0}
      onPage={setPage}
    >
      <ErrorNote error={selected.error} />
      {selected.isLoading ? (
        <Spinner />
      ) : rows.length ? (
        <div className={table.wrap}>
          <table className={table.table}>
            <thead className={table.head}>
              <tr>
                <th className={table.th}>Event</th>
                <th className={table.th}>Date</th>
                <th className={table.th}>Type</th>
                <th className={table.th}>Status</th>
                <th className={table.th}>Registrations</th>
                <th className={table.th}><span className="sr-only">Open</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.slug} className={`${table.row} cursor-pointer`} onClick={() => navigate(`/manage/events/${e.slug}`)}>
                  <td className={table.td}>
                    <p className="font-semibold">{e.title}</p>
                    <p className="text-xs text-stone-500">{e.organization.name} · {label(e.delivery_mode)}</p>
                  </td>
                  <td className={`${table.td} whitespace-nowrap`}>{formatDate(e.starts_at)}</td>
                  <td className={table.td}>{EVENT_TYPE_LABELS[e.event_type] ?? label(e.event_type)}</td>
                  <td className={table.td}><StatusBadge status={e.status} /></td>
                  <td className={table.td}>
                    {e.capacity ? (
                      <div className="w-32">
                        <div className="mb-1 text-xs tabular-nums text-stone-600">{e.registered_count} of {e.capacity}</div>
                        <Meter value={e.registered_count} max={e.capacity} label={`${e.title}: places taken`} warn />
                      </div>
                    ) : (
                      <span className="tabular-nums">{e.registered_count}</span>
                    )}
                  </td>
                  <td className={`${table.td} text-right`}><Icon name="chevronRight" className="inline h-4 w-4 text-stone-400" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyRows>
          <p className="font-semibold text-ink">{search ? 'Nothing matches your search' : 'No events here'}</p>
          {!search && filter === 'upcoming' && access.events && (
            <div className="mt-4"><LinkButton to="/manage/events/new">Create an event</LinkButton></div>
          )}
        </EmptyRows>
      )}
    </ListShell>
  )
}

// --- hackathons ----------------------------------------------------------------

const HACKATHON_FILTERS = {
  all: 'scope=managed&ordering=-starts_at',
  draft: 'scope=managed&status=draft',
  published: 'scope=managed&status=published',
  judging: 'scope=managed&status=judging',
  completed: 'scope=managed&status=completed&ordering=-starts_at',
}
type HackathonFilter = keyof typeof HACKATHON_FILTERS

export function HackathonsList() {
  const access = useAccess()
  const navigate = useNavigate()
  const [filter, setFilter] = useState<HackathonFilter>('all')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const { selected, counts } = useFiltered<Hackathon, HackathonFilter>('/hackathons/', HACKATHON_FILTERS, filter, search, page)
  const rows = selected.data?.results ?? []

  return (
    <ListShell
      title="Hackathons"
      subtitle="Run registration, teams, judging and results."
      create={access.hackathons && <LinkButton to="/manage/hackathons/new"><Icon name="plus" className="h-4 w-4" />New hackathon</LinkButton>}
      chips={
        <FilterChips
          current={filter}
          onChange={(f) => { setFilter(f); setPage(1) }}
          options={[
            { id: 'all', label: 'All', count: counts.all },
            { id: 'draft', label: 'Drafts', count: counts.draft },
            { id: 'published', label: 'Open', count: counts.published },
            { id: 'judging', label: 'Judging', count: counts.judging },
            { id: 'completed', label: 'Completed', count: counts.completed },
          ]}
        />
      }
      search={search}
      onSearch={(v) => { setSearch(v); setPage(1) }}
      page={page}
      count={selected.data?.count ?? 0}
      onPage={setPage}
    >
      <ErrorNote error={selected.error} />
      {selected.isLoading ? (
        <Spinner />
      ) : rows.length ? (
        <div className={table.wrap}>
          <table className={table.table}>
            <thead className={table.head}>
              <tr>
                <th className={table.th}>Hackathon</th>
                <th className={table.th}>Dates</th>
                <th className={table.th}>Status</th>
                <th className={`${table.th} text-right`}>People</th>
                <th className={`${table.th} text-right`}>Teams</th>
                <th className={`${table.th} text-right`}>Projects</th>
                <th className={table.th}><span className="sr-only">Open</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((h) => (
                <tr key={h.slug} className={`${table.row} cursor-pointer`} onClick={() => navigate(`/manage/hackathons/${h.slug}`)}>
                  <td className={table.td}>
                    <p className="font-semibold">{h.title}</p>
                    <p className="text-xs text-stone-500">{h.organization.name}{h.theme && ` · ${h.theme}`}</p>
                  </td>
                  <td className={`${table.td} whitespace-nowrap`}>{formatDate(h.starts_at)} to {formatDate(h.ends_at)}</td>
                  <td className={table.td}><StatusBadge status={h.status} /></td>
                  <td className={`${table.td} text-right tabular-nums`}>{h.participant_count}</td>
                  <td className={`${table.td} text-right tabular-nums`}>{h.team_count}</td>
                  <td className={`${table.td} text-right tabular-nums`}>{h.submission_count}</td>
                  <td className={`${table.td} text-right`}><Icon name="chevronRight" className="inline h-4 w-4 text-stone-400" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyRows>
          <p className="font-semibold text-ink">{search ? 'Nothing matches your search' : 'No hackathons here'}</p>
          {!search && filter === 'all' && access.hackathons && (
            <div className="mt-4"><LinkButton to="/manage/hackathons/new">Create a hackathon</LinkButton></div>
          )}
        </EmptyRows>
      )}
    </ListShell>
  )
}
