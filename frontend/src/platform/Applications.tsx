/**
 * Organisations asking to join Community: a table to approve or decline many at once,
 * and one application in detail, where its alias can be chosen.
 */
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { ApiError, api } from '../api'
import { DataTable } from '../components/DataTable'
import type { Col } from '../components/DataTable'
import { useConfirm } from '../components/feedback'
import { Badge, Button, ErrorNote, Field, Input, Notice, Spinner, Textarea, formatDate } from '../components/ui'
import { ConsoleHeader, FilterChips, Panel } from '../console/shared'
import { useAct } from '../hooks'
import type { ApplicationRow } from './types'

type Filter = 'pending' | 'approved' | 'declined' | 'all'
type Decision = 'approve' | 'decline'
interface BulkResult { done: number[]; failed: { id: number; name: string; error: string }[] }

const TONE: Record<ApplicationRow['status'], string> = { pending: 'amber', approved: 'green', declined: 'red' }
const STATUS: Record<ApplicationRow['status'], string> = { pending: 'Waiting', approved: 'Approved', declined: 'Declined' }
const plural = (n: number) => `${n} ${n === 1 ? 'organisation' : 'organisations'}`

function useApplications() {
  return useQuery({ queryKey: ['platform', 'applications'], queryFn: () => api<ApplicationRow[]>('/platform/applications/') })
}

