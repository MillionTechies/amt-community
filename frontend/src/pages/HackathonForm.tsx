import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { ApiError, api } from '../api'
import type { Hackathon, Prize } from '../api'
import {
  Button, Card, Empty, ErrorNote, Field, Input, PageHeader, Select, Spinner, Textarea,
  fromLocalInput, toLocalInput,
} from '../components/ui'
import { Icon } from '../components/icons'
import { CoverField } from '../components/CoverField'
import { RichTextEditor } from '../components/RichTextEditor'
import { useAct, useMe } from '../hooks'

const blank = {
  organization_id: '',
  title: '',
  tagline: '',
  cover_image: '',
  theme: '',
  description: '',
  rules: '',
  eligibility: '',
  venue: '',
  starts_at: '',
  ends_at: '',
  registration_deadline: '',
  submission_deadline: '',
  min_team_size: '1',
  max_team_size: '4',
}
const emptyPrize = (): Prize => ({ title: '', value: '' })

/** Prize rows: a title (Winner, Runner-up, Best design) and what it is worth. */
function PrizeList({ prizes, onChange, error }: { prizes: Prize[]; onChange: (prizes: Prize[]) => void; error?: string }) {
  const update = (i: number, field: keyof Prize, value: string) =>
    onChange(prizes.map((p, j) => (j === i ? { ...p, [field]: value } : p)))
  return (
    <div role="group" aria-label="Prizes">
      <span className="mb-1.5 block font-mono text-xs font-semibold uppercase tracking-wider text-stone-700">Prizes</span>
      <div className="space-y-2">
        {prizes.map((p, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="w-6 shrink-0 text-center font-mono text-xs font-semibold text-stone-500">{i + 1}</span>
            <Input
              aria-label={`Prize ${i + 1} title`}
              placeholder={i === 0 ? 'Winner' : i === 1 ? 'Runner-up' : 'Title'}
              maxLength={100}
              value={p.title}
              onChange={(e) => update(i, 'title', e.target.value)}
            />
            <Input
              aria-label={`Prize ${i + 1} value`}
              placeholder={i === 0 ? 'KES 60,000' : 'Value'}
              maxLength={100}
              className="sm:max-w-48"
              value={p.value}
              onChange={(e) => update(i, 'value', e.target.value)}
            />
            <button
              type="button"
              aria-label={`Remove prize ${i + 1}`}
              className="shrink-0 rounded-lg p-2 text-stone-500 hover:bg-red-50 hover:text-red-700"
              onClick={() => onChange(prizes.filter((_, j) => j !== i))}
            >
              <Icon name="close" className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
      <Button variant="ghost" className="mt-2 px-2" onClick={() => onChange([...prizes, emptyPrize()])}>
        <Icon name="plus" className="h-4 w-4" />
        Add prize
      </Button>
      {error ? (
        <p role="alert" className="mt-1 text-xs text-red-700">{error}</p>
      ) : (
        <p className="mt-1 text-xs text-stone-500">List them in order, top prize first. Leave the list empty if there are no prizes.</p>
      )}
    </div>
  )
}

const dates = ['starts_at', 'ends_at', 'registration_deadline', 'submission_deadline'] as const

/** Create a hackathon, or edit one when the URL carries its id. */
export default function HackathonForm() {
  const { slug } = useParams()
  const navigate = useNavigate()
  const me = useMe()
  const organizations = me?.organizations.filter((o) => o.can_manage_hackathons) ?? []
  const existing = useQuery({
    queryKey: ['hackathon', slug],
    queryFn: () => api<Hackathon>(`/hackathons/${slug}/`),
    enabled: !!slug,
  })
  const [form, setForm] = useState(blank)
  const [prizes, setPrizes] = useState<Prize[]>([emptyPrize()])
  const [listed, setListed] = useState(true)
  const set = (field: keyof typeof blank) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [field]: e.target.value }))

  useEffect(() => {
    const h = existing.data
    if (!h) return
    setForm({
      organization_id: h.organization.id,
      title: h.title,
      tagline: h.tagline,
      cover_image: h.cover_image,
      theme: h.theme,
      description: h.description,
      rules: h.rules,
      eligibility: h.eligibility,
      venue: h.venue,
      starts_at: toLocalInput(h.starts_at),
      ends_at: toLocalInput(h.ends_at),
      registration_deadline: toLocalInput(h.registration_deadline),
      submission_deadline: toLocalInput(h.submission_deadline),
      min_team_size: String(h.min_team_size),
      max_team_size: String(h.max_team_size),
    })
    setPrizes(h.prizes.length ? h.prizes : [emptyPrize()])
    setListed(h.listed)
  }, [existing.data])

  const organizationId = form.organization_id || organizations[0]?.id || ''
  const save = useAct(() =>
    api<Hackathon>(slug ? `/hackathons/${slug}/` : '/hackathons/', {
      method: slug ? 'PATCH' : 'POST',
      body: {
        ...form,
        prizes,
        listed,
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
    save.mutate(undefined, { onSuccess: (h) => navigate(`/manage/hackathons/${h.slug}`) })
  }

  return (
    <form onSubmit={submit} className="max-w-3xl">
      {/* When editing, the console's workspace header already names the hackathon. */}
      {!slug && <PageHeader title="Create hackathon" subtitle='It is saved as a draft. Add challenges and judging criteria, then publish.' />}
      <Card className="space-y-5">
        {!slug && organizations.length > 1 && (
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
        <CoverField value={form.cover_image} onChange={(cover_image) => setForm((f) => ({ ...f, cover_image }))} kind="hackathon" title={form.title} />
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Theme"><Input maxLength={200} value={form.theme} onChange={set('theme')} /></Field>
          <Field label="Venue" hint="Leave empty if it is online."><Input value={form.venue} onChange={set('venue')} /></Field>
        </div>
        <Field label="Description" error={errors.description} group hint="Headings, text sizes, lists, links, images and YouTube videos.">
          <RichTextEditor value={form.description} onChange={(description) => setForm((f) => ({ ...f, description }))} placeholder="The challenge, the schedule, what teams will build…" />
        </Field>
        <Field label="Rules"><Textarea value={form.rules} onChange={set('rules')} /></Field>
        <Field label="Who can take part"><Textarea rows={2} value={form.eligibility} onChange={set('eligibility')} /></Field>
        <PrizeList prizes={prizes} onChange={setPrizes} error={errors.prizes} />
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
        <label className="flex cursor-pointer items-start gap-3">
          <input type="checkbox" className="mt-1 accent-brand-600" checked={listed} onChange={(e) => setListed(e.target.checked)} />
          <span>
            <span className="block text-sm font-semibold">Listed publicly</span>
            <span className="block text-sm text-stone-600">Untick for a private hackathon: it stays off the hackathons list, and people join with its 6-digit code or link.</span>
          </span>
        </label>
        <ErrorNote error={save.error} />
        <div className="flex gap-3">
          <Button type="submit" disabled={save.isPending}>{slug ? 'Save changes' : 'Save draft'}</Button>
          <Button variant="secondary" onClick={() => navigate(-1)}>Cancel</Button>
        </div>
      </Card>
    </form>
  )
}
