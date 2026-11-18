/** Members across the whole community, and how email delivery is going. */
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'

import { api } from '../api'
import { DataTable, downloadCsv } from '../components/DataTable'
import type { Col } from '../components/DataTable'
import { Badge, Button, ErrorNote, Notice, Spinner, formatDate, formatDateTime, label } from '../components/ui'
import { ConsoleHeader, FilterChips } from '../console/shared'
import { useAct } from '../hooks'
import type { EmailRow, MemberRow } from './types'

export function Members() {
  const members = useQuery({ queryKey: ['platform', 'members'], queryFn: () => api<MemberRow[]>('/platform/members/') })
  const columns: Col<MemberRow>[] = [
    {
      title: 'Member',
      value: (m) => `${m.name} ${m.email} ${m.institution}`,
      cell: (m) => (
        <>
          <p className="font-semibold">{m.name || 'No name'}</p>
          <p className="text-xs text-stone-500">{m.email}{m.institution && ` · ${m.institution}`}</p>
        </>
      ),
      priority: 1,
    },
    {
      title: 'Organisations',
      value: (m) => m.organizations.map((o) => o.name).join(', '),
      cell: (m) => (
        <span className="flex flex-wrap gap-1">
          {m.organizations.map((o) => <Badge key={o.name} tone={o.admin ? 'green' : 'grey'}>{o.name}{o.admin ? ' · admin' : ''}</Badge>)}
        </span>
      ),
      priority: 3,
    },
    { title: 'Roles', value: (m) => m.roles.join(', '), cell: (m) => <span className="text-xs text-stone-600">{m.roles.join('; ')}</span>, priority: 6 },
    { title: 'Registered', value: (m) => m.registrations, cell: (m) => <span className="font-mono tabular-nums">{m.registrations}</span>, align: 'right', priority: 4 },
    { title: 'Attended', value: (m) => m.attended, cell: (m) => <span className="font-mono tabular-nums">{m.attended}</span>, align: 'right', priority: 5 },
    { title: 'Joined', value: (m) => m.joined, cell: (m) => <span className="whitespace-nowrap font-mono text-xs">{formatDate(m.joined)}</span>, priority: 2 },
  ]
  return (
    <>
      <ConsoleHeader title="Members" subtitle="Everyone who has signed in to Community, newest first." />
      <ErrorNote error={members.error} />
      <div className="overflow-hidden rounded-xl border border-stone-200 bg-white">
        {members.data ? (
          <DataTable
            rows={members.data}
            columns={columns}
            order={[5, 'desc']}
            searchPlaceholder="Name, email, institution"
            toolbar={
              <>
                <p className="text-sm text-stone-600"><span className="font-semibold text-ink">{members.data.length}</span> members</p>
                <Button variant="secondary" disabled={!members.data.length} onClick={() =>
                  downloadCsv('members.csv', ['Name', 'Email', 'Institution', 'Organisations', 'Roles', 'Registered', 'Attended', 'Joined'],
                    members.data.map((m) => [m.name, m.email, m.institution, m.organizations.map((o) => o.name).join('; '), m.roles.join('; '), m.registrations, m.attended, m.joined]))
                }>
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

const TONE: Record<EmailRow['status'], string> = { sent: 'green', queued: 'blue', sending: 'blue', failed: 'red' }
type Filter = 'all' | EmailRow['status']

export function Emails() {
  const emails = useQuery({ queryKey: ['platform', 'emails'], queryFn: () => api<EmailRow[]>('/platform/emails/') })
  const [filter, setFilter] = useState<Filter>('all')
  const retry = useAct((body: { failed?: boolean; ids?: number[] }) => api<{ retried: number }>('/platform/emails/', { method: 'POST', body }))
  const all = useMemo(() => emails.data ?? [], [emails.data])
  const rows = useMemo(() => all.filter((e) => filter === 'all' || e.status === filter), [all, filter])
  const count = (s: Filter) => all.filter((e) => s === 'all' || e.status === s).length
  const failed = count('failed')

  const columns: Col<EmailRow>[] = [
    { title: 'Created', value: (e) => e.created_at, cell: (e) => <span className="whitespace-nowrap font-mono text-xs">{formatDateTime(e.created_at)}</span>, priority: 3 },
    {
      title: 'Email',
      value: (e) => `${e.subject} ${e.to} ${e.event}`,
      cell: (e) => (
        <>
          <p className="font-semibold">{e.subject}</p>
          <p className="text-xs text-stone-500">To {e.to} · {label(e.kind.replace('reminder_', 'reminder '))}</p>
          {e.last_error && <p className="mt-1 font-mono text-xs text-red-700">{e.last_error}</p>}
        </>
      ),
      priority: 1,
    },
    { title: 'Status', value: (e) => e.status, cell: (e) => <Badge tone={TONE[e.status]}>{e.status}</Badge>, priority: 2 },
    { title: 'Tries', value: (e) => e.attempts, cell: (e) => <span className="font-mono tabular-nums">{e.attempts}</span>, align: 'right', priority: 5 },
    {
      title: '',
      value: () => '',
      sortable: false,
      align: 'right',
      priority: 4,
      cell: (e) => (e.status === 'failed' ? <Button variant="ghost" className="px-2 py-1" onClick={() => retry.mutate({ ids: [e.id] })}>Retry</Button> : null),
    },
  ]
  return (
    <>
      <ConsoleHeader
        title="Email delivery"
        subtitle="The latest 500 emails Community sent or tried to send. Failed ones were tried five times."
        actions={failed > 0 && <Button disabled={retry.isPending} onClick={() => retry.mutate({ failed: true })}>Retry all {failed} failed</Button>}
      />
      <div className="mb-4 space-y-3 empty:hidden">
        {retry.data && <Notice>Sending {retry.data.retried} again.</Notice>}
        <ErrorNote error={retry.error ?? emails.error} />
      </div>
      <div className="overflow-hidden rounded-xl border border-stone-200 bg-white">
        {emails.data ? (
          <DataTable
            rows={rows}
            columns={columns}
            order={[0, 'desc']}
            searchPlaceholder="Subject or address"
            empty="No emails here."
            toolbar={
              <FilterChips
                current={filter}
                onChange={setFilter}
                options={[
                  { id: 'all', label: 'All', count: count('all') },
                  { id: 'sent', label: 'Sent', count: count('sent') },
                  { id: 'queued', label: 'Waiting', count: count('queued') + count('sending') },
                  { id: 'failed', label: 'Failed', count: failed },
                ]}
              />
            }
          />
        ) : (
          <Spinner />
        )}
      </div>
    </>
  )
}
