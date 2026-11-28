import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useAuth } from 'react-oidc-context'
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'

import { api } from '../api'
import type { Hackathon, JudgedSubmission, LeaderboardRow } from '../api'
import { Announcements, KeyDates, Leaderboard, ProjectLinks, count } from '../components/hackathon'
import {
  Badge, Button, Card, ErrorNote, LinkButton, Notice, Prose, Section, Spinner, StatusBadge, formatRange,
} from '../components/ui'
import { Cover } from '../components/cards'
import { RichText } from '../components/RichText'
import { Icon } from '../components/icons'
import type { IconName } from '../components/icons'
import { ReadMore, StickyAction, useScrolledPast } from '../components/mobile'
import { useToast } from '../components/feedback'
import { useAct, useSignIn } from '../hooks'

export default function HackathonDetail() {
  const { slug } = useParams()
  // Invite links from before 6-digit codes: /hackathons/<slug>?join=<code>.
  const code = useSearchParams()[0].get('join')
  const hackathon = useQuery({ queryKey: ['hackathon', slug], queryFn: () => api<Hackathon>(`/hackathons/${slug}/`) })
  const [actionRef, scrolledPast] = useScrolledPast()
  if (code) return <Navigate replace to={`/join?code=${code}`} />
  if (hackathon.isLoading) return <Spinner />
  if (!hackathon.data) return <ErrorNote error={hackathon.error ?? 'Hackathon not found.'} />
  const h = hackathon.data
  const teamSize =
    h.min_team_size === h.max_team_size
      ? `Teams of ${h.max_team_size}`
      : `Teams of ${h.min_team_size} to ${h.max_team_size}`
  const canJoin = !h.is_registered && !h.is_judge && h.registration_open
  // Taking part comes first on a phone while it matters; for a finished hackathon, the results do.
  const involved = h.is_registered || h.is_judge || h.status === 'published' || h.status === 'draft'

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
              <TakePart hackathon={h} />
            )}
          </div>
          <KeyDates hackathon={h} />
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

/** Registering is one click; the team, the project and the rest happen in the workspace. */
function TakePart({ hackathon: h }: { hackathon: Hackathon }) {
  const auth = useAuth()
  const signIn = useSignIn()
  const navigate = useNavigate()
  const toast = useToast()
  const workspace = `/hackathons/${h.slug}/workspace`
  const register = useAct(() => api(`/hackathons/${h.slug}/registration/`, { method: 'POST' }))

  if (h.is_registered) {
    return (
      <Card className="space-y-3">
        <p className="text-lg font-bold">You are registered</p>
        <p className="text-sm text-stone-600">
          {h.my_team_id ? 'Your team, project and teammates are in your workspace.' : 'Find a team or start one in your workspace.'}
        </p>
        <LinkButton to={workspace}>Open your workspace</LinkButton>
      </Card>
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
  return (
    <Card className="space-y-3">
      <p className="text-lg font-bold">Take part</p>
      <p className="text-sm text-stone-600">Register first. You can find a team or start one afterwards.</p>
      {auth.isAuthenticated ? (
        <>
          <ErrorNote error={register.error} />
          <Button
            className="w-full"
            disabled={register.isPending}
            onClick={() =>
              register.mutate(undefined, {
                onSuccess: () => {
                  toast({ title: 'You are registered', message: 'Now find a team or start one.' })
                  navigate(workspace)
                },
              })
            }
          >
            Register
          </Button>
        </>
      ) : (
        <Button className="w-full" onClick={signIn}>Sign in to register</Button>
      )}
      <Link to="/join" className="block text-center text-sm font-semibold text-brand-700 hover:underline">Have a code?</Link>
    </Card>
  )
}
