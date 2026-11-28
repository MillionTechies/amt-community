/** The judge's own area: every hackathon they judge and how far along their scoring is. */
import { useQuery } from '@tanstack/react-query'

import { api } from '../api'
import type { Hackathon, Paginated } from '../api'
import { Card, Empty, ErrorNote, LinkButton, PageHeader, Spinner, StatusBadge, formatRange } from '../components/ui'
import { Meter } from '../console/shared'

const scoringNote: Record<string, string> = {
  published: 'Scoring opens when submissions close.',
  judging: 'Scoring is open.',
  completed: 'Judging is over.',
  cancelled: 'This hackathon was cancelled.',
}

export default function JudgeDesk() {
  const hackathons = useQuery({
    queryKey: ['hackathons', 'judging'],
    queryFn: () => api<Paginated<Hackathon>>('/hackathons/?scope=judging&ordering=-starts_at'),
  })
  if (hackathons.isLoading) return <Spinner />
  if (!hackathons.data) return <ErrorNote error={hackathons.error} />
  const list = hackathons.data.results
  return (
    <>
      <PageHeader eyebrow="Judging" title="Your judging" subtitle="Score every project on each criterion. Your scores stay private until the results are published." />
      {list.length ? (
        <ul className="grid gap-4 md:grid-cols-2">
          {list.map((h) => {
            const scored = h.my_scores ?? 0
            return (
              <li key={h.slug}>
                <Card className="flex h-full flex-col gap-3">
                  <div className="flex items-center gap-2"><StatusBadge status={h.status} /><span className="text-xs text-stone-500">{h.organization.name}</span></div>
                  <h2 className="text-lg font-semibold">{h.title}</h2>
                  <p className="text-sm text-stone-600">{formatRange(h.starts_at, h.ends_at)}</p>
                  <p className="text-sm text-stone-600">{scoringNote[h.status]}</p>
                  <div>
                    <p className="mb-1 font-mono text-xs tabular-nums text-stone-600">{scored} of {h.submission_count} projects scored</p>
                    <Meter value={scored} max={Math.max(1, h.submission_count)} label={`${h.title}: projects scored`} />
                  </div>
                  <div className="mt-auto"><LinkButton to={`/hackathons/${h.slug}/judge`}>{h.status === 'judging' ? 'Score projects' : 'Open'}</LinkButton></div>
                </Card>
              </li>
            )
          })}
        </ul>
      ) : (
        <Empty>You are not judging any hackathons. Organisers invite judges by email.</Empty>
      )}
    </>
  )
}
