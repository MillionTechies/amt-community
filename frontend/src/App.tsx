import { useQueryClient } from '@tanstack/react-query'
import { Suspense, lazy, useEffect } from 'react'
import type { ReactNode } from 'react'
import { useAuth } from 'react-oidc-context'
import { Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'

import { setToken } from './api'
import { JUST_SIGNED_IN } from './auth'
import { LogoTile } from './components/brand'
import { ErrorBoundary, PageOutlet } from './components/ErrorBoundary'
import { Icon } from './components/icons'
import { BottomNav } from './components/mobile'
import { Button, Empty, Spinner } from './components/ui'
import { useMe, useSignIn, useSignUp } from './hooks'
import { useAccess } from './console/shared'

const ConsoleApp = lazy(() => import('./console/ConsoleApp'))
const PlatformApp = lazy(() => import('./platform/PlatformApp'))
import CertificatePage from './pages/Certificate'
import Dashboard from './pages/Dashboard'
import EventDetail from './pages/EventDetail'
import Events from './pages/Events'
import HackathonDetail from './pages/HackathonDetail'
import InvitationPage from './pages/Invitation'
import Hackathons from './pages/Hackathons'
import Home from './pages/Home'
import JoinByCode from './pages/JoinByCode'
import JoinOrganization from './pages/JoinOrganization'
import JudgeDesk from './pages/JudgeDesk'
import Judging from './pages/Judging'
import MyHackathon from './pages/MyHackathon'
import Organization from './pages/Organization'
import Profile from './pages/Profile'

/** Old addresses for organiser pages now live in the console. */
function Moved({ to }: { to: (slug: string) => string }) {
  const { slug = '' } = useParams()
  return <Navigate replace to={to(slug)} />
}

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
  const link = ({ isActive }: { isActive: boolean }) =>
    `rounded-lg px-3 py-2 text-sm font-semibold ${isActive ? 'bg-brand-50 text-brand-800' : 'text-stone-700 hover:bg-stone-100'}`
  const access = useAccess()
  const links = (
    <>
      <NavLink to="/events" className={link}>Events</NavLink>
      <NavLink to="/hackathons" className={link}>Hackathons</NavLink>
      {auth.isAuthenticated && <NavLink to="/dashboard" className={link}>My activity</NavLink>}
      {me?.judges_anything && <NavLink to="/judging" className={link}>Judging</NavLink>}
    </>
  )
  return (
    <header className="no-print sticky top-0 z-10 border-b border-stone-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
        <Link to="/" className="flex items-center gap-2 font-bold">
          <LogoTile className="h-8 w-8" />
          <span className="hidden sm:inline">A Million Techies</span>
          <span className="caret text-brand-700">Community</span>
        </Link>
        <nav className="ml-4 hidden items-center gap-1 md:flex">{links}</nav>
        <div className="ml-auto flex items-center gap-2">
          {access.platform && (
            <Link
              to="/platform"
              className="hidden whitespace-nowrap rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 font-mono text-xs font-semibold uppercase tracking-wider text-amber-800 hover:bg-amber-100 lg:inline-flex"
            >
              Platform
            </Link>
          )}
          {access.any && (
            <Link
              to="/manage"
              className="hidden items-center gap-2 whitespace-nowrap rounded-lg bg-ink px-3 py-2 text-sm font-semibold text-white hover:bg-stone-800 sm:inline-flex"
              title={`You are ${/^[AEIOU]/.test(access.role) ? 'an' : 'a'} ${access.role.toLowerCase()}`}
            >
              Organiser console
              <Icon name="chevronRight" className="h-4 w-4" />
            </Link>
          )}
          {auth.isAuthenticated ? (
            <div className="hidden items-center gap-2 md:flex">
              <NavLink to="/profile" className={link}>
                {me?.full_name || auth.user?.profile.name || 'Profile'}
              </NavLink>
              <Button variant="secondary" onClick={() => void auth.signoutRedirect()}>Sign out</Button>
            </div>
          ) : (
            <>
              <span className="hidden md:inline">
                <Button variant="ghost" className="whitespace-nowrap px-3" onClick={signIn} disabled={auth.isLoading}>Sign in</Button>
              </span>
              <Button onClick={signUp} disabled={auth.isLoading}>Join</Button>
            </>
          )}
        </div>
      </div>
    </header>
  )
}

/**
 * Right after signing in, send platform admins to the platform overview, organisers to their
 * console, and members to their activity,
 * unless they signed in from a particular page (an event, say), which they return to.
 */
