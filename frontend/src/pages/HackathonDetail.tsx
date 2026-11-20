import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { useAuth } from 'react-oidc-context'
import { Link, useParams, useSearchParams } from 'react-router-dom'

import { ApiError, api } from '../api'
import type { Announcement, Hackathon, JudgedSubmission, LeaderboardRow, MyTeam } from '../api'
import { Leaderboard, ProjectLinks } from '../components/hackathon'
import {
  Badge, Button, Card, ErrorNote, Field, Input, LinkButton, Notice, Prose, Section, Select, Spinner,
  StatusBadge, Textarea, formatDateTime, formatRange,
} from '../components/ui'
import { Cover } from '../components/cards'
import { RichText } from '../components/RichText'
import { Icon } from '../components/icons'
import type { IconName } from '../components/icons'
import { ReadMore, StickyAction, useScrolledPast } from '../components/mobile'
import { useConfirm, useToast } from '../components/feedback'
import { useAct, useSignIn } from '../hooks'

/** News from the organisers, newest first. */
function Announcements({ slug }: { slug: string }) {
  const announcements = useQuery({
    queryKey: ['hackathon', slug, 'announcements'],
    queryFn: () => api<Announcement[]>(`/hackathons/${slug}/announcements/`),
  })
  const list = announcements.data ?? []
  return (
    list.length > 0 && (
      <Section title="Announcements">
        <ul className="space-y-4">
          {list.map((a) => (
            <li key={a.id} className="border-l-2 border-brand-500 pl-4">
              <p className="font-semibold">{a.title}</p>
              <p className="text-xs text-stone-500">{formatDateTime(a.created_at)}</p>
              <RichText html={a.body} />
            </li>
          ))}
        </ul>
      </Section>
    )
  )
}

