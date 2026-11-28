/** An organisation's leadership: its positions, who holds them, and the roles they carry. */
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { api } from '../api'
import type { Position } from '../api'
import { useConfirm, useToast } from '../components/feedback'
import { Icon } from '../components/icons'
import { PendingInvitations } from '../components/invitations'
import { Badge, Button, ErrorNote, Field, Input, Spinner, label } from '../components/ui'
import { useAct } from '../hooks'

const ROLE_IDS = ['event_organiser', 'hackathon_manager']
const SUGGESTED = ['Chairperson', 'Vice chairperson', 'Secretary', 'Organising secretary', 'Treasurer', 'Patron', 'Publicity lead', 'Technical lead']

type Draft = Pick<Position, 'title' | 'roles' | 'is_public'>

/** Title, roles and visibility, for a new position or an existing one. */
function PositionForm({ initial, submitLabel, onSubmit, onCancel, error, busy }: {
  initial: Draft
  submitLabel: string
  onSubmit: (draft: Draft) => void
  onCancel?: () => void
  error: unknown
  busy: boolean
}) {
  const [draft, setDraft] = useState(initial)
  const toggleRole = (role: string) =>
    setDraft((d) => ({ ...d, roles: d.roles.includes(role) ? d.roles.filter((r) => r !== role) : [...d.roles, role] }))
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit(draft)
      }}
    >
      <Field label="Title">
        <Input required maxLength={100} list="position-titles" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
      </Field>
      <datalist id="position-titles">{SUGGESTED.map((t) => <option key={t} value={t} />)}</datalist>
      <fieldset>
        <legend className="mb-1 text-sm font-medium">Comes with</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-1">
          {ROLE_IDS.map((role) => (
            <label key={role} className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="accent-brand-600" checked={draft.roles.includes(role)} onChange={() => toggleRole(role)} />
              {label(role)}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="accent-brand-600" checked={draft.is_public} onChange={(e) => setDraft({ ...draft, is_public: e.target.checked })} />
        Show on the organisation's public page
      </label>
      <ErrorNote error={error} />
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>{submitLabel}</Button>
        {onCancel && <Button variant="ghost" onClick={onCancel}>Cancel</Button>}
      </div>
    </form>
  )
}

function PositionRow({ position: p, base }: { position: Position; base: string }) {
  const toast = useToast()
  const confirm = useConfirm()
  const [mode, setMode] = useState<'view' | 'edit' | 'invite'>('view')
  const [email, setEmail] = useState('')
  const save = useAct((draft: Draft) => api(`${base}${p.id}/`, { method: 'PATCH', body: draft }))
  const invite = useAct(() => api(`${base}${p.id}/invite/`, { method: 'POST', body: { email } }))
  const vacate = useAct(() => api(`${base}${p.id}/vacate/`, { method: 'POST' }))
  const remove = useAct(() => api(`${base}${p.id}/`, { method: 'DELETE' }))

  if (mode === 'edit') {
    return (
      <li className="px-5 py-4">
        <PositionForm
          initial={{ title: p.title, roles: p.roles, is_public: p.is_public }}
          submitLabel="Save"
          busy={save.isPending}
          error={save.error}
          onCancel={() => setMode('view')}
          onSubmit={(draft) => save.mutate(draft, { onSuccess: () => setMode('view') })}
        />
      </li>
    )
  }
  return (
    <li className="space-y-3 px-5 py-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-semibold">
            {p.title} {!p.is_public && <Badge>Not public</Badge>}
          </p>
          <p className="text-sm text-stone-600">
            {p.holder ? <>{p.holder.name} <span className="text-stone-400">· {p.holder_email}</span></> : 'Vacant'}
          </p>
          <p className="mt-1 flex flex-wrap gap-1">
            {p.roles.length ? p.roles.map((r) => <Badge key={r} tone="blue">{label(r)}</Badge>) : <span className="text-xs text-stone-500">No console roles</span>}
          </p>
        </div>
        <div className="flex flex-wrap gap-1">
          <Button variant="secondary" onClick={() => setMode(mode === 'invite' ? 'view' : 'invite')}>{p.holder ? 'Change' : 'Invite'}</Button>
          {p.holder && (
            <Button
              variant="ghost"
              onClick={async () => {
                if (await confirm({ tone: 'danger', title: `Vacate ${p.title}?`, message: `${p.holder?.name} loses the roles that come with it.`, confirmLabel: 'Vacate' }))
                  vacate.mutate(undefined, { onSuccess: () => toast({ title: `${p.title} is vacant` }) })
              }}
            >
              Vacate
            </Button>
          )}
          <Button variant="ghost" onClick={() => setMode('edit')}>Edit</Button>
          <Button
            variant="ghost"
            onClick={async () => {
              if (await confirm({ tone: 'danger', title: `Remove ${p.title}?`, message: 'Whoever holds it loses the roles that come with it.', confirmLabel: 'Remove' }))
                remove.mutate(undefined, { onSuccess: () => toast({ title: `${p.title} removed` }) })
            }}
          >
            Remove
          </Button>
        </div>
      </div>
      <ErrorNote error={vacate.error ?? remove.error} />
      {p.invitation && <PendingInvitations invitations={[p.invitation]} />}
      {mode === 'invite' && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            invite.mutate(undefined, {
              onSuccess: () => {
                toast({ title: 'Invitation sent', message: `${email} becomes ${p.title} once they accept.` })
                setEmail('')
                setMode('view')
              },
            })
          }}
        >
          <div className="min-w-48 flex-1">
            <Field label={`Email of the new ${p.title.toLowerCase()}`} hint="They do not need an account yet.">
              <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
          </div>
          <Button type="submit" disabled={invite.isPending}>Send invitation</Button>
          <div className="w-full empty:hidden"><ErrorNote error={invite.error} /></div>
        </form>
      )}
    </li>
  )
}

