import { fireEvent, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { mockFetch, reply, sentBody, sequence } from '../test/fetch'
import { emailRow, memberRow } from '../test/platform'
import { renderApp } from '../test/render'
import { Emails, Members } from './People'

const bodyRows = () => within(screen.getByRole('table')).getAllByRole('row').slice(1)

describe('members', () => {
  it('lists everyone who has signed in and exports them as CSV', async () => {
    mockFetch({
      'GET /platform/members/': [
        memberRow({
          institution: 'University of Nairobi',
          organizations: [{ name: 'Acme Labs', admin: true }, { name: 'Beta Hub', admin: false }],
          roles: ['Acme Labs: event organiser', 'Beta Hub: hackathon manager'],
          registrations: 4,
          attended: 3,
          joined: '2026-11-01T08:00:00Z',
        }),
        memberRow({ sub: 'user-2', name: '', email: 'quiet@example.com' }),
      ],
    })
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:csv')
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }))
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    const { user } = renderApp(<Members />, { route: '/platform/members' })
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()

    await user.click(await screen.findByRole('button', { name: 'Export CSV' }))
    const [wanjiru, quiet] = bodyRows()
    expect(wanjiru).toHaveTextContent('wanjiru@example.com · University of Nairobi')
    expect(within(wanjiru).getByText('Acme Labs · admin')).toBeInTheDocument()
    expect(within(quiet).getByText('No name')).toBeInTheDocument()
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
})

describe('email delivery', () => {
  const emails = [
    emailRow(),
    emailRow({ id: 2, kind: 'reminder_24h', subject: 'Starts tomorrow', status: 'failed', attempts: 5, last_error: 'Mailbox full', created_at: '2026-11-21T08:00:00Z' }),
    emailRow({ id: 3, subject: 'Your ticket', status: 'queued', attempts: 0, created_at: '2026-11-19T08:00:00Z' }),
    emailRow({ id: 4, subject: 'Your certificate', status: 'sending', created_at: '2026-11-18T08:00:00Z' }),
    emailRow({ id: 5, subject: 'Thanks for coming', status: 'failed', last_error: '', created_at: '2026-11-17T08:00:00Z' }),
  ]

  it('shows the latest emails by status and retries failed ones', async () => {
    let finish = (_value: unknown) => {}
    const fetch = mockFetch({
      'GET /platform/emails/': emails,
      'POST /platform/emails/': sequence(reply(400, { detail: 'Email is switched off.' }), { retried: 1 }, new Promise((resolve) => (finish = resolve))),
    })
    const { user } = renderApp(<Emails />, { route: '/platform/emails' })
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()

    expect(await screen.findByRole('tab', { name: /^All\s*5$/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: /^Waiting\s*2$/ })).toBeInTheDocument()
    expect(bodyRows()[0]).toHaveTextContent('To wanjiru@example.com · Reminder 24h')
    expect(bodyRows()[0]).toHaveTextContent('Mailbox full')

    await user.click(screen.getByRole('button', { name: 'Retry all 2 failed' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Email is switched off.')

    await user.click(screen.getByRole('tab', { name: /^Failed\s*2$/ }))
    expect(bodyRows()).toHaveLength(2)
    fireEvent.click(within(bodyRows()[0]).getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Sending 1 again.')).toBeInTheDocument()
    expect(sentBody(fetch, 'POST /platform/emails/')).toEqual({ ids: [2] })

    await user.click(screen.getByRole('button', { name: 'Retry all 2 failed' }))
    expect(await screen.findByRole('button', { name: 'Retry all 2 failed' })).toBeDisabled()
    expect(sentBody(fetch, 'POST /platform/emails/')).toEqual({ failed: true })
    finish({ retried: 2 })
    expect(await screen.findByText('Sending 2 again.')).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: /^Sent\s*1$/ }))
    expect(bodyRows()).toHaveLength(1)
    expect(within(bodyRows()[0]).queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
  })

  it('offers no retry when nothing failed', async () => {
    mockFetch({ 'GET /platform/emails/': [emailRow()] })
    const { user } = renderApp(<Emails />, { route: '/platform/emails' })
    await user.click(await screen.findByRole('tab', { name: /^Failed\s*0$/ }))
    expect(screen.getByText('No emails here.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Retry/ })).not.toBeInTheDocument()
  })
})

it.each([
  ['members', Members, 'GET /platform/members/'],
  ['emails', Emails, 'GET /platform/emails/'],
])('explains when %s cannot load', async (_what, Page, key) => {
  mockFetch({ [key]: reply(500, { detail: 'Try again later.' }) })
  renderApp(<Page />)
  expect(await screen.findByRole('alert')).toHaveTextContent('Try again later.')
})
