/** One hackathon in the console: its stage, lifecycle actions, and a page per section. */
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, Outlet, useNavigate, useOutletContext, useParams } from 'react-router-dom'

import { api } from '../api'
import type { Hackathon, Judge, LeaderboardRow, Team } from '../api'
import { Leaderboard } from '../components/hackathon'
import { DataTable, downloadCsv } from '../components/DataTable'
import type { Col } from '../components/DataTable'
import { Icon } from '../components/icons'
import {
  Badge, Button, Empty, ErrorNote, Field, Input, Notice, Spinner, StatusBadge, formatDate, formatDateTime,
} from '../components/ui'
import { useAct } from '../hooks'
import { ConsoleHeader, Kpi, Meter, Panel, relative } from './shared'

type Ctx = { hackathon: Hackathon }
const useHackathon = () => useOutletContext<Ctx>().hackathon

function useJudges(slug: string) {
  return useQuery({ queryKey: ['hackathon', slug, 'judges'], queryFn: () => api<Judge[]>(`/hackathons/${slug}/judges/`) })
}

export default function HackathonWorkspace() {
  const { slug } = useParams()
  const navigate = useNavigate()
  const hackathon = useQuery({ queryKey: ['hackathon', slug], queryFn: () => api<Hackathon>(`/hackathons/${slug}/`) })
  const move = useAct((status: string) => api(`/hackathons/${slug}/transition/`, { method: 'POST', body: { status } }))
  const remove = useAct(() => api(`/hackathons/${slug}/`, { method: 'DELETE' }))

  if (hackathon.isLoading) return <Spinner />
  if (!hackathon.data) return <ErrorNote error={hackathon.error ?? 'Hackathon not found.'} />
  const h = hackathon.data
  if (!h.can_manage) return <Empty>You do not manage this hackathon.</Empty>
  const confirmMove = (status: string, question: string) => () => window.confirm(question) && move.mutate(status)
  const cancel = (
    <Button variant="danger" onClick={confirmMove('cancelled', 'Cancel this hackathon? Teams can no longer join or submit. You can restore it later.')}>Cancel</Button>
  )
  const restoreTo = h.cancelled_from || 'published'

  return (
    <>
      <ConsoleHeader
        title={h.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <StatusBadge status={h.status} />
            <span className="inline-flex items-center gap-1"><Icon name="calendar" className="h-4 w-4" />{formatDate(h.starts_at)} to {formatDate(h.ends_at)}</span>
            <span>{h.organization.name}</span>
          </span>
        }
        actions={
          <>
            <a href={`/hackathons/${h.slug}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-semibold hover:bg-stone-100">
              <Icon name="external" className="h-4 w-4" />Public page
            </a>
            {h.status === 'draft' && (
              <>
                <Button variant="danger" onClick={() => window.confirm('Delete this draft?') && remove.mutate(undefined, { onSuccess: () => navigate('/manage/hackathons') })}>Delete</Button>
                <Button disabled={move.isPending} onClick={() => move.mutate('published')}>Publish</Button>
              </>
            )}
            {h.status === 'published' && (
              <>
                {cancel}
                <Button onClick={confirmMove('judging', 'Start judging? Submissions close, and teams and criteria can no longer change.')}>Start judging</Button>
              </>
            )}
            {h.status === 'cancelled' && (
              <Button
                disabled={move.isPending}
                onClick={confirmMove(restoreTo, `Restore this hackathon? It goes back to ${restoreTo === 'judging' ? 'judging' : 'open'}, as it was before it was cancelled.`)}
              >
                Restore
              </Button>
            )}
            {h.status === 'judging' && (
              <>
                {cancel}
                <Button onClick={confirmMove('completed', 'Publish the results? The leaderboard and all projects become public, and scores are final.')}>Publish results</Button>
              </>
            )}
          </>
        }
      />
      <div className="mb-4 space-y-3 empty:hidden">
        <ErrorNote error={move.error ?? remove.error} />
        {h.status === 'draft' && <Notice tone="amber">This is a draft. Only managers can see it until you publish.</Notice>}
      </div>
      <Outlet context={{ hackathon: h } satisfies Ctx} />
    </>
  )
}

// --- overview ------------------------------------------------------------------

const STAGES = [
  { id: 'draft', label: 'Draft' },
  { id: 'published', label: 'Open' },
  { id: 'judging', label: 'Judging' },
  { id: 'completed', label: 'Results out' },
]

function Stages({ h }: { h: Hackathon }) {
  if (h.status === 'cancelled')
    return <Notice tone="amber">This hackathon was cancelled. Use Restore at the top of the page to bring it back.</Notice>
  const at = STAGES.findIndex((s) => s.id === h.status)
  const dates: Record<string, string> = {
    published: `Registration closes ${formatDate(h.registration_deadline)}`,
    judging: `Submissions close ${formatDate(h.submission_deadline)}`,
    completed: `Ends ${formatDate(h.ends_at)}`,
  }
  return (
    <ol className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {STAGES.map((s, i) => {
        const done = i < at
        const current = i === at
        return (
          <li key={s.id} className={`rounded-lg border px-3 py-2.5 ${current ? 'border-brand-600 bg-brand-50' : 'border-stone-200'}`}>
            <div className="flex items-center gap-2">
              <span className={`grid h-5 w-5 place-items-center rounded-full text-[11px] font-bold ${done ? 'bg-brand-600 text-white' : current ? 'bg-ink text-white' : 'bg-stone-200 text-stone-600'}`}>
                {done ? <Icon name="check" className="h-3 w-3" /> : i + 1}
              </span>
              <span className={`text-sm font-semibold ${current ? 'text-brand-800' : done ? 'text-stone-700' : 'text-stone-500'}`}>{s.label}</span>
            </div>
            {dates[s.id] && <p className="mt-1 text-xs text-stone-500">{dates[s.id]}</p>}
          </li>
        )
      })}
    </ol>
  )
}

export function HackathonOverview() {
  const h = useHackathon()
  const judges = useJudges(h.slug)
  const base = `/manage/hackathons/${h.slug}`
  const judgeList = judges.data ?? []
  const scored = judgeList.reduce((s, j) => s + j.evaluations, 0)
  const needed = judgeList.length * h.submission_count
  const now = Date.now()
  const regOpen = new Date(h.registration_deadline).getTime() > now
  const subOpen = new Date(h.submission_deadline).getTime() > now

  const steps = [
    { done: h.challenges.length > 0, text: 'Add challenges or tracks', to: `${base}/setup` },
    { done: h.criteria.length > 0, text: 'Set the judging criteria', to: `${base}/setup` },
    { done: judgeList.length > 0, text: 'Invite judges', to: `${base}/judges` },
    { done: h.status !== 'draft', text: 'Publish to open registration', to: base },
    { done: h.status === 'judging' || h.status === 'completed', text: 'Start judging after submissions close', to: base },
    { done: h.status === 'completed', text: 'Publish the results', to: `${base}/leaderboard` },
  ]
  const doneCount = steps.filter((s) => s.done).length

  return (
    <div className="space-y-6">
      <Panel title="Stage"><Stages h={h} /></Panel>

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Kpi label="Participants" value={h.participant_count} icon="users" note={regOpen ? `Registration closes ${relative(h.registration_deadline)}` : 'Registration closed'} />
        <Kpi label="Teams" value={h.team_count} icon="target" to={`${base}/teams`} note={`${h.min_team_size} to ${h.max_team_size} people each`} />
        <Kpi
          label="Projects submitted"
          value={h.submission_count}
          icon="inbox"
          to={`${base}/teams`}
          note={h.team_count ? <span className="block"><span className="mb-1.5 block">{Math.round((h.submission_count / h.team_count) * 100)}% of teams{subOpen ? `, closes ${relative(h.submission_deadline)}` : ''}</span><Meter value={h.submission_count} max={h.team_count} label="Teams that submitted" /></span> : 'No teams yet'}
        />
        <Kpi
          label="Judging"
          value={needed ? `${Math.round((scored / needed) * 100)}%` : '–'}
          icon="gavel"
          to={`${base}/judges`}
          note={needed ? <span className="block"><span className="mb-1.5 block">{scored} of {needed} scores in</span><Meter value={scored} max={needed} label="Scores in" /></span> : `${judgeList.length} judges, ${h.criteria.length} criteria`}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Panel title="Key dates">
            <dl className="grid gap-4 text-sm sm:grid-cols-2">
              {[
                ['Starts', h.starts_at],
                ['Ends', h.ends_at],
                ['Registration closes', h.registration_deadline],
                ['Submissions close', h.submission_deadline],
              ].map(([k, v]) => (
                <div key={k} className="rounded-lg border border-stone-200 px-4 py-3">
                  <dt className="text-xs font-semibold uppercase tracking-wide text-stone-500">{k}</dt>
                  <dd className="mt-1 font-semibold">{formatDateTime(v)}</dd>
                  <dd className="text-xs text-stone-500">{relative(v)}</dd>
                </div>
              ))}
            </dl>
          </Panel>
          <Panel title="Set-up" action={<Link to={`${base}/setup`} className="text-sm font-semibold text-brand-700 hover:underline">Edit</Link>}>
            <div className="grid gap-6 sm:grid-cols-2">
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">Challenges</p>
                {h.challenges.length ? (
                  <ul className="space-y-1.5 text-sm">{h.challenges.map((c) => <li key={c.id} className="font-medium">{c.title}</li>)}</ul>
                ) : <p className="text-sm text-stone-500">None yet. Teams can build anything.</p>}
              </div>
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">Criteria</p>
                {h.criteria.length ? (
                  <ul className="space-y-1.5 text-sm">
                    {h.criteria.map((c) => (
                      <li key={c.id} className="flex justify-between gap-2"><span className="font-medium">{c.name}</span><span className="text-stone-500">out of {c.max_score}{c.weight > 1 && `, ×${c.weight}`}</span></li>
                    ))}
                  </ul>
                ) : <p className="text-sm text-stone-500">None yet. Judges need at least one.</p>}
              </div>
            </div>
          </Panel>
        </div>
        <Panel title="Getting it right" action={<span className="text-xs font-semibold tabular-nums text-stone-500">{doneCount} of {steps.length}</span>}>
          <div className="mb-4"><Meter value={doneCount} max={steps.length} label="Steps done" /></div>
          <ul className="space-y-2.5">
            {steps.map((step) => (
              <li key={step.text} className="flex items-start gap-2.5 text-sm">
                <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full ${step.done ? 'bg-brand-600 text-white' : 'border border-stone-300 text-transparent'}`}>
                  <Icon name="check" className="h-3 w-3" />
                </span>
                {step.done ? (
                  <span className="text-stone-500 line-through decoration-stone-300">{step.text}</span>
                ) : (
                  <Link to={step.to} className="font-medium hover:text-brand-700">{step.text}</Link>
                )}
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  )
}

// --- challenges and criteria -----------------------------------------------------

export function HackathonSetup() {
  const h = useHackathon()
  const [challenge, setChallenge] = useState({ title: '', description: '' })
  const [criterion, setCriterion] = useState({ name: '', description: '', max_score: '10', weight: '1' })
  const addChallenge = useAct(() => api(`/hackathons/${h.slug}/challenges/`, { method: 'POST', body: challenge }))
  const addCriterion = useAct(() =>
    api(`/hackathons/${h.slug}/criteria/`, {
      method: 'POST',
      body: { ...criterion, max_score: Number(criterion.max_score), weight: Number(criterion.weight) },
    }),
  )
  const remove = useAct((path: string) => api(`/hackathons/${h.slug}/${path}/`, { method: 'DELETE' }))
  const criteriaLocked = h.status !== 'draft' && h.status !== 'published'
  const submit = (action: typeof addChallenge, reset: () => void) => (e: FormEvent) => {
    e.preventDefault()
    action.mutate(undefined, { onSuccess: reset })
  }
  const totalWeight = h.criteria.reduce((s, c) => s + c.weight, 0)
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Panel title="Challenges">
        <p className="mb-3 text-sm text-stone-600">Optional problem statements or tracks teams can build for.</p>
        <ul className="mb-4 divide-y divide-stone-100">
          {h.challenges.map((c) => (
            <li key={c.id} className="flex items-start justify-between gap-2 py-3">
              <div>
                <p className="font-semibold">{c.title}</p>
                {c.description && <p className="text-sm text-stone-600">{c.description}</p>}
              </div>
              <Button variant="ghost" onClick={() => remove.mutate(`challenges/${c.id}`)}>Remove</Button>
            </li>
          ))}
        </ul>
        <form className="space-y-3 rounded-lg bg-stone-50 p-4" onSubmit={submit(addChallenge, () => setChallenge({ title: '', description: '' }))}>
          <Field label="Title"><Input required value={challenge.title} onChange={(e) => setChallenge({ ...challenge, title: e.target.value })} /></Field>
          <Field label="Description"><Input value={challenge.description} onChange={(e) => setChallenge({ ...challenge, description: e.target.value })} /></Field>
          <ErrorNote error={addChallenge.error} />
          <Button type="submit" variant="secondary" disabled={addChallenge.isPending}><Icon name="plus" className="h-4 w-4" />Add challenge</Button>
        </form>
      </Panel>
      <Panel title="Judging criteria">
        <p className="mb-3 text-sm text-stone-600">Judges score every project on each criterion. A weight of 2 makes a criterion count twice.</p>
        <ul className="mb-4 divide-y divide-stone-100">
          {h.criteria.map((c) => (
            <li key={c.id} className="flex items-start justify-between gap-2 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold">{c.name}</p>
                  <span className="text-xs tabular-nums text-stone-500">{Math.round((c.weight / totalWeight) * 100)}% of the score</span>
                </div>
                <p className="text-sm text-stone-600">Out of {c.max_score}, weight {c.weight}{c.description && `. ${c.description}`}</p>
              </div>
              {!criteriaLocked && <Button variant="ghost" onClick={() => remove.mutate(`criteria/${c.id}`)}>Remove</Button>}
            </li>
          ))}
        </ul>
        <ErrorNote error={remove.error} />
        {criteriaLocked ? (
          <Notice tone="amber">Criteria are fixed once judging starts.</Notice>
        ) : (
          <form className="space-y-3 rounded-lg bg-stone-50 p-4" onSubmit={submit(addCriterion, () => setCriterion({ name: '', description: '', max_score: '10', weight: '1' }))}>
            <Field label="Name" hint="For example: Innovation, Technical execution, Impact.">
              <Input required value={criterion.name} onChange={(e) => setCriterion({ ...criterion, name: e.target.value })} />
            </Field>
            <Field label="What judges should look for"><Input value={criterion.description} onChange={(e) => setCriterion({ ...criterion, description: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Highest score"><Input type="number" min={1} max={100} required value={criterion.max_score} onChange={(e) => setCriterion({ ...criterion, max_score: e.target.value })} /></Field>
              <Field label="Weight"><Input type="number" min={1} max={100} required value={criterion.weight} onChange={(e) => setCriterion({ ...criterion, weight: e.target.value })} /></Field>
            </div>
            <ErrorNote error={addCriterion.error} />
            <Button type="submit" variant="secondary" disabled={addCriterion.isPending}><Icon name="plus" className="h-4 w-4" />Add criterion</Button>
          </form>
        )}
      </Panel>
    </div>
  )
}

// --- teams ---------------------------------------------------------------------

export function HackathonTeams() {
  const h = useHackathon()
  const teams = useQuery({ queryKey: ['hackathon', h.slug, 'teams'], queryFn: () => api<Team[]>(`/hackathons/${h.slug}/teams/`) })
  if (!teams.data) return <Spinner />
  const submitted = teams.data.filter((t) => t.has_submission).length
  const columns: Col<Team>[] = [
    { title: 'Team', value: (t) => t.name, cell: (t) => <span className="font-semibold">{t.name}</span>, priority: 1 },
    {
      title: 'Members',
      value: (t) => t.members.map((m) => m.person.name).join(', '),
      cell: (t) => <span className="text-stone-600">{t.members.map((m) => (m.is_leader ? `${m.person.name} (lead)` : m.person.name)).join(', ')}</span>,
      priority: 3,
    },
    { title: 'Size', value: (t) => t.members.length, cell: (t) => <span className="font-mono tabular-nums">{t.members.length}</span>, align: 'right', priority: 4 },
    {
      title: 'Project',
      value: (t) => (t.has_submission ? 'submitted' : 'not yet'),
      cell: (t) => <Badge tone={t.has_submission ? 'green' : 'grey'}>{t.has_submission ? 'Submitted' : 'Not yet'}</Badge>,
      priority: 2,
    },
  ]
  return (
    <div className="overflow-hidden rounded-xl border border-stone-200 bg-white">
      <DataTable
        rows={teams.data}
        columns={columns}
        order={[0, 'asc']}
        searchPlaceholder="Team or member"
        empty="No teams have registered yet."
        toolbar={
          <>
            <p className="text-sm text-stone-600"><span className="font-semibold text-ink">{teams.data.length} teams</span>, {submitted} submitted a project</p>
            <Button
              variant="secondary"
              disabled={!teams.data.length}
              onClick={() =>
                downloadCsv(
                  `${h.slug}-teams.csv`,
                  ['Team', 'Members', 'Size', 'Submitted'],
                  teams.data.map((t) => [t.name, t.members.map((m) => m.person.name).join('; '), t.members.length, t.has_submission ? 'yes' : 'no']),
                )
              }
            >
              Export CSV
            </Button>
          </>
        }
      />
    </div>
  )
}

// --- judges --------------------------------------------------------------------

export function HackathonJudges() {
  const h = useHackathon()
  const judges = useJudges(h.slug)
  const [email, setEmail] = useState('')
  const add = useAct(() => api(`/hackathons/${h.slug}/judges/`, { method: 'POST', body: { email } }))
  const remove = useAct((judge: number) => api(`/hackathons/${h.slug}/judges/${judge}/`, { method: 'DELETE' }))
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <div className="overflow-hidden rounded-xl border border-stone-200 bg-white">
          {judges.data ? (
            <DataTable
              rows={judges.data}
              columns={[
                {
                  title: 'Judge',
                  value: (j: Judge) => `${j.person.name} ${j.email}`,
                  cell: (j: Judge) => (
                    <>
                      <p className="font-semibold">{j.person.name}</p>
                      <p className="text-xs text-stone-500">{j.email}</p>
                    </>
                  ),
                  priority: 1,
                },
                {
                  title: 'Projects scored',
                  value: (j: Judge) => j.evaluations,
                  cell: (j: Judge) => (
                    <div className="w-44">
                      <div className="mb-1 font-mono text-xs tabular-nums text-stone-600">{j.evaluations}/{h.submission_count}</div>
                      <Meter value={j.evaluations} max={Math.max(1, h.submission_count)} label={`${j.person.name}: projects scored`} />
                    </div>
                  ),
                  priority: 2,
                },
                {
                  title: '',
                  value: () => '',
                  sortable: false,
                  align: 'right',
                  priority: 3,
                  cell: (j: Judge) => (
                    <Button variant="ghost" onClick={() => window.confirm(`Remove ${j.person.name}? Their scores are deleted too.`) && remove.mutate(j.id)}>Remove</Button>
                  ),
                },
              ]}
              order={[0, 'asc']}
              searchPlaceholder="Search judges"
              empty="No judges yet. Every judge scores every project."
              toolbar={<p className="eyebrow text-stone-700">Judges ({judges.data.length})</p>}
            />
          ) : (
            <Spinner />
          )}
        </div>
      </div>
      <Panel title="Invite a judge">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault()
            add.mutate(undefined, { onSuccess: () => setEmail('') })
          }}
        >
          <Field label="Email" hint="They must have signed in to Community at least once.">
            <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <ErrorNote error={add.error ?? remove.error} />
          <Button type="submit" disabled={add.isPending}><Icon name="plus" className="h-4 w-4" />Add judge</Button>
        </form>
      </Panel>
    </div>
  )
}

// --- leaderboard ---------------------------------------------------------------

export function HackathonLeaderboard() {
  const h = useHackathon()
  const board = useQuery({ queryKey: ['hackathon', h.slug, 'leaderboard'], queryFn: () => api<LeaderboardRow[]>(`/hackathons/${h.slug}/leaderboard/`) })
  if (!board.data) return <Spinner />
  if (!board.data.length) return <Empty>No projects have been submitted yet.</Empty>
  return (
    <Panel title="Leaderboard" action={<Badge tone={h.results_published ? 'green' : 'grey'}>{h.results_published ? 'Public' : 'Managers only'}</Badge>}>
      <p className="mb-2 text-sm text-stone-600">
        {h.results_published
          ? 'These results are public.'
          : 'Only managers see this until you publish the results. A score is the average across judges, as a percentage of the weighted marks.'}
      </p>
      <Leaderboard rows={board.data} />
    </Panel>
  )
}
