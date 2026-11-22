import { screen, within } from '@testing-library/react'
import type { UserEvent } from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import type { CommunityEvent, EventLink, Integration } from '../api'
import { eventLink, integration } from '../test/console'
import { callsTo, mockFetch, reply, sentBody } from '../test/fetch'
import { event } from '../test/fixtures'
import { currentPath, renderApp } from '../test/render'
import { MeetingPanel } from './MeetingPanel'

const LINKS = '/events/react-workshop/links/'

const google = integration({ connected: true, account_email: 'amina@example.com' })
const microsoft = integration({ id: 'microsoft', name: 'Microsoft', meeting_name: 'Microsoft Teams' })
const zoom = integration({ id: 'zoom', name: 'Zoom', meeting_name: 'Zoom', has_calendar: false, configured: false })

function show(
  item: Partial<CommunityEvent> = {},
  { integrations = [google, microsoft, zoom], links = [], routes = {} }: { integrations?: Integration[]; links?: EventLink[]; routes?: Record<string, unknown> } = {},
) {
  const fetch = mockFetch({
    'GET /integrations/?organization=org-1': integrations,
    [`GET ${LINKS}`]: links,
    ...routes,
  })
  return { ...renderApp(<MeetingPanel event={event(item)} />), fetch }
}

const answer = (user: UserEvent, choice: string) => user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: choice }))

describe('MeetingPanel', () => {
  it('waits for the connected apps and links', () => {
    show()
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()
  })

  it('creates a first meeting without asking', async () => {
    const { user, fetch } = show({}, { routes: { [`POST ${LINKS}`]: eventLink({ is_meeting: true }) } })
    expect(await screen.findByText('None yet. Paste one under Details, or create one here.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Google Meet' }))
    expect(await screen.findByText('Google Meet meeting created')).toBeInTheDocument()
    expect(sentBody(fetch, `POST ${LINKS}`)).toEqual({ provider: 'google', meeting: true })
  })

  it('asks before replacing a meeting link people already have', async () => {
    const { user, fetch } = show(
      { delivery_mode: 'online', online_url: 'https://meet.example.com/abc', meeting_provider: { id: 'google', name: 'Google Meet' } },
      { routes: { [`POST ${LINKS}`]: eventLink() } },
    )
    expect(await screen.findByRole('link', { name: 'https://meet.example.com/abc' })).toBeInTheDocument()
    expect(screen.getByText('Google Meet', { selector: 'span' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Google Meet' }))
    expect(screen.getByText('Replace the meeting link?')).toBeInTheDocument()
    await answer(user, 'Cancel')
    expect(callsTo(fetch, `POST ${LINKS}`)).toHaveLength(0)

    await user.click(screen.getByRole('button', { name: 'Google Meet' }))
    await answer(user, 'Create Google Meet meeting')
    expect(await screen.findByText('Google Meet meeting created')).toBeInTheDocument()
  })

  it('names an unrecognised meeting link plainly', async () => {
    show({ online_url: 'https://example.com/room' })
    expect(await screen.findByText('Link', { selector: 'span' })).toBeInTheDocument()
  })

  it('offers to connect an app that is set up but not connected', async () => {
    const { user } = show()
    await user.click(await screen.findByRole('link', { name: 'Connect Microsoft for Microsoft Teams' }))
    expect(currentPath()).toBe('/manage/integrations')
  })

  it('adds the event to a connected calendar not already holding it', async () => {
    const outlook = integration({ id: 'microsoft', name: 'Microsoft', meeting_name: 'Microsoft Teams', connected: true })
    const { user, fetch } = show({}, {
      integrations: [google, outlook],
      links: [eventLink({ provider: 'google' })],
      routes: { [`POST ${LINKS}`]: eventLink({ id: 2, provider: 'microsoft' }) },
    })
    expect(await screen.findByText('Keep it in my calendar')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Google Calendar' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Outlook' }))
    expect(sentBody(fetch, `POST ${LINKS}`)).toEqual({ provider: 'microsoft', meeting: false })
  })

  it('offers the Google calendar when it is connected and free', async () => {
    show({}, { integrations: [google] })
    expect(await screen.findByRole('button', { name: 'Google Calendar' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Connect Google or Microsoft' })).not.toBeInTheDocument()
  })

  it('points to the connected accounts page when no calendar is connected', async () => {
    show({}, { integrations: [microsoft] })
    expect(await screen.findByRole('link', { name: 'Connect Google or Microsoft' })).toHaveAttribute('href', '/manage/integrations')
  })

  it('lists the event’s links, and removes the member’s own after asking', async () => {
    const { user, fetch } = show({}, {
      links: [
        eventLink({ id: 1, provider: 'zoom', provider_name: 'Zoom', is_meeting: true, mine: false, account_email: 'host@example.com' }),
        eventLink({ id: 2, provider: 'google', provider_name: 'Google', is_meeting: true }),
        eventLink({ id: 3, provider: 'microsoft', provider_name: 'Microsoft', mine: false }),
      ],
      routes: { [`DELETE ${LINKS}2/`]: reply(204) },
    })
    expect(await screen.findByText('Zoom meeting')).toBeInTheDocument()
    expect(screen.getByText('host@example.com · kept in sync')).toBeInTheDocument()
    expect(screen.getByText('Google meeting and calendar')).toBeInTheDocument()
    expect(screen.getByText('Microsoft calendar')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Remove' })).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'Remove' }))
    expect(screen.getByText('Remove it from Google?')).toBeInTheDocument()
    await answer(user, 'Cancel')
    expect(callsTo(fetch, `DELETE ${LINKS}2/`)).toHaveLength(0)
    await user.click(screen.getByRole('button', { name: 'Remove' }))
    await answer(user, 'Remove')
    expect(await screen.findByText('Removed from Google')).toBeInTheDocument()
  })

  it('shows why a link could not be added or removed', async () => {
    const { user } = show({}, {
      links: [eventLink({ id: 2 })],
      routes: {
        [`POST ${LINKS}`]: reply(400, { detail: 'Google refused.' }),
        [`DELETE ${LINKS}2/`]: reply(400, { detail: 'Already gone.' }),
      },
    })
    await user.click(await screen.findByRole('button', { name: 'Google Meet' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Google refused.')
  })

  it('shows why a link could not be removed', async () => {
    const { user } = show({}, { links: [eventLink({ id: 2 })], routes: { [`DELETE ${LINKS}2/`]: reply(400, { detail: 'Already gone.' }) } })
    await user.click(await screen.findByRole('button', { name: 'Remove' }))
    await answer(user, 'Remove')
    expect(await screen.findByRole('alert')).toHaveTextContent('Already gone.')
  })

  it('offers nothing new for a finished or cancelled event', async () => {
    for (const status of ['completed', 'cancelled'] as const) {
      const { unmount } = show({ status })
      expect(await screen.findByText('Join link')).toBeInTheDocument()
      expect(screen.queryByText('Create a meeting')).not.toBeInTheDocument()
      expect(screen.queryByText('Keep it in my calendar')).not.toBeInTheDocument()
      unmount()
    }
  })

  it('explains when no app is set up on the server', async () => {
    show({}, { integrations: [zoom] })
    expect(await screen.findByText(/Google, Microsoft and Zoom are not set up on this server yet/)).toBeInTheDocument()
    expect(screen.queryByText('Create a meeting')).not.toBeInTheDocument()
  })
})
