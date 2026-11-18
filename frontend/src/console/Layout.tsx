/** The organiser console shell: a sidebar, a top bar with breadcrumbs, and the page. */
import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useAuth } from 'react-oidc-context'
import { Link, NavLink, Outlet, useLocation, useMatch } from 'react-router-dom'

import { api } from '../api'
import type { CommunityEvent, Hackathon } from '../api'
import { LogoTile } from '../components/brand'
import { Icon } from '../components/icons'
import type { IconName } from '../components/icons'
import { Button, Empty, LinkButton, Spinner, StatusBadge } from '../components/ui'
import { useOrganiserSignIn } from '../hooks'
import { useAccess } from './shared'

const EVENT_SECTIONS: { to: string; label: string; icon: IconName }[] = [
  { to: '', label: 'Overview', icon: 'gauge' },
  { to: 'registrations', label: 'Registrations', icon: 'list' },
  { to: 'check-in', label: 'Check-in', icon: 'scan' },
  { to: 'content', label: 'Announcements', icon: 'megaphone' },
  { to: 'feedback', label: 'Feedback', icon: 'star' },
  { to: 'edit', label: 'Details', icon: 'pencil' },
]

const HACKATHON_SECTIONS: { to: string; label: string; icon: IconName }[] = [
  { to: '', label: 'Overview', icon: 'gauge' },
  { to: 'setup', label: 'Challenges and criteria', icon: 'target' },
  { to: 'teams', label: 'Teams', icon: 'users' },
  { to: 'judges', label: 'Judges', icon: 'gavel' },
  { to: 'leaderboard', label: 'Leaderboard', icon: 'podium' },
  { to: 'edit', label: 'Details', icon: 'pencil' },
]

/** The event or hackathon the URL is inside, if any (not "new"). */
function useCurrentItem() {
  const eventMatch = useMatch('/manage/events/:slug/*')
  const hackathonMatch = useMatch('/manage/hackathons/:slug/*')
  // "new" is the create form, not an item.
  const eventId = eventMatch?.params.slug !== 'new' ? eventMatch?.params.slug : undefined
  const hackathonId = hackathonMatch?.params.slug !== 'new' ? hackathonMatch?.params.slug : undefined
  const event = useQuery({
    queryKey: ['event', eventId],
    queryFn: () => api<CommunityEvent>(`/events/${eventId}/`),
    enabled: !!eventId,
  })
  const hackathon = useQuery({
    queryKey: ['hackathon', hackathonId],
    queryFn: () => api<Hackathon>(`/hackathons/${hackathonId}/`),
    enabled: !!hackathonId,
  })
  if (event.data && eventId)
    return { kind: 'event' as const, base: `/manage/events/${eventId}`, title: event.data.title, status: event.data.status, sections: EVENT_SECTIONS }
  if (hackathon.data && hackathonId)
    return { kind: 'hackathon' as const, base: `/manage/hackathons/${hackathonId}`, title: hackathon.data.title, status: hackathon.data.status, sections: HACKATHON_SECTIONS }
  return null
}

const navItem = ({ isActive }: { isActive: boolean }) =>
  `group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
    isActive ? 'bg-white/10 text-white' : 'text-stone-400 hover:bg-white/5 hover:text-white'
  }`

function NavIcon({ name }: { name: IconName }) {
  return <Icon name={name} className="h-[18px] w-[18px]" />
}

