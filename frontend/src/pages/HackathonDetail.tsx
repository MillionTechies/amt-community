import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { useAuth } from 'react-oidc-context'
import { useParams, useSearchParams } from 'react-router-dom'

import { ApiError, api } from '../api'
import type { Hackathon, JudgedSubmission, LeaderboardRow, MyTeam } from '../api'
import { Leaderboard, ProjectLinks } from '../components/hackathon'
import {
  Badge, Button, Card, ErrorNote, Field, Input, LinkButton, Notice, Prose, Section, Select, Spinner,
  StatusBadge, Textarea, formatDateTime,
} from '../components/ui'
import { RichText } from '../components/RichText'
import { useAct, useSignIn } from '../hooks'

export default function HackathonDetail() {
  const { slug } = useParams()
  const hackathon = useQuery({ queryKey: ['hackathon', slug], queryFn: () => api<Hackathon>(`/hackathons/${slug}/`) })
  if (hackathon.isLoading) return <Spinner />
  if (!hackathon.data) return <ErrorNote error={hackathon.error ?? 'Hackathon not found.'} />
  const h = hackathon.data

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <div>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <StatusBadge status={h.status} />
            {h.theme && <Badge tone="blue">{h.theme}</Badge>}
          </div>
          <h1 className="text-3xl font-bold tracking-tight">{h.title}</h1>
          <p className="mt-1 text-stone-600">Hosted by {h.organization.name}</p>
          {h.tagline && <p className="mt-3 text-lg text-stone-700">{h.tagline}</p>}
        </div>
        {h.status === 'cancelled' && <Notice tone="amber">This hackathon has been cancelled.</Notice>}
        {h.status === 'judging' && <Notice tone="amber">Submissions are closed and the judges are scoring projects.</Notice>}
        {h.results_published && <Results id={h.slug} />}
        {h.description && <Section title="About"><RichText html={h.description} /></Section>}
        {!!h.challenges.length && (
          <Section title="Challenges">
            <ul className="space-y-4">
              {h.challenges.map((c) => (
                <li key={c.id}>
                  <p className="font-semibold">{c.title}</p>
                  {c.description && <Prose>{c.description}</Prose>}
                </li>
              ))}
            </ul>
          </Section>
        )}
        {h.rules && <Section title="Rules"><Prose>{h.rules}</Prose></Section>}
        {h.eligibility && <Section title="Who can take part"><Prose>{h.eligibility}</Prose></Section>}
        {!!h.prizes.length && (
          <Section title="Prizes">
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {h.prizes.map((p, i) => (
                <li
                  key={i}
                  className={`rounded-lg border p-4 ${i === 0 ? 'border-amber-300 bg-amber-50' : 'border-stone-200 bg-stone-50'}`}
                >
                  <p className={`font-mono text-xs font-semibold uppercase tracking-wider ${i === 0 ? 'text-amber-800' : 'text-stone-600'}`}>
                    {p.title}
                  </p>
                  {p.value && <p className="mt-1 font-mono text-xl font-bold tabular-nums tracking-tight">{p.value}</p>}
                </li>
              ))}
            </ul>
          </Section>
        )}
        {!!h.criteria.length && (
          <Section title="How projects are judged">
            <ul className="divide-y divide-stone-200">
              {h.criteria.map((c) => (
                <li key={c.id} className="flex items-start justify-between gap-4 py-2">
                  <div>
                    <p className="font-semibold">{c.name}</p>
                    {c.description && <p className="text-sm text-stone-600">{c.description}</p>}
                  </div>
                  <span className="shrink-0 text-sm text-stone-600">
                    Out of {c.max_score}{c.weight > 1 && `, counts ${c.weight} times`}
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        )}
      </div>

      <aside className="space-y-4">
        <Card className="space-y-3">
          <Detail label="Starts">{formatDateTime(h.starts_at)}</Detail>
          <Detail label="Ends">{formatDateTime(h.ends_at)}</Detail>
          <Detail label="Register by">{formatDateTime(h.registration_deadline)}</Detail>
          <Detail label="Submit by">{formatDateTime(h.submission_deadline)}</Detail>
          <Detail label="Where">{h.venue || 'Online'}</Detail>
          <Detail label="Team size">
            {h.min_team_size === h.max_team_size
              ? `${h.max_team_size} ${h.max_team_size === 1 ? 'person' : 'people'}`
              : `${h.min_team_size} to ${h.max_team_size} people`}
          </Detail>
          <Detail label="So far">
            {count(h.participant_count, 'participant')} in {count(h.team_count, 'team')},{' '}
            {count(h.submission_count, 'project')} submitted
          </Detail>
        </Card>
        {h.is_judge ? (
          <Card className="space-y-3">
            <p className="text-sm font-semibold">You are a judge</p>
            <p className="text-sm text-stone-600">
              {h.status === 'judging' ? 'Scoring is open.' : h.status === 'published' ? 'Scoring opens when submissions close.' : 'Judging is over.'}
            </p>
            <LinkButton to={`/hackathons/${h.slug}/judge`}>Go to judging</LinkButton>
          </Card>
        ) : (
          <TeamPanel hackathon={h} />
        )}
        {h.can_manage && (
          <Card className="space-y-3">
            <p className="text-sm font-semibold">You manage this hackathon</p>
            <div className="flex flex-wrap gap-2">
              <LinkButton to={`/manage/hackathons/${h.slug}`}>Manage</LinkButton>
              <LinkButton to={`/manage/hackathons/${h.slug}/edit`} variant="secondary">Edit details</LinkButton>
            </div>
          </Card>
        )}
      </aside>
    </div>
  )
}

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-stone-500">{label}</div>
      <div className="text-sm">{children}</div>
    </div>
  )
}

