import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { integration, renderConsole } from '../test/console'
import { callsTo, reply, sentBody, sequence } from '../test/fetch'
import { currentPath } from '../test/render'

const google = integration({ connected: true, account_email: 'amina@example.com' })
const ownGoogle = integration({ app: 'org-1', app_name: 'Acme Labs', connected: true })
const microsoft = integration({ id: 'microsoft', name: 'Microsoft', meeting_name: 'Microsoft Teams' })
const zoom = integration({ id: 'zoom', name: 'Zoom', meeting_name: 'Zoom', has_calendar: false, configured: false })
const calendarOnly = integration({ id: 'microsoft', name: 'Outlook only', meeting_name: '', app: 'org-2', app_name: 'Beta' })

const card = (name: string) => screen.getByRole('heading', { level: 2, name: new RegExp(`^${name}`) }).closest('section')!

describe('Integrations', () => {
  it('shows each app, what it does and whether it is connected', async () => {
    const { user } = renderConsole('/manage/integrations', { 'GET /integrations/': [google, ownGoogle, microsoft, zoom, calendarOnly] })
    expect(await screen.findByRole('heading', { level: 1, name: 'Connected accounts' })).toBeInTheDocument()
    const [platformGoogle, acmeGoogle] = (await screen.findAllByRole('heading', { level: 2, name: /^Google/ })).map((h) => within(h.closest('section')!))

    expect(platformGoogle.getByText('Connected', { selector: 'span' })).toBeInTheDocument()
    expect(platformGoogle.getByText('amina@example.com')).toBeInTheDocument()
    expect(platformGoogle.getByText('Calendar sync')).toBeInTheDocument()
    expect(acmeGoogle.getByText('Acme Labs\'s own app, for its events')).toBeInTheDocument()
    expect(acmeGoogle.getByText('Connected', { selector: 'p' })).toBeInTheDocument()

    expect(within(card('Microsoft')).queryByText('Connected')).not.toBeInTheDocument()
    expect(within(card('Microsoft')).queryByText('Not set up')).not.toBeInTheDocument()
    expect(within(card('Outlook only')).queryByText(/meetings$/)).not.toBeInTheDocument()

    const zoomCard = within(card('Zoom'))
    expect(zoomCard.getByText('Not set up')).toBeInTheDocument()
    expect(zoomCard.queryByText('Calendar sync')).not.toBeInTheDocument()
    await user.click(zoomCard.getByRole('link', { name: 'Configuration' }))
    expect(currentPath()).toBe('/manage/configuration')
  })

  it('sends the organiser to the app to connect it, or says why it could not', async () => {
    const assign = vi.fn()
    vi.stubGlobal('location', { ...window.location, assign })
    const { user, fetch } = renderConsole('/manage/integrations', {
      'GET /integrations/': [microsoft],
      'POST /integrations/microsoft/': sequence(reply(503, { detail: 'Microsoft is unavailable.' }), { authorize_url: 'https://login.example.com/authorize' }),
    })
    await user.click(await screen.findByRole('button', { name: 'Connect Microsoft' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Microsoft is unavailable.')
    await user.click(screen.getByRole('button', { name: 'Connect Microsoft' }))
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://login.example.com/authorize'))
    expect(sentBody(fetch, 'POST /integrations/microsoft/')).toEqual({ app: null })
  })

  it('disconnects the platform’s app or an organisation’s own, after asking', async () => {
    const { user, fetch } = renderConsole('/manage/integrations', {
      'GET /integrations/': [google, ownGoogle],
      'DELETE /integrations/google/': reply(204),
      'DELETE /integrations/google/?app=org-1': reply(400, { detail: 'Try again later.' }),
    })
    const [platformButton, ownButton] = await screen.findAllByRole('button', { name: 'Disconnect' })

    await user.click(platformButton)
    expect(screen.getByText('Disconnect Google?')).toBeInTheDocument()
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' }))
    expect(callsTo(fetch, 'DELETE /integrations/google/')).toHaveLength(0)

    await user.click(platformButton)
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Disconnect' }))
    expect(await screen.findByText('Google disconnected')).toBeInTheDocument()

    await user.click(ownButton)
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Disconnect' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Try again later.')
  })

  it('confirms a connection that just came back, or explains one that failed', async () => {
    const { unmount } = renderConsole('/manage/integrations?connected=google', { 'GET /integrations/': [google, microsoft] })
    expect(await screen.findByText('Your Google account is connected.')).toBeInTheDocument()
    unmount()

    renderConsole('/manage/integrations?error=microsoft', { 'GET /integrations/': [google, microsoft] })
    expect(await screen.findByText('Microsoft did not connect. Try again, and allow the access it asks for.')).toBeInTheDocument()
  })

  it('shows why the apps did not load', async () => {
    renderConsole('/manage/integrations', { 'GET /integrations/': reply(500, { detail: 'Server error.' }) })
    expect(await screen.findByRole('alert')).toHaveTextContent('Server error.')
  })
})