function Sidebar({ onNavigate }: { onNavigate: () => void }) {
  const auth = useAuth()
  const access = useAccess()
  const item = useCurrentItem()
  const name = access.me?.full_name || auth.user?.profile.name || 'Organiser'
  const initials = name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase()

  return (
    <div className="flex h-full flex-col bg-ink text-stone-300">
      <Link to="/manage" onClick={onNavigate} className="flex items-center gap-2.5 px-5 py-5">
        <LogoTile className="h-9 w-9" />
        <span className="leading-tight">
          <span className="block text-sm font-bold text-white">A Million Techies</span>
          <span className="block text-xs text-brand-300">Organiser console</span>
        </span>
      </Link>

      <nav className="flex-1 space-y-6 overflow-y-auto px-3 pb-4" onClick={onNavigate}>
        <div className="space-y-0.5">
          <NavLink end to="/manage" className={navItem}><NavIcon name="home" />Overview</NavLink>
          {access.events && <NavLink to="/manage/events" className={navItem}><NavIcon name="calendar" />Events</NavLink>}
          {access.hackathons && <NavLink to="/manage/hackathons" className={navItem}><NavIcon name="trophy" />Hackathons</NavLink>}
        </div>

        {item && (
          <div>
            <p className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-stone-500">
              {item.kind === 'event' ? 'This event' : 'This hackathon'}
            </p>
            <div className="mb-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2.5">
              <p className="line-clamp-2 text-sm font-semibold text-white">{item.title}</p>
              <div className="mt-1.5"><StatusBadge status={item.status} /></div>
            </div>
            <div className="space-y-0.5">
              {item.sections.map((s) => (
                <NavLink key={s.to} end to={s.to ? `${item.base}/${s.to}` : item.base} className={navItem}>
                  <NavIcon name={s.icon} />
                  {s.label}
                </NavLink>
              ))}
            </div>
          </div>
        )}

        {(access.team || access.platform) && (
          <div>
            <p className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-stone-500">Organisation</p>
            <div className="space-y-0.5">
              {access.team && <NavLink to="/manage/team" className={navItem}><NavIcon name="users" />Team and roles</NavLink>}
              {access.platform && <NavLink to="/manage/platform" className={navItem}><NavIcon name="shield" />Platform</NavLink>}
            </div>
          </div>
        )}
      </nav>

      <div className="border-t border-white/10 p-3">
        <Link to="/dashboard" onClick={onNavigate} className="mb-2 flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-stone-400 hover:bg-white/5 hover:text-white">
          <NavIcon name="external" />
          Switch to member view
        </Link>
        <div className="flex items-center gap-3 rounded-lg px-3 py-2">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-600 text-xs font-bold text-white">{initials}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-white">{name}</span>
            <span className="block truncate text-xs text-brand-300">{access.role}</span>
          </span>
          <button
            type="button"
            className="rounded-md p-1.5 text-stone-400 hover:bg-white/10 hover:text-white"
            aria-label="Sign out"
            title="Sign out"
            onClick={() => void auth.signoutRedirect()}
          >
            <NavIcon name="logout" />
          </button>
        </div>
      </div>
    </div>
  )
}

const CRUMB_LABELS: Record<string, string> = {
  events: 'Events',
  hackathons: 'Hackathons',
  team: 'Team and roles',
  platform: 'Platform',
  new: 'New',
  ...Object.fromEntries([...EVENT_SECTIONS, ...HACKATHON_SECTIONS].filter((s) => s.to).map((s) => [s.to, s.label])),
}

