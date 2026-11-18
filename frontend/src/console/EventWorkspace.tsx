/** One event in the console: a header with its lifecycle actions, and a page per section. */
import { useQuery } from '@tanstack/react-query'
import { Scanner } from '@yudiel/react-qr-scanner'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, Outlet, useNavigate, useOutletContext, useParams } from 'react-router-dom'

import { api } from '../api'
import type { Announcement, CommunityEvent, EventStats, Feedback, Registration, Resource } from '../api'
import { Icon } from '../components/icons'
import {
  Badge, Button, Empty, ErrorNote, Field, Input, LinkButton, Notice, Spinner, StatusBadge, Textarea,
  formatDateTime, formatRange, label,
} from '../components/ui'
import { useAct } from '../hooks'
import { EVENT_TYPE_LABELS } from '../pages/Events'
import { DailyBars } from './charts'
import { ConsoleHeader, Kpi, Meter, Panel, relative, table } from './shared'

type Ctx = { event: CommunityEvent }
const useEvent = () => useOutletContext<Ctx>().event

export default function EventWorkspace() {
  const { slug } = useParams()
  const navigate = useNavigate()
  const event = useQuery({ queryKey: ['event', slug], queryFn: () => api<CommunityEvent>(`/events/${slug}/`) })
  const move = useAct((status: string) => api(`/events/${slug}/transition/`, { method: 'POST', body: { status } }))
  const remove = useAct(() => api(`/events/${slug}/`, { method: 'DELETE' }))

  if (event.isLoading) return <Spinner />
  if (!event.data) return <ErrorNote error={event.error ?? 'Event not found.'} />
  const e = event.data
  if (!e.can_manage) return <Empty>You do not organise this event.</Empty>
  const confirmMove = (status: string, question: string) => () => window.confirm(question) && move.mutate(status)

  return (
    <>
      <ConsoleHeader
        title={e.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <StatusBadge status={e.status} />
            <span className="inline-flex items-center gap-1"><Icon name="calendar" className="h-4 w-4" />{formatRange(e.starts_at, e.ends_at)}</span>
            <span>{e.organization.name}</span>
          </span>
        }
        actions={
          <>
            <a href={`/events/${e.slug}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-semibold hover:bg-stone-100">
              <Icon name="external" className="h-4 w-4" />Public page
            </a>
            {e.status === 'draft' && (
              <>
                <Button variant="danger" onClick={() => window.confirm('Delete this draft?') && remove.mutate(undefined, { onSuccess: () => navigate('/manage/events') })}>Delete</Button>
                <Button disabled={move.isPending} onClick={() => move.mutate('published')}>Publish</Button>
              </>
            )}
            {e.status === 'published' && (
              <>
                <Button variant="danger" onClick={confirmMove('cancelled', 'Cancel this event? This cannot be undone.')}>Cancel event</Button>
                <Button onClick={confirmMove('completed', 'Mark this event as completed? Attendees can then get their certificates.')}>Mark completed</Button>
              </>
            )}
          </>
        }
      />
      <div className="mb-4 space-y-3 empty:hidden">
        <ErrorNote error={move.error ?? remove.error} />
        {e.status === 'draft' && <Notice tone="amber">This is a draft. Only organisers can see it until you publish.</Notice>}
      </div>
      <Outlet context={{ event: e } satisfies Ctx} />
    </>
  )
}

// --- overview ------------------------------------------------------------------

function useRegistrations(slug: string) {
  return useQuery({ queryKey: ['event', slug, 'registrations'], queryFn: () => api<Registration[]>(`/events/${slug}/registrations/`) })
}

export function EventOverview() {
  const e = useEvent()
  const stats = useQuery({ queryKey: ['event', e.slug, 'stats'], queryFn: () => api<EventStats>(`/events/${e.slug}/stats/`) })
  const registrations = useRegistrations(e.slug)
  const resources = useQuery({ queryKey: ['event', String(e.slug), 'resources'], queryFn: () => api<Resource[]>(`/events/${e.slug}/resources/`) })
  const announcements = useQuery({ queryKey: ['event', String(e.slug), 'announcements'], queryFn: () => api<Announcement[]>(`/events/${e.slug}/announcements/`) })
  if (!stats.data) return <Spinner />
  const s = stats.data
  const base = `/manage/events/${e.slug}`
  const started = new Date(e.starts_at).getTime() <= Date.now()
  const recent = [...(registrations.data ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 6)

  const steps = [
    { done: e.status !== 'draft', text: 'Publish the event so people can register', to: base },
    { done: !!e.summary && !!e.description, text: 'Write a summary and description', to: `${base}/edit` },
    { done: (announcements.data?.length ?? 0) > 0, text: 'Post a welcome announcement', to: `${base}/content` },
    { done: (resources.data?.length ?? 0) > 0, text: 'Share slides, links or a recording', to: `${base}/content` },
    { done: s.checked_in > 0, text: 'Check people in on the day', to: `${base}/check-in` },
    { done: e.status === 'completed', text: 'Mark it completed to release certificates', to: base },
  ]
  const doneCount = steps.filter((x) => x.done).length

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Kpi
          label="Registered"
          value={s.registered}
          icon="users"
          to={`${base}/registrations`}
          note={s.capacity ? <span className="block"><span className="mb-1.5 block">{Math.max(0, s.capacity - s.registered)} of {s.capacity} places left</span><Meter value={s.registered} max={s.capacity} label="Places taken" warn /></span> : 'No limit on places'}
        />
        <Kpi label="Waiting list" value={s.waitlisted} icon="clock" note={s.cancelled ? `${s.cancelled} cancelled` : 'Nobody has cancelled'} />
        <Kpi
          label="Checked in"
          value={s.checked_in}
          icon="scan"
          to={`${base}/check-in`}
          note={s.attendance_rate === null ? (started ? 'Nobody checked in yet' : `Starts ${relative(e.starts_at)}`) : `${Math.round(s.attendance_rate * 100)}% of those registered`}
        />
        <Kpi
          label="Average rating"
          value={s.average_rating === null ? '–' : s.average_rating.toFixed(1)}
          icon="star"
          to={`${base}/feedback`}
          note={s.feedback_count ? `From ${s.feedback_count} responses, out of 5` : 'No feedback yet'}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Panel title="Sign-ups per day">
            {registrations.data?.length ? (
              <DailyBars dates={registrations.data.map((r) => r.created_at)} noun="sign-up" />
            ) : (
              <p className="py-8 text-center text-sm text-stone-600">Sign-ups will show here once people register.</p>
            )}
          </Panel>
          <Panel title="Latest registrations" action={<Link to={`${base}/registrations`} className="text-sm font-semibold text-brand-700 hover:underline">See all</Link>} flush>
            {recent.length ? (
              <ul className="divide-y divide-stone-100">
                {recent.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{r.person.name}</p>
                      <p className="truncate text-xs text-stone-500">{r.person.institution || r.email}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <span className="hidden text-xs text-stone-500 sm:inline">{relative(r.created_at)}</span>
                      {r.checked_in_at ? <Badge tone="blue">Checked in</Badge> : <StatusBadge status={r.status} />}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-5 py-8 text-center text-sm text-stone-600">Nobody has registered yet.</p>
            )}
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel title="Getting it right" action={<span className="text-xs font-semibold tabular-nums text-stone-500">{doneCount} of {steps.length}</span>}>
            <div className="mb-4"><Meter value={doneCount} max={steps.length} label="Steps done" /></div>
            <ul className="space-y-2.5">
              {steps.map((step) => (
                <li key={step.text} className="flex items-start gap-2.5 text-sm">
                  <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full ${step.done ? 'bg-brand-600 text-white' : 'border border-stone-300 text-transparent'}`}>
                    <Icon name="check" className="h-3 w-3" />
                  </span>
                  {step.done ? (
                    <span className="text-stone-500 line-through decoration-stone-300">{step.text}</span>
                  ) : (
                    <Link to={step.to} className="font-medium hover:text-brand-700">{step.text}</Link>
                  )}
                </li>
              ))}
            </ul>
          </Panel>
          <Panel title="Details" action={<Link to={`${base}/edit`} className="text-sm font-semibold text-brand-700 hover:underline">Edit</Link>}>
            <dl className="space-y-3 text-sm">
              {[
                ['Type', EVENT_TYPE_LABELS[e.event_type] ?? label(e.event_type)],
                ['Format', label(e.delivery_mode)],
                ['Venue', e.venue || (e.online_url ? 'Online' : 'Not set')],
                ['Places', e.capacity ? String(e.capacity) : 'No limit'],
                ['Registration closes', e.registration_deadline ? formatDateTime(e.registration_deadline) : 'When the event ends'],
                ['Registration', e.registration_open ? 'Open' : 'Closed'],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4">
                  <dt className="text-stone-500">{k}</dt>
                  <dd className="text-right font-medium">{v}</dd>
                </div>
              ))}
            </dl>
          </Panel>
        </div>
      </div>
    </div>
  )
}

