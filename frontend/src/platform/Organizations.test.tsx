import { fireEvent, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { callsTo, mockFetch, reply } from '../test/fetch'
import { orgDetail, orgRow } from '../test/platform'
import { currentPath, renderApp } from '../test/render'
import { NotFound, OrganizationDetail, Organizations } from './Organizations'

const bodyRows = () => within(screen.getByRole('table')).getAllByRole('row').slice(1)

// Catch the CSV a button downloads: its file name and text.
function catchDownload() {
  const createObjectURL = vi.fn((_blob: Blob) => 'blob:csv')
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }))
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
  return {
    name: () => (click.mock.contexts[0] as HTMLAnchorElement).download,
    text: () => createObjectURL.mock.calls[0][0].text(),
    restore: () => click.mockRestore(),
  }
}

const rows = [
  orgRow(),
  orgRow({ id: 'org 2', name: 'Beta Hub', alias: 'beta', admins: 0, upcoming_events: 2, own_apps: ['Zoom', 'Mailgun'] }),
]

describe('organisations list', () => {
  it('lists every organisation with its people and activity', async () => {
    mockFetch({ 'GET /platform/organizations/': rows })
    renderApp(<Organizations />, { route: '/platform/organizations' })
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()

    expect(await screen.findByText('2')).toBeInTheDocument()
    expect(screen.getByText(/organisations$/)).toHaveTextContent('2 organisations')
    const [acme, beta] = bodyRows()
    expect(acme).toHaveTextContent('Acme Labs')
    expect(acme).toHaveTextContent('Platform')
    expect(beta).toHaveTextContent('beta')
    expect(within(beta).getByText('None')).toBeInTheDocument()
    expect(beta).toHaveTextContent('6 (2 upcoming)')
    expect(beta).toHaveTextContent('Zoom, Mailgun')
  })

  it('opens an organisation from its row', async () => {
    mockFetch({ 'GET /platform/organizations/': rows })
    renderApp(<Organizations />, { route: '/platform/organizations' })
    fireEvent.click(await screen.findByText('Beta Hub'))
    expect(currentPath()).toBe('/platform/organizations/org%202')
  })

  it('exports the list as CSV', async () => {
    mockFetch({ 'GET /platform/organizations/': rows })
    const download = catchDownload()
    const { user } = renderApp(<Organizations />, { route: '/platform/organizations' })
    await user.click(await screen.findByRole('button', { name: 'Export CSV' }))
    expect(download.name()).toBe('organisations.csv')
    expect(await download.text()).toBe(
      [
        '"Name","Alias","Members","Admins","Organisers","Events","Upcoming","Hackathons","Registrations"',
        '"Acme Labs","acme","30","2","4","6","0","1","80"',
        '"Beta Hub","beta","30","0","4","6","2","1","80"',
      ].join('\n'),
    )
    download.restore()
  })

  it('says when there are no organisations yet', async () => {
    mockFetch({ 'GET /platform/organizations/': [] })
    renderApp(<Organizations />, { route: '/platform/organizations' })
    expect(await screen.findByText('No organisations yet. Create them in Keycloak, then refresh.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeDisabled()
  })

  it('refreshes organisations from Keycloak', async () => {
    let finish = (_value: unknown) => {}
    const fetch = mockFetch({
      'GET /platform/organizations/': rows,
      'POST /organizations/sync/': () => new Promise((resolve) => (finish = resolve)),
    })
    const { user } = renderApp(<Organizations />, { route: '/platform/organizations' })
    await user.click(screen.getByRole('button', { name: 'Refresh from Keycloak' }))
    expect(await screen.findByRole('button', { name: 'Refreshing…' })).toBeDisabled()

    finish({ organizations: 5 })
    expect(await screen.findByText('Refreshed 5 organisations from Keycloak.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Refresh from Keycloak' })).toBeEnabled()
    expect(callsTo(fetch, 'POST /organizations/sync/')).toHaveLength(1)
  })

  it('explains when refreshing fails', async () => {
    mockFetch({
      'GET /platform/organizations/': rows,
      'POST /organizations/sync/': reply(502, { detail: 'Keycloak did not answer.' }),
    })
    const { user } = renderApp(<Organizations />, { route: '/platform/organizations' })
    await user.click(screen.getByRole('button', { name: 'Refresh from Keycloak' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Keycloak did not answer.')
  })

  it('explains when the list cannot load', async () => {
    mockFetch({ 'GET /platform/organizations/': reply(403, { detail: 'Platform admins only.' }) })
    renderApp(<Organizations />, { route: '/platform/organizations' })
    expect(await screen.findByRole('alert')).toHaveTextContent('Platform admins only.')
  })
})

const panel = (title: string) => screen.getByRole('heading', { name: title }).closest('section') as HTMLElement

describe('one organisation', () => {
  const route = { route: '/platform/organizations/org%201', path: '/platform/organizations/:id' }

  it('shows its people, events, hackathons and own settings', async () => {
    mockFetch({
      'GET /platform/organizations/org%201/': orgDetail({
        last_event_at: '2026-11-30T06:00:00Z',
        upcoming_events: 1,
        admin_people: [{ sub: 'a', name: 'Amina Yusuf', email: 'amina@example.com' }],
        role_people: [{ name: 'Otieno Ouma', email: 'otieno@example.com', role: 'event_organiser' }],
        event_list: [{ slug: 'react-workshop', title: 'React workshop', status: 'published', starts_at: '2026-11-30T06:00:00Z', registered: 12 }],
        hackathon_list: [{ slug: 'climate-hack', title: 'Climate hack', status: 'judging', starts_at: '2026-12-01T06:00:00Z' }],
        overrides: [{ group: 'Email', keys: ['from_address', 'reply_to'] }],
      }),
    })
    renderApp(<OrganizationDetail />, route)
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()

    expect(await screen.findByRole('heading', { name: 'Acme Labs' })).toBeInTheDocument()
    expect(screen.getByText(/^acme · synced/)).toBeInTheDocument()
    expect(screen.queryByText(/has no admin/)).not.toBeInTheDocument()
    expect(screen.getByText('2 admins, 4 with roles')).toBeInTheDocument()
    expect(screen.getByText('1 upcoming')).toBeInTheDocument()
    expect(screen.getByText('Last event 30 Nov 2026')).toBeInTheDocument()

    expect(within(panel('Events (1)')).getByRole('link', { name: /React workshop\s*30 Nov 2026 · 12 registered/ })).toHaveAttribute('href', '/manage/events/react-workshop')
    expect(within(panel('Hackathons (1)')).getByRole('link', { name: /Climate hack/ })).toHaveAttribute('href', '/manage/hackathons/climate-hack')
    expect(within(panel('Admins')).getByText('amina@example.com')).toBeInTheDocument()
    const roles = panel('Organisers and managers')
    expect(within(roles).getByText('Otieno Ouma')).toBeInTheDocument()
    expect(within(roles).getByText('Event organiser')).toBeInTheDocument()
    expect(within(panel('Its own settings')).getByText('Email:').parentElement).toHaveTextContent('Email: from_address, reply_to')
    expect(screen.getByRole('link', { name: 'All organisations' })).toHaveAttribute('href', '/platform/organizations')
  })

  it('warns about an organisation with nobody and nothing yet', async () => {
    mockFetch({ 'GET /platform/organizations/org%201/': orgDetail({ admins: 0 }) })
    renderApp(<OrganizationDetail />, route)
    expect(await screen.findByText('This organisation has no admin. Add someone to its admins group in Keycloak, then refresh.')).toBeInTheDocument()
    expect(screen.getByText('No events yet')).toBeInTheDocument()
    expect(within(panel('Events (0)')).getByText('No events yet.')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /Hackathons \(/ })).not.toBeInTheDocument()
    expect(within(panel('Admins')).getByText('None.')).toBeInTheDocument()
    expect(screen.getByText('Nobody has a role yet.')).toBeInTheDocument()
    expect(screen.getByText("Uses the platform's settings for everything.")).toBeInTheDocument()
  })

  it('explains when the organisation cannot load', async () => {
    mockFetch({ 'GET /platform/organizations/org%201/': reply(404, { detail: 'No such organisation.' }) })
    renderApp(<OrganizationDetail />, route)
    expect(await screen.findByRole('alert')).toHaveTextContent('No such organisation.')
  })

  it('says so when the API has no organisation to give', async () => {
    mockFetch({ 'GET /platform/organizations/org%201/': null })
    renderApp(<OrganizationDetail />, route)
    expect(await screen.findByRole('alert')).toHaveTextContent('Organisation not found.')
  })

  it('asks for nothing without an id', async () => {
    const fetch = mockFetch({ 'GET /platform/organizations//': null })
    renderApp(<OrganizationDetail />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Organisation not found.')
    expect(callsTo(fetch, 'GET /platform/organizations//')).toHaveLength(1)
  })
})

describe('an unknown platform page', () => {
  it('leads back to the overview', async () => {
    const { user } = renderApp(<NotFound />, { route: '/platform/nowhere' })
    expect(screen.getByText(/This page does not exist/)).toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: 'Back to the overview' }))
    expect(currentPath()).toBe('/platform')
  })
})