export function Positions({ organizationId, organizationName }: { organizationId: string; organizationName: string }) {
  const base = `/organizations/${organizationId}/positions/`
  const toast = useToast()
  const [adding, setAdding] = useState(false)
  const positions = useQuery({ queryKey: ['positions', organizationId], queryFn: () => api<Position[]>(base) })
  const committee = useAct(() => api(`${base}committee/`, { method: 'POST' }))
  const create = useAct((draft: Draft) => api(base, { method: 'POST', body: draft }))
  const list = positions.data ?? []
  return (
    <section className="overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-200 px-5 py-3">
        <div>
          <h2 className="font-semibold">Leadership at {organizationName}</h2>
          <p className="text-sm text-stone-600">Positions such as chairperson and secretary. Holders get the roles that come with them.</p>
        </div>
        {!adding && <Button variant="secondary" onClick={() => setAdding(true)}><Icon name="plus" className="h-4 w-4" />Add a position</Button>}
      </div>
      {positions.isLoading ? (
        <Spinner />
      ) : (
        <>
          <div className="px-5 empty:hidden"><ErrorNote error={positions.error ?? committee.error} /></div>
          {adding && (
            <div className="border-b border-stone-200 px-5 py-4">
              <PositionForm
                initial={{ title: '', roles: [], is_public: true }}
                submitLabel="Add position"
                busy={create.isPending}
                error={create.error}
                onCancel={() => setAdding(false)}
                onSubmit={(draft) => create.mutate(draft, { onSuccess: () => setAdding(false) })}
              />
            </div>
          )}
          {list.length ? (
            <ul className="divide-y divide-stone-100">{list.map((p) => <PositionRow key={p.id} position={p} base={base} />)}</ul>
          ) : (
            <div className="px-5 py-8 text-center">
              <p className="mb-3 text-sm text-stone-600">No positions yet. Most clubs start with a chairperson, vice chairperson, secretaries and a treasurer.</p>
              <Button
                disabled={committee.isPending}
                onClick={() => committee.mutate(undefined, { onSuccess: () => toast({ title: 'Committee added', message: 'Invite someone to each position, or edit them first.' }) })}
              >
                Add the usual committee
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  )
}
