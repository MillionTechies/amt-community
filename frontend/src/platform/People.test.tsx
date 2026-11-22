import { fireEvent, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { mockFetch, reply, sentBody } from '../test/fetch'
import { emailRow, memberRow } from '../test/platform'
import { renderApp } from '../test/render'
import { Emails, Members } from './People'

const bodyRows = () => within(screen.getByRole('table')).getAllByRole('row').slice(1)

describe('members', () => {
  const members = [
    memberRow({
      institution: 'University of Nairobi',
      organizations: [{ name: 'Acme Labs', admin: true }, { name: 'Beta Hub', admin: false }],
      roles: ['Acme Labs: event organiser', 'Beta Hub: hackathon manager'],
      registrations: 4,
      attended: 3,
      joined: '2026-11-01T08:00:00Z',
    }),
    memberRow({ sub: 'user-2', name: '', email: 'quiet@example.com' }),
  ]

  it('lists everyone who has signed in, newest first', async () => {
    mockFetch({ 'GET /platform/members/': members })
    renderApp(<Members />, { route: '/platform/members' })
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()

    expect(await screen.findByRole('button', { name: 'Export CSV' })).toBeEnabled()
    expect(screen.getByRole('heading', { name: 'Members' })).toBeInTheDocument()
    expect(screen.getByText(/members$/, { selector: 'p' })).toHaveTextContent('2 members')
    const [wanjiru, quiet] = bodyRows()
    expect(wanjiru).toHaveTextContent('wanjiru@example.com · University of Nairobi')
    expect(within(wanjiru).getByText('Acme Labs · admin')).toBeInTheDocument()
    expect(within(wanjiru).getByText('Beta Hub')).toBeInTheDocument()
    expect(wanjiru).toHaveTextContent('Acme Labs: event organiser; Beta Hub: hackathon manager')
    expect(wanjiru).toHaveTextContent('1 Nov 2026')
    expect(within(quiet).getByText('No name')).toBeInTheDocument()
    expect(within(quiet).getByText('quiet@example.com')).toBeInTheDocument()
  })

  it('exports members as CSV', async () => {
    mockFetch({ 'GET /platform/members/': members })
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:csv')
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }))
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    const { user } = renderApp(<Members />, { route: '/platform/members' })

    await user.click(await screen.findByRole('button', { name: 'Export CSV' }))
    expect((click.mock.contexts[0] as HTMLAnchorElement).download).toBe('members.csv')
    expect(await createObjectURL.mock.calls[0][0].text()).toBe(
      [
        '"Name","Email","Institution","Organisations","Roles","Registered","Attended","Joined"',
        '"Wanjiru Kamau","wanjiru@example.com","University of Nairobi","Acme Labs; Beta Hub","Acme Labs: event organiser; Beta Hub: hackathon manager","4","3","2026-11-01T08:00:00Z"',
        '"","quiet@example.com","","","","0","0","2026-10-01T08:00:00Z"',
      ].join('\n'),
    )
    click.mockRestore()
  })

  it('has nothing to export before anyone joins', async () => {
    mockFetch({ 'GET /platform/members/': [] })
    renderApp(<Members />, { route: '/platform/members' })
    expect(await screen.findByRole('button', { name: 'Export CSV' })).toBeDisabled()
    expect(screen.getByText('Nothing to show.')).toBeInTheDocument()
  })

  it('explains when members cannot load', async () => {
    mockFetch({ 'GET /platform/members/': reply(500, { detail: 'Try again later.' }) })
    renderApp(<Members />, { route: '/platform/members' })
    expect(await screen.findByRole('alert')).toHaveTextContent('Try again later.')
  })
})

