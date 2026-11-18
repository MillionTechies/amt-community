import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { ApiError, api } from '../api'
import type { CommunityEvent } from '../api'
import {
  Button, Card, Empty, ErrorNote, Field, Input, PageHeader, Select, Spinner, Textarea,
  fromLocalInput, toLocalInput,
} from '../components/ui'
import { useAct, useMe } from '../hooks'
import { EVENT_TYPES, EVENT_TYPE_LABELS } from './Events'

const blank = {
  organization_id: '',
  title: '',
  summary: '',
  description: '',
  event_type: 'workshop',
  delivery_mode: 'in_person',
  venue: '',
  online_url: '',
  starts_at: '',
  ends_at: '',
  registration_deadline: '',
  capacity: '',
  eligibility: '',
}

/** Create an event, or edit one when the URL carries its id. */
export default function EventForm() {
  const { id } = useParams()
  const navigate = useNavigate()
  const me = useMe()
  const organizations = me?.organizations.filter((o) => o.can_manage_events) ?? []
  const existing = useQuery({
    queryKey: ['event', id],
    queryFn: () => api<CommunityEvent>(`/events/${id}/`),
    enabled: !!id,
  })
  const [form, setForm] = useState(blank)
  const set = (field: keyof typeof blank) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [field]: e.target.value }))

  useEffect(() => {
    const e = existing.data
    if (!e) return
    setForm({
      organization_id: e.organization.id,
      title: e.title,
      summary: e.summary,
      description: e.description,
      event_type: e.event_type,
      delivery_mode: e.delivery_mode,
      venue: e.venue,
      online_url: e.online_url,
      starts_at: toLocalInput(e.starts_at),
      ends_at: toLocalInput(e.ends_at),
      registration_deadline: toLocalInput(e.registration_deadline),
      capacity: e.capacity === null ? '' : String(e.capacity),
      eligibility: e.eligibility,
    })
  }, [existing.data])

  const organizationId = form.organization_id || organizations[0]?.id || ''
  const save = useAct(() =>
    api<CommunityEvent>(id ? `/events/${id}/` : '/events/', {
      method: id ? 'PATCH' : 'POST',
      body: {
        ...form,
        organization_id: organizationId,
        starts_at: fromLocalInput(form.starts_at),
        ends_at: fromLocalInput(form.ends_at),
        registration_deadline: fromLocalInput(form.registration_deadline),
        capacity: form.capacity === '' ? null : Number(form.capacity),
      },
    }),
  )
  const errors = save.error instanceof ApiError ? save.error.fields : {}

  if (!me || existing.isLoading) return <Spinner />
  if (!organizations.length) return <Empty>You do not organise events for any organisation.</Empty>

  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate(undefined, { onSuccess: (event) => navigate(`/manage/events/${event.id}`) })
  }
  const online = form.delivery_mode !== 'in_person'
  const inPerson = form.delivery_mode !== 'online'

  return (
    <form onSubmit={submit} className="max-w-3xl">
      {/* When editing, the console's workspace header already names the event. */}
      {!id && <PageHeader title="Create event" subtitle='It is saved as a draft. Publish it when you are ready.' />}
      <Card className="space-y-5">
        {!id && organizations.length > 1 && (
          <Field label="Organisation">
            <Select value={organizationId} onChange={set('organization_id')}>
              {organizations.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </Select>
          </Field>
        )}
        <Field label="Title" error={errors.title}>
          <Input required maxLength={200} value={form.title} onChange={set('title')} />
        </Field>
        <Field label="Summary" hint="One or two sentences shown on the events list." error={errors.summary}>
          <Input maxLength={300} value={form.summary} onChange={set('summary')} />
        </Field>
        <Field label="Description" error={errors.description}>
          <Textarea rows={6} value={form.description} onChange={set('description')} />
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Type">
            <Select value={form.event_type} onChange={set('event_type')}>
              {EVENT_TYPES.map((t) => <option key={t} value={t}>{EVENT_TYPE_LABELS[t]}</option>)}
            </Select>
          </Field>
          <Field label="How people attend">
            <Select value={form.delivery_mode} onChange={set('delivery_mode')}>
              <option value="in_person">In person</option>
              <option value="online">Online</option>
              <option value="hybrid">Hybrid</option>
            </Select>
          </Field>
          <Field label="Starts" error={errors.starts_at}>
            <Input type="datetime-local" required value={form.starts_at} onChange={set('starts_at')} />
          </Field>
          <Field label="Ends" error={errors.ends_at}>
            <Input type="datetime-local" required value={form.ends_at} onChange={set('ends_at')} />
          </Field>
          {inPerson && (
            <Field label="Venue" error={errors.venue}>
              <Input value={form.venue} onChange={set('venue')} />
            </Field>
          )}
          {online && (
            <Field label="Meeting link" hint="Only shown to people who register." error={errors.online_url}>
              <Input type="url" placeholder="https://" value={form.online_url} onChange={set('online_url')} />
            </Field>
          )}
          <Field label="Places" hint="Leave empty for no limit. Extra people join a waiting list." error={errors.capacity}>
            <Input type="number" min={1} value={form.capacity} onChange={set('capacity')} />
          </Field>
          <Field label="Registration closes" hint="Leave empty to keep it open until the event ends." error={errors.registration_deadline}>
            <Input type="datetime-local" value={form.registration_deadline} onChange={set('registration_deadline')} />
          </Field>
        </div>
        <Field label="Who can attend" hint="Optional. For example: second-year students and above.">
          <Textarea rows={2} value={form.eligibility} onChange={set('eligibility')} />
        </Field>
        <ErrorNote error={save.error} />
        <div className="flex gap-3">
          <Button type="submit" disabled={save.isPending}>{id ? 'Save changes' : 'Save draft'}</Button>
          <Button variant="secondary" onClick={() => navigate(-1)}>Cancel</Button>
        </div>
      </Card>
    </form>
  )
}
