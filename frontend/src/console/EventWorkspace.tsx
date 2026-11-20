/** One event in the console: a header with its lifecycle actions, and a page per section. */
import { useQuery } from '@tanstack/react-query'
import { Scanner } from '@yudiel/react-qr-scanner'
import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, Outlet, useNavigate, useOutletContext, useParams } from 'react-router-dom'

import { api } from '../api'
import type { Announcement, CommunityEvent, EventStats, Feedback, Registration, Resource } from '../api'
import { DataTable, downloadCsv } from '../components/DataTable'
import type { Col } from '../components/DataTable'
import { Icon } from '../components/icons'
import { RichText } from '../components/RichText'
import { RichTextEditor } from '../components/RichTextEditor'
import {
  Badge, Button, Empty, ErrorNote, Field, Input, LinkButton, Notice, Spinner, StatusBadge,
  formatDateTime, formatRange, label,
} from '../components/ui'
import { useConfirm, useToast } from '../components/feedback'
import type { ConfirmOptions, ToastOptions } from '../components/feedback'
import { useAct } from '../hooks'
import { EVENT_TYPE_LABELS } from '../pages/Events'
import { DailyBars } from './charts'
import { MeetingPanel } from './MeetingPanel'
import { ConsoleHeader, FilterChips, Kpi, Meter, Panel, relative } from './shared'

type Ctx = { event: CommunityEvent }
const useEvent = () => useOutletContext<Ctx>().event