describe('email delivery', () => {
  const emails = [
    emailRow(),
    emailRow({ id: 2, kind: 'reminder_24h', subject: 'Starts tomorrow', status: 'failed', attempts: 5, last_error: 'Mailbox full', created_at: '2026-11-21T08:00:00Z' }),
    emailRow({ id: 3, subject: 'Your ticket', status: 'queued', attempts: 0, created_at: '2026-11-19T08:00:00Z' }),
    emailRow({ id: 4, subject: 'Your certificate', status: 'sending', created_at: '2026-11-18T08:00:00Z' }),
    emailRow({ id: 5, subject: 'Thanks for coming', status: 'failed', last_error: '', created_at: '2026-11-17T08:00:00Z' }),
  ]

  it('shows the latest emails and filters them by status', async () => {
    mockFetch({ 'GET /platform/emails/': emails })
    const { user } = renderApp(<Emails />, { route: '/platform/emails' })
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()

    expect(await screen.findByRole('tab', { name: /^All\s*5$/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: /^Sent\s*1$/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /^Waiting\s*2$/ })).toBeInTheDocument()
    expect(bodyRows()).toHaveLength(5)
    const [failed] = bodyRows()
    expect(failed).toHaveTextContent('Starts tomorrow')
    expect(failed).toHaveTextContent('To wanjiru@example.com · Reminder 24h')
    expect(within(failed).getByText('Mailbox full')).toBeInTheDocument()
    expect(within(failed).getByText('failed')).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: /^Failed\s*2$/ }))
    expect(bodyRows().map((r) => within(r).getAllByRole('cell')[1].querySelector('p')?.textContent)).toEqual(['Starts tomorrow', 'Thanks for coming'])
    expect(within(bodyRows()[1]).queryByText('Mailbox full')).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: /^Sent\s*1$/ }))
    expect(bodyRows()).toHaveLength(1)
    expect(bodyRows()[0]).toHaveTextContent('You are registered')
    expect(within(bodyRows()[0]).queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
  })

  it('retries one failed email', async () => {
    const fetch = mockFetch({ 'GET /platform/emails/': emails, 'POST /platform/emails/': { retried: 1 } })
    renderApp(<Emails />, { route: '/platform/emails' })
    await screen.findByRole('tab', { name: /^All\s*5$/ })
    fireEvent.click(within(bodyRows()[0]).getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Sending 1 again.')).toBeInTheDocument()
    expect(sentBody(fetch, 'POST /platform/emails/')).toEqual({ ids: [2] })
  })

  it('retries every failed email at once', async () => {
    let finish = (_value: unknown) => {}
    const fetch = mockFetch({
      'GET /platform/emails/': emails,
      'POST /platform/emails/': () => new Promise((resolve) => (finish = resolve)),
    })
    const { user } = renderApp(<Emails />, { route: '/platform/emails' })
    await user.click(await screen.findByRole('button', { name: 'Retry all 2 failed' }))
    expect(await screen.findByRole('button', { name: 'Retry all 2 failed' })).toBeDisabled()
    expect(sentBody(fetch, 'POST /platform/emails/')).toEqual({ failed: true })

    finish({ retried: 2 })
    expect(await screen.findByText('Sending 2 again.')).toBeInTheDocument()
  })

  it('explains when a retry fails', async () => {
    mockFetch({ 'GET /platform/emails/': emails, 'POST /platform/emails/': reply(400, { detail: 'Email is switched off.' }) })
    const { user } = renderApp(<Emails />, { route: '/platform/emails' })
    await user.click(await screen.findByRole('button', { name: 'Retry all 2 failed' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Email is switched off.')
  })

  it('offers no retry when nothing failed', async () => {
    mockFetch({ 'GET /platform/emails/': [emailRow()] })
    const { user } = renderApp(<Emails />, { route: '/platform/emails' })
    expect(await screen.findByRole('tab', { name: /^Failed\s*0$/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Retry all/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: /^Failed\s*0$/ }))
    expect(screen.getByText('No emails here.')).toBeInTheDocument()
  })

  it('explains when emails cannot load', async () => {
    mockFetch({ 'GET /platform/emails/': reply(500, { detail: 'Try again later.' }) })
    renderApp(<Emails />, { route: '/platform/emails' })
    expect(await screen.findByRole('alert')).toHaveTextContent('Try again later.')
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()
  })
})
