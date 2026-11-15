import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { ApiError, api } from '../api'
import type { Hackathon } from '../api'
import {
  Button, Card, Empty, ErrorNote, Field, Input, PageHeader, Select, Spinner, Textarea,
  fromLocalInput, toLocalInput,
} from '../components/ui'
import { useAct, useMe } from '../hooks'

const blank = {
  organization_id: '',
  title: '',
  tagline: '',
  theme: '',
  description: '',
  rules: '',
  eligibility: '',
  prizes: '',
  venue: '',
  starts_at: '',
  ends_at: '',
  registration_deadline: '',
  submission_deadline: '',
  min_team_size: '1',
  max_team_size: '4',
}
const dates = ['starts_at', 'ends_at', 'registration_deadline', 'submission_deadline'] as const

/** Create a hackathon, or edit one when the URL carries its id. */
export default function HackathonForm() {
  const { id } = useParams()
  const navigate = useNavigate()
  const me = useMe()
  const organizations = me?.organizations.filter((o) => o.can_manage_hackathons) ?? []
  const existing = useQuery({
    queryKey: ['hackathon', id],
    queryFn: () => api<Hackathon>(`/hackathons/${id}/`),
    enabled: !!id,
  })
  const [form, setForm] = useState(blank)
  const set = (field: keyof typeof blank) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [field]: e.target.value }))

  useEffect(() => {
    const h = existing.data
    if (!h) return
    setForm({
      organization_id: h.organization.id,
      title: h.title,
      tagline: h.tagline,
      theme: h.theme,
      description: h.description,
      rules: h.rules,
      eligibility: h.eligibility,
      prizes: h.prizes,
      venue: h.venue,
      starts_at: toLocalInput(h.starts_at),
      ends_at: toLocalInput(h.ends_at),
      registration_deadline: toLocalInput(h.registration_deadline),
      submission_deadline: toLocalInput(h.submission_deadline),
      min_team_size: String(h.min_team_size),
      max_team_size: String(h.max_team_size),
    })
  }, [existing.data])

  const organizationId = form.organization_id || organizations[0]?.id || ''
  const save = useAct(() =>
    api<Hackathon>(id ? `/hackathons/${id}/` : '/hackathons/', {
      method: id ? 'PATCH' : 'POST',
      body: {
        ...form,
        organization_id: organizationId,
        ...Object.fromEntries(dates.map((d) => [d, fromLocalInput(form[d])])),
        min_team_size: Number(form.min_team_size),
        max_team_size: Number(form.max_team_size),
      },
    }),
  )
  const errors = save.error instanceof ApiError ? save.error.fields : {}

  if (!me || existing.isLoading) return <Spinner />
  if (!organizations.length) return <Empty>You do not manage hackathons for any organisation.</Empty>

  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate(undefined, { onSuccess: (h) => navigate(`/hackathons/${h.id}/manage`) })
  }

  return (
    <form onSubmit={submit} className="mx-auto max-w-3xl">
      <PageHeader
        title={id ? 'Edit hackathon' : 'Create hackathon'}
        subtitle={id ? undefined : 'It is saved as a draft. Add challenges and judging criteria, then publish.'}
      />
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
        <Field label="Tagline" hint="One sentence shown on the hackathons list.">
          <Input maxLength={300} value={form.tagline} onChange={set('tagline')} />
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Theme"><Input maxLength={200} value={form.theme} onChange={set('theme')} /></Field>
          <Field label="Venue" hint="Leave empty if it is online."><Input value={form.venue} onChange={set('venue')} /></Field>
        </div>
        <Field label="Description"><Textarea rows={6} value={form.description} onChange={set('description')} /></Field>
        <Field label="Rules"><Textarea value={form.rules} onChange={set('rules')} /></Field>
        <Field label="Who can take part"><Textarea rows={2} value={form.eligibility} onChange={set('eligibility')} /></Field>
        <Field label="Prizes"><Textarea rows={2} value={form.prizes} onChange={set('prizes')} /></Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Starts" error={errors.starts_at}>
            <Input type="datetime-local" required value={form.starts_at} onChange={set('starts_at')} />
          </Field>
          <Field label="Ends" error={errors.ends_at}>
            <Input type="datetime-local" required value={form.ends_at} onChange={set('ends_at')} />
          </Field>
          <Field label="Registration closes" hint="No new teams or members after this." error={errors.registration_deadline}>
            <Input type="datetime-local" required value={form.registration_deadline} onChange={set('registration_deadline')} />
          </Field>
          <Field label="Submissions close" error={errors.submission_deadline}>
            <Input type="datetime-local" required value={form.submission_deadline} onChange={set('submission_deadline')} />
          </Field>
          <Field label="Smallest team" hint="1 lets people take part alone." error={errors.min_team_size}>
            <Input type="number" min={1} required value={form.min_team_size} onChange={set('min_team_size')} />
          </Field>
          <Field label="Largest team" error={errors.max_team_size}>
            <Input type="number" min={1} required value={form.max_team_size} onChange={set('max_team_size')} />
          </Field>
        </div>
        <ErrorNote error={save.error} />
        <div className="flex gap-3">
          <Button type="submit" disabled={save.isPending}>{id ? 'Save changes' : 'Save draft'}</Button>
          <Button variant="secondary" onClick={() => navigate(-1)}>Cancel</Button>
        </div>
      </Card>
    </form>
  )
}