function SignInLanding() {
  const access = useAccess()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  useEffect(() => {
    if (!access.loaded) return
    let fresh = false
    try {
      fresh = sessionStorage.getItem(JUST_SIGNED_IN) === '1'
      sessionStorage.removeItem(JUST_SIGNED_IN)
    } catch {
      return
    }
    if (!fresh || (pathname !== '/' && pathname !== '/dashboard')) return
    if (access.platform) navigate('/platform', { replace: true })
    else if (access.any) navigate('/manage', { replace: true })
    else if (pathname === '/') navigate('/dashboard', { replace: true })
  }, [access.loaded, access.any, access.platform, navigate, pathname])
  return null
}

/** The public site: header, page, footer. */
function PublicLayout() {
  // The landing page lays out its own full-width sections.
  const isLanding = useLocation().pathname === '/'
  return (
    <div className="flex min-h-screen flex-col pb-[calc(3.6rem+env(safe-area-inset-bottom))] md:pb-0">
      <Header />
      <main className={isLanding ? 'w-full flex-1' : 'mx-auto w-full max-w-6xl flex-1 px-4 py-8'}>
        <PageOutlet />
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
            <Link className="hover:text-ink" to="/manage">For organisers</Link>
            <Link className="hover:text-ink" to="/organizations/join">Bring your organisation</Link>
          </nav>
        </div>
      </footer>
      <BottomNav />
    </div>
  )
}

export default function App() {
  const auth = useAuth()
  const queryClient = useQueryClient()
  const { pathname } = useLocation()
  // Every request made while rendering below must carry the current token.
  setToken(auth.user?.access_token)
  useEffect(() => {
    // What the API returns depends on who is asking; refetch when that changes.
    void queryClient.invalidateQueries()
  }, [auth.isAuthenticated, queryClient])

  if (auth.isLoading) return <Spinner />

  return (
    <ErrorBoundary resetKey={pathname}>
    <SignInLanding />
    <Routes>
      {/* The organiser console has its own sidebar layout, loaded only when opened. */}
      <Route path="/manage/*" element={<Suspense fallback={<Spinner />}><ConsoleApp /></Suspense>} />
      {/* The platform admin area: the whole community, for platform admins. */}
      <Route path="/platform/*" element={<Suspense fallback={<Spinner />}><PlatformApp /></Suspense>} />

      <Route element={<PublicLayout />}>
        <Route path="/" element={<Home />} />
        <Route path="/events" element={<Events />} />
        <Route path="/events/:slug" element={<EventDetail />} />
        <Route path="/hackathons" element={<Hackathons />} />
        <Route path="/hackathons/:slug" element={<HackathonDetail />} />
        <Route path="/hackathons/:slug/judge" element={<Private><Judging /></Private>} />
        <Route path="/hackathons/:slug/workspace" element={<Private><MyHackathon /></Private>} />
        <Route path="/join" element={<JoinByCode />} />
        <Route path="/invitations/:token" element={<InvitationPage />} />
        <Route path="/judging" element={<Private><JudgeDesk /></Private>} />
        <Route path="/certificates/:code" element={<CertificatePage />} />
        <Route path="/organizations/join" element={<JoinOrganization />} />
        <Route path="/organizations/:alias" element={<Organization />} />
        <Route path="/dashboard" element={<Private><Dashboard /></Private>} />
        <Route path="/profile" element={<Private><Profile /></Private>} />
        <Route path="*" element={<Empty>This page does not exist. <Link className="font-semibold text-brand-700" to="/">Go home</Link></Empty>} />
      </Route>

      <Route path="/events/new" element={<Navigate replace to="/manage/events/new" />} />
      <Route path="/events/:slug/manage" element={<Moved to={(slug) => `/manage/events/${slug}`} />} />
      <Route path="/events/:slug/edit" element={<Moved to={(slug) => `/manage/events/${slug}/edit`} />} />
      <Route path="/hackathons/new" element={<Navigate replace to="/manage/hackathons/new" />} />
      <Route path="/hackathons/:slug/manage" element={<Moved to={(slug) => `/manage/hackathons/${slug}`} />} />
      <Route path="/hackathons/:slug/edit" element={<Moved to={(slug) => `/manage/hackathons/${slug}/edit`} />} />
      <Route path="/organisation" element={<Navigate replace to="/manage/team" />} />
    </Routes>
    </ErrorBoundary>
  )
}
