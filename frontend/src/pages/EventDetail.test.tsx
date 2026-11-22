import { screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CommunityEvent } from '../api'
import { auth, signIn } from '../test/auth'
import { callsTo, mockFetch, reply, sentBody, sequence } from '../test/fetch'
import { event, me, registration } from '../test/fixtures'
import { currentPath, renderApp } from '../test/render'
import EventDetail from './EventDetail'

const EVENT = 'GET /events/react-workshop/'
const REGISTER = '/events/react-workshop/register/'

// 22 Nov 2026: the fixture event (30 Nov) is a week away.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-22T06:00:00Z'))
})

const past = { starts_at: '2026-11-01T06:00:00Z', ends_at: '2026-11-01T09:00:00Z' }

// The event page with no announcements or resources, plus any other routes.
const show = (e: unknown, routes: Record<string, unknown> = {}) => {
  const fetch = mockFetch({
    [EVENT]: e,
    'GET /events/react-workshop/announcements/': [],
    'GET /events/react-workshop/resources/': [],
    ...routes,
  })
  return { fetch, ...renderApp(<EventDetail />, { route: '/events/react-workshop', path: '/events/:slug' }) }
}

const registered = (overrides: Partial<CommunityEvent> = {}) => event({ my_registration: registration(), ...overrides })

const openTicket = async (user: ReturnType<typeof show>['user']) => {
  await user.click(await screen.findByRole('button', { name: /Tap to open it full screen/ }))
  return screen.getByRole('dialog', { name: 'Your ticket' })
}