function Breadcrumbs() {
  const { pathname } = useLocation()
  const item = useCurrentItem()
  const parts = pathname.replace(/^\/manage\/?/, '').split('/').filter(Boolean)
  const crumbs = [{ to: '/manage', label: 'Console' }]
  parts.forEach((part, i) => {
    const to = `/manage/${parts.slice(0, i + 1).join('/')}`
    // The segment after events/ or hackathons/ (other than "new") is the item's slug.
    const isItem = i === 1 && (parts[0] === 'events' || parts[0] === 'hackathons') && part !== 'new'
    const label = isItem ? (item?.title ?? '…') : (CRUMB_LABELS[part] ?? part)
    crumbs.push({ to, label })
  })
  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex items-center gap-1.5 text-sm">
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1
          return (
            <li key={c.to} className={`flex min-w-0 items-center gap-1.5 ${!last && i > 0 ? 'hidden sm:flex' : ''}`}>
              {i > 0 && <Icon name="chevronRight" className="h-3.5 w-3.5 text-stone-400" />}
              {last ? (
                <span className="truncate font-semibold text-ink" aria-current="page">{c.label}</span>
              ) : (
                <Link to={c.to} className="truncate text-stone-500 hover:text-ink">{c.label}</Link>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

/** "Create" menu in the top bar, offering what the member may create. */
function CreateMenu() {
  const access = useAccess()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const escape = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', escape)
    }
  }, [open])
  if (!access.events && !access.hackathons) return null
  const option = 'flex items-center gap-3 rounded-md px-3 py-2 text-sm hover:bg-stone-100'
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-700"
      >
        <Icon name="plus" className="h-4 w-4" />
        <span className="hidden sm:inline">Create</span>
        <Icon name="chevronDown" className="h-4 w-4" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-30 mt-2 w-60 rounded-xl border border-stone-200 bg-white p-1.5 shadow-lg" onClick={() => setOpen(false)}>
          {access.events && (
            <Link role="menuitem" to="/manage/events/new" className={option}>
              <Icon name="calendar" className="h-4 w-4 text-brand-700" />
              <span><span className="block font-semibold">Event</span><span className="block text-xs text-stone-500">Workshop, meetup, webinar</span></span>
            </Link>
          )}
          {access.hackathons && (
            <Link role="menuitem" to="/manage/hackathons/new" className={option}>
              <Icon name="trophy" className="h-4 w-4 text-brand-700" />
              <span><span className="block font-semibold">Hackathon</span><span className="block text-xs text-stone-500">Teams, projects and judging</span></span>
            </Link>
          )}
        </div>
      )}
    </div>
  )
}

/** Signed out: the console's own sign-in screen, returning here afterwards. */
function ConsoleSignIn() {
  const auth = useAuth()
  const signIn = useOrganiserSignIn()
  return (
    <div className="grid min-h-screen place-items-center bg-ink px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 text-center shadow-xl">
        <LogoTile className="mx-auto mb-4 h-12 w-12" />
        <h1 className="text-xl font-bold">Organiser console</h1>
        <p className="mt-1 mb-6 text-sm text-stone-600">
          For event organisers, hackathon managers and organisation admins at A Million Techies.
        </p>
        <Button className="w-full" onClick={signIn} disabled={auth.isLoading}>Sign in as an organiser</Button>
        <Link to="/" className="mt-4 block text-sm font-semibold text-brand-700 hover:underline">Back to Community</Link>
      </div>
    </div>
  )
}

export default function ConsoleLayout() {
  const auth = useAuth()
  if (!auth.isAuthenticated) return <ConsoleSignIn />
  return <Console />
}

function Console() {
  const access = useAccess()
  const [open, setOpen] = useState(false)
  const { pathname } = useLocation()
  // A new page starts at the top. (The mobile menu closes itself when a link is chosen.)
  useEffect(() => window.scrollTo(0, 0), [pathname])

  if (!access.loaded) return <Spinner />
  if (!access.any)
    return (
      <div className="mx-auto max-w-lg px-4 py-16">
        <Empty>
          <p className="mb-1 font-semibold text-ink">You are signed in as a member</p>
          <p className="mb-4">The organiser console is for people who run events or hackathons. Ask your organisation's admin to give you a role, then sign in again.</p>
          <LinkButton to="/dashboard">Go to my activity</LinkButton>
        </Empty>
      </div>
    )

  return (
    <div className="min-h-screen bg-stone-100">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 lg:block">
        <Sidebar onNavigate={() => {}} />
      </aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-ink/50" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85%] shadow-xl">
            <button
              type="button"
              className="absolute right-3 top-5 z-10 rounded-md p-1.5 text-stone-400 hover:bg-white/10 hover:text-white"
              aria-label="Close menu"
              onClick={() => setOpen(false)}
            >
              <Icon name="close" />
            </button>
            <Sidebar onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}
      <div className="lg:pl-64">
        <header className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b border-stone-200 bg-white/95 px-4 backdrop-blur sm:px-6">
          <button
            type="button"
            className="-ml-1 rounded-md p-1.5 text-stone-600 hover:bg-stone-100 lg:hidden"
            aria-label="Open menu"
            onClick={() => setOpen(true)}
          >
            <Icon name="menu" />
          </button>
          <Breadcrumbs />
          <div className="ml-auto flex items-center gap-2">
            <CreateMenu />
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
