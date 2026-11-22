/** Organisations asking to join Community: read each application, then approve or decline it. */
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { ApiError, api } from '../api'
import { Badge, Button, Empty, ErrorNote, Field, Input, Notice, Spinner, Textarea, formatDate } from '../components/ui'
import { ConsoleHeader, FilterChips } from '../console/shared'
import { useAct } from '../hooks'
import type { ApplicationRow } from './types'

type Filter = 'pending' | 'approved' | 'declined' | 'all'
const TONE: Record<ApplicationRow['status'], string> = { pending: 'amber', approved: 'green', declined: 'red' }
const STATUS: Record<ApplicationRow['status'], string> = { pending: 'Waiting', approved: 'Approved', declined: 'Declined' }

function Review({ application, onDone }: { application: ApplicationRow; onDone: (message: string) => void }) {
  const [mode, setMode] = useState<'approve' | 'decline' | null>(null)
  const [alias, setAlias] = useState(application.suggested_alias)
  const [note, setNote] = useState('')
  const decide = useAct((decision: 'approve' | 'decline') =>
    api<ApplicationRow>(`/platform/applications/${application.id}/${decision}/`, {
      method: 'POST',
      body: decision === 'approve' ? { alias, note } : { note },
    }),
  )
  const errors = decide.error instanceof ApiError ? decide.error.fields : {}
  const submit = (decision: 'approve' | 'decline') =>
    decide.mutate(decision, {
      onSuccess: () =>
        onDone(decision === 'approve'
          ? `${application.name} is on Community, with ${application.applicant.name || application.applicant.email} as its admin.`
          : `Declined ${application.name}. We emailed ${application.applicant.email} your reason.`),
    })

  if (mode === 'approve')
    return (
      <form className="space-y-4 rounded-lg border border-brand-200 bg-brand-50/50 p-4" onSubmit={(e) => { e.preventDefault(); submit('approve') }}>
        <p className="text-sm text-stone-700">
          This creates <span className="font-semibold">{application.name}</span> in Keycloak with its admins, clubs and mentorships groups, and makes {application.applicant.name || application.applicant.email} its admin.
        </p>
        <Field label="Alias" hint="Lowercase letters, numbers and dashes. It names the organisation in sign-in tokens and cannot be changed later." error={errors.alias}>
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
      <form className="space-y-4 rounded-lg border border-red-200 bg-red-50/50 p-4" onSubmit={(e) => { e.preventDefault(); submit('decline') }}>
        <Field label="Reason" hint="Emailed to the applicant. Say what would get it approved, if anything." error={errors.note}>
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

function ApplicationCard({ application: a, onDone }: { application: ApplicationRow; onDone: (message: string) => void }) {
  return (
    <li className="space-y-4 rounded-xl border border-stone-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-lg font-semibold">{a.name}</p>
          <p className="text-sm text-stone-500">
            {a.kind_label}{a.location && ` · ${a.location}`} · applied {formatDate(a.created_at)}
          </p>
        </div>
        <Badge tone={TONE[a.status]}>{STATUS[a.status]}</Badge>
      </div>
      <dl className="grid gap-4 text-sm sm:grid-cols-2">
        <div>
          <dt className="eyebrow mb-1 text-stone-500">Applicant</dt>
          <dd className="font-semibold">{a.applicant.name || 'No name'}</dd>
          <dd className="text-stone-600">{a.applicant.email}{a.contact_phone && ` · ${a.contact_phone}`}</dd>
          {a.applicant.institution && <dd className="text-stone-500">{a.applicant.institution}</dd>}
        </div>
        {a.website && (
          <div>
            <dt className="eyebrow mb-1 text-stone-500">Website</dt>
            <dd><a href={a.website} target="_blank" rel="noreferrer" className="break-all font-semibold text-brand-700 hover:underline">{a.website}</a></dd>
          </div>
        )}
        <div className="sm:col-span-2">
          <dt className="eyebrow mb-1 text-stone-500">About</dt>
          <dd className="whitespace-pre-line text-stone-700">{a.about}</dd>
        </div>
        {a.plans && (
          <div className="sm:col-span-2">
            <dt className="eyebrow mb-1 text-stone-500">Plans</dt>
            <dd className="whitespace-pre-line text-stone-700">{a.plans}</dd>
          </div>
        )}
      </dl>
      {a.status === 'pending' ? (
        <Review application={a} onDone={onDone} />
      ) : (
        <div className="space-y-2 border-t border-stone-100 pt-3 text-sm text-stone-600">
          <p>{STATUS[a.status]} by {a.reviewed_by || 'a platform admin'}{a.reviewed_at && ` on ${formatDate(a.reviewed_at)}`}.</p>
          {a.review_note && <p className="rounded-lg bg-stone-50 px-3 py-2 text-stone-700">{a.review_note}</p>}
          {a.organization_id && a.status === 'approved' && (
            <Link to={`/platform/organizations/${encodeURIComponent(a.organization_id)}`} className="inline-block font-semibold text-brand-700 hover:underline">
              Open the organisation
            </Link>
          )}
        </div>
      )}
    </li>
  )
}

export default function Applications() {
  const applications = useQuery({ queryKey: ['platform', 'applications'], queryFn: () => api<ApplicationRow[]>('/platform/applications/') })
  const [filter, setFilter] = useState<Filter>('pending')
  const [done, setDone] = useState('')
  const all = applications.data ?? []
  const count = (f: Filter) => all.filter((a) => f === 'all' || a.status === f).length
  const rows = all.filter((a) => filter === 'all' || a.status === filter)

  return (
    <>
      <ConsoleHeader
        title="Applications"
        subtitle="Universities, companies, tech communities and groups asking to join. Approving one creates it in Keycloak with the applicant as its admin."
      />
      <div className="mb-4 space-y-3 empty:hidden">
        {done && <Notice>{done}</Notice>}
        <ErrorNote error={applications.error} />
      </div>
      {applications.data ? (
        <div className="space-y-4">
          <FilterChips
            current={filter}
            onChange={setFilter}
            options={[
              { id: 'pending', label: 'Waiting', count: count('pending') },
              { id: 'approved', label: 'Approved', count: count('approved') },
              { id: 'declined', label: 'Declined', count: count('declined') },
              { id: 'all', label: 'All', count: count('all') },
            ]}
          />
          {rows.length ? (
            <ul className="space-y-4">
              {rows.map((a) => <ApplicationCard key={a.id} application={a} onDone={setDone} />)}
            </ul>
          ) : (
            <Empty>{filter === 'pending' ? 'No applications are waiting. New ones appear here and on the overview.' : 'Nothing here.'}</Empty>
          )}
        </div>
      ) : (
        !applications.error && <Spinner />
      )}
    </>
  )
}
