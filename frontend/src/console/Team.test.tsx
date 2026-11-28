import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import type { UserEvent } from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { organiser, person, renderConsole, roleAssignment } from '../test/console'
import { callsTo, reply, sentBody, sequence } from '../test/fetch'
import { membership } from '../test/fixtures'
import { renderApp } from '../test/render'
import { Team } from './Team'

const admin = organiser({
  organizations: [
    membership({ is_admin: true }),
    membership({ id: 'org-2', name: 'Beta Hub', alias: 'beta', is_admin: true }),
    membership({ id: 'org-3', name: 'Gamma', alias: 'gamma', roles: ['event_organiser'], can_manage_events: true }),
  ],
})
const soleAdmin = organiser({ organizations: [membership({ is_admin: true })] })

const roles = [
  roleAssignment({ id: 1, person: person({ name: 'Wanjiru Kamau' }), role: 'event_organiser' }),
  roleAssignment({ id: 2, person: person({ name: 'Otieno Barasa' }), email: 'otieno@example.com', role: 'hackathon_manager' }),
]

const bodyRows = () => within(screen.getByRole('table')).getAllByRole('row').slice(1)
const removeButton = (name: string) => within(bodyRows().find((r) => r.textContent?.includes(name))!).getByRole('button', { name: 'Remove' })
const answer = (user: UserEvent, choice: string) => user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: choice }))

describe('Team', () => {
  it('lists who has a role at each organisation the member runs, filtered by role', async () => {
    const { user } = renderConsole('/manage/team', {
      'GET /organizations/org-1/roles/': roles,
      'GET /organizations/org-2/roles/': [roleAssignment({ id: 9, person: person({ name: 'Beta Person' }) })],
    }, { member: admin })
    expect(await screen.findByRole('heading', { name: 'People at Acme Labs' })).toBeInTheDocument()
    expect(await screen.findByText('Wanjiru Kamau')).toBeInTheDocument()
    expect(within(bodyRows()[0]).getByText('Hackathon manager')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /^All/ })).toHaveTextContent('All2')

    await user.click(screen.getByRole('tab', { name: /^Event organisers/ }))
    expect(bodyRows()).toHaveLength(1)
    expect(bodyRows()[0]).toHaveTextContent('Wanjiru Kamau')
    await user.click(screen.getByRole('tab', { name: /^Hackathon managers/ }))
    expect(bodyRows()[0]).toHaveTextContent('Otieno Barasa')
    await user.click(screen.getByRole('tab', { name: /^All/ }))

    const picker = screen.getByRole('combobox', { name: 'Organisation' })
    expect(within(picker).getAllByRole('option').map((o) => o.textContent)).toEqual(['Acme Labs', 'Beta Hub'])
    await user.selectOptions(picker, 'Beta Hub')
    expect(await screen.findByText('Beta Person')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'People at Beta Hub' })).toBeInTheDocument()
  })

  it('removes a role after asking, and reports a failure', async () => {
    const { user, fetch } = renderConsole('/manage/team', {
      'GET /organizations/org-1/roles/': roles,
      'DELETE /organizations/org-1/roles/1/': reply(204),
      'DELETE /organizations/org-1/roles/2/': sequence(reply(400, { detail: 'They lead a live hackathon.' }), reply(204)),
    }, { member: soleAdmin })
    await screen.findByText('Wanjiru Kamau')
    expect(screen.queryByRole('combobox', { name: 'Organisation' })).not.toBeInTheDocument()

    fireEvent.click(removeButton('Wanjiru Kamau'))
    expect(await screen.findByText('They will no longer be an event organiser here.')).toBeInTheDocument()
    await answer(user, 'Cancel')
    expect(callsTo(fetch, 'DELETE /organizations/org-1/roles/1/')).toHaveLength(0)

    fireEvent.click(removeButton('Wanjiru Kamau'))
    await answer(user, 'Remove')
    expect(await screen.findByText('Wanjiru Kamau is no longer an event organiser.')).toBeInTheDocument()

    fireEvent.click(removeButton('Otieno Barasa'))
    expect(await screen.findByText('They will no longer be a hackathon manager here.')).toBeInTheDocument()
    await answer(user, 'Remove')
    expect(await screen.findByText('Could not remove the role')).toBeInTheDocument()
    expect(screen.getAllByText('They lead a live hackathon.')).toHaveLength(2)

    fireEvent.click(removeButton('Otieno Barasa'))
    await answer(user, 'Remove')
    expect(await screen.findByText('Otieno Barasa is no longer a hackathon manager.')).toBeInTheDocument()
  })

  it('invites someone to a role, and resends or withdraws invitations waiting for an answer', async () => {
    const pending = { id: 9, kind: 'org_role', email: 'kim@example.com', name: 'kim@example.com', role: 'event_organiser', status: 'pending', sent_count: 1, created_at: '2026-11-20T08:00:00Z' }
    const { user, fetch } = renderConsole('/manage/team', {
      'GET /organizations/org-1/roles/': [],
      'GET /organizations/org-1/invitations/': [pending],
      'POST /organizations/org-1/roles/': sequence(reply(400, { email: 'They already have this role.' }), reply(201, {})),
      'POST /invitations/sent/9/': sequence(reply(400, { detail: 'Too soon.' }), {}),
      'DELETE /invitations/sent/9/': reply(204),
    }, { member: soleAdmin })
    expect(await screen.findByText('Nobody has been given a role yet.')).toBeInTheDocument()
    const email = screen.getByLabelText('Email')
    await user.type(email, 'new@example.com')
    expect(screen.getByRole('radio', { name: /Event organiser/ })).toBeChecked()
    await user.click(screen.getByRole('radio', { name: /Hackathon manager/ }))
    await user.click(screen.getByRole('button', { name: 'Send invitation' }))
    expect(await screen.findByText('They already have this role.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Send invitation' }))
    expect(await screen.findByText('Invitation sent')).toBeInTheDocument()
    await waitFor(() => expect(email).toHaveValue(''))
    expect(sentBody(fetch, 'POST /organizations/org-1/roles/')).toEqual({ email: 'new@example.com', role: 'hackathon_manager' })

    expect(await screen.findByText('Waiting for an answer (1)')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Resend' }))
    expect(await screen.findByText('Too soon.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Resend' }))
    expect(await screen.findByText('Invitation sent again')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Withdraw' }))
    await user.click(within(screen.getByRole('alertdialog', { name: 'Withdraw the invitation to kim@example.com?' })).getByRole('button', { name: 'Cancel' }))
    expect(callsTo(fetch, 'DELETE /invitations/sent/9/')).toHaveLength(0)
    await user.click(screen.getByRole('button', { name: 'Withdraw' }))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Withdraw' }))
    expect(await screen.findByText('Invitation withdrawn')).toBeInTheDocument()
  })

  it('waits for the member, turns away a non-admin, and shows why the people did not load', async () => {
    const waiting = renderApp(<Team />)
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()
    waiting.unmount()

    const organiser = renderConsole('/manage/team')
    expect(await screen.findByText('You do not administer an organisation.')).toBeInTheDocument()
    organiser.unmount()

    renderConsole('/manage/team', { 'GET /organizations/org-1/roles/': reply(403, { detail: 'Not an admin.' }), 'GET /organizations/org-1/positions/': [] }, { member: soleAdmin })
    expect(await screen.findByRole('alert')).toHaveTextContent('Not an admin.')
  })
})
