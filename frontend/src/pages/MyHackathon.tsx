/** A participant's own space for a hackathon: their team, teammates, project, and finding a team. */
import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { useAuth } from 'react-oidc-context'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { ApiError, api } from '../api'
import type { Hackathon, MyTeam, Participant, Team, Teammate } from '../api'
import { Announcements, KeyDates, ProjectLinks } from '../components/hackathon'
import {
  Badge, Button, Card, Empty, ErrorNote, Field, Input, LinkButton, Notice, PageHeader, Section, Select, Spinner,
  StatusBadge, Textarea, formatDateTime,
} from '../components/ui'
import { useConfirm, useToast } from '../components/feedback'
import { useAct } from '../hooks'

export default function MyHackathon() {
  const { slug } = useParams()
  const hackathon = useQuery({ queryKey: ['hackathon', slug], queryFn: () => api<Hackathon>(`/hackathons/${slug}/`) })
  if (hackathon.isLoading) return <Spinner />
  if (!hackathon.data) return <ErrorNote error={hackathon.error ?? 'Hackathon not found.'} />
  const h = hackathon.data
  if (!h.is_registered) {
    return (
      <Empty>
        <p className="mb-4">You are not registered for {h.title}.</p>
        <LinkButton to={`/hackathons/${h.slug}`}>See the hackathon</LinkButton>
      </Empty>
    )
  }
  return (
    <>
      <PageHeader
        title={h.title}
        eyebrow="Your workspace"
        subtitle={<>Hosted by {h.organization.name} <StatusBadge status={h.status} /></>}
        action={<LinkButton to={`/hackathons/${h.slug}`} variant="secondary">Hackathon page</LinkButton>}
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {h.my_team_id ? <TeamWorkspace hackathon={h} /> : <FindATeam hackathon={h} />}
          <Announcements slug={h.slug} />
        </div>
        <aside className="space-y-4">
          <KeyDates hackathon={h} />
          {!h.my_team_id && <Registration hackathon={h} />}
        </aside>
      </div>
    </>
  )
}

function Person({ person, children }: { person: Teammate; children?: ReactNode }) {
  return (
    <div className="min-w-0 flex-1">
      <p className="font-semibold">{person.name} {children}</p>
      {(person.headline || person.institution) && (
        <p className="text-sm text-stone-600">{[person.headline, person.institution].filter(Boolean).join(' · ')}</p>
      )}
      {person.skills.length > 0 && (
        <p className="mt-1 flex flex-wrap gap-1">{person.skills.map((skill) => <Badge key={skill}>{skill}</Badge>)}</p>
      )}
      <p className="mt-1 flex gap-3 text-sm empty:hidden">
        {person.github_url && <a className="font-semibold text-brand-700 hover:underline" href={person.github_url} target="_blank" rel="noreferrer">GitHub</a>}
        {person.linkedin_url && <a className="font-semibold text-brand-700 hover:underline" href={person.linkedin_url} target="_blank" rel="noreferrer">LinkedIn</a>}
      </p>
    </div>
  )
}

// --- with a team -------------------------------------------------------------------