function Results({ id }: { id: string }) {
  const board = useQuery({
    queryKey: ['hackathon', id, 'leaderboard'],
    queryFn: () => api<LeaderboardRow[]>(`/hackathons/${id}/leaderboard/`),
  })
  const projects = useQuery({
    queryKey: ['hackathon', id, 'submissions'],
    queryFn: () => api<JudgedSubmission[]>(`/hackathons/${id}/submissions/`),
  })
  return (
    <>
      <Section title="Results">
        {board.data ? (board.data.length ? <Leaderboard rows={board.data} /> : <p className="text-stone-600">No projects were submitted.</p>) : <Spinner />}
      </Section>
      {!!projects.data?.length && (
        <Section title="Project showcase">
          <ul className="space-y-5">
            {projects.data.map((p) => (
              <li key={p.id}>
                <p className="font-semibold">{p.title}</p>
                <p className="text-sm text-stone-600">{p.team_name}: {p.members.join(', ')}</p>
                <Prose>{p.description}</Prose>
                <ProjectLinks submission={p} />
              </li>
            ))}
          </ul>
        </Section>
      )}
    </>
  )
}

/** Taking part: create or join a team, see it, and submit the project. */
function TeamPanel({ hackathon: h }: { hackathon: Hackathon }) {
  const auth = useAuth()
  const signIn = useSignIn()
  const [searchParams] = useSearchParams()
  const [name, setName] = useState('')
  const [code, setCode] = useState(searchParams.get('join') ?? '')
  const team = useQuery({
    queryKey: ['hackathon', h.slug, 'my-team'],
    queryFn: () => api<MyTeam>(`/hackathons/${h.slug}/my-team/`),
    enabled: !!h.my_team_id,
  })
  const create = useAct(() => api(`/hackathons/${h.slug}/teams/`, { method: 'POST', body: { name } }))
  const join = useAct(() => api(`/hackathons/${h.slug}/teams/join/`, { method: 'POST', body: { invite_code: code.trim() } }))
  const leave = useAct(() => api(`/hackathons/${h.slug}/my-team/leave/`, { method: 'POST' }))
  const remove = useAct((member: number) => api(`/hackathons/${h.slug}/my-team/members/${member}/`, { method: 'DELETE' }))
  const [copied, setCopied] = useState(false)

  if (h.my_team_id) {
    if (!team.data) return <Card><Spinner /></Card>
    const t = team.data
    const me = t.members.find((m) => m.person.sub === auth.user?.profile.sub)
    const link = `${window.location.origin}/hackathons/${h.slug}?join=${t.invite_code}`
    const canChange = h.status === 'published'
    return (
      <>
        <Card className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">Your team</p>
          <p className="text-lg font-semibold">{t.name}</p>
          <ul className="space-y-2">
            {t.members.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2 text-sm">
                <span>{m.person.name} {m.is_leader && <Badge tone="green">Leader</Badge>}</span>
                {me?.is_leader && !m.is_leader && canChange && (
                  <Button variant="ghost" onClick={() => window.confirm(`Remove ${m.person.name} from the team?`) && remove.mutate(m.id)}>Remove</Button>
                )}
              </li>
            ))}
          </ul>
          {h.registration_open && t.members.length < h.max_team_size && (
            <div className="space-y-2 border-t border-stone-200 pt-3">
              <p className="text-sm text-stone-600">
                Invite up to {h.max_team_size - t.members.length} more. Share this link:
              </p>
              <Input readOnly value={link} aria-label="Invite link" onFocus={(e) => e.target.select()} />
              <Button
                variant="secondary"
                className="w-full"
                onClick={() => void navigator.clipboard.writeText(link).then(() => setCopied(true))}
              >
                {copied ? 'Link copied' : 'Copy invite link'}
              </Button>
            </div>
          )}
          {t.members.length < h.min_team_size && (
            <Notice tone="amber">You need {h.min_team_size} members before you can submit.</Notice>
          )}
          <ErrorNote error={leave.error ?? remove.error} />
          {canChange && (
            <Button
              variant="danger"
              className="w-full"
              onClick={() => window.confirm(t.members.length === 1 ? 'Leave? Your team and its submission will be deleted.' : 'Leave this team?') && leave.mutate()}
            >
              Leave team
            </Button>
          )}
        </Card>
        <SubmissionForm hackathon={h} team={t} />
      </>
    )
  }

  if (!h.registration_open) {
    return (
      <Card>
        <p className="text-sm text-stone-600">
          {h.status === 'published' ? 'Registration is closed.' : 'This hackathon is not taking registrations.'}
        </p>
      </Card>
    )
  }
  if (!auth.isAuthenticated) {
    return (
      <Card className="space-y-3">
        <p className="text-sm text-stone-600">Sign in to create a team or join one.</p>
        <Button className="w-full" onClick={signIn}>Sign in to take part</Button>
      </Card>
    )
  }
  const submit = (action: typeof create) => (e: FormEvent) => {
    e.preventDefault()
    action.mutate()
  }
  return (
    <Card className="space-y-5">
      <form className="space-y-3" onSubmit={submit(join)}>
        <p className="font-semibold">Join a team</p>
        <Field label="Invite code" hint="Your team leader has it.">
          <Input required value={code} onChange={(e) => setCode(e.target.value)} />
        </Field>
        <ErrorNote error={join.error} />
        <Button type="submit" className="w-full" disabled={join.isPending}>Join team</Button>
      </form>
      <form className="space-y-3 border-t border-stone-200 pt-5" onSubmit={submit(create)}>
        <p className="font-semibold">{h.max_team_size === 1 ? 'Take part' : 'Or start a new team'}</p>
        <Field label="Team name" hint={h.min_team_size === 1 ? 'Taking part alone? Create a team of one.' : undefined}>
          <Input required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <ErrorNote error={create.error} />
        <Button type="submit" variant="secondary" className="w-full" disabled={create.isPending}>Create team</Button>
      </form>
    </Card>
  )
}

