import { useQuery } from '@tanstack/react-query'
import { QRCodeSVG } from 'qrcode.react'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { useAuth } from 'react-oidc-context'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { api } from '../api'
import type { Announcement, Certificate, CommunityEvent, Resource } from '../api'
import {
  Badge, Button, Card, ErrorNote, Field, LinkButton, Notice, Prose, Section, Spinner, StatusBadge,
  Textarea, formatDateTime, formatRange, label,
} from '../components/ui'
import { AddToCalendar } from '../components/AddToCalendar'
import { Cover, eventPlace } from '../components/cards'
import { Icon } from '../components/icons'
import type { IconName } from '../components/icons'
import { ReadMore, StickyAction, TicketSheet, useScrolledPast } from '../components/mobile'
import { RichText } from '../components/RichText'
import { useConfirm, useToast } from '../components/feedback'
import { useAct, useMe, useSignIn } from '../hooks'

export default function EventDetail() {
  const { slug } = useParams()
  const auth = useAuth()
  const signIn = useSignIn()
  const navigate = useNavigate()
  const event = useQuery({ queryKey: ['event', slug], queryFn: () => api<CommunityEvent>(`/events/${slug}/`) })
  const announcements = useQuery({
    queryKey: ['event', slug, 'announcements'],
    queryFn: () => api<Announcement[]>(`/events/${slug}/announcements/`),
  })
  const resources = useQuery({
    queryKey: ['event', slug, 'resources'],
    queryFn: () => api<Resource[]>(`/events/${slug}/resources/`),
  })
  const register = useAct(() => api(`/events/${slug}/register/`, { method: 'POST' }))
  const cancel = useAct(() => api(`/events/${slug}/register/`, { method: 'DELETE' }))
  const certificate = useAct(async () => {
    const data = await api<Certificate>(`/events/${slug}/certificate/`)
    navigate(`/certificates/${data.certificate_code}`)
  })

  const [actionRef, scrolledPast] = useScrolledPast()
  const [ticketOpen, setTicketOpen] = useState(false)
  const confirm = useConfirm()
  const toast = useToast()
  const me = useMe()

  if (event.isLoading) return <Spinner />
  if (!event.data) return <ErrorNote error={event.error ?? 'Event not found.'} />
  const e = event.data
  const mine = e.my_registration && e.my_registration.status !== 'cancelled' ? e.my_registration : null
  const live = e.status === 'published'
  const upcoming = new Date(e.ends_at).getTime() > Date.now()
  const hasTicket = !!mine && mine.status === 'registered' && !mine.checked_in_at && live
  const places =
    e.capacity === null
      ? `${e.registered_count} going`
      : e.spots_left === 0
        ? `Full, ${e.registered_count} going`
        : `${e.spots_left} of ${e.capacity} places left`
  const registerButton = auth.isAuthenticated ? (
    <Button className="w-full py-3" disabled={register.isPending} onClick={() => register.mutate()}>
      {register.isPending ? 'Registering…' : e.spots_left === 0 ? 'Join waiting list' : 'Register, it is free'}
    </Button>
  ) : (
    <Button className="w-full py-3" onClick={signIn}>Sign in to register</Button>
  )

  return (
    <div className="space-y-6">
      <Cover image={e.cover_image} kind={e.event_type} title={e.title} className="-mx-4 -mt-8 rounded-none sm:mx-0 sm:mt-0 sm:aspect-[21/8] sm:rounded-2xl" />
      <div>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Badge tone="blue">{label(e.event_type)}</Badge>
          <Badge>{label(e.delivery_mode)}</Badge>
          {e.status !== 'published' && <StatusBadge status={e.status} />}
        </div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{e.title}</h1>
        <p className="mt-1 text-stone-600">Hosted by <Link className="font-semibold hover:text-brand-700" to={`/organizations/${e.organization.alias}`}>{e.organization.name}</Link></p>
        <ul className="mt-4 space-y-2 text-sm">
          <Fact icon="clock">{formatRange(e.starts_at, e.ends_at)}</Fact>
          <Fact icon="pin">{eventPlace(e)}</Fact>
          <Fact icon="users">{places}</Fact>
        </ul>
        {e.summary && <p className="mt-4 text-stone-700 sm:text-lg">{e.summary}</p>}
      </div>
      {e.status === 'cancelled' && <Notice tone="amber">This event has been cancelled.</Notice>}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* First on a phone: what the visitor came to do. */}
        <aside className="space-y-4 lg:col-start-3 lg:row-start-1">
          <div ref={actionRef}>
            <Card className="space-y-4">
              {register.isSuccess && mine && (
                <div className="-mx-5 -mt-5 rounded-t-xl bg-brand-600 px-5 py-4 text-white">
                  <p className="flex items-center gap-2 text-lg font-bold"><Icon name="check" className="h-6 w-6" />
                    {mine.status === 'waitlisted' ? 'You are on the list' : 'You are in!'}
                  </p>
                  <p className="text-sm text-brand-50">
                    {mine.status === 'waitlisted'
                      ? 'We will email you as soon as a place opens up.'
                      : 'We have emailed your ticket. See you there.'}
                  </p>
                </div>
              )}
              {mine ? (
                <>
                  {mine.checked_in_at ? (
                    <Status icon="check" tone="green" title="You attended" text="Thanks for coming." />
                  ) : mine.status === 'waitlisted' ? (
                    <Status icon="clock" tone="amber" title="On the waiting list" text="You get a place automatically if someone cancels." />
                  ) : (
                    !register.isSuccess && <Status icon="check" tone="green" title="You're going" text={live && upcoming ? 'Your ticket is ready below.' : 'You registered for this event.'} />
                  )}
                  {hasTicket && (
                    <button
                      type="button"
                      onClick={() => setTicketOpen(true)}
                      className="flex w-full items-center gap-4 rounded-xl border border-stone-200 bg-stone-50 p-3 text-left transition hover:border-brand-500"
                    >
                      <span className="rounded-lg bg-white p-1.5"><QRCodeSVG value={mine.ticket_code} size={72} /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold">Show ticket</span>
                        <span className="block text-sm text-stone-600">Tap to open it full screen for the door.</span>
                        <span className="block font-mono text-xs text-stone-500">Order #{mine.order_number}</span>
                      </span>
                      <Icon name="chevronRight" className="h-5 w-5 text-stone-400" />
                    </button>
                  )}
                  {hasTicket && e.delivery_mode !== 'online' && (
                    <a
                      href={`${import.meta.env.VITE_API_URL}/api/tickets/${mine.ticket_code}/ticket.pdf`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 font-mono text-xs font-semibold uppercase tracking-wider text-brand-700 hover:underline"
                    >
                      <Icon name="ticket" className="h-4 w-4" />Download ticket (PDF)
                    </a>
                  )}
                  {mine.certificate_available && (
                    <Button className="w-full" onClick={() => certificate.mutate()} disabled={certificate.isPending}>
                      View certificate
                    </Button>
                  )}
                </>
              ) : e.registration_open ? (
                <div className="space-y-2">
                  {registerButton}
                  {e.registration_deadline && (
                    <p className="text-center text-xs text-stone-500">Registration closes {formatDateTime(e.registration_deadline)}</p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-stone-600">{upcoming ? 'Registration is closed.' : 'This event has ended.'}</p>
              )}

              {e.delivery_mode !== 'in_person' && (
                <div className="border-t border-stone-200 pt-4">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">Online</p>
                  {e.online_url ? (
                    <a
                      className="btn-prompt inline-flex w-full items-center justify-center gap-2 rounded-lg bg-ink px-3 py-2.5 font-mono text-xs font-semibold uppercase tracking-wider text-white hover:bg-stone-800"
                      href={e.online_url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Join {e.meeting_provider ? `on ${e.meeting_provider.name}` : 'the meeting'}
                    </a>
                  ) : (
                    <p className="text-sm text-stone-600">
                      {e.meeting_provider ? `On ${e.meeting_provider.name}. ` : ''}The link appears here once you register.
                    </p>
                  )}
                </div>
              )}

              {e.status !== 'draft' && e.status !== 'cancelled' && upcoming && <AddToCalendar event={e} />}
              <ErrorNote error={register.error ?? cancel.error ?? certificate.error} />
              {mine && !mine.checked_in_at && live && (
                <button
                  type="button"
                  disabled={cancel.isPending}
                  onClick={async () => {
                    const ok = await confirm({
                      tone: 'danger', title: "Can't make it?", confirmLabel: 'Cancel my place', cancelLabel: 'Keep my place',
                      message: 'Your place goes to the next person waiting. You can register again later if there is room.',
                    })
                    if (ok) cancel.mutate(undefined, { onSuccess: () => toast({ tone: 'info', title: 'Registration cancelled', message: 'Thanks for letting us know.' }) })
                  }}
                  className="w-full pt-1 text-center text-sm font-semibold text-stone-500 hover:text-red-700"
                >
                  Can't make it? Cancel registration
                </button>
              )}
            </Card>
          </div>
          {e.can_manage && (
            <Card className="space-y-3">
              <p className="text-sm font-semibold">You organise this event</p>
              <div className="flex flex-wrap gap-2">
                <LinkButton to={`/manage/events/${e.slug}`}>Manage</LinkButton>
                <LinkButton to={`/manage/events/${e.slug}/edit`} variant="secondary">Edit details</LinkButton>
              </div>
            </Card>
          )}
        </aside>

        <div className="space-y-6 lg:col-span-2 lg:col-start-1 lg:row-start-1">
          {!!announcements.data?.length && (
            <Section title="Announcements">
              <ul className="space-y-4">
                {announcements.data.map((a) => (
                  <li key={a.id} className="border-l-2 border-brand-500 pl-4">
                    <p className="font-semibold">{a.title}</p>
                    <p className="text-xs text-stone-500">{formatDateTime(a.created_at)}</p>
                    <RichText html={a.body} />
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {mine?.checked_in_at && <FeedbackForm eventId={e.slug} done={mine.has_feedback} />}
          {e.description && (
            <Section title="About this event">
              <ReadMore><RichText html={e.description} /></ReadMore>
            </Section>
          )}
          {e.eligibility && <Section title="Who can attend"><Prose>{e.eligibility}</Prose></Section>}
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
          <Link to="/events" className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 hover:underline">
            <Icon name="arrowLeft" className="h-4 w-4" />All events
          </Link>
        </div>
      </div>

      {!mine && e.registration_open && (
        <StickyAction show={scrolledPast}>
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{e.title}</p>
              <p className="truncate text-xs text-stone-500">{places}</p>
            </div>
            <div className="w-44 shrink-0">{registerButton}</div>
          </div>
        </StickyAction>
      )}
      {hasTicket && (
        <StickyAction show={scrolledPast}>
          <Button className="w-full py-3" onClick={() => setTicketOpen(true)}>
            <Icon name="ticket" className="h-4 w-4" />Show ticket
          </Button>
        </StickyAction>
      )}
      {ticketOpen && mine && (
        <TicketSheet
          code={mine.ticket_code}
          title={e.title}
          when={formatRange(e.starts_at, e.ends_at)}
          name={me?.full_name || auth.user?.profile.name || ''}
          order={mine.order_number}
          onClose={() => setTicketOpen(false)}
        />
      )}
    </div>
  )
}

function Fact({ icon, children }: { icon: IconName; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700"><Icon name={icon} className="h-4 w-4" /></span>
      <span className="pt-1">{children}</span>
    </li>
  )
}

function Status({ icon, tone, title, text }: { icon: IconName; tone: 'green' | 'amber'; title: string; text: string }) {
  const style = tone === 'green' ? 'bg-brand-50 text-brand-700' : 'bg-amber-50 text-amber-700'
  return (
    <div className="flex items-start gap-3">
      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${style}`}><Icon name={icon} className="h-5 w-5" /></span>
      <div>
        <p className="text-lg font-bold leading-tight">{title}</p>
        <p className="text-sm text-stone-600">{text}</p>
      </div>
    </div>
  )
}

function FeedbackForm({ eventId, done }: { eventId: string; done: boolean }) {
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
