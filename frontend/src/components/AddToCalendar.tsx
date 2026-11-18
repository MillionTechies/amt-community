/** "Add to calendar": Google, Outlook, Office 365, Yahoo, or an .ics file for Apple and the rest. */
import { useEffect, useRef, useState } from 'react'

import type { CommunityEvent } from '../api'

const API = import.meta.env.VITE_API_URL

/** 2026-11-30T06:00:00Z -> 20261130T060000Z */
const compact = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')

function links(e: CommunityEvent) {
  const page = `${location.origin}/events/${e.slug}`
  const join = e.online_url ? `Join${e.meeting_provider ? ` on ${e.meeting_provider.name}` : ''}: ${e.online_url}\n\n` : ''
  const details = `${join}${e.summary ? `${e.summary}\n\n` : ''}Event page: ${page}`
  const where = e.venue && e.delivery_mode !== 'online' ? e.venue : e.online_url || (e.meeting_provider ? `Online (${e.meeting_provider.name})` : 'Online')
  const q = (params: Record<string, string>) => new URLSearchParams(params).toString()
  const outlook = (host: string) =>
    `https://${host}/calendar/0/action/compose?${q({
      path: '/calendar/action/compose', rru: 'addevent', subject: e.title,
      startdt: new Date(e.starts_at).toISOString(), enddt: new Date(e.ends_at).toISOString(), body: details, location: where,
    })}`
  // Someone registered gets their own file, with the meeting link in it.
  const ics = e.my_registration?.status === 'registered'
    ? `${API}/api/tickets/${e.my_registration.ticket_code}/calendar.ics`
    : `${API}/api/events/${e.slug}/calendar.ics`
  return [
    { label: 'Google Calendar', href: `https://calendar.google.com/calendar/render?${q({ action: 'TEMPLATE', text: e.title, dates: `${compact(e.starts_at)}/${compact(e.ends_at)}`, details, location: where })}` },
    { label: 'Outlook.com', href: outlook('outlook.live.com') },
    { label: 'Office 365', href: outlook('outlook.office.com') },
    { label: 'Yahoo Calendar', href: `https://calendar.yahoo.com/?${q({ v: '60', title: e.title, st: compact(e.starts_at), et: compact(e.ends_at), desc: details, in_loc: where })}` },
    { label: 'Apple Calendar or other (.ics)', href: ics },
  ]
}

export function AddToCalendar({ event }: { event: CommunityEvent }) {
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

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-stone-300 bg-white px-4 py-2 font-mono text-[0.8125rem] font-semibold uppercase tracking-[0.06em] hover:border-ink"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M4 6h16v14H4zM4 10h16M8 3v4M16 3v4M12 13v4M10 15h4" /></svg>
        Add to calendar
      </button>
      {open && (
        <div role="menu" className="absolute right-0 left-0 z-20 mt-2 rounded-xl border border-stone-200 bg-white p-1.5 shadow-lg">
          {links(event).map((l) => (
            <a
              key={l.label}
              role="menuitem"
              href={l.href}
              target={l.href.endsWith('.ics') ? undefined : '_blank'}
              rel="noreferrer"
              onClick={() => setOpen(false)}
              className="block rounded-md px-3 py-2 text-sm hover:bg-stone-100"
            >
              {l.label}
            </a>
          ))}
        </div>
      )}
    </div>
  )
}
