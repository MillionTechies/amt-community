import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { api } from '../api'
import type { RoleAssignment } from '../api'
import { Badge, Button, Empty, ErrorNote, Field, Input, Notice, PageHeader, Section, Select, Spinner, label } from '../components/ui'
import { useAct, useMe } from '../hooks'

/** An organisation's admins choose who may run its events and hackathons. */
export default function Organization() {
  const me = useMe()
  const organizations = me?.organizations.filter((o) => o.is_admin) ?? []
  const [selected, setSelected] = useState('')
  const organizationId = selected || organizations[0]?.id
  const roles = useQuery({
    queryKey: ['roles', organizationId],
    queryFn: () => api<RoleAssignment[]>(`/organizations/${organizationId}/roles/`),
    enabled: !!organizationId,
  })
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('event_organiser')
  const grant = useAct(() => api(`/organizations/${organizationId}/roles/`, { method: 'POST', body: { email, role } }))
  const revoke = useAct((id: number) => api(`/organizations/${organizationId}/roles/${id}/`, { method: 'DELETE' }))
  const sync = useAct(() => api<{ organizations: number }>('/organizations/sync/', { method: 'POST' }))

  if (!me) return <Spinner />
  if (!organizations.length) return <Empty>You do not administer an organisation.</Empty>
  const current = organizations.find((o) => o.id === organizationId)

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Organisation" subtitle="Choose who can run events and hackathons." />
      {organizations.length > 1 && (
        <Field label="Organisation">
          <Select value={organizationId} onChange={(e) => setSelected(e.target.value)}>
            {organizations.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </Select>
        </Field>
      )}
      <Section title={`Roles at ${current?.name}`}>
        <p className="mb-4 text-sm text-stone-600">
          Admins can do everything. Event organisers create and run events. Hackathon managers
          create and run hackathons. Admins are managed in Keycloak.
        </p>
        <form
          className="mb-4 grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault()
            grant.mutate(undefined, { onSuccess: () => setEmail('') })
          }}
        >
          <Field label="Member's email"><Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Field label="Role">
            <Select value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="event_organiser">Event organiser</option>
              <option value="hackathon_manager">Hackathon manager</option>
            </Select>
          </Field>
          <Button type="submit" disabled={grant.isPending}>Give role</Button>
        </form>
        <ErrorNote error={grant.error ?? revoke.error ?? roles.error} />
        {roles.data?.length ? (
          <ul className="divide-y divide-stone-200">
            {roles.data.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div>
                  <p className="font-semibold">{r.person.name}</p>
                  <p className="text-sm text-stone-600">{r.email}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone="blue">{label(r.role)}</Badge>
                  <Button variant="ghost" onClick={() => revoke.mutate(r.id)}>Remove</Button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          roles.data && <p className="text-stone-600">Nobody has been given a role yet.</p>
        )}
      </Section>
      {me.is_platform_admin && (
        <Section title="Platform">
          <p className="mb-3 text-sm text-stone-600">
            Organisations and their members are kept in Keycloak. Refresh Community's copy after
            adding or changing an organisation there.
          </p>
          <ErrorNote error={sync.error} />
          {sync.data && <div className="mb-3"><Notice>Refreshed {sync.data.organizations} organisations.</Notice></div>}
          <Button variant="secondary" disabled={sync.isPending} onClick={() => sync.mutate()}>Refresh organisations from Keycloak</Button>
        </Section>
      )}
    </div>
  )
}
