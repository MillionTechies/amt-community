import { useQuery } from '@tanstack/react-query'
import { Scanner } from '@yudiel/react-qr-scanner'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { api } from '../api'
import type { Announcement, CommunityEvent, EventStats, Feedback, Registration, Resource } from '../api'
import {
  Badge, Button, Empty, ErrorNote, Field, Input, LinkButton, Notice, PageHeader, Section, Spinner,
  Stat, StatusBadge, Tabs, Textarea, formatDateTime,
} from '../components/ui'
import { useAct } from '../hooks'

type Tab = 'overview' | 'people' | 'checkin' | 'content' | 'feedback'

export default function EventManage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('overview')
  const event = useQuery({ queryKey: ['event', id], queryFn: () => api<CommunityEvent>(`/events/${id}/`) })
  const move = useAct((status: string) =>
    api(`/events/${id}/transition/`, { method: 'POST', body: { status } }),
  )
  const remove = useAct(() => api(`/events/${id}/`, { method: 'DELETE' }))

  if (event.isLoading) return <Spinner />
  if (!event.data) return <ErrorNote error={event.error ?? 'Event not found.'} />
  const e = event.data
  if (!e.can_manage) return <Empty>You do not organise this event.</Empty>
  const confirmMove = (status: string, question: string) => () => window.confirm(question) && move.mutate(status)

  return (
    <>
      <PageHeader
        title={e.title}
        subtitle={<span className="flex items-center gap-2"><StatusBadge status={e.status} /> {e.organization.name}</span>}
        action={
          <div className="flex flex-wrap gap-2">
            <LinkButton to={`/events/${e.id}`} variant="secondary">View page</LinkButton>
            <LinkButton to={`/events/${e.id}/edit`} variant="secondary">Edit details</LinkButton>
            {e.status === 'draft' && (
              <>
                <Button disabled={move.isPending} onClick={() => move.mutate('published')}>Publish</Button>
                <Button
                  variant="danger"
                  onClick={() =>
                    window.confirm('Delete this draft?') &&
                    remove.mutate(undefined, { onSuccess: () => navigate('/events') })
                  }
                >
                  Delete
                </Button>
              </>
            )}
            {e.status === 'published' && (
              <>
                <Button onClick={confirmMove('completed', 'Mark this event as completed? Attendees can then get their certificates.')}>
                  Mark completed
                </Button>
                <Button variant="danger" onClick={confirmMove('cancelled', 'Cancel this event? This cannot be undone.')}>
                  Cancel event
                </Button>
              </>
            )}
          </div>
        }
      />
      <div className="mb-4"><ErrorNote error={move.error ?? remove.error} /></div>
      {e.status === 'draft' && (
        <div className="mb-4"><Notice tone="amber">This is a draft. Only organisers can see it until you publish.</Notice></div>
      )}
      <Tabs
        tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'people', label: 'Registrations' },
          { id: 'checkin', label: 'Check-in' },
          { id: 'content', label: 'Announcements and resources' },
          { id: 'feedback', label: 'Feedback' },
        ]}
        current={tab}
        onChange={setTab}
      />
      {tab === 'overview' && <Overview id={e.id} />}
      {tab === 'people' && <People id={e.id} />}
      {tab === 'checkin' && <CheckIn id={e.id} />}
      {tab === 'content' && <Content id={e.id} />}
      {tab === 'feedback' && <FeedbackList id={e.id} />}
    </>
  )
}

function Overview({ id }: { id: number }) {
  const stats = useQuery({ queryKey: ['event', id, 'stats'], queryFn: () => api<EventStats>(`/events/${id}/stats/`) })
  if (!stats.data) return <Spinner />
  const s = stats.data
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <Stat label={s.capacity ? `Registered, of ${s.capacity} places` : 'Registered'} value={s.registered} />
      <Stat label="On the waiting list" value={s.waitlisted} />
      <Stat label="Checked in" value={s.checked_in} />
      <Stat
        label="Of those registered, attended"
        value={s.attendance_rate === null ? 'None yet' : `${Math.round(s.attendance_rate * 100)}%`}
      />
      <Stat label="Cancelled" value={s.cancelled} />
      <Stat label="Feedback responses" value={s.feedback_count} />
      <Stat label="Average rating, out of 5" value={s.average_rating === null ? 'None yet' : s.average_rating.toFixed(1)} />
    </div>
  )
}