function SubmissionForm({ hackathon: h, team }: { hackathon: Hackathon; team: MyTeam }) {
  const s = team.submission
  const [form, setForm] = useState({ title: '', description: '', repository_url: '', demo_url: '', video_url: '', challenge_id: '' })
  useEffect(() => {
    if (s)
      setForm({
        title: s.title,
        description: s.description,
        repository_url: s.repository_url,
        demo_url: s.demo_url,
        video_url: s.video_url,
        challenge_id: s.challenge ? String(s.challenge.id) : '',
      })
  }, [s])
  const set = (field: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [field]: e.target.value }))
  const save = useAct(() =>
    api(`/hackathons/${h.slug}/my-team/submission/`, {
      method: 'PUT',
      body: { ...form, challenge_id: form.challenge_id ? Number(form.challenge_id) : null },
    }),
  )
  const errors = save.error instanceof ApiError ? save.error.fields : {}

  if (!h.submissions_open) {
    return (
      <Card className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">Your project</p>
        {s ? (
          <>
            <p className="font-semibold">{s.title}</p>
            <p className="text-sm text-stone-600">Submitted {formatDateTime(s.updated_at)}</p>
            <ProjectLinks submission={s} />
          </>
        ) : (
          <p className="text-sm text-stone-600">Submissions are closed. Your team did not submit a project.</p>
        )}
      </Card>
    )
  }
  return (
    <Card>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate()
        }}
      >
        <p className="font-semibold">{s ? 'Your project' : 'Submit your project'}</p>
        <p className="text-sm text-stone-600">You can change it until {formatDateTime(h.submission_deadline)}.</p>
        <Field label="Project name" error={errors.title}><Input required value={form.title} onChange={set('title')} /></Field>
        {!!h.challenges.length && (
          <Field label="Challenge">
            <Select value={form.challenge_id} onChange={set('challenge_id')}>
              <option value="">No specific challenge</option>
              {h.challenges.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </Select>
          </Field>
        )}
        <Field label="What it does" error={errors.description}><Textarea required value={form.description} onChange={set('description')} /></Field>
        <Field label="GitHub repository" error={errors.repository_url}><Input type="url" required placeholder="https://github.com/" value={form.repository_url} onChange={set('repository_url')} /></Field>
        <Field label="Live demo (optional)" error={errors.demo_url}><Input type="url" placeholder="https://" value={form.demo_url} onChange={set('demo_url')} /></Field>
        <Field label="Demo video (optional)" error={errors.video_url}><Input type="url" placeholder="https://" value={form.video_url} onChange={set('video_url')} /></Field>
        <ErrorNote error={save.error} />
        {save.isSuccess && <Notice>Saved. Your project is submitted.</Notice>}
        <Button type="submit" className="w-full" disabled={save.isPending}>{s ? 'Update submission' : 'Submit project'}</Button>
      </form>
    </Card>
  )
}
