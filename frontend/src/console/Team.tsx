/** Organisation admins choose who runs events and hackathons. */
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { api } from '../api'
import type { RoleAssignment, SentInvitation } from '../api'
import { DataTable } from '../components/DataTable'
import { PendingInvitations } from '../components/invitations'
import { Icon } from '../components/icons'
import { Badge, Button, Empty, ErrorNote, Field, Input, Select, Spinner, label } from '../components/ui'
import { useConfirm, useToast } from '../components/feedback'
import { useAct } from '../hooks'
import { Positions } from './Positions'
import { ConsoleHeader, FilterChips, Panel, useAccess } from './shared'

const ROLES = [
  { id: 'event_organiser', label: 'Event organiser', detail: 'Creates and runs events: registrations, check-in, announcements.' },
  { id: 'hackathon_manager', label: 'Hackathon manager', detail: 'Creates and runs hackathons: challenges, judges, results.' },
]

export function Team() {
  const { me } = useAccess()
  const organizations = me?.organizations.filter((o) => o.is_admin) ?? []
  const [selected, setSelected] = useState('')
  const organizationId = selected || organizations[0]?.id
  const roles = useQuery({
    queryKey: ['roles', organizationId],
    queryFn: () => api<RoleAssignment[]>(`/organizations/${organizationId}/roles/`),
    enabled: !!organizationId,
  })
  const invitations = useQuery({
    queryKey: ['roles', organizationId, 'invitations'],
    queryFn: () => api<SentInvitation[]>(`/organizations/${organizationId}/invitations/`),
    enabled: !!organizationId,
  })
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('event_organiser')
  const [show, setShow] = useState<'all' | 'event_organiser' | 'hackathon_manager'>('all')
  const grant = useAct(() => api(`/organizations/${organizationId}/roles/`, { method: 'POST', body: { email, role } }))
  const revoke = useAct((id: number) => api(`/organizations/${organizationId}/roles/${id}/`, { method: 'DELETE' }))
  const confirm = useConfirm()
  const toast = useToast()
  const removeRole = async (r: RoleAssignment) => {
    const role = label(r.role).toLowerCase()
    if (await confirm({ tone: 'danger', title: `Remove ${r.person.name}?`, message: `They will no longer be ${/^[aeiou]/.test(role) ? 'an' : 'a'} ${role} here.`, confirmLabel: 'Remove' })) {
      revoke.mutate(r.id, {
        onSuccess: () => toast({ title: 'Role removed', message: `${r.person.name} is no longer ${/^[aeiou]/.test(role) ? 'an' : 'a'} ${role}.` }),
        onError: (error) => toast({ tone: 'error', title: 'Could not remove the role', message: error.message }),
      })
    }
  }

  if (!me) return <Spinner />
  if (!organizations.length) return <Empty>You do not administer an organisation.</Empty>
  const current = organizations.find((o) => o.id === organizationId)
  const all = roles.data ?? []
  const rows = all.filter((r) => show === 'all' || r.role === show)
  const count = (id: string) => all.filter((r) => r.role === id).length

  return (
    <>
      <ConsoleHeader
        title="Team, positions and roles"
        subtitle="Invite people to run events and hackathons. Admins can do everything and are managed in Keycloak."
        actions={
          organizations.length > 1 && (
            <label className="flex items-center gap-2 text-sm">
              <span className="text-stone-600">Organisation</span>
              <Select value={organizationId} onChange={(e) => setSelected(e.target.value)} className="w-56">
                {organizations.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </Select>
            </label>
          )
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Positions key={organizationId} organizationId={current!.id} organizationName={current!.name} />
          <div className="overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-200 px-5 py-3">
              <h2 className="font-semibold">People at {current?.name}</h2>
              <FilterChips
                current={show}
                onChange={setShow}
                options={[
                  { id: 'all', label: 'All', count: all.length },
                  { id: 'event_organiser', label: 'Event organisers', count: count('event_organiser') },
                  { id: 'hackathon_manager', label: 'Hackathon managers', count: count('hackathon_manager') },
                ]}
              />
            </div>
            <div className="px-5 empty:hidden"><ErrorNote error={revoke.error ?? roles.error} /></div>
            {roles.isLoading ? (
              <Spinner />
            ) : (
              <DataTable
                rows={rows}
                columns={[
                  {
                    title: 'Name',
                    value: (r: RoleAssignment) => `${r.person.name} ${r.email}`,
                    cell: (r: RoleAssignment) => (
                      <>
                        <p className="font-semibold">{r.person.name}</p>
                        <p className="text-xs text-stone-500">{r.email}</p>
                      </>
                    ),
                    priority: 1,
                  },
                  { title: 'Role', value: (r: RoleAssignment) => label(r.role), cell: (r: RoleAssignment) => <Badge tone="blue">{label(r.role)}</Badge>, priority: 2 },
                  {
                    title: '',
                    value: () => '',
                    sortable: false,
                    align: 'right',
                    priority: 3,
                    cell: (r: RoleAssignment) => (
                      <Button variant="ghost" onClick={() => void removeRole(r)}>Remove</Button>
                    ),
                  },
                ]}
                order={[0, 'asc']}
                searchPlaceholder="Search people"
                empty="Nobody has been given a role yet."
              />
            )}
          </div>
        </div>
        <Panel title="Invite someone to a role">
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault()
              grant.mutate(undefined, {
                onSuccess: () => {
                  toast({ title: 'Invitation sent', message: `${email} gets the role once they accept.` })
                  setEmail('')
                },
              })
            }}
          >
            <Field label="Email" hint="Anyone with an email address. New people create an account, then accept.">
              <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <fieldset className="space-y-2">
              <legend className="mb-1 text-sm font-medium">Role</legend>
              {ROLES.map((r) => (
                <label key={r.id} className={`flex cursor-pointer gap-3 rounded-lg border p-3 ${role === r.id ? 'border-brand-600 bg-brand-50' : 'border-stone-200 hover:border-stone-300'}`}>
                  <input type="radio" name="role" value={r.id} checked={role === r.id} onChange={() => setRole(r.id)} className="mt-1 accent-brand-600" />
                  <span>
                    <span className="block text-sm font-semibold">{r.label}</span>
                    <span className="block text-xs text-stone-600">{r.detail}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            <ErrorNote error={grant.error} />
            <Button type="submit" disabled={grant.isPending} className="w-full"><Icon name="plus" className="h-4 w-4" />Send invitation</Button>
          </form>
          <div className="mt-5 empty:hidden"><PendingInvitations invitations={invitations.data ?? []} /></div>
        </Panel>
      </div>
    </>
  )
}
