import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useParams } from 'react-router-dom'

import { api } from '../api'
import type { Hackathon, JudgedSubmission } from '../api'
import { ProjectLinks } from '../components/hackathon'
import {
  Badge, Button, Card, Empty, ErrorNote, Field, Input, LinkButton, Notice, PageHeader, Prose, Spinner,
  Textarea,
} from '../components/ui'
import { useAct } from '../hooks'

export default function Judging() {
  const { id } = useParams()
  const hackathon = useQuery({ queryKey: ['hackathon', id], queryFn: () => api<Hackathon>(`/hackathons/${id}/`) })
  const submissions = useQuery({
    queryKey: ['hackathon', id, 'submissions'],
    queryFn: () => api<JudgedSubmission[]>(`/hackathons/${id}/submissions/`),
    enabled: !!hackathon.data?.is_judge,
  })
  if (hackathon.isLoading) return <Spinner />
  if (!hackathon.data) return <ErrorNote error={hackathon.error ?? 'Hackathon not found.'} />
  const h = hackathon.data
  if (!h.is_judge) return <Empty>You are not a judge for this hackathon.</Empty>
  const open = h.status === 'judging'
  const done = submissions.data?.filter((s) => s.my_evaluation).length ?? 0

  return (
    <>
      <PageHeader
        title={`Judging: ${h.title}`}
        subtitle={submissions.data && `You have scored ${done} of ${submissions.data.length} projects.`}
        action={<LinkButton to={`/hackathons/${h.id}`} variant="secondary">Hackathon page</LinkButton>}
      />
      {!open && (
        <div className="mb-4">
          <Notice tone="amber">
            {h.status === 'published'
              ? 'Scoring opens when the organisers close submissions. You can read the projects submitted so far.'
              : 'Judging is over. Scores can no longer be changed.'}
          </Notice>
        </div>
      )}
      {!submissions.data ? (
        <Spinner />
      ) : !submissions.data.length ? (
        <Empty>No projects have been submitted yet.</Empty>
      ) : (
        <div className="space-y-6">
          {submissions.data.map((s) => <ScoreCard key={s.id} hackathon={h} submission={s} open={open} />)}
        </div>
      )}
    </>
  )
}

function ScoreCard({ hackathon: h, submission: s, open }: { hackathon: Hackathon; submission: JudgedSubmission; open: boolean }) {
  const given = Object.fromEntries(s.my_evaluation?.scores.map((x) => [x.criterion, String(x.value)]) ?? [])
  const [scores, setScores] = useState<Record<number, string>>(given)
  const [comment, setComment] = useState(s.my_evaluation?.comment ?? '')
  const save = useAct(() =>
    api(`/hackathons/${h.id}/submissions/${s.id}/evaluation/`, {
      method: 'PUT',
      body: {
        comment,
        scores: h.criteria.map((c) => ({ criterion: c.id, value: Number(scores[c.id]) })),
      },
    }),
  )
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">{s.title}</h2>
        {s.challenge && <Badge tone="blue">{s.challenge.title}</Badge>}
        {s.my_evaluation ? <Badge tone="green">Scored</Badge> : <Badge tone="amber">Not scored</Badge>}
      </div>
      <p className="text-sm text-stone-600">{s.team_name}: {s.members.join(', ')}</p>
      <div className="mt-3"><Prose>{s.description}</Prose></div>
      <ProjectLinks submission={s} />
      <form
        className="mt-5 space-y-4 border-t border-stone-200 pt-5"
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate()
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {h.criteria.map((c) => (
            <Field key={c.id} label={`${c.name} (0 to ${c.max_score})`} hint={c.description}>
              <Input
                type="number"
                min={0}
                max={c.max_score}
                required
                disabled={!open}
                value={scores[c.id] ?? ''}
                onChange={(e) => setScores({ ...scores, [c.id]: e.target.value })}
              />
            </Field>
          ))}
        </div>
        <Field label="Comment (optional)" hint="A note to go with your scores.">
          <Textarea rows={2} disabled={!open} value={comment} onChange={(e) => setComment(e.target.value)} />
        </Field>
        <ErrorNote error={save.error} />
        {save.isSuccess && <Notice>Scores saved.</Notice>}
        {open && <Button type="submit" disabled={save.isPending}>{s.my_evaluation ? 'Update scores' : 'Save scores'}</Button>}
      </form>
    </Card>
  )
}
