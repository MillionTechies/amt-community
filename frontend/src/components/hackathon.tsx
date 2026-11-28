/** Pieces shared by the hackathon pages. */
import { useQuery } from '@tanstack/react-query'

import { api } from '../api'
import type { Announcement, Hackathon, LeaderboardRow, Submission } from '../api'
import { RichText } from './RichText'
import { Badge, Card, Section, formatDateTime } from './ui'

/** News from the organisers, newest first. */
export function Announcements({ slug }: { slug: string }) {
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

export const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`

/** Registration, hacking, submissions and the end, struck through once they pass. */
export function KeyDates({ hackathon: h }: { hackathon: Hackathon }) {
  return (
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
  )
}

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