export default function EventWorkspace() {
  const { slug } = useParams()
  const navigate = useNavigate()
  const event = useQuery({ queryKey: ['event', slug], queryFn: () => api<CommunityEvent>(`/events/${slug}/`) })
  const move = useAct((status: string) => api(`/events/${slug}/transition/`, { method: 'POST', body: { status } }))
  const remove = useAct(() => api(`/events/${slug}/`, { method: 'DELETE' }))
  const confirm = useConfirm()
  const toast = useToast()

  if (event.isLoading) return <Spinner />
  if (!event.data) return <ErrorNote error={event.error ?? 'Event not found.'} />
  const e = event.data
  if (!e.can_manage) return <Empty>You do not organise this event.</Empty>
  const failed = (title: string) => (error: Error) => toast({ tone: 'error', title, message: error.message })
  const moveTo = (status: string, done: ToastOptions, ask: ConfirmOptions) => async () => {
    if (await confirm(ask)) move.mutate(status, { onSuccess: () => toast(done), onError: failed('Could not update the event') })
  }
  const deleteDraft = async () => {
    const ok = await confirm({
      tone: 'danger', title: 'Delete this draft?', confirmLabel: 'Delete draft',
      message: <>“{e.title}” is removed for good.</>,
    })
    if (ok) {
      remove.mutate(undefined, {
        onSuccess: () => {
          toast({ title: 'Draft deleted' })
          navigate('/manage/events')
        },
        onError: failed('Could not delete the draft'),
      })
    }
  }

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
                <Button variant="danger" disabled={remove.isPending} onClick={() => void deleteDraft()}>Delete</Button>
                <Button
                  disabled={move.isPending}
                  onClick={moveTo(
                    'published',
                    { title: 'Event published', message: 'Registration is open.' },
                    { title: 'Publish this event?', confirmLabel: 'Publish', icon: 'megaphone', message: 'Everyone can see it and register. Check the date, place and capacity first.' },
                  )}
                >
                  Publish
                </Button>
              </>
            )}
            {e.status === 'published' && (
              <>
                <Button
                  variant="danger"
                  disabled={move.isPending}
                  onClick={moveTo(
                    'cancelled',
                    { tone: 'info', title: 'Event cancelled', message: 'Everyone registered has been emailed.' },
                    {
                      tone: 'danger', title: 'Cancel this event?', confirmLabel: 'Yes, cancel it', cancelLabel: 'Keep it',
                      message: 'Everyone registered is emailed and the event is removed from their calendars. This cannot be undone.',
                    },
                  )}
                >
                  Cancel event
                </Button>
                <Button
                  disabled={move.isPending}
                  onClick={moveTo(
                    'completed',
                    { title: 'Event completed', message: 'Attendees can now download their certificates.' },
                    { title: 'Mark this event as completed?', confirmLabel: 'Mark completed', icon: 'check', message: 'Attendees who checked in can then get their certificates.' },
                  )}
                >
                  Mark completed
                </Button>
              </>
            )}
          </>
        }
      />
      <div className="mb-4 space-y-3 empty:hidden">
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
          <MeetingPanel event={e} />
          <Panel title="Details" action={<Link to={`${base}/edit`} className="text-sm font-semibold text-brand-700 hover:underline">Edit</Link>}>
            <dl className="space-y-3 text-sm">
              {[
                ['Type', EVENT_TYPE_LABELS[e.event_type] ?? label(e.event_type)],
                ['Format', label(e.delivery_mode)],
                ['Venue', e.venue || 'Not set'],
                ['Online', e.delivery_mode === 'in_person' ? 'No' : e.meeting_provider?.name ?? (e.online_url ? 'Link added' : 'No link yet')],
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

const WHO: Record<Who, (r: Registration) => boolean> = {
  all: () => true,
  registered: (r) => r.status === 'registered' && !r.checked_in_at,
  checked_in: (r) => !!r.checked_in_at,
  waitlisted: (r) => r.status === 'waitlisted',
  cancelled: (r) => r.status === 'cancelled',
}

export function EventRegistrations() {
  const e = useEvent()
  const registrations = useRegistrations(e.slug)
  const [who, setWho] = useState<Who>('all')
  const checkIn = useAct((registration: number) => api(`/events/${e.slug}/check-in/`, { method: 'POST', body: { registration } }))
  const undo = useAct((registration: number) => api(`/events/${e.slug}/check-in/?registration=${registration}`, { method: 'DELETE' }))
  const all = useMemo(() => registrations.data ?? [], [registrations.data])
  const rows = useMemo(() => all.filter(WHO[who]), [all, who])
  if (!registrations.data) return <Spinner />
  const count = (id: Who) => all.filter(WHO[id]).length

  const columns: Col<Registration>[] = [
    {
      title: 'Name',
      value: (r) => `${r.person.name} ${r.email} ${r.person.institution}`,
      cell: (r) => (
        <>
          <p className="font-semibold">{r.person.name}</p>
          <p className="text-xs text-stone-500">{r.person.institution || r.email}</p>
        </>
      ),
      priority: 1,
    },
    { title: 'Email', value: (r) => r.email, priority: 4 },
    { title: 'Registered', value: (r) => r.created_at, cell: (r) => <span className="whitespace-nowrap font-mono text-xs text-stone-600">{formatDateTime(r.created_at)}</span>, priority: 5 },
    {
      title: 'Status',
      value: (r) => (r.checked_in_at ? 'checked in' : r.status),
      cell: (r) => (r.checked_in_at ? <Badge tone="blue">Checked in</Badge> : <StatusBadge status={r.status} />),
      priority: 3,
    },
    {
      title: 'Check-in',
      value: (r) => r.checked_in_at ?? '',
      sortable: false,
      align: 'right',
      priority: 2,
      cell: (r) =>
        r.checked_in_at ? (
          <span className="inline-flex items-center gap-2">
            <span className="font-mono text-xs text-stone-500">{formatDateTime(r.checked_in_at)}</span>
            <Button variant="ghost" className="px-2 py-1" onClick={() => undo.mutate(r.id)}>Undo</Button>
          </span>
        ) : r.status === 'registered' ? (
          <Button variant="secondary" className="px-3 py-1" onClick={() => checkIn.mutate(r.id)}>Check in</Button>
        ) : null,
    },
  ]

  const exportCsv = () =>
    downloadCsv(
      `${e.slug}-registrations.csv`,
      ['Name', 'Email', 'Institution', 'Status', 'Registered', 'Checked in'],
      rows.map((r) => [r.person.name, r.email, r.person.institution, r.status, r.created_at, r.checked_in_at]),
    )

  return (
    <div className="overflow-hidden rounded-xl border border-stone-200 bg-white">
      <div className="px-5 pt-3 empty:hidden"><ErrorNote error={checkIn.error ?? undo.error} /></div>
      <DataTable
        rows={rows}
        columns={columns}
        order={[2, 'desc']}
        searchPlaceholder="Name, email or institution"
        empty="Nobody has registered yet."
        toolbar={
          <>
            <FilterChips
              current={who}
              onChange={setWho}
              options={[
                { id: 'all', label: 'All', count: all.length },
                { id: 'registered', label: 'Not yet in', count: count('registered') },
                { id: 'checked_in', label: 'Checked in', count: count('checked_in') },
                { id: 'waitlisted', label: 'Waiting list', count: count('waitlisted') },
                { id: 'cancelled', label: 'Cancelled', count: count('cancelled') },
              ]}
            />
            <Button variant="secondary" onClick={exportCsv} disabled={!rows.length}>Export CSV</Button>
          </>
        }
      />
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
  const [note, setNote] = useState({ title: '', body: '', notify: true })
  const [link, setLink] = useState({ title: '', url: '', description: '' })
  const post = useAct(() => api<Announcement & { emailed_to?: number }>(`/events/${id}/announcements/`, { method: 'POST', body: note }))
  const add = useAct(() => api(`/events/${id}/resources/`, { method: 'POST', body: link }))
  const remove = useAct((path: string) => api(`/events/${id}/${path}/`, { method: 'DELETE' }))
  const confirm = useConfirm()
  const toast = useToast()
  const removeAnnouncement = async (a: Announcement) => {
    if (await confirm({ tone: 'danger', title: 'Remove this announcement?', message: <>“{a.title}” disappears from the event page. Emails already sent stay sent.</>, confirmLabel: 'Remove' })) {
      remove.mutate(`announcements/${a.id}`, { onSuccess: () => toast({ title: 'Announcement removed' }) })
    }
  }
  const submit = (action: { mutate: (v: undefined, o: { onSuccess: () => void }) => void }, reset: () => void) => (ev: FormEvent) => {
    ev.preventDefault()
    action.mutate(undefined, { onSuccess: reset })
  }
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Panel title="Announcements">
        <p className="mb-4 text-sm text-stone-600">Shown on the event page to everyone registered.</p>
        <form className="space-y-3" onSubmit={submit(post, () => {
          setNote({ title: '', body: '', notify: note.notify })
          toast({ title: 'Announcement posted', message: note.notify ? 'It is on the event page and was emailed to everyone registered.' : 'It is on the event page.' })
        })}>
          <Field label="Title"><Input required value={note.title} onChange={(ev) => setNote({ ...note, title: ev.target.value })} /></Field>
          <Field label="Message" group>
            <RichTextEditor value={note.body} onChange={(body) => setNote((n) => ({ ...n, body }))} placeholder="What do attendees need to know?" minHeight="8rem" />
          </Field>
          <ErrorNote error={post.error} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={note.notify} onChange={(ev) => setNote({ ...note, notify: ev.target.checked })} />
            Also email everyone registered
          </label>
          <Button type="submit" disabled={post.isPending || !note.body}>Post announcement</Button>
        </form>
        <ul className="mt-5 divide-y divide-stone-100 border-t border-stone-200">
          {announcements.data?.map((a) => (
            <li key={a.id} className="flex items-start justify-between gap-2 py-3">
              <div>
                <p className="font-semibold">{a.title}</p>
                <RichText html={a.body} className="text-sm" />
                <p className="mt-1 text-xs text-stone-500">{formatDateTime(a.created_at)}</p>
              </div>
              <Button variant="ghost" onClick={() => void removeAnnouncement(a)}>Remove</Button>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel title="Resources">
        <p className="mb-4 text-sm text-stone-600">Slides, recordings and repositories for attendees.</p>
        <form className="space-y-3" onSubmit={submit(add, () => {
          setLink({ title: '', url: '', description: '' })
          toast({ title: 'Resource added', message: 'Attendees can find it on the event page.' })
        })}>
          <Field label="Title"><Input required value={link.title} onChange={(ev) => setLink({ ...link, title: ev.target.value })} /></Field>
          <Field label="Link"><Input type="url" required placeholder="https://" value={link.url} onChange={(ev) => setLink({ ...link, url: ev.target.value })} /></Field>
          <ErrorNote error={add.error} />
          <Button type="submit" disabled={add.isPending}>Add resource</Button>
        </form>
        <ul className="mt-5 divide-y divide-stone-100 border-t border-stone-200">
          {resources.data?.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-2 py-3">
              <a className="font-semibold text-brand-700 hover:underline" href={r.url} target="_blank" rel="noreferrer">{r.title}</a>
              <Button variant="ghost" onClick={() => remove.mutate(`resources/${r.id}`, { onSuccess: () => toast({ title: 'Resource removed' }) })}>Remove</Button>
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