function TeamWorkspace({ hackathon: h }: { hackathon: Hackathon }) {
  const auth = useAuth()
  const team = useQuery({
    queryKey: ['hackathon', h.slug, 'my-team'],
    queryFn: () => api<MyTeam>(`/hackathons/${h.slug}/my-team/`),
  })
  const leave = useAct(() => api(`/hackathons/${h.slug}/my-team/leave/`, { method: 'POST' }))
  const remove = useAct((member: number) => api(`/hackathons/${h.slug}/my-team/members/${member}/`, { method: 'DELETE' }))
  const confirm = useConfirm()
  const toast = useToast()
  if (!team.data) return <Card>{team.error ? <ErrorNote error={team.error} /> : <Spinner />}</Card>
  const t = team.data
  const me = t.members.find((m) => m.person.sub === auth.user?.profile.sub)
  const canChange = h.status === 'published'
  const leader = !!me?.is_leader && canChange

  return (
    <>
      <Section title={t.name}>
        <ul className="divide-y divide-stone-200">
          {t.members.map((m) => (
            <li key={m.id} className="flex items-start gap-3 py-3">
              <Person person={m.person}>{m.is_leader && <Badge tone="green">Leader</Badge>}</Person>
              {leader && !m.is_leader && (
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
        {t.members.length < h.min_team_size && (
          <Notice tone="amber">You need {h.min_team_size} members before you can submit.</Notice>
        )}
        <ErrorNote error={leave.error ?? remove.error} />
        {canChange && (
          <Button
            variant="danger"
            className="mt-4"
            onClick={async () => {
              const alone = t.members.length === 1
              const ok = await confirm({
                tone: 'danger', title: alone ? 'Leave and delete your team?' : `Leave ${t.name}?`, confirmLabel: 'Leave team', cancelLabel: 'Stay',
                message: alone
                  ? 'You are the only member, so the team and its submission are deleted. You stay registered.'
                  : 'Your teammates keep the team and its submission. You stay registered.',
              })
              if (ok) leave.mutate(undefined, { onSuccess: () => toast({ tone: 'info', title: 'You left the team' }) })
            }}
          >
            Leave team
          </Button>
        )}
      </Section>
      {leader && <TeamSettings hackathon={h} team={t} />}
      {leader && h.registration_open && t.members.length < h.max_team_size && <InviteTeammates hackathon={h} team={t} />}
      <SubmissionForm hackathon={h} team={t} />
    </>
  )
}

function TeamSettings({ hackathon: h, team }: { hackathon: Hackathon; team: MyTeam }) {
  const [name, setName] = useState(team.name)
  const toast = useToast()
  const save = useAct((body: Partial<Pick<MyTeam, 'name' | 'is_open'>>) => api(`/hackathons/${h.slug}/my-team/`, { method: 'PATCH', body }))
  return (
    <Section title="Team settings">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate({ name }, { onSuccess: () => toast({ title: 'Team renamed' }) })
        }}
      >
        <div className="min-w-48 flex-1">
          <Field label="Team name"><Input required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} /></Field>
        </div>
        <Button type="submit" variant="secondary" disabled={save.isPending}>Rename</Button>
      </form>
      <label className="mt-4 flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          className="mt-1 accent-brand-600"
          checked={team.is_open}
          onChange={(e) => save.mutate({ is_open: e.target.checked })}
        />
        <span>
          <span className="block text-sm font-semibold">Open team</span>
          <span className="block text-sm text-stone-600">Anyone registered can join with one click while there is room.</span>
        </span>
      </label>
      <div className="mt-3 empty:hidden"><ErrorNote error={save.error} /></div>
    </Section>
  )
}

function InviteTeammates({ hackathon: h, team }: { hackathon: Hackathon; team: MyTeam }) {
  const [copied, setCopied] = useState(false)
  const link = `${window.location.origin}/join?code=${team.invite_code}`
  const participants = useQuery({
    queryKey: ['hackathon', h.slug, 'participants'],
    queryFn: () => api<Participant[]>(`/hackathons/${h.slug}/participants/`),
  })
  const looking = (participants.data ?? []).filter((p) => p.looking_for_team && !p.team_name)
  return (
    <Section title="Grow your team">
      <p className="text-sm text-stone-600">
        Room for {h.max_team_size - team.members.length} more. Share your team code <span className="font-mono font-bold text-ink">{team.invite_code}</span> or this link:
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Input readOnly value={link} aria-label="Invite link" className="min-w-0 flex-1" onFocus={(e) => e.target.select()} />
        <Button variant="secondary" onClick={() => void navigator.clipboard.writeText(link).then(() => setCopied(true))}>
          {copied ? 'Link copied' : 'Copy invite link'}
        </Button>
      </div>
      <p className="mb-2 mt-5 text-sm font-semibold">Looking for a team</p>
      {looking.length ? (
        <ul className="divide-y divide-stone-200">
          {looking.map((p) => <li key={p.id} className="py-3"><Person person={p.person} /></li>)}
        </ul>
      ) : (
        <p className="text-sm text-stone-500">Nobody is looking right now.</p>
      )}
    </Section>
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
      <Section title="Your project">
        {s ? (
          <>
            <p className="font-semibold">{s.title}</p>
            <p className="text-sm text-stone-600">Submitted {formatDateTime(s.updated_at)}</p>
            <ProjectLinks submission={s} />
          </>
        ) : (
          <p className="text-sm text-stone-600">Submissions are closed. Your team did not submit a project.</p>
        )}
      </Section>
    )
  }
  return (
    <Section title={s ? 'Your project' : 'Submit your project'}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate()
        }}
      >
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
        <Button type="submit" disabled={save.isPending}>{s ? 'Update submission' : 'Submit project'}</Button>
      </form>
    </Section>
  )
}

// --- without a team ----------------------------------------------------------------

