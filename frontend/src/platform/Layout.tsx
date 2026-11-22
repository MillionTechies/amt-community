/** The platform admin area: its own sidebar, set apart from the organiser console. */
import { useEffect, useState } from 'react'
import { useAuth } from 'react-oidc-context'
import { Link, NavLink, useLocation } from 'react-router-dom'

import { LogoTile } from '../components/brand'
import { PageOutlet } from '../components/ErrorBoundary'
import { Icon } from '../components/icons'
import type { IconName } from '../components/icons'
import { Empty, LinkButton, Spinner } from '../components/ui'
import { useAccess } from '../console/shared'

const NAV: { to: string; label: string; icon: IconName; end?: boolean }[] = [
  { to: '/platform', label: 'Overview', icon: 'gauge', end: true },
  { to: '/platform/organizations', label: 'Organisations', icon: 'home' },
  { to: '/platform/applications', label: 'Applications', icon: 'inbox' },
  { to: '/platform/members', label: 'Members', icon: 'users' },
  { to: '/platform/emails', label: 'Email delivery', icon: 'inbox' },
  { to: '/platform/configuration', label: 'Configuration', icon: 'shield' },
]

const LABELS: Record<string, string> = {
  organizations: 'Organisations',
  applications: 'Applications',
  members: 'Members',
  emails: 'Email delivery',
  configuration: 'Configuration',
}

const navItem = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
    isActive ? 'bg-amber-400/15 text-amber-200' : 'text-stone-400 hover:bg-white/5 hover:text-white'
  }`

function Sidebar({ onNavigate }: { onNavigate: () => void }) {
  const auth = useAuth()
  const access = useAccess()
  const name = access.me?.full_name || 'Platform admin'
  return (
    <div className="flex h-full flex-col bg-[#11120f] text-stone-300">
      <Link to="/platform" onClick={onNavigate} className="flex items-center gap-2.5 px-5 py-5">
        <LogoTile className="h-9 w-9" />
        <span className="leading-tight">
          <span className="block text-sm font-bold text-white">A Million Techies</span>
          <span className="caret block font-mono text-[11px] uppercase tracking-wider text-amber-300">Platform admin</span>
        </span>
      </Link>
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-4" onClick={onNavigate}>
        {NAV.map((n) => (
          <NavLink key={n.to} end={n.end} to={n.to} className={navItem}>
            <Icon name={n.icon} className="h-[18px] w-[18px]" />
            {n.label}
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-white/10 p-3">
        <Link to="/manage" onClick={onNavigate} className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-stone-400 hover:bg-white/5 hover:text-white">
          <Icon name="calendar" className="h-[18px] w-[18px]" />Organiser console
        </Link>
        <Link to="/" onClick={onNavigate} className="mb-2 flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-stone-400 hover:bg-white/5 hover:text-white">
          <Icon name="external" className="h-[18px] w-[18px]" />Community site
        </Link>
        <div className="flex items-center gap-3 rounded-lg px-3 py-2">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-white">{name}</span>
            <span className="block truncate text-xs text-amber-300">Platform admin</span>
          </span>
          <button type="button" aria-label="Sign out" title="Sign out" className="rounded-md p-1.5 text-stone-400 hover:bg-white/10 hover:text-white" onClick={() => void auth.signoutRedirect()}>
            <Icon name="logout" className="h-[18px] w-[18px]" />
          </button>
        </div>
      </div>
    </div>
  )
}

function Crumbs() {
  const parts = useLocation().pathname.replace(/^\/platform\/?/, '').split('/').filter(Boolean)
  const crumbs = [{ to: '/platform', label: 'Platform' }, ...parts.map((p, i) => ({ to: `/platform/${parts.slice(0, i + 1).join('/')}`, label: LABELS[p] ?? 'Details' }))]
  return (
    <ol className="flex min-w-0 items-center gap-1.5 text-sm">
      {crumbs.map((c, i) => (
        <li key={c.to} className="flex min-w-0 items-center gap-1.5">
          {i > 0 && <Icon name="chevronRight" className="h-3.5 w-3.5 text-stone-400" />}
          {i === crumbs.length - 1 ? <span className="truncate font-semibold">{c.label}</span> : <Link to={c.to} className="truncate text-stone-500 hover:text-ink">{c.label}</Link>}
        </li>
      ))}
    </ol>
  )
}

export default function PlatformLayout() {
  const auth = useAuth()
  const access = useAccess()
  const [open, setOpen] = useState(false)
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])

  if (!auth.isAuthenticated)
    return (
      <div className="mx-auto max-w-lg px-4 py-16">
        <Empty>
          <p className="mb-4">Sign in as a platform admin to see the whole community.</p>
          <LinkButton to="/manage">Go to sign in</LinkButton>
        </Empty>
      </div>
    )
  if (!access.loaded) return <Spinner />
  if (!access.platform)
    return (
      <div className="mx-auto max-w-lg px-4 py-16">
        <Empty>
          <p className="mb-4">This area is for platform admins.</p>
          <LinkButton to={access.any ? '/manage' : '/dashboard'}>{access.any ? 'Go to the organiser console' : 'Go to my activity'}</LinkButton>
        </Empty>
      </div>
    )

  return (
    <div className="min-h-screen bg-stone-100">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 lg:block"><Sidebar onNavigate={() => {}} /></aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-ink/50" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85%] shadow-xl"><Sidebar onNavigate={() => setOpen(false)} /></aside>
        </div>
      )}
      <div className="lg:pl-64">
        <header className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b border-amber-200 bg-white/95 px-4 backdrop-blur sm:px-6">
          <button type="button" className="-ml-1 rounded-md p-1.5 text-stone-600 hover:bg-stone-100 lg:hidden" aria-label="Open menu" onClick={() => setOpen(true)}>
            <Icon name="menu" />
          </button>
          <Crumbs />
          <span className="ml-auto rounded-md bg-amber-100 px-2 py-1 font-mono text-[11px] font-semibold uppercase tracking-wider text-amber-800">Whole platform</span>
        </header>
        <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8"><PageOutlet /></main>
      </div>
    </div>
  )
}
