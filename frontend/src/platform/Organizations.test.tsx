import { fireEvent, screen, within } from '@testing-library/react'
import type { ComponentType } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { mockFetch, reply, sequence } from '../test/fetch'
import { orgDetail, orgRow } from '../test/platform'
import { currentPath, renderApp } from '../test/render'
import { OrganizationDetail, Organizations } from './Organizations'

const bodyRows = () => within(screen.getByRole('table')).getAllByRole('row').slice(1)
const panel = (title: string) => screen.getByRole('heading', { name: title }).closest('section') as HTMLElement
const detailRoute = { route: '/platform/organizations/org%201', path: '/platform/organizations/:id' }

describe('organisations list', () => {
  it('lists every organisation, exports them as CSV and opens one', async () => {
    mockFetch({
      'GET /platform/organizations/': [
        orgRow(),
        orgRow({ id: 'org 2', name: 'Beta Hub', alias: 'beta', admins: 0, upcoming_events: 2, own_apps: ['Zoom', 'Mailgun'] }),
      ],
    })
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:csv')
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }))
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    const { user } = renderApp(<Organizations />, { route: '/platform/organizations' })
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()

    await screen.findByText('Beta Hub')
    const [acme, beta] = bodyRows()
    expect(acme).toHaveTextContent('Platform')
    expect(within(beta).getByText('None')).toBeInTheDocument()
    expect(beta).toHaveTextContent('6 (2 upcoming)')
    expect(beta).toHaveTextContent('Zoom, Mailgun')

    await user.click(screen.getByRole('button', { name: 'Export CSV' }))
    expect((click.mock.contexts[0] as HTMLAnchorElement).download).toBe('organisations.csv')
    expect(await createObjectURL.mock.calls[0][0].text()).toBe(
      [
        '"Name","Alias","Members","Admins","Organisers","Events","Upcoming","Hackathons","Registrations"',
        '"Acme Labs","acme","30","2","4","6","0","1","80"',
        '"Beta Hub","beta","30","0","4","6","2","1","80"',
      ].join('\n'),
    )
    click.mockRestore()

    fireEvent.click(screen.getByText('Beta Hub'))
    expect(currentPath()).toBe('/platform/organizations/org%202')
  })

  it('refreshes organisations from Keycloak, trying again after a failure', async () => {
    let finish = (_value: unknown) => {}
    mockFetch({
      'GET /platform/organizations/': [],
      'POST /organizations/sync/': sequence(reply(502, { detail: 'Keycloak did not answer.' }), new Promise((resolve) => (finish = resolve))),
    })
    const { user } = renderApp(<Organizations />, { route: '/platform/organizations' })
    expect(await screen.findByRole('button', { name: 'Export CSV' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Refresh from Keycloak' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Keycloak did not answer.')

    await user.click(screen.getByRole('button', { name: 'Refresh from Keycloak' }))
    expect(await screen.findByRole('button', { name: 'Refreshing…' })).toBeDisabled()
    finish({ organizations: 5 })
    expect(await screen.findByText('Refreshed 5 organisations from Keycloak.')).toBeInTheDocument()
  })
})

describe('one organisation', () => {
  it('shows its people, events, hackathons and own settings', async () => {
    mockFetch({
      'GET /platform/organizations/org%201/': orgDetail({
        last_event_at: '2026-11-30T06:00:00Z',
        admin_people: [{ sub: 'a', name: 'Amina Yusuf', email: 'amina@example.com' }],
        role_people: [{ name: 'Otieno Ouma', email: 'otieno@example.com', role: 'event_organiser' }],
        event_list: [
          { slug: 'react-workshop', title: 'React workshop', status: 'published', starts_at: '2026-11-30T06:00:00Z', registered: 12 },
          { slug: 'secret-plan', title: 'Secret plan', status: 'draft', starts_at: '2026-12-30T06:00:00Z', registered: 0 },
        ],
        hackathon_list: [{ slug: 'climate-hack', title: 'Climate hack', status: 'judging', starts_at: '2026-12-01T06:00:00Z' }],
        overrides: [{ group: 'Email', keys: ['from_address', 'reply_to'] }],
      }),
    })
    renderApp(<OrganizationDetail />, detailRoute)
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()

    expect(await screen.findByRole('heading', { name: 'Acme Labs' })).toBeInTheDocument()
    expect(screen.queryByText(/has no admin/)).not.toBeInTheDocument()
    expect(screen.getByText('Last event 30 Nov 2026')).toBeInTheDocument()
    expect(within(panel('Events (2)')).getByRole('link', { name: /React workshop/ })).toHaveAttribute('href', '/events/react-workshop')
    // A draft has no public page, so it is not a link.
    expect(within(panel('Events (2)')).getByText('Secret plan').closest('a')).toBeNull()
    expect(within(panel('Hackathons (1)')).getByRole('link', { name: /Climate hack/ })).toHaveAttribute('href', '/hackathons/climate-hack')
    expect(within(panel('Admins')).getByText('amina@example.com')).toBeInTheDocument()
    expect(within(panel('Organisers and managers')).getByText('Event organiser')).toBeInTheDocument()
    expect(panel('Its own settings')).toHaveTextContent('Email: from_address, reply_to')
  })

  it('warns about an organisation with nobody and nothing yet', async () => {
    mockFetch({ 'GET /platform/organizations/org%201/': orgDetail({ admins: 0 }) })
    renderApp(<OrganizationDetail />, detailRoute)
    expect(await screen.findByText(/This organisation has no admin/)).toBeInTheDocument()
    expect(screen.getByText('No events yet')).toBeInTheDocument()
    expect(within(panel('Events (0)')).getByText('No events yet.')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /Hackathons \(/ })).not.toBeInTheDocument()
    expect(within(panel('Admins')).getByText('None.')).toBeInTheDocument()
    expect(screen.getByText('Nobody has a role yet.')).toBeInTheDocument()
    expect(screen.getByText("Uses the platform's settings for everything.")).toBeInTheDocument()
  })
})

describe('when the API cannot help', () => {
  it.each<[string, ComponentType, object, string, unknown, string]>([
    ['the list', Organizations, { route: '/platform/organizations' }, 'GET /platform/organizations/', reply(403, { detail: 'Platform admins only.' }), 'Platform admins only.'],
    ['an organisation', OrganizationDetail, detailRoute, 'GET /platform/organizations/org%201/', reply(404, { detail: 'No such organisation.' }), 'No such organisation.'],
    ['an organisation without an id', OrganizationDetail, {}, 'GET /platform/organizations//', null, 'Organisation not found.'],
  ])('explains why %s cannot be shown', async (_what, Page, options, key, answer, message) => {
    mockFetch({ [key]: answer })
    renderApp(<Page />, options)
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
  })
})
