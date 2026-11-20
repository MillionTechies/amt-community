/** One hackathon in the console: its stage, lifecycle actions, and a page per section. */
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, Outlet, useNavigate, useOutletContext, useParams } from 'react-router-dom'

import { api } from '../api'
import type { Announcement, Hackathon, Judge, LeaderboardRow, Team } from '../api'
import { Leaderboard } from '../components/hackathon'
import { DataTable, downloadCsv } from '../components/DataTable'
import type { Col } from '../components/DataTable'
import { Icon } from '../components/icons'
import { RichText } from '../components/RichText'
import { RichTextEditor } from '../components/RichTextEditor'
import {
  Badge, Button, Empty, ErrorNote, Field, Input, Notice, Spinner, StatusBadge, formatDate, formatDateTime,
} from '../components/ui'
import { useConfirm, useToast } from '../components/feedback'
import type { ConfirmOptions, ToastOptions } from '../components/feedback'
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
  const confirm = useConfirm()
  const toast = useToast()

  if (hackathon.isLoading) return <Spinner />
  if (!hackathon.data) return <ErrorNote error={hackathon.error ?? 'Hackathon not found.'} />
  const h = hackathon.data
  if (!h.can_manage) return <Empty>You do not manage this hackathon.</Empty>
  const failed = (title: string) => (error: Error) => toast({ tone: 'error', title, message: error.message })
  /** Ask first (when `ask` is given), move the hackathon on, then say what happened. */
  const moveTo = (status: string, done: ToastOptions, ask?: ConfirmOptions) => async () => {
    if (ask && !(await confirm(ask))) return
    move.mutate(status, { onSuccess: () => toast(done), onError: failed('Could not update the hackathon') })
  }
  const restoreTo = h.cancelled_from || 'published'
  const cancel = (
    <Button
      variant="danger"
      disabled={move.isPending}
      onClick={moveTo(
        'cancelled',
        { tone: 'info', title: 'Hackathon cancelled', message: 'You can restore it at any time.' },
        {
          tone: 'danger', title: 'Cancel this hackathon?', confirmLabel: 'Yes, cancel it', cancelLabel: 'Keep it',
          message: 'Teams can no longer join or submit. Nothing is deleted, and you can restore it later.',
        },
      )}
    >
      Cancel
    </Button>
  )
  const deleteDraft = async () => {
    const ok = await confirm({
      tone: 'danger', title: 'Delete this draft?', confirmLabel: 'Delete draft',
      message: <>“{h.title}” and its challenges and criteria are removed for good.</>,
    })
    if (!ok) return
    remove.mutate(undefined, {
      onSuccess: () => {
        toast({ title: 'Draft deleted' })
        navigate('/manage/hackathons')
      },
      onError: failed('Could not delete the draft'),
    })
  }

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
                <Button variant="danger" disabled={remove.isPending} onClick={() => void deleteDraft()}>Delete</Button>
                <Button
                  disabled={move.isPending}
                  onClick={moveTo(
                    'published',
                    { title: 'Hackathon published', message: 'It is live, and teams can start signing up.' },
                    {
                      title: 'Publish this hackathon?', confirmLabel: 'Publish', icon: 'megaphone',
                      message: 'Everyone can see it and form teams. Check the dates, challenges and criteria first.',
                    },
                  )}
                >
                  Publish
                </Button>
              </>
            )}
            {h.status === 'published' && (
              <>
                {cancel}
                <Button
                  disabled={move.isPending}
                  onClick={moveTo(
                    'judging',
                    { title: 'Judging has started', message: 'Judges can now score every project.' },
                    {
                      tone: 'warning', title: 'Start judging?', confirmLabel: 'Start judging', icon: 'gavel',
                      message: 'Submissions close, and teams and criteria can no longer change.',
                    },
                  )}
                >
                  Start judging
                </Button>
              </>
            )}
            {h.status === 'cancelled' && (
              <Button
                disabled={move.isPending}
                onClick={moveTo(
                  restoreTo,
                  { title: 'Hackathon restored', message: `It is ${restoreTo === 'judging' ? 'back in judging' : 'open again'}.` },
                  {
                    title: 'Restore this hackathon?', confirmLabel: 'Restore', icon: 'refresh',
                    message: `It goes back to ${restoreTo === 'judging' ? 'judging' : 'open'}, just as it was before it was cancelled.`,
                  },
                )}
              >
                Restore
              </Button>
            )}
            {h.status === 'judging' && (
              <>
                {cancel}
                <Button
                  disabled={move.isPending}
                  onClick={moveTo(
                    'completed',
                    { title: 'Results published', message: 'The leaderboard and projects are now public.' },
                    {
                      tone: 'warning', title: 'Publish the results?', confirmLabel: 'Publish results', icon: 'podium',
                      message: 'The leaderboard and every project become public, and the scores are final.',
                    },
                  )}
                >
                  Publish results
                </Button>
              </>
            )}
          </>
        }
      />
      <div className="mb-4 space-y-3 empty:hidden">
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
  const confirm = useConfirm()
  const toast = useToast()
  const removeItem = async (path: string, kind: string, name: string) => {
    if (!(await confirm({ tone: 'danger', title: `Remove this ${kind}?`, message: <>“{name}” is removed from the hackathon.</>, confirmLabel: 'Remove' }))) return
    remove.mutate(path, {
      onSuccess: () => toast({ title: `${kind[0].toUpperCase()}${kind.slice(1)} removed` }),
      onError: (error) => toast({ tone: 'error', title: `Could not remove the ${kind}`, message: error.message }),
    })
  }
  const criteriaLocked = h.status !== 'draft' && h.status !== 'published'
  const submit = (action: typeof addChallenge, reset: () => void) => (e: FormEvent) => {
    e.preventDefault()
    action.mutate(undefined, {
      onSuccess: () => {
        reset()
        toast({ title: action === addChallenge ? 'Challenge added' : 'Criterion added' })
      },
    })
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
              <Button variant="ghost" onClick={() => void removeItem(`challenges/${c.id}`, 'challenge', c.title)}>Remove</Button>
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
              {!criteriaLocked && <Button variant="ghost" onClick={() => void removeItem(`criteria/${c.id}`, 'criterion', c.name)}>Remove</Button>}
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
  const confirm = useConfirm()
  const toast = useToast()
  const removeJudge = async (j: Judge) => {
    const ok = await confirm({
      tone: 'danger', title: `Remove ${j.person.name}?`, confirmLabel: 'Remove judge',
      message: j.evaluations ? `They have scored ${j.evaluations} ${j.evaluations === 1 ? 'project' : 'projects'}. Those scores are deleted too.` : 'They have not scored anything yet.',
    })
    if (!ok) return
    remove.mutate(j.id, {
      onSuccess: () => toast({ title: 'Judge removed', message: `${j.person.name} can no longer score projects.` }),
      onError: (error) => toast({ tone: 'error', title: 'Could not remove the judge', message: error.message }),
    })
  }
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
                    <Button variant="ghost" onClick={() => void removeJudge(j)}>Remove</Button>
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
            add.mutate(undefined, {
              onSuccess: () => {
                toast({ title: 'Judge added', message: `${email} can now score projects.` })
                setEmail('')
              },
            })
          }}
        >
          <Field label="Email" hint="They must have signed in to Community at least once.">
            <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <ErrorNote error={add.error} />
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

