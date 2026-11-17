import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useAuth } from 'react-oidc-context'
import { Link, NavLink, Route, Routes, useLocation } from 'react-router-dom'

import { setToken } from './api'
import { LogoTile } from './components/brand'
import { Button, Empty, Spinner } from './components/ui'
import { useMe, useSignIn, useSignUp } from './hooks'
import CertificatePage from './pages/Certificate'
import Dashboard from './pages/Dashboard'
import EventDetail from './pages/EventDetail'
import EventForm from './pages/EventForm'
import EventManage from './pages/EventManage'
import Events from './pages/Events'
import HackathonDetail from './pages/HackathonDetail'
import HackathonForm from './pages/HackathonForm'
import HackathonManage from './pages/HackathonManage'
import Hackathons from './pages/Hackathons'
import Home from './pages/Home'
import Judging from './pages/Judging'
import Organization from './pages/Organization'
import Profile from './pages/Profile'

/** Pages that only make sense for a signed-in member. */
function Private({ children }: { children: ReactNode }) {
  const auth = useAuth()
  const signIn = useSignIn()
  if (auth.isAuthenticated) return <>{children}</>
  return (
    <Empty>
      <p className="mb-4">Sign in to see this page.</p>
      <Button onClick={signIn}>Sign in</Button>
    </Empty>
  )
}

function Header() {
  const auth = useAuth()
  const me = useMe()
  const signIn = useSignIn()
  const signUp = useSignUp()
  const [open, setOpen] = useState(false)
  const link = ({ isActive }: { isActive: boolean }) =>
    `rounded-lg px-3 py-2 text-sm font-semibold ${isActive ? 'bg-brand-50 text-brand-800' : 'text-stone-700 hover:bg-stone-100'}`
  const manages = me?.organizations.some((o) => o.is_admin)
  const links = (
    <>
      <NavLink to="/events" className={link}>Events</NavLink>
      <NavLink to="/hackathons" className={link}>Hackathons</NavLink>
      {auth.isAuthenticated && <NavLink to="/dashboard" className={link}>My activity</NavLink>}
      {manages && <NavLink to="/organisation" className={link}>Organisation</NavLink>}
    </>
  )
  return (
    <header className="no-print sticky top-0 z-10 border-b border-stone-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
        <Link to="/" className="flex items-center gap-2 font-bold">
          <LogoTile className="h-8 w-8" />
          <span className="hidden sm:inline">A Million Techies</span>
          <span className="text-brand-700">Community</span>
        </Link>
        <nav className="ml-4 hidden items-center gap-1 md:flex">{links}</nav>
        <div className="ml-auto flex items-center gap-2">
          {auth.isAuthenticated ? (
            <>
              <NavLink to="/profile" className={link}>
                {me?.full_name || auth.user?.profile.name || 'Profile'}
              </NavLink>
              <Button variant="secondary" onClick={() => void auth.signoutRedirect()}>Sign out</Button>
            </>
          ) : (
            <>
              <Button variant="ghost" className="whitespace-nowrap px-3" onClick={signIn} disabled={auth.isLoading}>Sign in</Button>
              <Button onClick={signUp} disabled={auth.isLoading}>Join</Button>
            </>
          )}
          <button
            type="button"
            className="rounded-lg p-2 text-stone-700 hover:bg-stone-100 md:hidden"
            aria-label="Menu"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 5h14M3 10h14M3 15h14" />
            </svg>
          </button>
        </div>
      </div>
      {open && (
        <nav className="flex flex-col gap-1 border-t border-stone-200 px-4 py-2 md:hidden" onClick={() => setOpen(false)}>
          {links}
        </nav>
      )}
    </header>
  )
}

export default function App() {
  const auth = useAuth()
  const queryClient = useQueryClient()
  // The landing page lays out its own full-width sections.
  const isLanding = useLocation().pathname === '/'
  // Every request made while rendering below must carry the current token.
  setToken(auth.user?.access_token)
  useEffect(() => {
    // What the API returns depends on who is asking; refetch when that changes.
    void queryClient.invalidateQueries()
  }, [auth.isAuthenticated, queryClient])

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className={isLanding ? 'w-full flex-1' : 'mx-auto w-full max-w-6xl flex-1 px-4 py-8'}>
        {auth.isLoading ? (
          <Spinner />
        ) : (
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/events" element={<Events />} />
            <Route path="/events/new" element={<Private><EventForm /></Private>} />
            <Route path="/events/:id" element={<EventDetail />} />
            <Route path="/events/:id/edit" element={<Private><EventForm /></Private>} />
            <Route path="/events/:id/manage" element={<Private><EventManage /></Private>} />
            <Route path="/hackathons" element={<Hackathons />} />
            <Route path="/hackathons/new" element={<Private><HackathonForm /></Private>} />
            <Route path="/hackathons/:id" element={<HackathonDetail />} />
            <Route path="/hackathons/:id/edit" element={<Private><HackathonForm /></Private>} />
            <Route path="/hackathons/:id/manage" element={<Private><HackathonManage /></Private>} />
            <Route path="/hackathons/:id/judge" element={<Private><Judging /></Private>} />
            <Route path="/certificates/:code" element={<CertificatePage />} />
            <Route path="/dashboard" element={<Private><Dashboard /></Private>} />
            <Route path="/profile" element={<Private><Profile /></Private>} />
            <Route path="/organisation" element={<Private><Organization /></Private>} />
            <Route path="*" element={<Empty>This page does not exist. <Link className="font-semibold text-brand-700" to="/">Go home</Link></Empty>} />
          </Routes>
        )}
      </main>
      <footer className="no-print border-t border-stone-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-sm text-stone-500 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-center gap-2">
            <LogoTile className="h-6 w-6" />
            <span>
              Community is part of <a className="font-semibold text-ink hover:text-brand-700" href="https://amilliontechies.com">A Million Techies</a>. Learn. Build. Grow.
            </span>
          </p>
          <nav className="flex flex-wrap gap-x-5 gap-y-2 font-medium">
            <a className="hover:text-ink" href="https://amilliontechies.com">amilliontechies.com</a>
            <a className="hover:text-ink" href="https://learn.amilliontechies.com">Courses</a>
            <Link className="hover:text-ink" to="/events">Events</Link>
            <Link className="hover:text-ink" to="/hackathons">Hackathons</Link>
          </nav>
        </div>
      </footer>
    </div>
  )
}