export default function Applications() {
  const navigate = useNavigate()
  const confirm = useConfirm()
  const applications = useApplications()
  const [filter, setFilter] = useState<Filter>('pending')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [declining, setDeclining] = useState(false)
  const [reason, setReason] = useState('')
  const bulk = useAct((body: { ids: number[]; decision: Decision; note?: string }) =>
    api<BulkResult>('/platform/applications/bulk/', { method: 'POST', body }),
  )
  const all = useMemo(() => applications.data ?? [], [applications.data])
  const rows = useMemo(() => all.filter((a) => filter === 'all' || a.status === filter), [all, filter])
  const count = (f: Filter) => all.filter((a) => f === 'all' || a.status === f).length
  const pending = rows.filter((a) => a.status === 'pending')
  const chosen = [...selected].filter((id) => pending.some((a) => a.id === id))

  const toggle = (id: number) =>
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const decide = (decision: Decision, note?: string) =>
    bulk.mutate({ ids: chosen, decision, note }, {
      onSuccess: () => {
        setSelected(new Set())
        setDeclining(false)
        setReason('')
      },
    })
  const approve = async () => {
    const ok = await confirm({
      title: `Approve ${plural(chosen.length)}?`,
      message: 'Each one is created in Keycloak with its suggested alias, and its applicant becomes its admin. To choose an alias, open the application instead.',
      confirmLabel: 'Approve',
      tone: 'primary',
    })
    if (ok) decide('approve')
  }

  const columns = useMemo<Col<ApplicationRow>[]>(
    () => [
      {
        title: '',
        value: () => '',
        sortable: false,
        width: '2.5rem',
        priority: 1,
        cell: (a) =>
          a.status === 'pending' ? (
            <input type="checkbox" aria-label={`Select ${a.name}`} checked={selected.has(a.id)} onChange={() => toggle(a.id)} className="h-4 w-4 accent-brand-600" />
          ) : null,
      },
      {
        title: 'Organisation',
        value: (a) => `${a.name} ${a.kind_label}`,
        cell: (a) => (
          <>
            <p className="font-semibold">{a.name}</p>
            <p className="text-xs text-stone-500">{a.kind_label}</p>
          </>
        ),
        priority: 1,
      },
      {
        title: 'Applicant',
        value: (a) => `${a.applicant.name} ${a.applicant.email}`,
        cell: (a) => (
          <>
            <p>{a.applicant.name || 'No name'}</p>
            <p className="text-xs text-stone-500">{a.applicant.email}</p>
          </>
        ),
        priority: 3,
      },
      { title: 'Location', value: (a) => a.location, priority: 5 },
      { title: 'Applied', value: (a) => a.created_at, cell: (a) => <span className="whitespace-nowrap font-mono text-xs">{formatDate(a.created_at)}</span>, priority: 4 },
      { title: 'Status', value: (a) => a.status, cell: (a) => <Badge tone={TONE[a.status]}>{STATUS[a.status]}</Badge>, priority: 2 },
    ],
    [selected],
  )

  return (
    <>
      <ConsoleHeader
        title="Applications"
        subtitle="Organisations asking to join. Select some to approve or decline them together, or open one to read it in full."
      />
      <div className="mb-4 space-y-3 empty:hidden">
        {bulk.data && bulk.data.done.length > 0 && <Notice>Done: {plural(bulk.data.done.length)}. Their applicants were emailed.</Notice>}
        {bulk.data && bulk.data.failed.length > 0 && (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            <p className="font-semibold">Not done:</p>
            <ul className="mt-1 list-disc pl-5">
              {bulk.data.failed.map((f) => <li key={f.id}><Link to={`/platform/applications/${f.id}`} className="font-semibold underline">{f.name}</Link>: {f.error}</li>)}
            </ul>
          </div>
        )}
        <ErrorNote error={bulk.error ?? applications.error} />
      </div>
      {declining && (
        <form
          className="mb-4 space-y-3 rounded-xl border border-red-200 bg-white p-4"
          onSubmit={(e) => { e.preventDefault(); decide('decline', reason) }}
        >
          <Field label={`Reason for declining ${plural(chosen.length)}`} required hint="Emailed to every applicant.">
            <Textarea required rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="danger" disabled={bulk.isPending}>Decline {chosen.length}</Button>
            <Button variant="ghost" onClick={() => setDeclining(false)}>Cancel</Button>
          </div>
        </form>
      )}
      <div className="overflow-hidden rounded-xl border border-stone-200 bg-white">
        {applications.data ? (
          <DataTable
            rows={rows}
            columns={columns}
            order={[4, 'desc']}
            onOpen={(a) => navigate(`/platform/applications/${a.id}`)}
            searchPlaceholder="Organisation or applicant"
            empty={filter === 'pending' ? 'No applications are waiting.' : 'Nothing here.'}
            toolbar={
              <>
                <FilterChips
                  current={filter}
                  onChange={(f) => { setFilter(f); setSelected(new Set()) }}
                  options={[
                    { id: 'pending', label: 'Waiting', count: count('pending') },
                    { id: 'approved', label: 'Approved', count: count('approved') },
                    { id: 'declined', label: 'Declined', count: count('declined') },
                    { id: 'all', label: 'All', count: count('all') },
                  ]}
                />
                {pending.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2">
                    {chosen.length === pending.length ? (
                      <Button variant="ghost" className="px-2 py-1" onClick={() => setSelected(new Set())}>Clear selection</Button>
                    ) : (
                      <Button variant="ghost" className="px-2 py-1" onClick={() => setSelected(new Set(pending.map((a) => a.id)))}>Select all {pending.length} waiting</Button>
                    )}
                    <Button disabled={!chosen.length || bulk.isPending} onClick={() => void approve()}>Approve {chosen.length || ''}</Button>
                    <Button variant="danger" disabled={!chosen.length || bulk.isPending} onClick={() => setDeclining(true)}>Decline {chosen.length || ''}</Button>
                  </div>
                )}
              </>
            }
          />
        ) : (
          !applications.error && <Spinner />
        )}
      </div>
    </>
  )
}