// --- announcements ---------------------------------------------------------------

export function HackathonAnnouncements() {
  const h = useHackathon()
  const path = `/hackathons/${h.slug}/announcements/`
  const announcements = useQuery({ queryKey: ['hackathon', h.slug, 'announcements'], queryFn: () => api<Announcement[]>(path) })
  const [note, setNote] = useState({ title: '', body: '', notify: true })
  const post = useAct(() => api<Announcement & { emailed_to?: number }>(path, { method: 'POST', body: note }))
  const remove = useAct((id: number) => api(`${path}${id}/`, { method: 'DELETE' }))
  const confirm = useConfirm()
  const toast = useToast()
  const submit = (ev: FormEvent) => {
    ev.preventDefault()
    post.mutate(undefined, {
      onSuccess: (posted) => {
        setNote({ title: '', body: '', notify: note.notify })
        const sent = posted.emailed_to
        toast({
          title: 'Announcement posted',
          message: sent === undefined ? 'It is on the hackathon page.' : `It is on the hackathon page and was emailed to ${sent} ${sent === 1 ? 'person' : 'people'}.`,
        })
      },
    })
  }
  const removeAnnouncement = async (a: Announcement) => {
    if (!(await confirm({ tone: 'danger', title: 'Remove this announcement?', message: <>“{a.title}” disappears from the hackathon page. Emails already sent stay sent.</>, confirmLabel: 'Remove' }))) return
    remove.mutate(a.id, { onSuccess: () => toast({ title: 'Announcement removed' }) })
  }
  const list = announcements.data ?? []
  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <div className="lg:col-span-2">
        <Panel title="New announcement">
          <p className="mb-4 text-sm text-stone-600">Shown on the hackathon page. Use it for schedule changes, reminders and results news.</p>
          <form className="space-y-3" onSubmit={submit}>
            <Field label="Title">
              <Input required maxLength={200} value={note.title} onChange={(ev) => setNote({ ...note, title: ev.target.value })} />
            </Field>
            <Field label="Message" group>
              <RichTextEditor value={note.body} onChange={(body) => setNote((n) => ({ ...n, body }))} placeholder="What do teams and judges need to know?" minHeight="8rem" />
            </Field>
            <ErrorNote error={post.error} />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={note.notify} onChange={(ev) => setNote({ ...note, notify: ev.target.checked })} />
              Also email every team member and judge
            </label>
            <Button type="submit" disabled={post.isPending || !note.body}>Post announcement</Button>
          </form>
        </Panel>
      </div>
      <div className="lg:col-span-3">
        <Panel title={`Posted${list.length ? ` (${list.length})` : ''}`} flush>
          {announcements.isLoading ? (
            <Spinner />
          ) : list.length ? (
            <ul className="divide-y divide-stone-100">
              {list.map((a) => (
                <li key={a.id} className="flex items-start justify-between gap-3 px-5 py-4">
                  <div className="min-w-0">
                    <p className="font-semibold">{a.title}</p>
                    <p className="mb-1 text-xs text-stone-500">{formatDateTime(a.created_at)}</p>
                    <RichText html={a.body} className="text-sm" />
                  </div>
                  <Button variant="ghost" onClick={() => void removeAnnouncement(a)}>Remove</Button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex flex-col items-center px-5 py-10 text-center">
              <span className="mb-3 grid h-11 w-11 place-items-center rounded-full bg-stone-100 text-stone-500"><Icon name="megaphone" /></span>
              <p className="font-semibold">No announcements yet</p>
              <p className="text-sm text-stone-600">Post a welcome note so teams know what happens next.</p>
            </div>
          )}
        </Panel>
      </div>
    </div>
  )
}
