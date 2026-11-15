import { useQuery } from '@tanstack/react-query'
import { QRCodeSVG } from 'qrcode.react'
import { useState } from 'react'
import { useAuth } from 'react-oidc-context'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { api } from '../api'
import type { Announcement, Certificate, CommunityEvent, Resource } from '../api'
import {
  Badge, Button, Card, ErrorNote, Field, LinkButton, Notice, Prose, Section, Spinner, StatusBadge,
  Textarea, formatDateTime, formatRange, label,
} from '../components/ui'
import { useAct, useSignIn } from '../hooks'

export default function EventDetail() {
  const { id } = useParams()
  const auth = useAuth()
  const signIn = useSignIn()
  const navigate = useNavigate()
  const event = useQuery({ queryKey: ['event', id], queryFn: () => api<CommunityEvent>(`/events/${id}/`) })
  const announcements = useQuery({
    queryKey: ['event', id, 'announcements'],
    queryFn: () => api<Announcement[]>(`/events/${id}/announcements/`),
  })
  const resources = useQuery({
    queryKey: ['event', id, 'resources'],
    queryFn: () => api<Resource[]>(`/events/${id}/resources/`),
  })
  const register = useAct(() => api(`/events/${id}/register/`, { method: 'POST' }))
  const cancel = useAct(() => api(`/events/${id}/register/`, { method: 'DELETE' }))
  const certificate = useAct(async () => {
    const data = await api<Certificate>(`/events/${id}/certificate/`)
    navigate(`/certificates/${data.certificate_code}`)
  })

  if (event.isLoading) return <Spinner />
  if (!event.data) return <ErrorNote error={event.error ?? 'Event not found.'} />
  const e = event.data
  const mine = e.my_registration && e.my_registration.status !== 'cancelled' ? e.my_registration : null

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <div>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Badge tone="blue">{label(e.event_type)}</Badge>
            <Badge>{label(e.delivery_mode)}</Badge>
            {e.status !== 'published' && <StatusBadge status={e.status} />}
          </div>
          <h1 className="text-3xl font-bold tracking-tight">{e.title}</h1>
          <p className="mt-1 text-stone-600">Hosted by {e.organization.name}</p>
          {e.summary && <p className="mt-3 text-lg text-stone-700">{e.summary}</p>}
        </div>
        {e.status === 'cancelled' && <Notice tone="amber">This event has been cancelled.</Notice>}
        {e.description && <Section title="About this event"><Prose>{e.description}</Prose></Section>}
        {e.eligibility && <Section title="Who can attend"><Prose>{e.eligibility}</Prose></Section>}
        {!!announcements.data?.length && (
          <Section title="Announcements">
            <ul className="space-y-4">
              {announcements.data.map((a) => (
                <li key={a.id}>
                  <p className="font-semibold">{a.title}</p>
                  <p className="text-xs text-stone-500">{formatDateTime(a.created_at)}</p>
                  <Prose>{a.body}</Prose>
                </li>
              ))}
            </ul>
          </Section>
        )}
        {!!resources.data?.length && (
          <Section title="Resources">
            <ul className="space-y-3">
              {resources.data.map((r) => (
                <li key={r.id}>
                  <a className="font-semibold text-brand-700 hover:underline" href={r.url} target="_blank" rel="noreferrer">
                    {r.title}
                  </a>
                  {r.description && <p className="text-sm text-stone-600">{r.description}</p>}
                </li>
              ))}
            </ul>
          </Section>
        )}
        {mine?.checked_in_at && <FeedbackForm eventId={e.id} done={mine.has_feedback} />}
      </div>

      <aside className="space-y-4">
        <Card className="space-y-3">
          <Detail label="When">{formatRange(e.starts_at, e.ends_at)}</Detail>
          {e.venue && <Detail label="Where">{e.venue}</Detail>}
          {e.online_url && (
            <Detail label="Join online">
              <a className="break-all text-brand-700 hover:underline" href={e.online_url} target="_blank" rel="noreferrer">
                {e.online_url}
              </a>
            </Detail>
          )}
          {e.registration_deadline && <Detail label="Register by">{formatDateTime(e.registration_deadline)}</Detail>}
          <Detail label="Places">
            {e.capacity === null
              ? `${e.registered_count} registered, no limit`
              : `${e.registered_count} of ${e.capacity} taken`}
          </Detail>

          <div className="space-y-3 border-t border-stone-200 pt-4">
            {mine ? (
              <>
                {mine.checked_in_at ? (
                  <Notice>You attended this event.</Notice>
                ) : mine.status === 'waitlisted' ? (
                  <Notice tone="amber">You are on the waiting list. You get a place if someone cancels.</Notice>
                ) : (
                  <Notice>You are registered.</Notice>
                )}
                {mine.status === 'registered' && !mine.checked_in_at && e.status === 'published' && (
                  <div className="text-center">
                    <div className="inline-block rounded-xl border border-stone-200 bg-white p-3">
                      <QRCodeSVG value={mine.ticket_code} size={176} />
                    </div>
                    <p className="mt-2 text-sm text-stone-600">Your ticket. Show this code at the door.</p>
                  </div>
                )}
                {mine.certificate_available && (
                  <Button className="w-full" onClick={() => certificate.mutate()} disabled={certificate.isPending}>
                    View certificate
                  </Button>
                )}
                {!mine.checked_in_at && e.status === 'published' && (
                  <Button
                    variant="danger"
                    className="w-full"
                    disabled={cancel.isPending}
                    onClick={() => window.confirm('Cancel your registration?') && cancel.mutate()}
                  >
                    Cancel registration
                  </Button>
                )}
              </>
            ) : e.registration_open ? (
              auth.isAuthenticated ? (
                <Button className="w-full" disabled={register.isPending} onClick={() => register.mutate()}>
                  {e.spots_left === 0 ? 'Join waiting list' : 'Register'}
                </Button>
              ) : (
                <Button className="w-full" onClick={signIn}>Sign in to register</Button>
              )
            ) : (
              <p className="text-sm text-stone-600">Registration is closed.</p>
            )}
            <ErrorNote error={register.error ?? cancel.error ?? certificate.error} />
          </div>
        </Card>
        {e.can_manage && (
          <Card className="space-y-3">
            <p className="text-sm font-semibold">You organise this event</p>
            <div className="flex flex-wrap gap-2">
              <LinkButton to={`/events/${e.id}/manage`}>Manage</LinkButton>
              <LinkButton to={`/events/${e.id}/edit`} variant="secondary">Edit details</LinkButton>
            </div>
          </Card>
        )}
        <Link to="/events" className="block text-sm font-semibold text-brand-700 hover:underline">
          Back to all events
        </Link>
      </aside>
    </div>
  )
}