function Review({ application }: { application: ApplicationRow }) {
  const [mode, setMode] = useState<Decision | null>(null)
  const [alias, setAlias] = useState(application.suggested_alias)
  const [note, setNote] = useState('')
  const decide = useAct((decision: Decision) =>
    api<ApplicationRow>(`/platform/applications/${application.id}/${decision}/`, {
      method: 'POST',
      body: decision === 'approve' ? { alias, note } : { note },
    }),
  )
  const errors = decide.error instanceof ApiError ? decide.error.fields : {}
  const who = application.applicant.name || application.applicant.email

  if (mode === 'approve')
    return (
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); decide.mutate('approve') }}>
        <p className="text-sm text-stone-700">
          This creates <span className="font-semibold">{application.name}</span> in Keycloak with its admins, clubs and mentorships groups, and makes {who} its admin.
        </p>
        <Field label="Alias" required hint="Lowercase letters, numbers and dashes. It cannot be changed later." error={errors.alias}>
          <Input required pattern="[a-z0-9_\-]+" value={alias} onChange={(e) => setAlias(e.target.value.toLowerCase())} className="font-mono" />
        </Field>
        <Field label="Welcome note" hint="Optional. Added to the approval email." error={errors.note}>
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <ErrorNote error={decide.error} />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={decide.isPending}>{decide.isPending ? 'Creating…' : 'Approve and create'}</Button>
          <Button variant="ghost" onClick={() => setMode(null)}>Back</Button>
        </div>
      </form>
    )

  if (mode === 'decline')
    return (
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); decide.mutate('decline') }}>
        <Field label="Reason" required hint="Emailed to the applicant." error={errors.note}>
          <Textarea required rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <ErrorNote error={decide.error} />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="danger" disabled={decide.isPending}>Decline application</Button>
          <Button variant="ghost" onClick={() => setMode(null)}>Back</Button>
        </div>
      </form>
    )

  return (
    <div className="flex flex-wrap gap-2">
      <Button onClick={() => setMode('approve')}>Approve</Button>
      <Button variant="danger" onClick={() => setMode('decline')}>Decline</Button>
    </div>
  )
}

export function ApplicationDetail() {
  const { id = '' } = useParams()
  const applications = useApplications()
  if (applications.isLoading) return <Spinner />
  const a = applications.data?.find((row) => String(row.id) === id)
  if (!a) return <ErrorNote error={applications.error ?? 'Application not found.'} />

  return (
    <>
      <ConsoleHeader
        title={a.name}
        subtitle={`${a.kind_label}${a.location ? ` · ${a.location}` : ''} · applied ${formatDate(a.created_at)}`}
        actions={<Link to="/platform/applications" className="text-sm font-semibold text-brand-700 hover:underline">All applications</Link>}
      />
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Panel title="About">
            <p className="whitespace-pre-line text-sm text-stone-700">{a.about}</p>
            {a.plans && (
              <>
                <h3 className="eyebrow mb-1 mt-5 text-stone-500">Plans</h3>
                <p className="whitespace-pre-line text-sm text-stone-700">{a.plans}</p>
              </>
            )}
          </Panel>
          <Panel title="Decision" action={<Badge tone={TONE[a.status]}>{STATUS[a.status]}</Badge>}>
            {a.status === 'pending' ? (
              <Review application={a} />
            ) : (
              <div className="space-y-2 text-sm text-stone-600">
                <p>{STATUS[a.status]} by {a.reviewed_by || 'a platform admin'}{a.reviewed_at && ` on ${formatDate(a.reviewed_at)}`}.</p>
                {a.review_note && <p className="rounded-lg bg-stone-50 px-3 py-2 text-stone-700">{a.review_note}</p>}
                {a.organization_id && a.status === 'approved' && (
                  <Link to={`/platform/organizations/${encodeURIComponent(a.organization_id)}`} className="inline-block font-semibold text-brand-700 hover:underline">
                    Open the organisation
                  </Link>
                )}
              </div>
            )}
          </Panel>
        </div>
        <Panel title="Applicant">
          <dl className="space-y-1 text-sm">
            <dt className="sr-only">Name</dt>
            <dd className="font-semibold">{a.applicant.name || 'No name'}</dd>
            <dt className="sr-only">Email</dt>
            <dd className="text-stone-600">{a.applicant.email}</dd>
            {a.contact_phone && <><dt className="sr-only">Phone</dt><dd className="text-stone-600">{a.contact_phone}</dd></>}
            {a.applicant.institution && <><dt className="sr-only">Institution</dt><dd className="text-stone-500">{a.applicant.institution}</dd></>}
            {a.website && (
              <>
                <dt className="sr-only">Website</dt>
                <dd><a href={a.website} target="_blank" rel="noreferrer" className="break-all font-semibold text-brand-700 hover:underline">{a.website}</a></dd>
              </>
            )}
          </dl>
        </Panel>
      </div>
    </>
  )
}
