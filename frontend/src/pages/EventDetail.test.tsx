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

describe('Event page', () => {
  it('shows an error when the event cannot be loaded', async () => {
    mockFetch({})
    renderApp(<EventDetail />, { route: '/events/react-workshop', path: '/events/:slug' })
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()
    expect(await screen.findByRole('alert')).toHaveTextContent('No mock for GET /events/react-workshop/')
  })

  it('says the event was not found when the API returns nothing', async () => {
    show(null)
    expect(await screen.findByRole('alert')).toHaveTextContent('Event not found.')
  })

  it('tells visitors everything about the event and asks them to sign in to register', async () => {
    const { user } = show(
      event({
        description: '<p>Hands-on React.</p>',
        eligibility: 'Students only',
        registration_deadline: '2026-11-29T06:00:00Z',
        registered_count: 12,
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
    expect(screen.getByText('Hosted by Acme Labs')).toBeInTheDocument()
    expect(screen.getByText('Nairobi Garage')).toBeInTheDocument()
    expect(screen.getAllByText('12 going')).toHaveLength(2)
    expect(screen.getByText('Build an app in a day.')).toBeInTheDocument()
    expect(screen.queryByText('Open')).not.toBeInTheDocument()
    expect(screen.getByText(/Registration closes 29 Nov 2026/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add to calendar' })).toBeInTheDocument()
    expect(await screen.findByText('Room change')).toBeInTheDocument()
    expect(screen.getByText('Now in room 2.')).toBeInTheDocument()
    expect(screen.getByText('Hands-on React.')).toBeInTheDocument()
    expect(screen.getByText('Students only')).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: 'Slides' })).toHaveAttribute('href', 'https://slides.test')
    expect(screen.getByText('From the talk')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Repo' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'All events' })).toHaveAttribute('href', '/events')
    expect(screen.queryByText('You organise this event')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'How was it?' })).not.toBeInTheDocument()

    // The phone's sticky bar repeats the button, hidden until the card scrolls away.
    expect(screen.getAllByRole('button', { name: 'Sign in to register', hidden: true })).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: 'Sign in to register' }))
    expect(auth.signinRedirect).toHaveBeenCalled()
  })

  it('registers a member and welcomes them in', async () => {
    signIn()
    let finish: (value: unknown) => void = () => undefined
    const { user, fetch } = show(sequence(event({ spots_left: 5, capacity: 10 }), registered()), {
      'GET /me/': me(),
      [`POST ${REGISTER}`]: () => new Promise((resolve) => (finish = resolve)),
    })
    expect(await screen.findAllByText('5 of 10 places left')).toHaveLength(2)
    expect(screen.queryByText(/Registration closes/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Register, it is free' }))
    expect(screen.getByRole('button', { name: 'Registering…' })).toBeDisabled()
    finish(reply(201, {}))
    expect(await screen.findByText('You are in!')).toBeInTheDocument()
    expect(screen.getByText('We have emailed your ticket. See you there.')).toBeInTheDocument()
    expect(screen.queryByText("You're going")).not.toBeInTheDocument()
    expect(callsTo(fetch, `POST ${REGISTER}`)).toHaveLength(1)
  })

  it('puts a member on the waiting list when the event is full', async () => {
    signIn()
    const { user } = show(
      sequence(event({ spots_left: 0, capacity: 10, registered_count: 10 }), event({ my_registration: registration({ status: 'waitlisted' }) })),
      { 'GET /me/': me(), [`POST ${REGISTER}`]: reply(201, {}) },
    )
    expect(await screen.findAllByText('Full, 10 going')).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: 'Join waiting list' }))
    expect(await screen.findByText('You are on the list')).toBeInTheDocument()
    expect(screen.getByText('We will email you as soon as a place opens up.')).toBeInTheDocument()
    expect(screen.getByText('On the waiting list')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Show ticket' })).not.toBeInTheDocument()
  })

  it('shows why a registration failed', async () => {
    signIn()
    const { user } = show(event(), { 'GET /me/': me(), [`POST ${REGISTER}`]: reply(400, { detail: 'Registration has closed.' }) })
    await user.click(await screen.findByRole('button', { name: 'Register, it is free' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Registration has closed.')
  })

  it('shows a registered member their ticket, full screen', async () => {
    signIn({ name: 'From token' })
    const { user } = show(registered(), { 'GET /me/': me({ full_name: 'Wanjiru Kamau' }) })
    expect(await screen.findByText("You're going")).toBeInTheDocument()
    expect(screen.getByText('Your ticket is ready below.')).toBeInTheDocument()
    expect(screen.getByText('Order #AMT-7K3Q9X2M')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Download ticket (PDF)' })).toHaveAttribute('href', 'http://api.test/api/tickets/TICKET-1/ticket.pdf')
    expect(screen.queryByRole('button', { name: /register/i })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Tap to open it full screen/ }))
    const sheet = await screen.findByRole('dialog', { name: 'Your ticket' })
    expect(within(sheet).getByText('Wanjiru Kamau')).toBeInTheDocument()
    await user.click(within(sheet).getByRole('button', { name: 'Close ticket' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    // The phone's sticky "Show ticket" opens the same sheet.
    await user.click(screen.getByRole('button', { name: 'Show ticket', hidden: true }))
    expect(within(screen.getByRole('dialog', { name: 'Your ticket' })).getByText('Wanjiru Kamau')).toBeInTheDocument()
  })

  it('names the ticket from the sign-in when the profile has not loaded', async () => {
    signIn({ name: 'From token' })
    const { user } = show(registered())
    await user.click(await screen.findByRole('button', { name: /Tap to open it full screen/ }))
    expect(within(screen.getByRole('dialog', { name: 'Your ticket' })).getByText('From token')).toBeInTheDocument()
  })

  it('leaves the ticket unnamed when nothing gives a name', async () => {
    signIn({ name: '' })
    const { user } = show(registered(), { 'GET /me/': me({ full_name: '' }) })
    await user.click(await screen.findByRole('button', { name: /Tap to open it full screen/ }))
    expect(screen.getByRole('dialog', { name: 'Your ticket' })).toBeInTheDocument()
  })

  it('cancels a registration only once the member confirms', async () => {
    signIn()
    const { user, fetch } = show(sequence(registered(), event()), {
      'GET /me/': me(),
      [`DELETE ${REGISTER}`]: reply(204),
    })
    await user.click(await screen.findByRole('button', { name: "Can't make it? Cancel registration" }))
    expect(screen.getByRole('alertdialog', { name: "Can't make it?" })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Keep my place' }))
    expect(callsTo(fetch, `DELETE ${REGISTER}`)).toHaveLength(0)

    await user.click(screen.getByRole('button', { name: "Can't make it? Cancel registration" }))
    await user.click(screen.getByRole('button', { name: 'Cancel my place' }))
    expect(await screen.findByText('Registration cancelled')).toBeInTheDocument()
    expect(callsTo(fetch, `DELETE ${REGISTER}`)).toHaveLength(1)
    expect(await screen.findByRole('button', { name: 'Register, it is free' })).toBeInTheDocument()
  })

  it('shows why a cancellation failed', async () => {
    signIn()
    const { user } = show(registered(), { 'GET /me/': me(), [`DELETE ${REGISTER}`]: reply(400, { detail: 'Too late to cancel.' }) })
    await user.click(await screen.findByRole('button', { name: "Can't make it? Cancel registration" }))
    await user.click(screen.getByRole('button', { name: 'Cancel my place' }))
    expect(await screen.findByText('Too late to cancel.')).toHaveAttribute('role', 'alert')
  })

  it('gives registered members the meeting link for an online event', async () => {
    signIn()
    show(registered({ delivery_mode: 'online', online_url: 'https://zoom.us/j/1', meeting_provider: { id: 'zoom', name: 'Zoom' } }))
    expect(await screen.findByRole('link', { name: 'Join on Zoom' })).toHaveAttribute('href', 'https://zoom.us/j/1')
    expect(screen.queryByRole('link', { name: 'Download ticket (PDF)' })).not.toBeInTheDocument()
  })

  it('links to a meeting on a service it does not recognise', async () => {
    signIn()
    show(registered({ delivery_mode: 'hybrid', online_url: 'https://meet.example/1' }))
    expect(await screen.findByRole('link', { name: 'Join the meeting' })).toHaveAttribute('href', 'https://meet.example/1')
  })

  it('tells visitors the meeting link comes with registering', async () => {
    show(event({ delivery_mode: 'online', meeting_provider: { id: 'teams', name: 'Microsoft Teams' } }))
    expect(await screen.findByText('On Microsoft Teams. The link appears here once you register.')).toBeInTheDocument()
  })

  it('says the meeting link comes with registering when the service is unknown', async () => {
    show(event({ delivery_mode: 'online' }))
    expect(await screen.findByText('The link appears here once you register.', { exact: true })).toBeInTheDocument()
  })

  it('treats a cancelled registration as none', async () => {
    signIn()
    show(event({ my_registration: registration({ status: 'cancelled' }) }), { 'GET /me/': me() })
    expect(await screen.findByRole('button', { name: 'Register, it is free' })).toBeInTheDocument()
  })

  it('says registration is closed, or that the event has ended', async () => {
    show(event({ registration_open: false }))
    expect(await screen.findByText('Registration is closed.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sign in to register', hidden: true })).not.toBeInTheDocument()
  })

  it('says a past event has ended and offers no calendar link', async () => {
    show(event({ ...past, registration_open: false, status: 'completed' }))
    expect(await screen.findByText('This event has ended.')).toBeInTheDocument()
    expect(screen.getByText('Completed')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add to calendar' })).not.toBeInTheDocument()
  })

  it('reminds a member who registered for an event that is over', async () => {
    signIn()
    show(registered({ ...past, status: 'completed' }))
    expect(await screen.findByText('You registered for this event.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Show ticket/, hidden: true })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Cancel registration/ })).not.toBeInTheDocument()
  })

  it('says when an event has been cancelled', async () => {
    show(event({ status: 'cancelled', registration_open: false }))
    expect(await screen.findByText('This event has been cancelled.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add to calendar' })).not.toBeInTheDocument()
  })

  it('keeps drafts off calendars', async () => {
    show(event({ status: 'draft' }))
    expect(await screen.findByText('Draft')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add to calendar' })).not.toBeInTheDocument()
  })

  it('links organisers to the console', async () => {
    show(event({ can_manage: true }))
    expect(await screen.findByText('You organise this event')).toBeInTheDocument()
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
    expect(screen.queryByText(/already sent feedback/)).not.toBeInTheDocument()
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