function useRegistrations(id: number) {
  return useQuery({
    queryKey: ['event', id, 'registrations'],
    queryFn: () => api<Registration[]>(`/events/${id}/registrations/`),
  })
}

function People({ id }: { id: number }) {
  const registrations = useRegistrations(id)
  const [search, setSearch] = useState('')
  const checkIn = useAct((registration: number) =>
    api(`/events/${id}/check-in/`, { method: 'POST', body: { registration } }),
  )
  const undo = useAct((registration: number) =>
    api(`/events/${id}/check-in/?registration=${registration}`, { method: 'DELETE' }),
  )
  if (!registrations.data) return <Spinner />
  const term = search.toLowerCase()
  const rows = registrations.data.filter(
    (r) => r.person.name.toLowerCase().includes(term) || r.email.toLowerCase().includes(term),
  )
  const download = () => {
    const quote = (v: string) => `"${v.replace(/"/g, '""')}"`
    const lines = [
      ['Name', 'Email', 'Institution', 'Status', 'Checked in'].join(','),
      ...registrations.data.map((r) =>
        [r.person.name, r.email, r.person.institution, r.status, r.checked_in_at ?? ''].map(quote).join(','),
      ),
    ]
    const link = document.createElement('a')
    link.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }))
    link.download = `event-${id}-registrations.csv`
    link.click()
    URL.revokeObjectURL(link.href)
  }
  if (!registrations.data.length) return <Empty>Nobody has registered yet.</Empty>
  return (
    <Section title={`${registrations.data.length} registrations`} action={<Button variant="secondary" onClick={download}>Download CSV</Button>}>
      <Input type="search" placeholder="Search by name or email" aria-label="Search registrations" value={search} onChange={(e) => setSearch(e.target.value)} />
      <div className="mt-3"><ErrorNote error={checkIn.error ?? undo.error} /></div>
      <ul className="mt-2 divide-y divide-stone-200">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
            <div>
              <p className="font-semibold">{r.person.name}</p>
              <p className="text-sm text-stone-600">{r.email}{r.person.institution && `, ${r.person.institution}`}</p>
            </div>
            <div className="flex items-center gap-2">
              {r.checked_in_at ? (
                <>
                  <Badge tone="blue">Checked in {formatDateTime(r.checked_in_at)}</Badge>
                  <Button variant="ghost" onClick={() => undo.mutate(r.id)}>Undo</Button>
                </>
              ) : (
                <>
                  <StatusBadge status={r.status} />
                  {r.status === 'registered' && (
                    <Button variant="secondary" onClick={() => checkIn.mutate(r.id)}>Check in</Button>
                  )}
                </>
              )}
            </div>
          </li>
        ))}
        {!rows.length && <li className="py-6 text-center text-stone-600">Nobody matches your search.</li>}
      </ul>
    </Section>
  )
}

interface ScanResult {
  ok: boolean
  message: string
}

function CheckIn({ id }: { id: number }) {
  const [scanning, setScanning] = useState(false)
  const [result, setResult] = useState<ScanResult | null>(null)
  const [last, setLast] = useState('')
  const checkIn = useAct((ticket_code: string) =>
    api<Registration & { already_checked_in: boolean }>(`/events/${id}/check-in/`, {
      method: 'POST',
      body: { ticket_code },
    }),
  )
  const handle = (code: string) => {
    // The camera reports the same code many times a second; act on it once.
    if (!code || code === last || checkIn.isPending) return
    setLast(code)
    checkIn.mutate(code, {
      onSuccess: (r) =>
        setResult(
          r.already_checked_in
            ? { ok: false, message: `${r.person.name} was already checked in.` }
            : { ok: true, message: `${r.person.name} is checked in.` },
        ),
      onError: (error) => setResult({ ok: false, message: error.message }),
    })
  }
  return (
    <Section title="Scan tickets">
      <p className="mb-4 text-sm text-stone-600">
        Point the camera at the QR code on an attendee's ticket. To check someone in by name, use
        the Registrations tab.
      </p>
      {result && (
        <div className="mb-4" aria-live="polite">
          {result.ok ? <Notice>{result.message}</Notice> : <Notice tone="amber">{result.message}</Notice>}
        </div>
      )}
      {scanning ? (
        <div className="mx-auto max-w-sm space-y-3">
          <div className="overflow-hidden rounded-xl">
            <Scanner
              onScan={(codes) => handle(codes[0]?.rawValue ?? '')}
              onError={() => {
                setScanning(false)
                setResult({ ok: false, message: 'Could not use the camera. Allow camera access in your browser and try again.' })
              }}
            />
          </div>
          <Button variant="secondary" className="w-full" onClick={() => setScanning(false)}>Stop scanning</Button>
        </div>
      ) : (
        <Button onClick={() => { setResult(null); setLast(''); setScanning(true) }}>Start scanning</Button>
      )}
    </Section>
  )
}

