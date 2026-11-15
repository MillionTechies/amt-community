import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { api } from '../api'
import type { Hackathon, Judge, LeaderboardRow, Team } from '../api'
import { Leaderboard } from '../components/hackathon'
import {
  Badge, Button, Empty, ErrorNote, Field, Input, LinkButton, Notice, PageHeader, Section, Spinner,
  Stat, StatusBadge, Tabs,
} from '../components/ui'
import { useAct } from '../hooks'

type Tab = 'setup' | 'teams' | 'judges' | 'results'

export default function HackathonManage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('setup')
  const hackathon = useQuery({ queryKey: ['hackathon', id], queryFn: () => api<Hackathon>(`/hackathons/${id}/`) })
  const move = useAct((status: string) => api(`/hackathons/${id}/transition/`, { method: 'POST', body: { status } }))
  const remove = useAct(() => api(`/hackathons/${id}/`, { method: 'DELETE' }))

  if (hackathon.isLoading) return <Spinner />
  if (!hackathon.data) return <ErrorNote error={hackathon.error ?? 'Hackathon not found.'} />
  const h = hackathon.data
  if (!h.can_manage) return <Empty>You do not manage this hackathon.</Empty>
  const confirmMove = (status: string, question: string) => () => window.confirm(question) && move.mutate(status)
  const cancel = (
    <Button variant="danger" onClick={confirmMove('cancelled', 'Cancel this hackathon? This cannot be undone.')}>Cancel hackathon</Button>
  )

  return (
    <>
      <PageHeader
        title={h.title}
        subtitle={<span className="flex items-center gap-2"><StatusBadge status={h.status} /> {h.organization.name}</span>}
        action={
          <div className="flex flex-wrap gap-2">
            <LinkButton to={`/hackathons/${h.id}`} variant="secondary">View page</LinkButton>
            <LinkButton to={`/hackathons/${h.id}/edit`} variant="secondary">Edit details</LinkButton>
            {h.status === 'draft' && (
              <>
                <Button disabled={move.isPending} onClick={() => move.mutate('published')}>Publish</Button>
                <Button variant="danger" onClick={() => window.confirm('Delete this draft?') && remove.mutate(undefined, { onSuccess: () => navigate('/hackathons') })}>Delete</Button>
              </>
            )}
            {h.status === 'published' && (
              <>
                <Button onClick={confirmMove('judging', 'Start judging? Submissions close, and teams and criteria can no longer change.')}>Start judging</Button>
                {cancel}
              </>
            )}
            {h.status === 'judging' && (
              <>
                <Button onClick={confirmMove('completed', 'Publish the results? The leaderboard and all projects become public, and scores are final.')}>Publish results</Button>
                {cancel}
              </>
            )}
          </div>
        }
      />
      <div className="mb-4"><ErrorNote error={move.error ?? remove.error} /></div>
      {h.status === 'draft' && (
        <div className="mb-4"><Notice tone="amber">This is a draft. Only managers can see it until you publish.</Notice></div>
      )}
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Participants" value={h.participant_count} />
        <Stat label="Teams" value={h.team_count} />
        <Stat label="Projects submitted" value={h.submission_count} />
        <Stat label="Judging criteria" value={h.criteria.length} />
      </div>
      <Tabs
        tabs={[
          { id: 'setup', label: 'Challenges and criteria' },
          { id: 'teams', label: 'Teams' },
          { id: 'judges', label: 'Judges' },
          { id: 'results', label: 'Leaderboard' },
        ]}
        current={tab}
        onChange={setTab}
      />
      {tab === 'setup' && <Setup hackathon={h} />}
      {tab === 'teams' && <Teams id={h.id} />}
      {tab === 'judges' && <Judges id={h.id} />}
      {tab === 'results' && <Results hackathon={h} />}
    </>
  )
}