function FindATeam({ hackathon: h }: { hackathon: Hackathon }) {
  const toast = useToast()
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const teams = useQuery({
    queryKey: ['hackathon', h.slug, 'teams'],
    queryFn: () => api<Team[]>(`/hackathons/${h.slug}/teams/`),
  })
  const create = useAct(() => api(`/hackathons/${h.slug}/teams/`, { method: 'POST', body: { name } }))
  const join = useAct(() => api(`/hackathons/${h.slug}/teams/join/`, { method: 'POST', body: { invite_code: code.trim() } }))
  const joinOpen = useAct((team: Team) => api(`/hackathons/${h.slug}/teams/${team.id}/join/`, { method: 'POST' }))
  const joined = () => toast({ title: 'You joined the team', message: 'Welcome aboard. Good luck!' })
  const submit = (action: typeof create, onSuccess: () => void) => (e: FormEvent) => {
    e.preventDefault()
    action.mutate(undefined, { onSuccess })
  }

  if (!h.registration_open) {
    return (
      <Section title="Your team">
        <p className="text-sm text-stone-600">Registration has closed and you did not join a team, so you cannot submit a project.</p>
      </Section>
    )
  }
  return (
    <>
      <Section title="Find a team">
        <div className="grid gap-6 sm:grid-cols-2">
          <form className="space-y-3" onSubmit={submit(create, () => toast(
            h.max_team_size > 1
              ? { title: `${name} is ready`, message: 'Share your team code with your teammates.' }
              : { title: 'You are taking part', message: 'Good luck!' },
          ))}>
            <p className="font-semibold">{h.max_team_size === 1 ? 'Take part on your own' : 'Start a team'}</p>
            <Field label="Team name" hint={h.min_team_size === 1 && h.max_team_size > 1 ? 'Taking part alone? Create a team of one.' : undefined}>
              <Input required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <ErrorNote error={create.error} />
            <Button type="submit" disabled={create.isPending}>Create team</Button>
          </form>
          <form className="space-y-3" onSubmit={submit(join, joined)}>
            <p className="font-semibold">Join with a code</p>
            <Field label="Team code" hint="The 6 digits your team leader shared.">
              <Input required inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} />
            </Field>
            <ErrorNote error={join.error} />
            <Button type="submit" variant="secondary" disabled={join.isPending}>Join team</Button>
          </form>
        </div>
      </Section>
      <Section title="Teams">
        <ErrorNote error={joinOpen.error ?? teams.error} />
        {!teams.data ? (
          teams.isLoading && <Spinner />
        ) : teams.data.length ? (
          <ul className="grid gap-3 sm:grid-cols-2">
            {teams.data.map((t) => (
              <li key={t.id} className="flex flex-col rounded-lg border border-stone-200 p-4">
                <div className="flex items-center gap-2">
                  <p className="font-semibold">{t.name}</p>
                  {t.is_open && <Badge tone="green">Open</Badge>}
                </div>
                <p className="text-sm text-stone-600">{t.members.map((m) => m.person.name).join(', ')}</p>
                <p className="mt-1 text-xs text-stone-500">{t.spots_left ? `${t.spots_left} ${t.spots_left === 1 ? 'spot' : 'spots'} left` : 'Full'}</p>
                {t.is_open && t.spots_left > 0 && (
                  <Button className="mt-3 self-start" variant="secondary" disabled={joinOpen.isPending} onClick={() => joinOpen.mutate(t, { onSuccess: joined })}>
                    Join
                  </Button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-stone-500">No teams yet. Start the first one.</p>
        )}
      </Section>
    </>
  )
}

/** Whether leaders see the member as looking for a team, and withdrawing. */
function Registration({ hackathon: h }: { hackathon: Hackathon }) {
  const navigate = useNavigate()
  const confirm = useConfirm()
  const toast = useToast()
  const participants = useQuery({
    queryKey: ['hackathon', h.slug, 'participants'],
    queryFn: () => api<Participant[]>(`/hackathons/${h.slug}/participants/`),
  })
  const auth = useAuth()
  const mine = participants.data?.find((p) => p.person.sub === auth.user?.profile.sub)
  const looking = useAct((value: boolean) => api(`/hackathons/${h.slug}/registration/`, { method: 'PATCH', body: { looking_for_team: value } }))
  const withdraw = useAct(() => api(`/hackathons/${h.slug}/registration/`, { method: 'DELETE' }))
  return (
    <Card className="space-y-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">Your registration</p>
      {h.registration_open && (
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            className="mt-1 accent-brand-600"
            checked={!!mine?.looking_for_team}
            disabled={!mine}
            onChange={(e) => looking.mutate(e.target.checked)}
          />
          <span>
            <span className="block text-sm font-semibold">I am looking for a team</span>
            <span className="block text-sm text-stone-600">
              Team leaders see your name, headline and skills. <Link className="font-semibold text-brand-700 hover:underline" to="/profile">Edit your profile</Link>
            </span>
          </span>
        </label>
      )}
      <ErrorNote error={looking.error ?? withdraw.error} />
      {h.status === 'published' && (
        <Button
          variant="ghost"
          onClick={async () => {
            if (await confirm({ tone: 'danger', title: `Withdraw from ${h.title}?`, message: 'You can register again while registration is open.', confirmLabel: 'Withdraw', cancelLabel: 'Stay' }))
              withdraw.mutate(undefined, {
                onSuccess: () => {
                  toast({ tone: 'info', title: 'You withdrew' })
                  navigate(`/hackathons/${h.slug}`)
                },
              })
          }}
        >
          Withdraw
        </Button>
      )}
    </Card>
  )
}
