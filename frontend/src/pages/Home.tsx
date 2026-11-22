import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { useAuth } from 'react-oidc-context'
import { Link } from 'react-router-dom'

import { api } from '../api'
import type { CommunityEvent, CommunityStats, Hackathon, Paginated } from '../api'
import { LogoMark, Rhino } from '../components/brand'
import { formatDate, label } from '../components/ui'
import { useMe, useSignIn, useSignUp } from '../hooks'

const MAIN_SITE = 'https://amilliontechies.com'
const LEARN_SITE = 'https://learn.amilliontechies.com'

const wrap = 'mx-auto w-full max-w-6xl px-4 sm:px-6'
const day = new Intl.DateTimeFormat('en-GB', { day: 'numeric' })
const month = new Intl.DateTimeFormat('en-GB', { month: 'short' })
const time = new Intl.DateTimeFormat('en-GB', { timeStyle: 'short' })

const primary =
  'inline-flex items-center justify-center gap-2 rounded-full bg-brand-600 px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700'
const secondary =
  'inline-flex items-center justify-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-ink ring-1 ring-stone-300 transition hover:ring-stone-400'

function Arrow({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3 8h10m0 0L9 4m4 4-4 4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function External({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M6 3H3v10h10v-3M9 3h4v4M13 3 7 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="mb-4 text-xs font-semibold uppercase tracking-[0.2em] text-brand-700">
      {children}
    </p>
  )
}

/**
 * A community photo. Until the file is in public/images, a branded block stands in,
 * so the layout holds either way.
 */
function Photo({ src, alt, className = '' }: { src: string; alt: string; className?: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) {
    return (
      <div className={`relative grid place-items-center overflow-hidden bg-gradient-to-br from-brand-700 to-brand-950 ${className}`} role="img" aria-label={alt}>
        <LogoMark className="h-1/3 w-1/3 text-white/15" />
      </div>
    )
  }
  return <img src={src} alt={alt} onError={() => setFailed(true)} className={`object-cover ${className}`} />
}

function places(event: CommunityEvent) {
  if (event.spots_left === null) return `${event.registered_count} going`
  if (event.spots_left === 0) return 'Full · waitlist open'
  return `${event.spots_left} ${event.spots_left === 1 ? 'place' : 'places'} left`
}

/** The hackathon most worth showing: open for sign-ups first, then running, then finished. */
function pickFeatured(hackathons: Hackathon[]) {
  const live = hackathons.filter((h) => h.status !== 'cancelled' && h.status !== 'draft')
  const rank = (h: Hackathon) =>
    h.registration_open ? 0 : h.status === 'published' ? 1 : h.status === 'judging' ? 2 : 3
  return [...live].sort((a, b) => rank(a) - rank(b))
}

const hackathonStatus = (h: Hackathon) =>
  h.registration_open ? 'Registration open' : label(h.status === 'published' ? 'upcoming' : h.status)

/** "This week in the community": the next events and the hackathon to watch. */
function LiveCard({ events, hackathon }: { events: CommunityEvent[]; hackathon?: Hackathon }) {
  return (
    <div className="rounded-2xl bg-white p-5 shadow-[0_20px_50px_-20px_rgba(12,20,16,0.35)] ring-1 ring-stone-200">
      <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-500 opacity-60 motion-reduce:hidden" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-brand-500" />
        </span>
        Happening in the community
      </p>
      {events.length || hackathon ? (
        <ul className="mt-4 space-y-3">
          {events.slice(0, 2).map((event) => (
            <li key={event.slug}>
              <Link to={`/events/${event.slug}`} className="group flex items-center gap-3">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-50 text-center leading-none text-brand-800">
                  <span>
                    <span className="block text-base font-bold">{day.format(new Date(event.starts_at))}</span>
                    <span className="block text-[10px] font-semibold uppercase">{month.format(new Date(event.starts_at))}</span>
                  </span>
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold group-hover:text-brand-700">{event.title}</span>
                  <span className="block truncate text-xs text-stone-500">{label(event.event_type)} · {event.organization.name}</span>
                </span>
              </Link>
            </li>
          ))}
          {hackathon && (
            <li>
              <Link to={`/hackathons/${hackathon.slug}`} className="group flex items-center gap-3">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-ink text-brand-300">
                  <LogoMark className="h-5 w-5" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold group-hover:text-brand-700">{hackathon.title}</span>
                  <span className="block truncate text-xs text-stone-500">Hackathon · {hackathonStatus(hackathon)}</span>
                </span>
              </Link>
            </li>
          )}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-stone-600">The first events are being planned. Join now and you will see them here first.</p>
      )}
    </div>
  )
}

/** Live counts. Only numbers above zero are shown, so a young community never shows a row of zeros. */
function StatsStrip({ stats }: { stats?: CommunityStats }) {
  if (!stats) return null
  const items = [
    [stats.members, 'members'],
    [stats.events, 'events run'],
    [stats.check_ins, 'check-ins at events'],
    [stats.hackathons, 'hackathons'],
    [stats.projects, 'projects shipped'],
    [stats.organizations, 'organisations hosting'],
  ] as const
  const shown = items.filter(([value]) => value > 0)
  if (!shown.length) return null
  return (
    <dl className="mt-12 grid grid-cols-2 gap-x-8 gap-y-5 border-t border-stone-200 pt-6 sm:grid-cols-3">
      {shown.map(([value, name]) => (
        <div key={name}>
          <dd className="font-display text-3xl font-bold">{value.toLocaleString('en-GB')}</dd>
          <dt className="text-sm text-stone-500">{name}</dt>
        </div>
      ))}
    </dl>
  )
}

const journey = [
  {
    step: 'Learn',
    title: 'Pick up the skills',
    body: 'Free courses and cohorts in Linux, networking, cloud, Python, cybersecurity, data and AI.',
    where: 'learn.amilliontechies.com',
    href: LEARN_SITE,
  },
  {
    step: 'Build',
    title: 'Put them to work, together',
    body: 'Workshops, meetups and hackathons where you build real things with other techies and mentors.',
    where: 'You are here',
  },
  {
    step: 'Grow',
    title: 'Turn it into a career',
    body: 'Certificates anyone can verify, projects to show, and soon mentorship and opportunities.',
    where: 'Community and amilliontechies.com',
  },
]

const liveNow = [
  {
    title: 'Events and workshops',
    body: 'Register once, show the QR code on your ticket at the door, get the slides and share feedback.',
    to: '/events',
  },
  {
    title: 'Hackathons',
    body: 'Form a team, pick a challenge, submit before the deadline and see judges score against published criteria.',
    to: '/hackathons',
  },
  {
    title: 'Certificates',
    body: 'Attend and you get a certificate with its own public link, so an employer can check it is real.',
    to: '/dashboard',
  },
]

const comingNext = [
  ['Mentorship circles', 'Small groups with a mentor who has done it before.'],
  ['Campus chapters', 'A Million Techies at your university, run by students.'],
  ['Projects', 'A home for what members build, with the team behind it.'],
  ['Opportunities', 'Internships, jobs and gigs from partners who hire from the community.'],
] as const

function EventRow({ event }: { event: CommunityEvent }) {
  const start = new Date(event.starts_at)
  return (
    <li>
      <Link to={`/events/${event.slug}`} className="group flex items-center gap-4 py-4">
        <span className="w-12 shrink-0 text-center">
          <span className="block font-display text-2xl font-bold leading-none">{day.format(start)}</span>
          <span className="mt-1 block text-xs font-semibold uppercase text-brand-700">{month.format(start)}</span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold group-hover:text-brand-700">{event.title}</span>
          <span className="block truncate text-sm text-stone-500">
            {label(event.event_type)} · {label(event.delivery_mode)} · {time.format(start)} · {event.organization.name}
          </span>
        </span>
        <span className="hidden shrink-0 text-sm text-stone-500 sm:block">{places(event)}</span>
      </Link>
    </li>
  )
}

function HackathonCard({ hackathon }: { hackathon: Hackathon }) {
  const facts = [
    ['Teams', hackathon.team_count],
    ['Builders', hackathon.participant_count],
    ['Challenges', hackathon.challenges.length],
  ] as const
  return (
    <Link
      to={`/hackathons/${hackathon.slug}`}
      className="group relative flex h-full flex-col overflow-hidden rounded-3xl bg-ink p-7 text-white sm:p-8"
    >
      <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-brand-600/40 blur-3xl" />
      <div className="relative flex flex-wrap items-center gap-2 text-xs font-semibold">
        <span className="rounded-full bg-brand-500 px-2.5 py-1 text-ink">{hackathonStatus(hackathon)}</span>
        {hackathon.theme && <span className="rounded-full px-2.5 py-1 ring-1 ring-white/25">{hackathon.theme}</span>}
      </div>
      <p className="relative mt-6 font-display text-3xl font-bold leading-tight">{hackathon.title}</p>
      {hackathon.tagline && <p className="relative mt-3 text-white/70">{hackathon.tagline}</p>}
      <p className="relative mt-4 text-sm text-white/55">
        {formatDate(hackathon.starts_at)} to {formatDate(hackathon.ends_at)} · {hackathon.organization.name}
      </p>
      <dl className="relative mt-auto grid grid-cols-3 gap-4 border-t border-white/15 pt-5">
        {facts.map(([name, value]) => (
          <div key={name}>
            <dt className="text-xs uppercase tracking-wider text-white/50">{name}</dt>
            <dd className="mt-1 font-display text-2xl font-bold">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="relative mt-6 inline-flex items-center gap-2 text-sm font-semibold text-brand-300">
        {hackathon.registration_open ? `Register by ${formatDate(hackathon.registration_deadline)}` : 'See the hackathon'}
        <Arrow className="transition group-hover:translate-x-1" />
      </p>
    </Link>
  )
}

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
  const stats = useQuery({ queryKey: ['stats'], queryFn: () => api<CommunityStats>('/stats/') })
  const upcoming = events.data?.results ?? []
  const featured = pickFeatured(hackathons.data?.results ?? [])[0]
  const canOrganise = me?.organizations.some((o) => o.can_manage_events)

  return (
    <div className="bg-stone-50">
      {/* Hero */}
      <section className="overflow-hidden">
        <div className={`${wrap} grid items-center gap-12 py-14 sm:py-20 lg:grid-cols-[1.1fr_1fr] lg:gap-16 lg:py-24`}>
          <div className="rise">
            <a
              href={MAIN_SITE}
              className="inline-flex items-center gap-2 rounded-full bg-white py-1 pl-1 pr-3 text-xs font-semibold text-stone-600 ring-1 ring-stone-200 transition hover:ring-stone-300"
            >
              <span className="rounded-full bg-brand-50 px-2 py-0.5 text-brand-800">A Million Techies</span>
              The community space
              <External />
            </a>
            <h1 className="mt-7 font-display text-5xl font-bold leading-[0.98] tracking-tight sm:text-7xl">
              Learn. Build. Grow. <span className="text-brand-600">Together.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-stone-600">
              Community is where A Million Techies meet: workshops and meetups to learn from each
              other, hackathons to build for real, and mentors to help you grow. Free, and open to
              anyone learning tech.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              {auth.isAuthenticated ? (
                <Link to="/events" className={primary}>Find your next event <Arrow /></Link>
              ) : (
                <button type="button" onClick={signUp} className={primary}>Join the community <Arrow /></button>
              )}
              <Link to="/events" className={secondary}>Browse events</Link>
            </div>
            <StatsStrip stats={stats.data} />
          </div>

          <div className="rise relative [animation-delay:120ms]">
            <Photo
              src="/images/community-1.jpeg"
              alt="A Million Techies members learning together"
              className="aspect-[4/5] w-full rounded-[2rem] sm:aspect-[5/4] lg:aspect-[4/5]"
            />
            <div className="absolute -bottom-6 left-4 right-4 sm:left-auto sm:right-6 sm:w-80 lg:-left-10 lg:right-auto">
              <LiveCard events={upcoming} hackathon={featured} />
            </div>
          </div>
        </div>
      </section>

      {/* Where Community sits in A Million Techies */}
      <section className="border-y border-stone-200 bg-white">
        <div className={`${wrap} py-20 sm:py-24`}>
          <div className="max-w-2xl">
            <Eyebrow>One movement, three steps</Eyebrow>
            <h2 className="font-display text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
              Community is where learning turns into doing.
            </h2>
          </div>
          <ol className="mt-12 grid gap-4 lg:grid-cols-3">
            {journey.map((stage, i) => {
              const here = stage.step === 'Build'
              const body = (
                <>
                  <div className="flex items-center justify-between">
                    <span className={`font-display text-sm font-bold ${here ? 'text-brand-300' : 'text-brand-700'}`}>
                      0{i + 1} · {stage.step}
                    </span>
                    {here && <span className="rounded-full bg-brand-500 px-2.5 py-1 text-xs font-semibold text-ink">You are here</span>}
                  </div>
                  <p className="mt-10 font-display text-2xl font-bold">{stage.title}</p>
                  <p className={`mt-3 text-sm leading-relaxed ${here ? 'text-white/70' : 'text-stone-600'}`}>{stage.body}</p>
                  {!here && (
                    <p className="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700">
                      {stage.where} {stage.href && <External />}
                    </p>
                  )}
                </>
              )
              const box = `block h-full rounded-3xl p-7 ${here ? 'bg-ink text-white' : 'bg-stone-50 ring-1 ring-stone-200'}`
              return (
                <li key={stage.step}>
                  {stage.href ? (
                    <a href={stage.href} className={`${box} transition hover:ring-brand-600`}>{body}</a>
                  ) : (
                    <div className={box}>{body}</div>
                  )}
                </li>
              )
            })}
          </ol>
        </div>
      </section>

      {/* What you can do here */}
      <section className={`${wrap} py-20 sm:py-24`}>
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-2xl">
            <Eyebrow>What you can do here</Eyebrow>
            <h2 className="font-display text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
              Live now, with more on the way.
            </h2>
          </div>
        </div>
        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {liveNow.map((item) => (
            <Link
              key={item.title}
              to={item.to}
              className="group flex flex-col rounded-3xl bg-white p-7 ring-1 ring-stone-200 transition hover:ring-brand-600"
            >
              <span className="w-fit rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-800">Live</span>
              <p className="mt-6 font-display text-2xl font-bold">{item.title}</p>
              <p className="mt-3 flex-1 text-sm leading-relaxed text-stone-600">{item.body}</p>
              <Arrow className="mt-6 text-stone-400 transition group-hover:translate-x-1 group-hover:text-brand-700" />
            </Link>
          ))}
        </div>
        <div className="mt-4 rounded-3xl border border-dashed border-stone-300 p-7">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">Coming next</p>
          <dl className="mt-5 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {comingNext.map(([title, body]) => (
              <div key={title}>
                <dt className="font-semibold">{title}</dt>
                <dd className="mt-1 text-sm leading-relaxed text-stone-500">{body}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* Happening now */}
      <section className="border-y border-stone-200 bg-white">
        <div className={`${wrap} py-20 sm:py-24`}>
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div>
              <Eyebrow>Happening now</Eyebrow>
              <h2 className="font-display text-4xl font-bold tracking-tight sm:text-5xl">Show up. Build something.</h2>
            </div>
            <div className="flex gap-5 text-sm font-semibold">
              <Link to="/events" className="group inline-flex items-center gap-1.5 hover:text-brand-700">
                All events <Arrow className="transition group-hover:translate-x-1" />
              </Link>
              <Link to="/hackathons" className="group inline-flex items-center gap-1.5 hover:text-brand-700">
                All hackathons <Arrow className="transition group-hover:translate-x-1" />
              </Link>
            </div>
          </div>
          <div className="mt-10 grid gap-8 lg:grid-cols-[1.3fr_1fr]">
            <div>
              {events.isLoading ? (
                <div className="space-y-3">
                  {[0, 1, 2].map((i) => <div key={i} className="h-16 animate-pulse rounded-2xl bg-stone-100" />)}
                </div>
              ) : upcoming.length ? (
                <ul className="divide-y divide-stone-200 border-y border-stone-200">
                  {upcoming.slice(0, 5).map((event) => <EventRow key={event.slug} event={event} />)}
                </ul>
              ) : (
                <p className="rounded-3xl border border-dashed border-stone-300 p-10 text-center text-stone-600">
                  No upcoming events yet. New ones show up here first.
                </p>
              )}
            </div>
            {hackathons.isLoading ? (
              <div className="h-80 animate-pulse rounded-3xl bg-stone-100" />
            ) : featured ? (
              <HackathonCard hackathon={featured} />
            ) : (
              <div className="grid place-items-center rounded-3xl bg-ink p-10 text-center text-white/70">
                The first hackathon will be announced here.
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Ubuntu: the people */}
      <section className={`${wrap} grid items-center gap-12 py-20 sm:py-24 lg:grid-cols-2 lg:gap-16`}>
        <div className="grid grid-cols-2 gap-4">
          <Photo src="/images/community-2.jpeg" alt="Mentors and learners at an A Million Techies session" className="aspect-[3/4] w-full rounded-3xl" />
          <Photo src="/images/community-3.jpeg" alt="Techies building together at a community event" className="mt-12 aspect-[3/4] w-full rounded-3xl" />
        </div>
        <div>
          <Eyebrow>Ubuntu</Eyebrow>
          <blockquote className="font-display text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
            “I am because we are.”
          </blockquote>
          <p className="mt-5 max-w-lg text-lg leading-relaxed text-stone-600">
            Nobody gets good at tech alone. Every event here is run by someone who chose to give
            back, and every member is one person further along than someone else.
          </p>
          <ul className="mt-8 divide-y divide-stone-200 border-y border-stone-200">
            <li className="flex items-center justify-between gap-4 py-4">
              <span>
                <span className="block font-semibold">Organise</span>
                <span className="block text-sm text-stone-500">Run a workshop, meetup or hackathon for your campus or community.</span>
              </span>
              {auth.isAuthenticated && canOrganise ? (
                <Link to="/manage/events/new" className="shrink-0 text-sm font-semibold text-brand-700 hover:text-brand-800">Create an event</Link>
              ) : !auth.isAuthenticated ? (
                <button type="button" onClick={signIn} className="shrink-0 text-sm font-semibold text-brand-700 hover:text-brand-800">Sign in</button>
              ) : null}
            </li>
            <li className="flex items-center justify-between gap-4 py-4">
              <span>
                <span className="block font-semibold">Mentor</span>
                <span className="block text-sm text-stone-500">Share what you know with learners a few steps behind you.</span>
              </span>
              <a href={`${MAIN_SITE}/join-us`} className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-brand-700 hover:text-brand-800">
                Join us <External />
              </a>
            </li>
            <li className="flex items-center justify-between gap-4 py-4">
              <span>
                <span className="block font-semibold">Partner</span>
                <span className="block text-sm text-stone-500">Universities and companies: host, sponsor or hire from the community.</span>
              </span>
              <a href={`${MAIN_SITE}/contact`} className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-brand-700 hover:text-brand-800">
                Talk to us <External />
              </a>
            </li>
          </ul>
        </div>
      </section>

      {/* Closing, with the rhino accent: a group of rhinos is a crash, strong because it moves together. */}
      <section className={`${wrap} pb-20 sm:pb-24`}>
        <div className="relative overflow-hidden rounded-[2rem] bg-brand-900 px-8 pt-14 text-center text-white sm:px-16 sm:pt-16">
          <h2 className="mx-auto max-w-3xl font-display text-4xl font-bold leading-tight tracking-tight sm:text-6xl">
            Become one of the million.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-white/70">
            A group of rhinos is called a crash, and it is strongest when it moves together. So are we.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            {!auth.isAuthenticated && (
              <button type="button" onClick={signUp} className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-ink transition hover:bg-brand-50">
                Join free <Arrow />
              </button>
            )}
            <Link to="/events" className="rounded-full px-6 py-3 text-sm font-semibold text-white ring-1 ring-white/50 transition hover:bg-white/10">
              Browse events
            </Link>
          </div>
          <div className="mx-auto mt-12 flex max-w-lg items-end justify-center gap-2 text-brand-950" aria-hidden="true">
            <Rhino className="w-[44%]" fold="#14532d" far="#0f3d22" />
            <Rhino className="w-[32%]" fold="#14532d" far="#0f3d22" />
            <Rhino className="w-[22%]" fold="#14532d" far="#0f3d22" />
          </div>
          <div className="absolute inset-x-0 bottom-0 h-[3px] bg-brand-950" aria-hidden="true" />
        </div>
      </section>
    </div>
  )
}