function Setup({ hackathon: h }: { hackathon: Hackathon }) {
  const [challenge, setChallenge] = useState({ title: '', description: '' })
  const [criterion, setCriterion] = useState({ name: '', description: '', max_score: '10', weight: '1' })
  const addChallenge = useAct(() => api(`/hackathons/${h.id}/challenges/`, { method: 'POST', body: challenge }))
  const addCriterion = useAct(() =>
    api(`/hackathons/${h.id}/criteria/`, {
      method: 'POST',
      body: { ...criterion, max_score: Number(criterion.max_score), weight: Number(criterion.weight) },
    }),
  )
  const remove = useAct((path: string) => api(`/hackathons/${h.id}/${path}/`, { method: 'DELETE' }))
  const criteriaLocked = h.status !== 'draft' && h.status !== 'published'
  const submit = (action: typeof addChallenge, reset: () => void) => (e: FormEvent) => {
    e.preventDefault()
    action.mutate(undefined, { onSuccess: reset })
  }
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Section title="Challenges">
        <p className="mb-3 text-sm text-stone-600">Optional problem statements or tracks teams can build for.</p>
        <ul className="mb-4 divide-y divide-stone-200">
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
        <form className="space-y-3" onSubmit={submit(addChallenge, () => setChallenge({ title: '', description: '' }))}>
          <Field label="Title"><Input required value={challenge.title} onChange={(e) => setChallenge({ ...challenge, title: e.target.value })} /></Field>
          <Field label="Description"><Input value={challenge.description} onChange={(e) => setChallenge({ ...challenge, description: e.target.value })} /></Field>
          <ErrorNote error={addChallenge.error} />
          <Button type="submit" variant="secondary" disabled={addChallenge.isPending}>Add challenge</Button>
        </form>
      </Section>
      <Section title="Judging criteria">
        <p className="mb-3 text-sm text-stone-600">
          Judges score every project on each criterion. A weight of 2 makes a criterion count twice.
        </p>
        <ul className="mb-4 divide-y divide-stone-200">
          {h.criteria.map((c) => (
            <li key={c.id} className="flex items-start justify-between gap-2 py-3">
              <div>
                <p className="font-semibold">{c.name}</p>
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
          <form className="space-y-3" onSubmit={submit(addCriterion, () => setCriterion({ name: '', description: '', max_score: '10', weight: '1' }))}>
            <Field label="Name" hint="For example: Innovation, Technical execution, Impact.">
              <Input required value={criterion.name} onChange={(e) => setCriterion({ ...criterion, name: e.target.value })} />
            </Field>
            <Field label="What judges should look for"><Input value={criterion.description} onChange={(e) => setCriterion({ ...criterion, description: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Highest score"><Input type="number" min={1} max={100} required value={criterion.max_score} onChange={(e) => setCriterion({ ...criterion, max_score: e.target.value })} /></Field>
              <Field label="Weight"><Input type="number" min={1} max={100} required value={criterion.weight} onChange={(e) => setCriterion({ ...criterion, weight: e.target.value })} /></Field>
            </div>
            <ErrorNote error={addCriterion.error} />
            <Button type="submit" variant="secondary" disabled={addCriterion.isPending}>Add criterion</Button>
          </form>
        )}
      </Section>
    </div>
  )
}

function Teams({ id }: { id: number }) {
  const teams = useQuery({ queryKey: ['hackathon', id, 'teams'], queryFn: () => api<Team[]>(`/hackathons/${id}/teams/`) })
  if (!teams.data) return <Spinner />
  if (!teams.data.length) return <Empty>No teams have registered yet.</Empty>
  return (
    <Section title={`${teams.data.length} teams`}>
      <ul className="divide-y divide-stone-200">
        {teams.data.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
            <div>
              <p className="font-semibold">{t.name}</p>
              <p className="text-sm text-stone-600">{t.members.map((m) => m.person.name).join(', ')}</p>
            </div>
            <Badge tone={t.has_submission ? 'green' : 'grey'}>{t.has_submission ? 'Submitted' : 'No submission yet'}</Badge>
          </li>
        ))}
      </ul>
    </Section>
  )
}

function Judges({ id }: { id: number }) {
  const judges = useQuery({ queryKey: ['hackathon', id, 'judges'], queryFn: () => api<Judge[]>(`/hackathons/${id}/judges/`) })
  const [email, setEmail] = useState('')
  const add = useAct(() => api(`/hackathons/${id}/judges/`, { method: 'POST', body: { email } }))
  const remove = useAct((judge: number) => api(`/hackathons/${id}/judges/${judge}/`, { method: 'DELETE' }))
  return (
    <Section title="Judges">
      <form
        className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end"
        onSubmit={(e) => {
          e.preventDefault()
          add.mutate(undefined, { onSuccess: () => setEmail('') })
        }}
      >
        <div className="flex-1">
          <Field label="Add a judge by email" hint="They must have signed in to Community at least once.">
            <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
        </div>
        <Button type="submit" disabled={add.isPending} className="sm:mb-5">Add judge</Button>
      </form>
      <ErrorNote error={add.error ?? remove.error} />
      {judges.data?.length ? (
        <ul className="divide-y divide-stone-200">
          {judges.data.map((j) => (
            <li key={j.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <div>
                <p className="font-semibold">{j.person.name}</p>
                <p className="text-sm text-stone-600">{j.email}, {j.evaluations} projects scored</p>
              </div>
              <Button variant="ghost" onClick={() => window.confirm(`Remove ${j.person.name}? Their scores are deleted too.`) && remove.mutate(j.id)}>Remove</Button>
            </li>
          ))}
        </ul>
      ) : (
        judges.data && <p className="text-stone-600">No judges yet. Every judge scores every project.</p>
      )}
    </Section>
  )
}

function Results({ hackathon: h }: { hackathon: Hackathon }) {
  const board = useQuery({ queryKey: ['hackathon', h.id, 'leaderboard'], queryFn: () => api<LeaderboardRow[]>(`/hackathons/${h.id}/leaderboard/`) })
  if (!board.data) return <Spinner />
  if (!board.data.length) return <Empty>No projects have been submitted yet.</Empty>
  return (
    <Section title="Leaderboard">
      <p className="mb-2 text-sm text-stone-600">
        {h.results_published
          ? 'These results are public.'
          : 'Only managers see this until you publish the results. A score is the average across judges, as a percentage of the weighted marks.'}
      </p>
      <Leaderboard rows={board.data} />
    </Section>
  )
}
