import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useAuth } from 'react-oidc-context'
import { Link } from 'react-router-dom'

import { api } from '../api'
import type { CommunityEvent, Hackathon, Paginated } from '../api'
import { StatusBadge, formatDate, label } from '../components/ui'
import { useMe, useSignIn, useSignUp } from '../hooks'

const wrap = 'mx-auto w-full max-w-6xl px-4 sm:px-6'
const month = new Intl.DateTimeFormat('en-GB', { month: 'short' })
const weekday = new Intl.DateTimeFormat('en-GB', { weekday: 'short' })
const time = new Intl.DateTimeFormat('en-GB', { timeStyle: 'short' })

function Arrow({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3 8h10m0 0L9 4m4 4-4 4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function places(event: CommunityEvent) {
  if (event.spots_left === null) return `${event.registered_count} going`
  if (event.spots_left === 0) return 'Full · waitlist open'
  return `${event.spots_left} ${event.spots_left === 1 ? 'place' : 'places'} left`
}

function Eyebrow({ children, dark = false }: { children: ReactNode; dark?: boolean }) {
  return (
    <p className={`mb-4 text-xs font-semibold uppercase tracking-[0.2em] ${dark ? 'text-brand-200' : 'text-brand-700'}`}>
      {children}
    </p>
  )
}

/** Decorative barcode, stable per event so it does not change between renders. */
function Barcode({ seed }: { seed: number }) {
  const bars = Array.from({ length: 30 }, (_, i) => ((seed * 9301 + i * 49297) % 233) % 4)
  return (
    <div className="flex h-10 items-stretch gap-[2px]" aria-hidden="true">
      {bars.map((w, i) => (
        <span key={i} className="bg-ink" style={{ width: w + 1 }} />
      ))}
    </div>
  )
}

/** The next upcoming event, drawn as an admission ticket. */
function NextTicket({ event, loading }: { event?: CommunityEvent; loading: boolean }) {
  const shell = 'relative rounded-3xl bg-white shadow-[0_30px_60px_-20px_rgba(16,32,28,0.25)] ring-1 ring-stone-200'
  const notches = (
    <>
      <span className="absolute -left-3 top-1/2 h-6 w-6 -translate-y-1/2 rounded-full bg-stone-50 ring-1 ring-stone-200 [clip-path:inset(0_0_0_50%)]" />
      <span className="absolute -right-3 top-1/2 h-6 w-6 -translate-y-1/2 rounded-full bg-stone-50 ring-1 ring-stone-200 [clip-path:inset(0_50%_0_0)]" />
    </>
  )

  if (loading) return <div className={`${shell} h-[22rem] animate-pulse`} />

  if (!event) {
    return (
      <div className={`${shell} p-8`}>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">Next up</p>
        <p className="mt-6 font-display text-3xl font-bold leading-tight">Nothing on the calendar yet.</p>
        <p className="mt-3 text-stone-600">New workshops, meetups and hackathons show up here first.</p>
      </div>
    )
  }

  const start = new Date(event.starts_at)
  return (
    <Link to={`/events/${event.id}`} className="group block focus-visible:outline-none">
      <div className={`${shell} transition duration-500 group-hover:-translate-y-1 group-focus-visible:ring-2 group-focus-visible:ring-brand-600`}>
        <div className="p-7 sm:p-8">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">Next up</p>
            <span className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-800">
              {label(event.delivery_mode)}
            </span>
          </div>
          <div className="mt-6 flex items-start gap-5">
            <div className="shrink-0 text-center">
              <p className="font-display text-5xl font-bold leading-none tracking-tight">{start.getDate()}</p>
              <p className="mt-1 text-sm font-semibold uppercase tracking-wider text-brand-700">{month.format(start)}</p>
            </div>
            <div className="min-w-0 border-l border-stone-200 pl-5">
              <p className="font-display text-2xl font-bold leading-snug">{event.title}</p>
              <p className="mt-1 text-sm text-stone-600">
                {weekday.format(start)} · {time.format(start)} · {event.organization.name}
              </p>
            </div>
          </div>
        </div>
        <div className="relative border-t-2 border-dashed border-stone-200">{notches}</div>
        <div className="flex items-center justify-between gap-4 p-7 sm:p-8">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-stone-500">{label(event.event_type)}</p>
            <p className="mt-1 text-sm font-semibold">{places(event)}</p>
          </div>
          <Barcode seed={event.id} />
        </div>
      </div>
    </Link>
  )
}

const steps = [
  {
    title: 'Register',
    body: 'One account for every event. If it is full, you join the waitlist and move up when a place frees.',
  },
  {
    title: 'Check in',
    body: 'Your ticket carries a QR code. Show it at the door and the organisers scan you in.',
  },
  {
    title: 'Build',
    body: 'Form a team, pick a challenge and submit before the deadline. Judges score against published criteria.',
  },
  {
    title: 'Keep the record',
    body: 'Attend and you get a certificate with its own link, so anyone can check it is real.',
  },
]

function EventRow({ event }: { event: CommunityEvent }) {
  const start = new Date(event.starts_at)
  return (
    <li>
      <Link
        to={`/events/${event.id}`}
        className="group grid grid-cols-[3.5rem_1fr] items-center gap-x-5 gap-y-2 py-6 transition sm:grid-cols-[4.5rem_1fr_auto] sm:gap-x-8"
      >
        <div className="text-center">
          <p className="font-display text-3xl font-bold leading-none sm:text-4xl">{start.getDate()}</p>
          <p className="mt-1 text-xs font-semibold uppercase tracking-wider text-stone-500">{month.format(start)}</p>
        </div>
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-brand-700">
            {label(event.event_type)} · {label(event.delivery_mode)}
          </p>
          <p className="mt-1 font-display text-xl font-bold leading-snug transition sm:truncate group-hover:text-brand-700 sm:text-2xl">
            {event.title}
          </p>
          <p className="mt-1 truncate text-sm text-stone-600">
            {event.organization.name} · {time.format(start)}
            {event.summary && <span className="hidden md:inline"> · {event.summary}</span>}
          </p>
        </div>
        <div className="col-start-2 flex items-center gap-4 text-sm text-stone-600 sm:col-start-3">
          <span>{places(event)}</span>
          <span className="hidden h-10 w-10 place-items-center rounded-full border border-stone-300 transition group-hover:border-ink group-hover:bg-ink group-hover:text-white sm:grid">
            <Arrow />
          </span>
        </div>
      </Link>
    </li>
  )
}

/** The hackathon most worth showing: open for sign-ups first, then running, then finished. */
function pickFeatured(hackathons: Hackathon[]) {
  const live = hackathons.filter((h) => h.status !== 'cancelled' && h.status !== 'draft')
  const rank = (h: Hackathon) =>
    h.registration_open ? 0 : h.status === 'published' ? 1 : h.status === 'judging' ? 2 : 3
  return [...live].sort((a, b) => rank(a) - rank(b))
}

function HackathonSpotlight({ hackathons }: { hackathons: Hackathon[] }) {
  const [featured, ...rest] = pickFeatured(hackathons)
  if (!featured) {
    return (
      <div className="rounded-3xl border border-white/10 p-10 text-center text-brand-100">
        No hackathons yet. The first one will be announced here.
      </div>
    )
  }
  const facts = [
    ['Teams', featured.team_count],
    ['Builders', featured.participant_count],
    ['Team size', `${featured.min_team_size}–${featured.max_team_size}`],
    ['Challenges', featured.challenges.length],
  ] as const
  return (
    <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
      <Link
        to={`/hackathons/${featured.id}`}
        className="group relative overflow-hidden rounded-3xl bg-white/[0.04] p-8 ring-1 ring-white/10 transition hover:bg-white/[0.07] sm:p-10"
      >
        <div className="glow pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full" />
        <div className="relative">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={featured.status} />
            {featured.theme && (
              <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-xs font-semibold text-white">{featured.theme}</span>
            )}
          </div>
          <h3 className="mt-6 max-w-xl font-display text-4xl font-bold leading-[1.05] tracking-tight sm:text-5xl">
            {featured.title}
          </h3>
          {featured.tagline && <p className="mt-4 max-w-lg text-lg text-brand-100">{featured.tagline}</p>}
          <p className="mt-6 text-sm text-brand-200">
            {formatDate(featured.starts_at)} to {formatDate(featured.ends_at)} · {featured.organization.name}
          </p>
          <dl className="mt-8 grid grid-cols-2 gap-6 border-t border-white/10 pt-6 sm:grid-cols-4">
            {facts.map(([name, value]) => (
              <div key={name}>
                <dt className="text-xs uppercase tracking-wider text-brand-200">{name}</dt>
                <dd className="mt-1 font-display text-2xl font-bold">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-8 inline-flex items-center gap-2 text-sm font-semibold">
            {featured.registration_open ? `Register by ${formatDate(featured.registration_deadline)}` : 'See the hackathon'}
            <Arrow className="transition group-hover:translate-x-1" />
          </p>
        </div>
      </Link>
      <div className="flex flex-col gap-4">
        {rest.slice(0, 3).map((h) => (
          <Link
            key={h.id}
            to={`/hackathons/${h.id}`}
            className="group flex flex-1 flex-col justify-between rounded-3xl p-6 ring-1 ring-white/10 transition hover:bg-white/[0.05]"
          >
            <div>
              <p className="text-xs uppercase tracking-wider text-brand-200">
                {label(h.status === 'published' ? 'open' : h.status)} · {formatDate(h.starts_at)}
              </p>
              <p className="mt-2 font-display text-xl font-bold leading-snug">{h.title}</p>
            </div>
            <p className="mt-4 flex items-center justify-between text-sm text-brand-100">
              {h.team_count} {h.team_count === 1 ? 'team' : 'teams'}
              <Arrow className="transition group-hover:translate-x-1" />
            </p>
          </Link>
        ))}
        <Link
          to="/hackathons"
          className="group flex items-center justify-between rounded-3xl bg-brand-500 p-6 font-semibold text-ink transition hover:bg-brand-200"
        >
          All hackathons
          <Arrow className="transition group-hover:translate-x-1" />
        </Link>
      </div>
    </div>
  )
}

const organiserTools = [
  ['Publish events', 'Set capacity, deadlines and who can attend. The waitlist runs itself.'],
  ['Scan people in', 'Check attendees in from a phone with the built-in QR scanner.'],
  ['Run hackathons', 'Teams, challenges, submissions, judges and weighted scoring in one place.'],
  ['Issue certificates', 'Attendees get verifiable certificates without you making a single PDF.'],
] as const

export default function Home() {
  const auth = useAuth()
  const me = useMe()
  const signIn = useSignIn()
  const signUp = useSignUp()
  const events = useQuery({
    queryKey: ['events', 'home'],
    queryFn: () => api<Paginated<CommunityEvent>>('/events/?when=upcoming&status=published&ordering=starts_at'),
  })
  const hackathons = useQuery({
    queryKey: ['hackathons', 'home'],
    queryFn: () => api<Paginated<Hackathon>>('/hackathons/'),
  })
  const upcoming = events.data?.results ?? []
  const canOrganise = me?.organizations.some((o) => o.can_manage_events)

  const primary = 'inline-flex items-center gap-2 rounded-full bg-ink px-6 py-3 text-sm font-semibold text-white transition hover:bg-brand-800'
  const secondary = 'inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-semibold text-ink ring-1 ring-stone-300 transition hover:bg-white hover:ring-stone-400'

  return (
    <div>
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-stone-200">
        <div className="grid-lines pointer-events-none absolute inset-0" aria-hidden="true" />
        <div className={`${wrap} relative grid items-center gap-14 py-16 sm:py-24 lg:grid-cols-[1.25fr_1fr] lg:py-28`}>
          <div className="rise">
            <p className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-stone-700 ring-1 ring-stone-200">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-500 opacity-60 motion-reduce:hidden" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-brand-500" />
              </span>
              {events.data?.count
                ? `${events.data.count} upcoming ${events.data.count === 1 ? 'event' : 'events'}`
                : 'Workshops · Meetups · Hackathons'}
            </p>
            <h1 className="mt-7 font-display text-5xl font-bold leading-[0.95] tracking-tight sm:text-7xl lg:text-[5.5rem]">
              Learn it.
              <br />
              Then build it{' '}
              <span className="relative whitespace-nowrap text-brand-700">
                together
                <svg className="absolute -bottom-2 left-0 w-full text-brand-500" viewBox="0 0 200 12" preserveAspectRatio="none" aria-hidden="true">
                  <path className="draw" d="M2 9C50 3 150 3 198 8" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
                </svg>
              </span>
              .
            </h1>
            <p className="mt-7 max-w-lg text-lg leading-relaxed text-stone-600">
              Workshops, meetups and hackathons run by universities, developer communities and
              A Million Techies. Register once, turn up, build something and keep the record.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link to="/events" className={primary}>
                Find an event <Arrow />
              </Link>
              <Link to="/hackathons" className={secondary}>
                See hackathons
              </Link>
              {!auth.isAuthenticated && (
                <button type="button" onClick={signUp} className="px-3 py-3 text-sm font-semibold text-brand-700 hover:text-brand-900">
                  Join free
                </button>
              )}
            </div>
          </div>
          <div className="rise relative mx-auto w-full max-w-md [animation-delay:150ms]">
            <div className="absolute inset-0 translate-x-3 translate-y-3 rotate-3 rounded-3xl bg-brand-600" aria-hidden="true" />
            <div className="relative -rotate-2 transition duration-500 hover:rotate-0">
              <NextTicket event={upcoming[0]} loading={events.isLoading} />
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className={`${wrap} py-20 sm:py-28`}>
        <div className="max-w-2xl">
          <Eyebrow>How it works</Eyebrow>
          <h2 className="font-display text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
            From sign-up to something you can show.
          </h2>
        </div>
        <ol className="mt-14 grid gap-px overflow-hidden rounded-3xl bg-stone-200 ring-1 ring-stone-200 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((step, i) => (
            <li key={step.title} className="bg-stone-50 p-7 transition hover:bg-white">
              <p className="font-display text-sm font-bold text-brand-600">0{i + 1}</p>
              <p className="mt-4 font-display text-2xl font-bold lg:mt-10">{step.title}</p>
              <p className="mt-3 text-sm leading-relaxed text-stone-600">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Agenda */}
      <section className="border-y border-stone-200 bg-white">
        <div className={`${wrap} py-20 sm:py-28`}>
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div>
              <Eyebrow>Coming up</Eyebrow>
              <h2 className="font-display text-4xl font-bold tracking-tight sm:text-5xl">On the calendar</h2>
            </div>
            <Link to="/events" className="group inline-flex items-center gap-2 text-sm font-semibold text-ink">
              All events <Arrow className="transition group-hover:translate-x-1" />
            </Link>
          </div>
          {events.isLoading ? (
            <div className="mt-10 space-y-3">
              {[0, 1, 2].map((i) => <div key={i} className="h-20 animate-pulse rounded-2xl bg-stone-100" />)}
            </div>
          ) : upcoming.length ? (
            <ul className="mt-10 divide-y divide-stone-200 border-y border-stone-200">
              {upcoming.slice(0, 5).map((event) => <EventRow key={event.id} event={event} />)}
            </ul>
          ) : (
            <p className="mt-10 rounded-2xl border border-dashed border-stone-300 p-10 text-center text-stone-600">
              No upcoming events yet. Check back soon.
            </p>
          )}
        </div>
      </section>

      {/* Hackathons */}
      <section className="bg-ink text-white">
        <div className={`${wrap} py-20 sm:py-28`}>
          <div className="mb-12 max-w-2xl">
            <Eyebrow dark>Hackathons</Eyebrow>
            <h2 className="font-display text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
              Ship something in a weekend.
            </h2>
            <p className="mt-4 text-lg text-brand-100">
              Team up, take on a real challenge and get scored by judges against criteria everyone can see.
            </p>
          </div>
          {hackathons.isLoading ? (
            <div className="h-96 animate-pulse rounded-3xl bg-white/5" />
          ) : (
            <HackathonSpotlight hackathons={hackathons.data?.results ?? []} />
          )}
        </div>
      </section>

      {/* Organisers */}
      <section className={`${wrap} grid gap-12 py-20 sm:py-28 lg:grid-cols-[1fr_1.2fr]`}>
        <div>
          <Eyebrow>For organisers</Eyebrow>
          <h2 className="font-display text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
            Run your community here.
          </h2>
          <p className="mt-5 max-w-md text-lg leading-relaxed text-stone-600">
            Universities and developer communities use Community to run everything from a Friday
            meetup to a three-day hackathon, without juggling forms and spreadsheets.
          </p>
          <div className="mt-8">
            {!auth.isAuthenticated ? (
              <button type="button" onClick={signIn} className={primary}>
                Sign in to start <Arrow />
              </button>
            ) : canOrganise ? (
              <Link to="/events/new" className={primary}>
                Create an event <Arrow />
              </Link>
            ) : (
              <p className="text-sm text-stone-500">Your organisation's admins can give you organiser access.</p>
            )}
          </div>
        </div>
        <dl className="grid gap-x-10 gap-y-10 sm:grid-cols-2">
          {organiserTools.map(([title, body]) => (
            <div key={title} className="border-t-2 border-ink pt-5">
              <dt className="font-display text-xl font-bold">{title}</dt>
              <dd className="mt-2 text-sm leading-relaxed text-stone-600">{body}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* Closing */}
      <section className={`${wrap} pb-20 sm:pb-28`}>
        <div className="relative overflow-hidden rounded-[2rem] bg-brand-600 px-8 py-16 text-center text-white sm:px-16 sm:py-20">
          <div className="grid-lines grid-lines-light pointer-events-none absolute inset-0" aria-hidden="true" />
          <h2 className="relative mx-auto max-w-3xl font-display text-4xl font-bold leading-tight tracking-tight sm:text-6xl">
            A million techies. Start with one event.
          </h2>
          <div className="relative mt-9 flex flex-wrap justify-center gap-3">
            <Link to="/events" className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-ink transition hover:bg-brand-50">
              Browse events <Arrow />
            </Link>
            {!auth.isAuthenticated && (
              <button type="button" onClick={signUp} className="rounded-full px-6 py-3 text-sm font-semibold text-white ring-1 ring-white/50 transition hover:bg-white/10">
                Create your account
              </button>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}
