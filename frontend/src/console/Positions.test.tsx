import { screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { Position } from '../api'
import { person } from '../test/console'
import { callsTo, mockFetch, reply, sentBody, sequence } from '../test/fetch'
import { renderApp } from '../test/render'
import { Positions } from './Positions'

const BASE = '/organizations/org-1/positions/'

const position = (overrides: Partial<Position> = {}): Position => ({
  id: 1,
  title: 'Chairperson',
  order: 0,
  roles: ['event_organiser', 'hackathon_manager'],
  is_public: true,
  holder: null,
  holder_email: null,
  invitation: null,
  ...overrides,
})

const show = (routes: Record<string, unknown>) => {
  const fetch = mockFetch(routes)
  return { fetch, ...renderApp(<Positions organizationId="org-1" organizationName="Acme Labs" />) }
}

describe('Positions', () => {
  it('starts an organisation off with the usual committee', async () => {
    const { user } = show({
      [`GET ${BASE}`]: [],
      [`POST ${BASE}committee/`]: sequence(reply(500, { detail: 'Try again.' }), reply(201, [])),
    })
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: 'Add the usual committee' }))
    expect(await screen.findByText('Try again.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Add the usual committee' }))
    expect(await screen.findByText('Committee added')).toBeInTheDocument()
  })

  it('adds a position of its own, with roles and visibility', async () => {
    const { user, fetch } = show({
      [`GET ${BASE}`]: [],
      [`POST ${BASE}`]: sequence(reply(400, { title: ['This field is required.'] }), reply(201, {})),
    })
    await user.click(await screen.findByRole('button', { name: 'Add a position' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await user.click(screen.getByRole('button', { name: 'Add a position' }))
    await user.type(screen.getByRole('combobox', { name: 'Title' }), 'Patron')
    await user.click(screen.getByRole('checkbox', { name: 'Event organiser' }))
    await user.click(screen.getByRole('checkbox', { name: 'Hackathon manager' }))
    await user.click(screen.getByRole('checkbox', { name: 'Event organiser' }))
    await user.click(screen.getByRole('checkbox', { name: /public page/ }))
    await user.click(screen.getByRole('button', { name: 'Add position' }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Add position' }))
    await vi.waitFor(() => expect(screen.queryByRole('button', { name: 'Add position' })).not.toBeInTheDocument())
    expect(sentBody(fetch, `POST ${BASE}`)).toEqual({ title: 'Patron', roles: ['hackathon_manager'], is_public: false })
  })

  it('invites someone to a vacant position and edits it', async () => {
    const { user, fetch } = show({
      [`GET ${BASE}`]: [position({ invitation: { id: 7, name: 'kim@example.com', created_at: '2026-11-20T08:00:00Z' } })],
      [`POST ${BASE}1/invite/`]: sequence(reply(400, { email: 'They already hold this position.' }), reply(201, {})),
      [`PATCH ${BASE}1/`]: sequence(reply(400, { roles: ['Choose roles.'] }), {}),
    })
    expect(await screen.findByText('Vacant')).toBeInTheDocument()
    expect(screen.getByText('Event organiser')).toBeInTheDocument()
    expect(screen.getByText('kim@example.com')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Invite' }))
    await user.type(screen.getByRole('textbox', { name: 'Email of the new chairperson' }), 'new@example.com')
    await user.click(screen.getByRole('button', { name: 'Send invitation' }))
    expect(await screen.findByText('They already hold this position.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Send invitation' }))
    expect(await screen.findByText('Invitation sent')).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: /Email of the new/ })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.getByRole('combobox', { name: 'Title' })).toHaveValue('Chairperson')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Choose roles.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('button', { name: 'Edit' })).toBeInTheDocument()
    expect(callsTo(fetch, `PATCH ${BASE}1/`)).toHaveLength(2)
  })

  it('vacates and removes a filled position after confirming', async () => {
    const { user, fetch } = show({
      [`GET ${BASE}`]: [position({ title: 'Treasurer', roles: [], is_public: false, holder: person({ name: 'Wanjiru' }), holder_email: 'w@example.com' })],
      [`POST ${BASE}1/vacate/`]: sequence(reply(500, { detail: 'Could not vacate.' }), {}),
      [`DELETE ${BASE}1/`]: reply(204),
    })
    expect(await screen.findByText('Not public')).toBeInTheDocument()
    expect(screen.getByText('No console roles')).toBeInTheDocument()
    expect(screen.getByText('· w@example.com')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Change' }))
    expect(screen.getByRole('textbox', { name: 'Email of the new treasurer' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Change' }))
    expect(screen.queryByRole('textbox', { name: 'Email of the new treasurer' })).not.toBeInTheDocument()

    const vacate = async () => {
      await user.click(screen.getByRole('button', { name: 'Vacate' }))
      await user.click(within(screen.getByRole('alertdialog', { name: 'Vacate Treasurer?' })).getByRole('button', { name: 'Vacate' }))
    }
    await user.click(screen.getByRole('button', { name: 'Vacate' }))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' }))
    expect(callsTo(fetch, `POST ${BASE}1/vacate/`)).toHaveLength(0)
    await vacate()
    expect(await screen.findByText('Could not vacate.')).toBeInTheDocument()
    await vacate()
    expect(await screen.findByText('Treasurer is vacant')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Remove' }))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' }))
    expect(callsTo(fetch, `DELETE ${BASE}1/`)).toHaveLength(0)
    await user.click(screen.getByRole('button', { name: 'Remove' }))
    await user.click(within(screen.getByRole('alertdialog', { name: 'Remove Treasurer?' })).getByRole('button', { name: 'Remove' }))
    expect(await screen.findByText('Treasurer removed')).toBeInTheDocument()
  })

  it('says when the positions did not load', async () => {
    show({ [`GET ${BASE}`]: reply(500, { detail: 'Server error.' }) })
    expect(await screen.findByText('Server error.')).toBeInTheDocument()
  })
})
