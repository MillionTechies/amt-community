import { fireEvent, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { mockFetch, reply, sentBody, sequence } from '../test/fetch'
import { applicationRow } from '../test/platform'
import { currentPath, renderApp } from '../test/render'
import Applications, { ApplicationDetail } from './Applications'

const LIST = 'GET /platform/applications/'
const BULK = 'POST /platform/applications/bulk/'
const bodyRows = () => within(screen.getByRole('table')).getAllByRole('row').slice(1)

const three = [
  applicationRow(),
  applicationRow({ id: 2, name: 'PyData Nairobi', kind_label: 'Tech community', created_at: '2026-11-21T08:00:00Z', applicant: { sub: 'u2', name: '', email: 'py@example.com', institution: '' } }),
  applicationRow({ id: 3, name: 'Old Club', status: 'declined' }),
]

describe('organisation applications', () => {
  it('lists waiting applications in a table and opens one', async () => {
    mockFetch({ [LIST]: three })
    const { user } = renderApp(<Applications />, { route: '/platform/applications' })
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()

    expect(await screen.findByRole('tab', { name: /^Waiting\s*2$/ })).toHaveAttribute('aria-selected', 'true')
    const [py, moi] = bodyRows()
    expect(py).toHaveTextContent('PyData Nairobi')
    expect(py).toHaveTextContent('No name')
    expect(moi).toHaveTextContent('Wanjiru Kamau')
    expect(moi).toHaveTextContent('Eldoret')
    expect(screen.queryByText('Old Club')).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: /^Declined\s*1$/ }))
    expect(bodyRows()[0]).toHaveTextContent('Old Club')
    expect(within(bodyRows()[0]).queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Approve/ })).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: /^All\s*3$/ }))
    expect(bodyRows()).toHaveLength(3)
    fireEvent.click(screen.getByText('Old Club'))
    expect(currentPath()).toBe('/platform/applications/3')
  })

  it('approves several at once after confirming', async () => {
    const fetch = mockFetch({ [LIST]: sequence(three, three.map((a) => ({ ...a, status: 'approved' }))), [BULK]: { done: [1, 2], failed: [] } })
    const { user } = renderApp(<Applications />, { route: '/platform/applications' })
    const approve = await screen.findByRole('button', { name: 'Approve' })
    expect(approve).toBeDisabled()

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Moi University' }))
    expect(screen.getByRole('button', { name: 'Approve 1' })).toBeEnabled()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Moi University' }))
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Select all 2 waiting' }))
    await user.click(screen.getByRole('button', { name: 'Approve 2' }))
    expect(await screen.findByText('Approve 2 organisations?')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Approve', hidden: false }))
    expect(await screen.findByText('Done: 2 organisations. Their applicants were emailed.')).toBeInTheDocument()
    expect(sentBody(fetch, BULK)).toEqual({ ids: [1, 2], decision: 'approve' })
  })

  it('does nothing when the bulk approval is cancelled, and clears a selection', async () => {
    const fetch = mockFetch({ [LIST]: three })
    const { user } = renderApp(<Applications />, { route: '/platform/applications' })
    await user.click(await screen.findByRole('button', { name: 'Select all 2 waiting' }))
    await user.click(screen.getByRole('button', { name: 'Clear selection' }))
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select PyData Nairobi' }))
    await user.click(screen.getByRole('button', { name: 'Approve 1' }))
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(fetch.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0)
  })

  it('declines several with one reason, and lists those that could not be done', async () => {
    const fetch = mockFetch({
      [LIST]: three,
      [BULK]: { done: [2], failed: [{ id: 1, name: 'Moi University', error: 'Its name is taken.' }] },
    })
    const { user } = renderApp(<Applications />, { route: '/platform/applications' })
    await user.click(await screen.findByRole('button', { name: 'Select all 2 waiting' }))
    await user.click(screen.getByRole('button', { name: 'Decline 2' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await user.click(screen.getByRole('button', { name: 'Decline 2' }))
    await user.type(screen.getByRole('textbox', { name: 'Reason for declining 2 organisations' }), 'Not tech.')
    await user.click(screen.getAllByRole('button', { name: 'Decline 2' })[0])

    expect(await screen.findByText('Done: 1 organisation. Their applicants were emailed.')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Moi University: Its name is taken.')
    expect(within(screen.getByRole('alert')).getByRole('link', { name: 'Moi University' })).toHaveAttribute('href', '/platform/applications/1')
    expect(sentBody(fetch, BULK)).toEqual({ ids: [1, 2], decision: 'decline', note: 'Not tech.' })
  })

  it('reports only failures when nothing was done', async () => {
    mockFetch({ [LIST]: three, [BULK]: { done: [], failed: [{ id: 1, name: 'Moi University', error: 'Down.' }] } })
    const { user } = renderApp(<Applications />, { route: '/platform/applications' })
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Select Moi University' }))
    await user.click(screen.getByRole('button', { name: 'Approve 1' }))
    await user.click(await screen.findByRole('button', { name: 'Approve' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Moi University: Down.')
    expect(screen.queryByText(/^Done:/)).not.toBeInTheDocument()
  })

  it('says when there is nothing, and when the list cannot load', async () => {
    mockFetch({ [LIST]: [] })
    const { user, unmount } = renderApp(<Applications />, { route: '/platform/applications' })
    expect(await screen.findByText('No applications are waiting.')).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: /^Approved\s*0$/ }))
    expect(screen.getByText('Nothing here.')).toBeInTheDocument()
    unmount()

    mockFetch({ [LIST]: reply(500, { detail: 'Try again later.' }) })
    renderApp(<Applications />, { route: '/platform/applications' })
    expect(await screen.findByRole('alert')).toHaveTextContent('Try again later.')
    expect(screen.queryByRole('status', { name: 'Loading' })).not.toBeInTheDocument()
  })
})

describe('one application', () => {
  const detail = (id = '1') => renderApp(<ApplicationDetail />, { route: `/platform/applications/${id}`, path: '/platform/applications/:id' })

  it('shows everything the applicant told us', async () => {
    mockFetch({ [LIST]: three })
    detail()
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Moi University' })).toBeInTheDocument()
    expect(screen.getByText('University, college or school · Eldoret · applied 20 Nov 2026')).toBeInTheDocument()
    expect(screen.getByText('A public university in Eldoret.')).toBeInTheDocument()
    expect(screen.getByText('Monthly meetups.')).toBeInTheDocument()
    expect(screen.getByText('+254700000000')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'https://mu.ac.ke' })).toHaveAttribute('href', 'https://mu.ac.ke')
  })

  it('shows a sparse application and an unknown one', async () => {
    mockFetch({ [LIST]: [applicationRow({ location: '', plans: '', website: '', contact_phone: '', applicant: { sub: 'x', name: '', email: 'x@example.com', institution: '' } })] })
    const { unmount } = detail()
    expect(await screen.findByText('University, college or school · applied 20 Nov 2026')).toBeInTheDocument()
    expect(screen.getByText('No name')).toBeInTheDocument()
    expect(screen.queryByText('Plans')).not.toBeInTheDocument()
    unmount()
    detail('99')
    expect(await screen.findByRole('alert')).toHaveTextContent('Application not found.')
  })

  it('approves with a chosen alias and a welcome note', async () => {
    const fetch = mockFetch({
      [LIST]: sequence([applicationRow()], [applicationRow({ status: 'approved', reviewed_by: 'Root', reviewed_at: '2026-11-21T08:00:00Z', organization_id: 'kc-moi', review_note: 'Karibu!' })]),
      'POST /platform/applications/1/approve/': applicationRow({ status: 'approved' }),
    })
    const { user } = detail()
    await user.click(await screen.findByRole('button', { name: 'Approve' }))
    expect(screen.getByText(/makes Wanjiru Kamau its admin/)).toBeInTheDocument()
    const alias = screen.getByRole('textbox', { name: 'Alias' })
    expect(alias).toHaveValue('moi-university')
    await user.clear(alias)
    await user.type(alias, 'MOI')
    await user.type(screen.getByRole('textbox', { name: 'Welcome note' }), 'Karibu!')
    await user.click(screen.getByRole('button', { name: 'Approve and create' }))

    expect(await screen.findByText('Approved by Root on 21 Nov 2026.')).toBeInTheDocument()
    expect(screen.getByText('Karibu!')).toBeInTheDocument()
    expect(sentBody(fetch, 'POST /platform/applications/1/approve/')).toEqual({ alias: 'moi', note: 'Karibu!' })
    await user.click(screen.getByRole('link', { name: 'Open the organisation' }))
    expect(currentPath()).toBe('/platform/organizations/kc-moi')
  })

  it('shows a taken alias, says it is creating, and goes back', async () => {
    mockFetch({
      [LIST]: [applicationRow({ applicant: { sub: 'x', name: '', email: 'x@example.com', institution: '' } })],
      'POST /platform/applications/1/approve/': sequence(reply(400, { alias: ['Pick another alias.'] }), new Promise(() => {})),
    })
    const { user } = detail()
    await user.click(await screen.findByRole('button', { name: 'Approve' }))
    expect(screen.getByText(/makes x@example.com its admin/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Approve and create' }))
    expect(await screen.findAllByText('Pick another alias.')).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: 'Approve and create' }))
    expect(await screen.findByRole('button', { name: 'Creating…' })).toBeDisabled()
  })

  it('goes back from approving', async () => {
    mockFetch({ [LIST]: [applicationRow()] })
    const { user } = detail()
    await user.click(await screen.findByRole('button', { name: 'Approve' }))
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByRole('button', { name: 'Decline' })).toBeInTheDocument()
  })

  it('declines with a reason, and goes back', async () => {
    const fetch = mockFetch({
      [LIST]: sequence([applicationRow()], [applicationRow({ status: 'declined', review_note: 'Not tech.' })]),
      'POST /platform/applications/1/decline/': applicationRow({ status: 'declined' }),
    })
    const { user } = detail()
    await user.click(await screen.findByRole('button', { name: 'Decline' }))
    await user.click(screen.getByRole('button', { name: 'Back' }))
    await user.click(screen.getByRole('button', { name: 'Decline' }))
    await user.type(screen.getByRole('textbox', { name: 'Reason' }), 'Not tech.')
    await user.click(screen.getByRole('button', { name: 'Decline application' }))
    expect(await screen.findByText('Declined by a platform admin.')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Open the organisation' })).not.toBeInTheDocument()
    expect(sentBody(fetch, 'POST /platform/applications/1/decline/')).toEqual({ note: 'Not tech.' })
  })
})
