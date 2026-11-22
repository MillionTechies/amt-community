import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { currentPath, renderApp } from '../test/render'
import { mockFetch, reply, sentBody, sequence } from '../test/fetch'
import { applicationRow } from '../test/platform'
import Applications from './Applications'

const LIST = 'GET /platform/applications/'
const cards = () => screen.getAllByRole('listitem').filter((li) => li.parentElement?.parentElement?.className.includes('space-y-4'))

describe('organisation applications', () => {
  it('shows the waiting ones first, with everything the applicant told us', async () => {
    mockFetch({
      [LIST]: [
        applicationRow(),
        applicationRow({ id: 2, name: 'PyData Nairobi', status: 'approved', reviewed_by: 'Root', reviewed_at: '2026-11-21T08:00:00Z', organization_id: 'kc-py', review_note: 'Welcome!' }),
        applicationRow({ id: 3, name: 'Spam Inc', status: 'declined', reviewed_by: '', reviewed_at: null, website: '', plans: '', location: '', contact_phone: '', applicant: { sub: 'x', name: '', email: 'spam@example.com', institution: '' } }),
      ],
    })
    const { user } = renderApp(<Applications />, { route: '/platform/applications' })
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()

    const moi = (await screen.findByText('Moi University', { selector: 'p' })).closest('li')!
    expect(moi).toHaveTextContent('University, college or school · Eldoret · applied 20 Nov 2026')
    expect(moi).toHaveTextContent('wanjiru@example.com · +254700000000')
    expect(within(moi).getByRole('link', { name: 'https://mu.ac.ke' })).toHaveAttribute('href', 'https://mu.ac.ke')
    expect(moi).toHaveTextContent('Monthly meetups.')
    expect(screen.queryByText('PyData Nairobi')).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /^Waiting\s*1$/ })).toHaveAttribute('aria-selected', 'true')

    await user.click(screen.getByRole('tab', { name: /^Approved\s*1$/ }))
    const py = screen.getByText('PyData Nairobi', { selector: 'p' }).closest('li')!
    expect(py).toHaveTextContent('Approved by Root on 21 Nov 2026.')
    expect(py).toHaveTextContent('Welcome!')
    await user.click(within(py).getByRole('link', { name: 'Open the organisation' }))
    expect(currentPath()).toBe('/platform/organizations/kc-py')

    await user.click(screen.getByRole('tab', { name: /^Declined\s*1$/ }))
    const spam = screen.getByText('Spam Inc', { selector: 'p' }).closest('li')!
    expect(spam).toHaveTextContent('No name')
    expect(spam).toHaveTextContent('Declined by a platform admin.')
    expect(within(spam).queryByRole('link')).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: /^All\s*3$/ }))
    expect(cards()).toHaveLength(3)
  })

  it('approves an application with an alias and a welcome note', async () => {
    const fetch = mockFetch({
      [LIST]: sequence([applicationRow()], [applicationRow({ status: 'approved' })]),
      'POST /platform/applications/1/approve/': applicationRow({ status: 'approved' }),
    })
    const { user } = renderApp(<Applications />, { route: '/platform/applications' })
    await user.click(await screen.findByRole('button', { name: 'Approve' }))
    expect(screen.getByText(/makes Wanjiru Kamau its admin/)).toBeInTheDocument()
    const alias = screen.getByRole('textbox', { name: 'Alias' })
    expect(alias).toHaveValue('moi-university')
    await user.clear(alias)
    await user.type(alias, 'MOI')
    await user.type(screen.getByRole('textbox', { name: 'Welcome note' }), 'Karibu!')
    await user.click(screen.getByRole('button', { name: 'Approve and create' }))

    expect(await screen.findByText('Moi University is on Community, with Wanjiru Kamau as its admin.')).toBeInTheDocument()
    expect(sentBody(fetch, 'POST /platform/applications/1/approve/')).toEqual({ alias: 'moi', note: 'Karibu!' })
    expect(await screen.findByText('No applications are waiting. New ones appear here and on the overview.')).toBeInTheDocument()
  })

  it('names the applicant by email when they have no name, and shows a taken alias', async () => {
    mockFetch({
      [LIST]: [applicationRow({ applicant: { sub: 'x', name: '', email: 'x@example.com', institution: '' } })],
      'POST /platform/applications/1/approve/': reply(400, { alias: ['Pick another alias.'] }),
    })
    const { user } = renderApp(<Applications />, { route: '/platform/applications' })
    await user.click(await screen.findByRole('button', { name: 'Approve' }))
    expect(screen.getByText(/makes x@example.com its admin/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Approve and create' }))
    expect(await screen.findAllByText('Pick another alias.')).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByRole('button', { name: 'Decline' })).toBeInTheDocument()
  })

  it('reports an approval for an applicant with no name by email', async () => {
    mockFetch({
      [LIST]: [applicationRow({ applicant: { sub: 'x', name: '', email: 'x@example.com', institution: '' } })],
      'POST /platform/applications/1/approve/': applicationRow({ status: 'approved' }),
    })
    const { user } = renderApp(<Applications />, { route: '/platform/applications' })
    await user.click(await screen.findByRole('button', { name: 'Approve' }))
    await user.click(screen.getByRole('button', { name: 'Approve and create' }))
    expect(await screen.findByText('Moi University is on Community, with x@example.com as its admin.')).toBeInTheDocument()
  })

  it('declines with a reason', async () => {
    const fetch = mockFetch({
      [LIST]: [applicationRow()],
      'POST /platform/applications/1/decline/': applicationRow({ status: 'declined' }),
    })
    const { user } = renderApp(<Applications />, { route: '/platform/applications' })
    await user.click(await screen.findByRole('button', { name: 'Decline' }))
    await user.type(screen.getByRole('textbox', { name: 'Reason' }), 'Use an official email.')
    await user.click(screen.getByRole('button', { name: 'Decline application' }))
    expect(await screen.findByText('Declined Moi University. We emailed wanjiru@example.com your reason.')).toBeInTheDocument()
    expect(sentBody(fetch, 'POST /platform/applications/1/decline/')).toEqual({ note: 'Use an official email.' })
  })

  it('says it is creating the organisation while Keycloak works', async () => {
    mockFetch({ [LIST]: [applicationRow()], 'POST /platform/applications/1/approve/': () => new Promise(() => {}) })
    const { user } = renderApp(<Applications />, { route: '/platform/applications' })
    await user.click(await screen.findByRole('button', { name: 'Approve' }))
    await user.click(screen.getByRole('button', { name: 'Approve and create' }))
    expect(await screen.findByRole('button', { name: 'Creating…' })).toBeDisabled()
  })

  it('goes back from declining', async () => {
    mockFetch({ [LIST]: [applicationRow()] })
    const { user } = renderApp(<Applications />, { route: '/platform/applications' })
    await user.click(await screen.findByRole('button', { name: 'Decline' }))
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument()
  })

  it('says when a filter has nothing, and when the list cannot load', async () => {
    mockFetch({ [LIST]: [] })
    const { user, unmount } = renderApp(<Applications />, { route: '/platform/applications' })
    await user.click(await screen.findByRole('tab', { name: /^Declined\s*0$/ }))
    expect(screen.getByText('Nothing here.')).toBeInTheDocument()
    unmount()

    mockFetch({ [LIST]: reply(500, { detail: 'Try again later.' }) })
    renderApp(<Applications />, { route: '/platform/applications' })
    expect(await screen.findByRole('alert')).toHaveTextContent('Try again later.')
    expect(screen.queryByRole('status', { name: 'Loading' })).not.toBeInTheDocument()
  })
})