function Detail({ label: text, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-stone-500">{text}</div>
      <div className="text-sm">{children}</div>
    </div>
  )
}

function FeedbackForm({ eventId, done }: { eventId: number; done: boolean }) {
  const [rating, setRating] = useState(0)
  const [comment, setComment] = useState('')
  const send = useAct(() =>
    api(`/events/${eventId}/feedback/`, { method: 'POST', body: { rating, comment } }),
  )
  return (
    <Section title="How was it?">
      {done && !send.isSuccess && (
        <p className="mb-3 text-sm text-stone-600">You have already sent feedback. Sending again replaces it.</p>
      )}
      {send.isSuccess ? (
        <Notice>Thank you. Your feedback has been sent to the organisers.</Notice>
      ) : (
        <div className="space-y-4">
          <div role="radiogroup" aria-label="Rating" className="flex gap-2">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={rating === n}
                aria-label={`${n} out of 5`}
                onClick={() => setRating(n)}
                className={`h-10 w-10 rounded-lg border text-sm font-bold ${
                  n <= rating ? 'border-brand-600 bg-brand-600 text-white' : 'border-stone-300 bg-white'
                }`}
              >
                {n}
              </button>
            ))}
          </div>
          <Field label="Anything to add? (optional)">
            <Textarea value={comment} onChange={(e) => setComment(e.target.value)} />
          </Field>
          <ErrorNote error={send.error} />
          <Button disabled={!rating || send.isPending} onClick={() => send.mutate()}>Send feedback</Button>
        </div>
      )}
    </Section>
  )
}