// --- registrations -------------------------------------------------------------

type Who = 'all' | 'registered' | 'checked_in' | 'waitlisted' | 'cancelled'

export function EventRegistrations() {
  const e = useEvent()
  const registrations = useRegistrations(e.slug)
  const [search, setSearch] = useState('')
  const [who, setWho] = useState<Who>('all')
  const checkIn = useAct((registration: number) => api(`/events/${e.slug}/check-in/`, { method: 'POST', body: { registration } }))
  const undo = useAct((registration: number) => api(`/events/${e.slug}/check-in/?registration=${registration}`, { method: 'DELETE' }))
  if (!registrations.data) return <Spinner />
  const all = registrations.data
  const matches: Record<Who, (r: Registration) => boolean> = {
    all: () => true,
    registered: (r) => r.status === 'registered' && !r.checked_in_at,
    checked_in: (r) => !!r.checked_in_at,
    waitlisted: (r) => r.status === 'waitlisted',
    cancelled: (r) => r.status === 'cancelled',
  }
  const term = search.toLowerCase()
  const rows = all.filter(matches[who]).filter((r) => r.person.name.toLowerCase().includes(term) || r.email.toLowerCase().includes(term))
  const download = () => {
    const quote = (v: string) => `"${v.replace(/"/g, '""')}"`
    const lines = [
      ['Name', 'Email', 'Institution', 'Status', 'Registered', 'Checked in'].join(','),
      ...all.map((r) => [r.person.name, r.email, r.person.institution, r.status, r.created_at, r.checked_in_at ?? ''].map(quote).join(',')),
    ]
    const link = document.createElement('a')
    link.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }))
    link.download = `event-${e.slug}-registrations.csv`
    link.click()
    URL.revokeObjectURL(link.href)
  }
  const chip = (id: Who, text: string) => {
    const count = all.filter(matches[id]).length
    return (
      <button
        key={id}
        type="button"
        role="tab"
        aria-selected={who === id}
        onClick={() => setWho(id)}
        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium ${who === id ? 'border-ink bg-ink text-white' : 'border-stone-300 bg-white text-stone-700 hover:border-stone-400'}`}
      >
        {text}<span className={`text-xs tabular-nums ${who === id ? 'text-white/70' : 'text-stone-500'}`}>{count}</span>
      </button>
    )
  }

  return (
    <div className="overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-stone-200 px-5 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-1.5" role="tablist">
          {chip('all', 'All')}
          {chip('registered', 'Not yet in')}
          {chip('checked_in', 'Checked in')}
          {chip('waitlisted', 'Waiting list')}
          {chip('cancelled', 'Cancelled')}
        </div>
        <div className="flex gap-2">
          <label className="relative block flex-1 lg:w-64">
            <span className="sr-only">Search registrations</span>
            <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
            <Input type="search" placeholder="Name or email" value={search} onChange={(ev) => setSearch(ev.target.value)} className="pl-9" />
          </label>
          <Button variant="secondary" onClick={download} disabled={!all.length}>Export CSV</Button>
        </div>
      </div>
      <div className="px-5 empty:hidden"><ErrorNote error={checkIn.error ?? undo.error} /></div>
      {rows.length ? (
        <div className={table.wrap}>
          <table className={table.table}>
            <thead className={table.head}>
              <tr>
                <th className={table.th}>Name</th>
                <th className={table.th}>Email</th>
                <th className={table.th}>Registered</th>
                <th className={table.th}>Status</th>
                <th className={`${table.th} text-right`}>Check-in</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={table.row}>
                  <td className={table.td}>
                    <p className="font-semibold">{r.person.name}</p>
                    {r.person.institution && <p className="text-xs text-stone-500">{r.person.institution}</p>}
                  </td>
                  <td className={table.td}>{r.email}</td>
                  <td className={`${table.td} whitespace-nowrap text-stone-600`}>{formatDateTime(r.created_at)}</td>
                  <td className={table.td}>{r.checked_in_at ? <Badge tone="blue">Checked in</Badge> : <StatusBadge status={r.status} />}</td>
                  <td className={`${table.td} text-right`}>
                    {r.checked_in_at ? (
                      <span className="inline-flex items-center gap-2">
                        <span className="text-xs text-stone-500">{formatDateTime(r.checked_in_at)}</span>
                        <Button variant="ghost" className="px-2 py-1" onClick={() => undo.mutate(r.id)}>Undo</Button>
                      </span>
                    ) : (
                      r.status === 'registered' && <Button variant="secondary" className="px-3 py-1" onClick={() => checkIn.mutate(r.id)}>Check in</Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="px-5 py-12 text-center text-stone-600">{all.length ? 'Nobody matches.' : 'Nobody has registered yet.'}</p>
      )}
    </div>
  )
}

// --- check-in ------------------------------------------------------------------

export function EventCheckIn() {
  const e = useEvent()
  const stats = useQuery({ queryKey: ['event', e.slug, 'stats'], queryFn: () => api<EventStats>(`/events/${e.slug}/stats/`) })
  const [scanning, setScanning] = useState(false)
  const [log, setLog] = useState<{ ok: boolean; message: string; at: Date }[]>([])
  const [last, setLast] = useState('')
  const checkIn = useAct((ticket_code: string) =>
    api<Registration & { already_checked_in: boolean }>(`/events/${e.slug}/check-in/`, { method: 'POST', body: { ticket_code } }),
  )
  const record = (ok: boolean, message: string) => setLog((l) => [{ ok, message, at: new Date() }, ...l].slice(0, 20))
  const handle = (code: string) => {
    // The camera reports the same code many times a second; act on it once.
    if (!code || code === last || checkIn.isPending) return
    setLast(code)
    checkIn.mutate(code, {
      onSuccess: (r) => record(!r.already_checked_in, r.already_checked_in ? `${r.person.name} was already checked in` : `${r.person.name} checked in`),
      onError: (error) => record(false, error.message),
    })
  }
  const s = stats.data
  const latest = log[0]

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <div className="lg:col-span-3">
        <Panel title="Scan tickets">
          <p className="mb-4 text-sm text-stone-600">
            Point the camera at the QR code on an attendee's ticket. To check someone in by name, use <Link className="font-semibold text-brand-700" to={`/manage/events/${e.slug}/registrations`}>Registrations</Link>.
          </p>
          {latest && (
            <div className="mb-4" aria-live="polite">
              <Notice tone={latest.ok ? 'green' : 'amber'}>{latest.message}.</Notice>
            </div>
          )}
          {scanning ? (
            <div className="mx-auto max-w-sm space-y-3">
              <div className="overflow-hidden rounded-xl">
                <Scanner
                  onScan={(codes) => handle(codes[0]?.rawValue ?? '')}
                  onError={() => {
                    setScanning(false)
                    record(false, 'Could not use the camera. Allow camera access in your browser and try again')
                  }}
                />
              </div>
              <Button variant="secondary" className="w-full" onClick={() => setScanning(false)}>Stop scanning</Button>
            </div>
          ) : (
            <Button onClick={() => { setLast(''); setScanning(true) }}><Icon name="scan" className="h-4 w-4" />Start scanning</Button>
          )}
        </Panel>
      </div>
      <div className="space-y-6 lg:col-span-2">
        <Panel title="At the door">
          {s ? (
            <>
              <div className="flex items-baseline justify-between">
                <span className="text-4xl font-bold tabular-nums">{s.checked_in}</span>
                <span className="text-sm text-stone-600">of {s.registered} registered</span>
              </div>
              <div className="mt-3"><Meter value={s.checked_in} max={Math.max(1, s.registered)} label="Checked in" /></div>
            </>
          ) : <Spinner />}
        </Panel>
        <Panel title="This session" flush>
          {log.length ? (
            <ul className="divide-y divide-stone-100">
              {log.map((entry, i) => (
                <li key={i} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                  <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full ${entry.ok ? 'bg-brand-100 text-brand-700' : 'bg-amber-100 text-amber-700'}`}>
                    <Icon name={entry.ok ? 'check' : 'alert'} className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0 flex-1 truncate">{entry.message}</span>
                  <span className="text-xs tabular-nums text-stone-500">{entry.at.toLocaleTimeString('en-GB', { timeStyle: 'short' })}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-5 py-6 text-center text-sm text-stone-600">Scans will be listed here.</p>
          )}
        </Panel>
      </div>
    </div>
  )
}

