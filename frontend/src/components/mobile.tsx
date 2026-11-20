/** Pieces that make the member side work well on a phone. */
import { QRCodeSVG } from 'qrcode.react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useAuth } from 'react-oidc-context'
import { NavLink } from 'react-router-dom'

import { useSignIn } from '../hooks'
import { Icon } from './icons'
import type { IconName } from './icons'

/** App-style tabs along the bottom of the screen on phones. */
export function BottomNav() {
  const auth = useAuth()
  const signIn = useSignIn()
  const tab = ({ isActive }: { isActive: boolean }) =>
    `flex flex-1 flex-col items-center gap-0.5 pb-1.5 pt-2 text-[11px] font-semibold transition ${
      isActive ? 'text-brand-700' : 'text-stone-500 active:text-ink'
    }`
  const item = (icon: IconName, text: string) => (
    <>
      <Icon name={icon} className="h-6 w-6" />
      {text}
    </>
  )
  return (
    <nav
      aria-label="Main"
      className="no-print fixed inset-x-0 bottom-0 z-30 flex border-t border-stone-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      <NavLink to="/events" className={tab}>{item('calendar', 'Events')}</NavLink>
      <NavLink to="/hackathons" className={tab}>{item('trophy', 'Hackathons')}</NavLink>
      {auth.isAuthenticated ? (
        <>
          <NavLink to="/dashboard" className={tab}>{item('home', 'My activity')}</NavLink>
          <NavLink to="/profile" className={tab}>{item('user', 'Profile')}</NavLink>
        </>
      ) : (
        <button type="button" onClick={signIn} className={tab({ isActive: false })}>{item('login', 'Sign in')}</button>
      )}
    </nav>
  )
}

/**
 * Whether the element has scrolled up out of view, so a sticky copy of it can appear.
 * Returns a ref callback to put on the element, and the answer.
 */
export function useScrolledPast() {
  const [node, setNode] = useState<HTMLElement | null>(null)
  const [past, setPast] = useState(false)
  useEffect(() => {
    if (!node || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(([entry]) => setPast(!entry.isIntersecting && entry.boundingClientRect.top < 0))
    observer.observe(node)
    return () => observer.disconnect()
  }, [node])
  return [setNode, past] as const
}

/** The page's main action, pinned above the bottom tabs on phones. */
export function StickyAction({ show, children }: { show: boolean; children: ReactNode }) {
  return (
    <div
      aria-hidden={!show}
      className={`no-print fixed inset-x-0 bottom-[calc(3.6rem+env(safe-area-inset-bottom))] z-20 border-t border-stone-200 bg-white/95 px-4 py-3 backdrop-blur transition duration-200 md:hidden ${
        show ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-4 opacity-0'
      }`}
    >
      {children}
    </div>
  )
}

/** Long text, folded after a few lines with a "Read more" toggle. */
export function ReadMore({ children, height = 288 }: { children: ReactNode; height?: number }) {
  const inner = useRef<HTMLDivElement>(null)
  const [long, setLong] = useState(false)
  const [open, setOpen] = useState(false)
  useLayoutEffect(() => {
    const el = inner.current
    if (!el) return
    const check = () => setLong(el.scrollHeight > height + 80)
    check()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(check)
    observer.observe(el)
    return () => observer.disconnect()
  }, [height])
  const folded = long && !open
  return (
    <div>
      <div className="relative overflow-hidden" style={folded ? { maxHeight: height } : undefined}>
        <div ref={inner}>{children}</div>
        {folded && <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-white" />}
      </div>
      {long && (
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="mt-2 inline-flex items-center gap-1 font-mono text-xs font-semibold uppercase tracking-wider text-brand-700"
        >
          {open ? 'Show less' : 'Read more'}
          <Icon name="chevronDown" className={`h-4 w-4 transition ${open ? 'rotate-180' : ''}`} />
        </button>
      )}
    </div>
  )
}

/** The ticket on its own, big and bright, for showing at the door. */
export function TicketSheet({
  code,
  title,
  name,
  when,
  order,
  onClose,
}: {
  code: string
  title: string
  name: string
  when: string
  order: string
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
    }
  }, [onClose])
  return (
    <div role="dialog" aria-modal="true" aria-label="Your ticket" className="fixed inset-0 z-50 flex flex-col bg-ink text-white">
      <div className="flex items-center justify-between px-4 pb-2 pt-[calc(1rem+env(safe-area-inset-top))]">
        <span className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-brand-300">
          <span className="text-brand-500">// </span>Your ticket
        </span>
        <button type="button" onClick={onClose} aria-label="Close ticket" className="rounded-full p-2 text-white/80 hover:bg-white/10">
          <Icon name="close" className="h-6 w-6" />
        </button>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center px-6 pb-[calc(2rem+env(safe-area-inset-bottom))] text-center">
        <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-ink shadow-2xl">
          <p className="text-lg font-bold leading-tight">{title}</p>
          <p className="mt-1 text-sm text-stone-600">{when}</p>
          <div className="my-5 flex justify-center">
            <QRCodeSVG value={code} size={240} className="h-auto w-full max-w-[240px]" />
          </div>
          <div className="border-t border-dashed border-stone-300 pt-4">
            <p className="font-semibold">{name}</p>
            <p className="font-mono text-xs text-stone-500">Order #{order}</p>
          </div>
        </div>
        <p className="mt-5 text-sm text-white/70">Turn your screen brightness up and show this at the door.</p>
      </div>
    </div>
  )
}