describe('Event page', () => {
  it.each([
    ['the request fails', reply(500, { detail: 'Server error.' }), 'Server error.'],
    ['the API returns nothing', null, 'Event not found.'],
  ])('shows an error when %s', async (_, answer, message) => {
    show(answer)
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
  })

  it('tells visitors about the event and asks them to sign in to register', async () => {
    const { user } = show(
      event({
        description: '<p>Hands-on React.</p>',
        eligibility: 'Students only',
        registration_deadline: '2026-11-29T06:00:00Z',
        registered_count: 12,
        delivery_mode: 'hybrid',
        meeting_provider: { id: 'teams', name: 'Microsoft Teams' },
      }),
      {
        'GET /events/react-workshop/announcements/': [{ id: 1, title: 'Room change', body: '<p>Now in room 2.</p>', created_at: '2026-11-20T06:00:00Z' }],
        'GET /events/react-workshop/resources/': [
          { id: 1, title: 'Slides', url: 'https://slides.test', description: 'From the talk' },
          { id: 2, title: 'Repo', url: 'https://repo.test', description: '' },
        ],
      },
    )
    expect(await screen.findByRole('heading', { level: 1, name: 'React workshop' })).toBeInTheDocument()
    expect(screen.getAllByText('12 going')).toHaveLength(2)
    expect(screen.getByText(/Registration closes 29 Nov 2026/)).toBeInTheDocument()
    expect(screen.getByText('On Microsoft Teams. The link appears here once you register.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add to calendar' })).toBeInTheDocument()
    expect(await screen.findByText('Now in room 2.')).toBeInTheDocument()
    expect(screen.getByText('Hands-on React.')).toBeInTheDocument()
    expect(screen.getByText('Students only')).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: 'Slides' })).toHaveAttribute('href', 'https://slides.test')
    expect(screen.getByRole('link', { name: 'Repo' })).toBeInTheDocument()
    expect(screen.queryByText('You organise this event')).not.toBeInTheDocument()

    // The phone's sticky bar repeats the button, hidden until the card scrolls away.
    expect(screen.getAllByRole('button', { name: 'Sign in to register', hidden: true })).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: 'Sign in to register' }))
    expect(auth.signinRedirect).toHaveBeenCalled()
  })

  it('registers a member, even one who cancelled before, and hands them a ticket', async () => {
    signIn({ name: 'From token' })
    let finish: (value: unknown) => void = () => undefined
    const { user, fetch } = show(
      sequence(event({ spots_left: 5, capacity: 10, my_registration: registration({ status: 'cancelled' }) }), registered()),
      { [`POST ${REGISTER}`]: () => new Promise((resolve) => (finish = resolve)) },
    )
    expect(await screen.findAllByText('5 of 10 places left')).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: 'Register, it is free' }))
    expect(screen.getByRole('button', { name: 'Registering…' })).toBeDisabled()
    finish(reply(201, {}))
    expect(await screen.findByText('You are in!')).toBeInTheDocument()
    expect(callsTo(fetch, `POST ${REGISTER}`)).toHaveLength(1)
    // With no profile loaded, the ticket carries the name from the sign-in.
    expect(within(await openTicket(user)).getByText('From token')).toBeInTheDocument()
  })

  it('puts a member on the waiting list when the event is full, after a failed try', async () => {
    signIn()
    const { user } = show(
      sequence(event({ spots_left: 0, capacity: 10, registered_count: 10 }), event({ my_registration: registration({ status: 'waitlisted' }) })),
      { 'GET /me/': me(), [`POST ${REGISTER}`]: sequence(reply(400, { detail: 'Registration has closed.' }), reply(201, {})) },
    )
    expect(await screen.findAllByText('Full, 10 going')).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: 'Join waiting list' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Registration has closed.')
    await user.click(screen.getByRole('button', { name: 'Join waiting list' }))
    expect(await screen.findByText('You are on the list')).toBeInTheDocument()
    expect(screen.getByText('On the waiting list')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Show ticket' })).not.toBeInTheDocument()
  })

  it('shows a member their ticket and meeting link, full screen and from the sticky bar', async () => {
    signIn({ name: 'From token' })
    const { user } = show(
      registered({ delivery_mode: 'online', online_url: 'https://zoom.us/j/1', meeting_provider: { id: 'zoom', name: 'Zoom' } }),
      { 'GET /me/': me({ full_name: 'Wanjiru Kamau' }) },
    )
    expect(await screen.findByText("You're going")).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Join on Zoom' })).toHaveAttribute('href', 'https://zoom.us/j/1')
    expect(screen.queryByRole('link', { name: 'Download ticket (PDF)' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /register/i })).not.toBeInTheDocument()

    expect(within(await openTicket(user)).getByText('Wanjiru Kamau')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Close ticket' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Show ticket', hidden: true }))
    expect(screen.getByRole('dialog', { name: 'Your ticket' })).toBeInTheDocument()
  })

  it('cancels a registration only once the member confirms, and shows why it failed', async () => {
    signIn({ name: '' })
    const { user, fetch } = show(sequence(registered({ delivery_mode: 'hybrid', online_url: 'https://meet.example/1' }), event()), {
      'GET /me/': me({ full_name: '' }),
      [`DELETE ${REGISTER}`]: sequence(reply(400, { detail: 'Too late to cancel.' }), reply(204)),
    })
    expect(await screen.findByRole('link', { name: 'Join the meeting' })).toHaveAttribute('href', 'https://meet.example/1')
    expect(screen.getByRole('link', { name: 'Download ticket (PDF)' })).toHaveAttribute('href', 'http://api.test/api/tickets/TICKET-1/ticket.pdf')
    // Nobody's name to print, but the ticket still opens.
    await openTicket(user)
    await user.click(screen.getByRole('button', { name: 'Close ticket' }))
    const cancel = () => user.click(screen.getByRole('button', { name: "Can't make it? Cancel registration" }))

    await cancel()
    await user.click(screen.getByRole('button', { name: 'Keep my place' }))
    expect(callsTo(fetch, `DELETE ${REGISTER}`)).toHaveLength(0)

    await cancel()
    await user.click(screen.getByRole('button', { name: 'Cancel my place' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Too late to cancel.')

    await cancel()
    await user.click(screen.getByRole('button', { name: 'Cancel my place' }))
    expect(await screen.findByText('Registration cancelled')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Register, it is free' })).toBeInTheDocument()
  })

  it.each<[string, Partial<CommunityEvent>, string]>([
    ['the event has ended', { ...past, registration_open: false, status: 'completed' }, 'This event has ended.'],
    ['the member registered for an event that is over', { ...past, status: 'completed', my_registration: registration() }, 'You registered for this event.'],
    ['the event was cancelled', { status: 'cancelled', registration_open: false }, 'This event has been cancelled.'],
  ])('says when %s, and offers no calendar or way to register', async (_, overrides, text) => {
    show(event(overrides))
    expect(await screen.findByText(text)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add to calendar' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Sign in to register|Show ticket|Cancel registration/, hidden: true })).not.toBeInTheDocument()
  })

  it('shows organisers their draft, closed and off calendars, with links to the console', async () => {
    show(event({ status: 'draft', can_manage: true, registration_open: false, delivery_mode: 'online' }))
    expect(await screen.findByText('Registration is closed.')).toBeInTheDocument()
    expect(screen.getByText('The link appears here once you register.', { exact: true })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add to calendar' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Manage' })).toHaveAttribute('href', '/manage/events/react-workshop')
    expect(screen.getByRole('link', { name: 'Edit details' })).toHaveAttribute('href', '/manage/events/react-workshop/edit')
  })

  it('asks attendees for feedback and opens their certificate', async () => {
    signIn()
    const { user, fetch } = show(
      event({ ...past, status: 'completed', my_registration: registration({ checked_in_at: '2026-11-01T06:30:00Z', certificate_available: true }) }),
      {
        'GET /me/': me(),
        'POST /events/react-workshop/feedback/': reply(201, {}),
        'GET /events/react-workshop/certificate/': { certificate_code: 'CERT-9' },
      },
    )
    expect(await screen.findByText('You attended')).toBeInTheDocument()
    const send = screen.getByRole('button', { name: 'Send feedback' })
    expect(send).toBeDisabled()
    await user.click(screen.getByRole('radio', { name: '4 out of 5' }))
    expect(screen.getByRole('radio', { name: '4 out of 5' })).toHaveAttribute('aria-checked', 'true')
    await user.type(screen.getByRole('textbox', { name: 'Anything to add? (optional)' }), 'Great')
    await user.click(send)
    expect(await screen.findByText('Thank you. Your feedback has been sent to the organisers.')).toBeInTheDocument()
    expect(sentBody(fetch, 'POST /events/react-workshop/feedback/')).toEqual({ rating: 4, comment: 'Great' })

    await user.click(screen.getByRole('button', { name: 'View certificate' }))
    expect(await screen.findByText('/certificates/CERT-9', { selector: 'output' })).toBeInTheDocument()
    expect(currentPath()).toBe('/certificates/CERT-9')
  })

  it('lets attendees replace their feedback, and shows errors', async () => {
    signIn()
    const { user } = show(
      registered({ my_registration: registration({ checked_in_at: '2026-11-30T06:30:00Z', has_feedback: true, certificate_available: true }) }),
      {
        'GET /me/': me(),
        'POST /events/react-workshop/feedback/': reply(400, { detail: 'Feedback is closed.' }),
        'GET /events/react-workshop/certificate/': reply(404, { detail: 'No certificate yet.' }),
      },
    )
    expect(await screen.findByText('You have already sent feedback. Sending again replaces it.')).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: '2 out of 5' }))
    await user.click(screen.getByRole('button', { name: 'Send feedback' }))
    expect(await screen.findByText('Feedback is closed.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'View certificate' }))
    expect(await screen.findByText('No certificate yet.')).toBeInTheDocument()
  })
})