export default function HackathonDetail() {
  const { slug } = useParams()
  const hackathon = useQuery({ queryKey: ['hackathon', slug], queryFn: () => api<Hackathon>(`/hackathons/${slug}/`) })
  const [actionRef, scrolledPast] = useScrolledPast()
  if (hackathon.isLoading) return <Spinner />
  if (!hackathon.data) return <ErrorNote error={hackathon.error ?? 'Hackathon not found.'} />
  const h = hackathon.data
  const teamSize =
    h.min_team_size === h.max_team_size
      ? `Teams of ${h.max_team_size}`
      : `Teams of ${h.min_team_size} to ${h.max_team_size}`
  const canJoin = !h.my_team_id && !h.is_judge && h.registration_open
  // Taking part comes first on a phone while it matters; for a finished hackathon, the results do.
  const involved = !!h.my_team_id || h.is_judge || h.status === 'published' || h.status === 'draft'

  return (
    <div className="space-y-6">
      <Cover image={h.cover_image} kind="hackathon" title={h.title} className="-mx-4 -mt-8 rounded-none sm:mx-0 sm:mt-0 sm:aspect-[21/8] sm:rounded-2xl" />
      <div>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <StatusBadge status={h.status} />
          {h.theme && <Badge tone="blue">{h.theme}</Badge>}
        </div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{h.title}</h1>
        <p className="mt-1 text-stone-600">Hosted by {h.organization.name}</p>
        <ul className="mt-4 space-y-2 text-sm">
          <Fact icon="calendar">{formatRange(h.starts_at, h.ends_at)}</Fact>
          <Fact icon="pin">{h.venue || 'Online'}</Fact>
          <Fact icon="users">{teamSize}, {count(h.team_count, 'team')} so far</Fact>
        </ul>
        {h.tagline && <p className="mt-4 text-stone-700 sm:text-lg">{h.tagline}</p>}
      </div>
      {h.status === 'cancelled' && <Notice tone="amber">This hackathon has been cancelled.</Notice>}
      {h.status === 'judging' && <Notice tone="amber">Submissions are closed and the judges are scoring projects.</Notice>}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* First on a phone: taking part. */}
        <aside className={`space-y-4 lg:order-none lg:col-start-3 lg:row-start-1 ${involved ? '' : 'order-last'}`}>
          <div ref={actionRef} id="take-part" className="scroll-mt-20 space-y-4">
            {h.is_judge ? (
              <Card className="space-y-3">
                <p className="text-lg font-bold">You are a judge</p>
                <p className="text-sm text-stone-600">
                  {h.status === 'judging' ? 'Scoring is open.' : h.status === 'published' ? 'Scoring opens when submissions close.' : 'Judging is over.'}
                </p>
                <LinkButton to={`/hackathons/${h.slug}/judge`}>Go to judging</LinkButton>
              </Card>
            ) : (
              <TeamPanel hackathon={h} />
            )}
          </div>
          <Card>
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-stone-500">Key dates</p>
            <ol className="space-y-3">
              {[
                ['Registration closes', h.registration_deadline],
                ['Hacking starts', h.starts_at],
                ['Submissions close', h.submission_deadline],
                ['Ends', h.ends_at],
              ].map(([text, iso]) => {
                const passed = new Date(iso).getTime() < Date.now()
                return (
                  <li key={text} className="flex items-center gap-3">
                    <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${passed ? 'bg-stone-300' : 'bg-brand-500'}`} />
                    <span className={`flex-1 text-sm ${passed ? 'text-stone-400 line-through' : ''}`}>{text}</span>
                    <span className={`text-right text-xs tabular-nums ${passed ? 'text-stone-400' : 'text-stone-600'}`}>{formatDateTime(iso)}</span>
                  </li>
                )
              })}
            </ol>
            <p className="mt-4 border-t border-stone-100 pt-3 text-sm text-stone-600">
              {count(h.participant_count, 'participant')} in {count(h.team_count, 'team')}, {count(h.submission_count, 'project')} submitted
            </p>
          </Card>
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

        <div className="space-y-6 lg:col-span-2 lg:col-start-1 lg:row-start-1">
          {h.results_published && <Results id={h.slug} />}
          <Announcements slug={h.slug} />
          {h.description && <Section title="About"><ReadMore><RichText html={h.description} /></ReadMore></Section>}
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
          <Link to="/hackathons" className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 hover:underline">
            <Icon name="arrowLeft" className="h-4 w-4" />All hackathons
          </Link>
        </div>
      </div>

      {canJoin && (
        <StickyAction show={scrolledPast}>
          <Button className="w-full py-3" onClick={() => document.getElementById('take-part')?.scrollIntoView({ behavior: 'smooth' })}>
            Take part
          </Button>
        </StickyAction>
      )}
      {h.is_judge && h.status === 'judging' && (
        <StickyAction show={scrolledPast}>
          <LinkButton to={`/hackathons/${h.slug}/judge`}>Go to judging</LinkButton>
        </StickyAction>
      )}
    </div>
  )
}

function Fact({ icon, children }: { icon: IconName; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700"><Icon name={icon} className="h-4 w-4" /></span>
      <span className="pt-1">{children}</span>
    </li>
  )
}

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`

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
  const confirm = useConfirm()
  const toast = useToast()

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
                  <Button
                    variant="ghost"
                    onClick={async () => {
                      if (await confirm({ tone: 'danger', title: `Remove ${m.person.name}?`, message: 'They leave your team and can join another one.', confirmLabel: 'Remove' }))
                        remove.mutate(m.id, { onSuccess: () => toast({ title: `${m.person.name} removed from the team` }) })
                    }}
                  >
                    Remove
                  </Button>
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
              onClick={async () => {
                const alone = t.members.length === 1
                const ok = await confirm({
                  tone: 'danger', title: alone ? 'Leave and delete your team?' : `Leave ${t.name}?`, confirmLabel: 'Leave team', cancelLabel: 'Stay',
                  message: alone ? 'You are the only member, so the team and its submission are deleted.' : 'Your teammates keep the team and its submission.',
                })
                if (ok) leave.mutate(undefined, { onSuccess: () => toast({ tone: 'info', title: 'You left the team' }) })
              }}
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
    action.mutate(undefined, {
      onSuccess: () =>
        toast(
          action === create
            ? { title: `${name} is ready`, message: h.max_team_size > 1 ? 'Share the invite link with your teammates.' : 'You are taking part.' }
            : { title: 'You joined the team', message: 'Welcome aboard. Good luck!' },
        ),
    })
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