// --- announcements and resources ------------------------------------------------

export function EventContent() {
  const { slug: id } = useEvent()
  const announcements = useQuery({ queryKey: ['event', String(id), 'announcements'], queryFn: () => api<Announcement[]>(`/events/${id}/announcements/`) })
  const resources = useQuery({ queryKey: ['event', String(id), 'resources'], queryFn: () => api<Resource[]>(`/events/${id}/resources/`) })
  const [note, setNote] = useState({ title: '', body: '' })
  const [link, setLink] = useState({ title: '', url: '', description: '' })
  const post = useAct(() => api(`/events/${id}/announcements/`, { method: 'POST', body: note }))
  const add = useAct(() => api(`/events/${id}/resources/`, { method: 'POST', body: link }))
  const remove = useAct((path: string) => api(`/events/${id}/${path}/`, { method: 'DELETE' }))
  const submit = (action: typeof post, reset: () => void) => (ev: FormEvent) => {
    ev.preventDefault()
    action.mutate(undefined, { onSuccess: reset })
  }
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Panel title="Announcements">
        <p className="mb-4 text-sm text-stone-600">Shown on the event page to everyone registered.</p>
        <form className="space-y-3" onSubmit={submit(post, () => setNote({ title: '', body: '' }))}>
          <Field label="Title"><Input required value={note.title} onChange={(ev) => setNote({ ...note, title: ev.target.value })} /></Field>
          <Field label="Message"><Textarea required rows={3} value={note.body} onChange={(ev) => setNote({ ...note, body: ev.target.value })} /></Field>
          <ErrorNote error={post.error} />
          <Button type="submit" disabled={post.isPending}>Post announcement</Button>
        </form>
        <ul className="mt-5 divide-y divide-stone-100 border-t border-stone-200">
          {announcements.data?.map((a) => (
            <li key={a.id} className="flex items-start justify-between gap-2 py-3">
              <div>
                <p className="font-semibold">{a.title}</p>
                <p className="text-sm text-stone-600">{a.body}</p>
                <p className="mt-1 text-xs text-stone-500">{formatDateTime(a.created_at)}</p>
              </div>
              <Button variant="ghost" onClick={() => window.confirm('Remove this announcement?') && remove.mutate(`announcements/${a.id}`)}>Remove</Button>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel title="Resources">
        <p className="mb-4 text-sm text-stone-600">Slides, recordings and repositories for attendees.</p>
        <form className="space-y-3" onSubmit={submit(add, () => setLink({ title: '', url: '', description: '' }))}>
          <Field label="Title"><Input required value={link.title} onChange={(ev) => setLink({ ...link, title: ev.target.value })} /></Field>
          <Field label="Link"><Input type="url" required placeholder="https://" value={link.url} onChange={(ev) => setLink({ ...link, url: ev.target.value })} /></Field>
          <ErrorNote error={add.error} />
          <Button type="submit" disabled={add.isPending}>Add resource</Button>
        </form>
        <ul className="mt-5 divide-y divide-stone-100 border-t border-stone-200">
          {resources.data?.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-2 py-3">
              <a className="font-semibold text-brand-700 hover:underline" href={r.url} target="_blank" rel="noreferrer">{r.title}</a>
              <Button variant="ghost" onClick={() => remove.mutate(`resources/${r.id}`)}>Remove</Button>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  )
}

// --- feedback ------------------------------------------------------------------

export function EventFeedback() {
  const e = useEvent()
  const feedback = useQuery({ queryKey: ['event', e.slug, 'feedback'], queryFn: () => api<Feedback[]>(`/events/${e.slug}/feedback/`) })
  if (!feedback.data) return <Spinner />
  const rows = feedback.data
  if (!rows.length)
    return (
      <Empty>
        No feedback yet. Attendees can rate the event from its page once they are checked in.{' '}
        <LinkButton to={`/events/${e.slug}`} variant="ghost">View the page</LinkButton>
      </Empty>
    )
  const average = rows.reduce((s, f) => s + f.rating, 0) / rows.length
  const comments = rows.filter((f) => f.comment)
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Panel title="Ratings">
        <div className="mb-5 flex items-baseline gap-2">
          <span className="text-4xl font-bold tabular-nums">{average.toFixed(1)}</span>
          <span className="text-sm text-stone-600">out of 5, from {rows.length} {rows.length === 1 ? 'response' : 'responses'}</span>
        </div>
        <ul className="space-y-2">
          {[5, 4, 3, 2, 1].map((n) => {
            const count = rows.filter((f) => f.rating === n).length
            return (
              <li key={n} className="flex items-center gap-3 text-sm">
                <span className="w-14 shrink-0 text-stone-600">{n} {n === 1 ? 'star' : 'stars'}</span>
                <span className="flex-1"><Meter value={count} max={rows.length} label={`${n} stars`} /></span>
                <span className="w-6 text-right tabular-nums text-stone-600">{count}</span>
              </li>
            )
          })}
        </ul>
      </Panel>
      <div className="lg:col-span-2">
        <Panel title={`Comments (${comments.length})`} flush>
          {comments.length ? (
            <ul className="divide-y divide-stone-100">
              {comments.map((f) => (
                <li key={f.id} className="px-5 py-4">
                  <div className="mb-1 flex items-center gap-2">
                    <Badge tone="green">{f.rating} of 5</Badge>
                    <span className="text-xs text-stone-500">{formatDateTime(f.created_at)}</span>
                  </div>
                  <p className="text-stone-700">{f.comment}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-5 py-8 text-center text-sm text-stone-600">Ratings came in without comments.</p>
          )}
        </Panel>
      </div>
    </div>
  )
}