function Content({ id }: { id: number }) {
  const announcements = useQuery({
    queryKey: ['event', String(id), 'announcements'],
    queryFn: () => api<Announcement[]>(`/events/${id}/announcements/`),
  })
  const resources = useQuery({
    queryKey: ['event', String(id), 'resources'],
    queryFn: () => api<Resource[]>(`/events/${id}/resources/`),
  })
  const [note, setNote] = useState({ title: '', body: '' })
  const [link, setLink] = useState({ title: '', url: '', description: '' })
  const post = useAct(() => api(`/events/${id}/announcements/`, { method: 'POST', body: note }))
  const add = useAct(() => api(`/events/${id}/resources/`, { method: 'POST', body: link }))
  const remove = useAct((path: string) => api(`/events/${id}/${path}/`, { method: 'DELETE' }))
  const submit = (action: typeof post, reset: () => void) => (e: FormEvent) => {
    e.preventDefault()
    action.mutate(undefined, { onSuccess: reset })
  }
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Section title="Announcements">
        <form className="space-y-3" onSubmit={submit(post, () => setNote({ title: '', body: '' }))}>
          <Field label="Title"><Input required value={note.title} onChange={(e) => setNote({ ...note, title: e.target.value })} /></Field>
          <Field label="Message"><Textarea required rows={3} value={note.body} onChange={(e) => setNote({ ...note, body: e.target.value })} /></Field>
          <ErrorNote error={post.error} />
          <Button type="submit" disabled={post.isPending}>Post announcement</Button>
        </form>
        <ul className="mt-4 divide-y divide-stone-200">
          {announcements.data?.map((a) => (
            <li key={a.id} className="flex items-start justify-between gap-2 py-3">
              <div>
                <p className="font-semibold">{a.title}</p>
                <p className="text-sm text-stone-600">{a.body}</p>
              </div>
              <Button variant="ghost" onClick={() => remove.mutate(`announcements/${a.id}`)}>Remove</Button>
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Resources">
        <form className="space-y-3" onSubmit={submit(add, () => setLink({ title: '', url: '', description: '' }))}>
          <Field label="Title"><Input required value={link.title} onChange={(e) => setLink({ ...link, title: e.target.value })} /></Field>
          <Field label="Link" hint="Slides, a recording, a repository."><Input type="url" required placeholder="https://" value={link.url} onChange={(e) => setLink({ ...link, url: e.target.value })} /></Field>
          <ErrorNote error={add.error} />
          <Button type="submit" disabled={add.isPending}>Add resource</Button>
        </form>
        <ul className="mt-4 divide-y divide-stone-200">
          {resources.data?.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-2 py-3">
              <a className="font-semibold text-brand-700 hover:underline" href={r.url} target="_blank" rel="noreferrer">{r.title}</a>
              <Button variant="ghost" onClick={() => remove.mutate(`resources/${r.id}`)}>Remove</Button>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  )
}

function FeedbackList({ id }: { id: number }) {
  const feedback = useQuery({ queryKey: ['event', id, 'feedback'], queryFn: () => api<Feedback[]>(`/events/${id}/feedback/`) })
  if (!feedback.data) return <Spinner />
  if (!feedback.data.length)
    return <Empty>No feedback yet. Attendees can rate the event from its page once they are checked in. <Link className="font-semibold text-brand-700" to={`/events/${id}`}>View the page</Link></Empty>
  return (
    <Section title={`${feedback.data.length} responses`}>
      <ul className="divide-y divide-stone-200">
        {feedback.data.map((f) => (
          <li key={f.id} className="py-3">
            <Badge tone="green">{f.rating} out of 5</Badge>
            {f.comment && <p className="mt-1 text-stone-700">{f.comment}</p>}
          </li>
        ))}
      </ul>
    </Section>
  )
}
