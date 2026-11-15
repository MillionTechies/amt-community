/** Pieces shared by the hackathon pages. */
import type { LeaderboardRow, Submission } from '../api'
import { Badge } from './ui'

export function ProjectLinks({ submission }: { submission: Submission }) {
  const links = [
    ['Repository', submission.repository_url],
    ['Live demo', submission.demo_url],
    ['Video', submission.video_url],
  ].filter(([, url]) => url)
  return (
    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
      {links.map(([name, url]) => (
        <a key={name} className="font-semibold text-brand-700 hover:underline" href={url} target="_blank" rel="noreferrer">
          {name}
        </a>
      ))}
    </div>
  )
}

export function Leaderboard({ rows }: { rows: LeaderboardRow[] }) {
  return (
    <ol className="divide-y divide-stone-200">
      {rows.map((row) => (
        <li key={row.submission.id} className="flex gap-4 py-4">
          <div
            className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-sm font-bold ${
              row.rank === 1 ? 'bg-amber-400 text-amber-950' : 'bg-stone-200 text-stone-700'
            }`}
            aria-label={row.rank ? `Rank ${row.rank}` : 'Not ranked'}
          >
            {row.rank ?? '-'}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-semibold">{row.submission.title}</p>
              {row.submission.challenge && <Badge tone="blue">{row.submission.challenge.title}</Badge>}
            </div>
            <p className="text-sm text-stone-600">by {row.submission.team_name}</p>
            <ProjectLinks submission={row.submission} />
          </div>
          <div className="text-right">
            <p className="text-xl font-bold">{row.score === null ? 'No scores' : `${row.score.toFixed(1)}%`}</p>
            <p className="text-xs text-stone-500">
              {row.evaluations} of {row.judges} judges
            </p>
          </div>
        </li>
      ))}
    </ol>
  )
}
