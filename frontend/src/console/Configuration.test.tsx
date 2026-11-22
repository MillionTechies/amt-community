import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { configField, configGroup, configScope, renderConsole } from '../test/console'
import { callsTo, mockFetch, reply, sentBody } from '../test/fetch'
import { renderApp } from '../test/render'
import Configuration from './Configuration'

const platform = configScope({ id: 'platform', name: 'Platform', kind: 'platform' })
const acme = configScope()
const beta = configScope({ id: 'org-2', name: 'Beta Hub' })

const email = configGroup({
  fields: [
    configField({ key: 'sender_name', label: 'Sender name', help: 'Shown as the sender.', inherited: 'A Million Techies', source: 'platform' }),
    configField({ key: 'reply_to', label: 'Reply-to', kind: 'email', is_set: true, value: 'hi@acme.org', help: 'Where replies go.', inherited: 'team@amt.org', source: 'platform' }),
    configField({ key: 'tracking', label: 'Tracking', kind: 'boolean', value: 'true', inherited: 'true', source: 'environment' }),
    configField({ key: 'smtp_password', label: 'SMTP password', kind: 'secret', is_set: true }),
    configField({ key: 'api_key', label: 'API key', kind: 'secret', inherited: 'set', source: 'organization' }),
    configField({ key: 'port', label: 'Port', kind: 'number', placeholder: '587' }),
    configField({ key: 'site', label: 'Site', kind: 'url' }),
  ],
})
const google = configGroup({
  id: 'google', title: 'Google', description: 'Meet and Calendar.', redirect_uri: 'https://api.test/oauth/google/',
  fields: [
    configField({ key: 'google_client_id', label: 'Client ID' }),
    configField({ key: 'google_client_secret', label: 'Client secret', kind: 'secret' }),
    configField({ key: 'google_debug', label: 'Debug', kind: 'boolean', inherited: 'false', source: 'organization' }),
  ],
})
const zoom = configGroup({ id: 'zoom', title: 'Zoom', description: 'Meetings.', own: true, redirect_uri: 'https://api.test/oauth/zoom/', fields: [] })
const storage = configGroup({ id: 'storage', title: 'Image storage', description: 'Where images go.', ready: true, fields: [] })

const card = (title: string) => within(screen.getByRole('heading', { level: 2, name: title }).closest('section')!)

// A reply the test hands over when it is ready, so the page can be seen waiting for it.
function later() {
  let resolve!: (value: unknown) => void
  const promise = new Promise((r) => { resolve = r })
  return { promise, resolve }
}

function show(mode?: 'platform' | 'organizations', routes: Record<string, unknown> = {}) {
  const fetch = mockFetch({
    'GET /configuration/': [platform, acme, beta],
    'GET /configuration/org-1/': [email, google, zoom, storage],
    'GET /configuration/platform/': [storage, configGroup({ id: 'smtp', title: 'SMTP', fields: [configField({ key: 'debug', label: 'Debug', kind: 'boolean' })] })],
    ...routes,
  })
  return { ...renderApp(<Configuration mode={mode} />), fetch }
}

describe('Configuration', () => {
  it('opens from the console on the first organisation the member runs', async () => {
    renderConsole('/manage/configuration', {
      'GET /configuration/': [acme],
      'GET /configuration/org-1/': [storage],
    })
    expect(await screen.findByRole('heading', { level: 1, name: 'Configuration' })).toBeInTheDocument()
    expect(screen.getByText(/Settings for Acme Labs/)).toBeInTheDocument()
    expect(await screen.findByText('Using platform')).toBeInTheDocument()
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
  })

  it('shows where each setting comes from and whether each app is set up, for each organisation', async () => {
    const { user } = show(undefined, { 'GET /configuration/org-2/': [configGroup({ id: 'branding', title: 'Branding', fields: [] })] })
    expect(await screen.findByRole('heading', { level: 2, name: 'Email' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Acme Labs' })).toHaveAttribute('aria-selected', 'true')

    const mail = card('Email')
    expect(mail.getByText('Shown as the sender. Using the platform setting: A Million Techies')).toBeInTheDocument()
    expect(mail.getByLabelText('Sender name')).toHaveAttribute('placeholder', 'A Million Techies')
    expect(mail.getByLabelText('Reply-to')).toHaveAttribute('type', 'email')
    expect(mail.getByLabelText('Reply-to')).toHaveValue('hi@acme.org')
    expect(mail.getByLabelText('Tracking')).toHaveValue('true')
    expect(within(mail.getByLabelText('Tracking')).getByRole('option', { name: 'Default (on)' })).toBeInTheDocument()
    expect(mail.getByText('Using the server environment: true')).toBeInTheDocument()
    expect(mail.getByLabelText('SMTP password')).toHaveAttribute('placeholder', '•••••••• saved. Type to replace.')
    expect(mail.getByLabelText('API key')).toHaveAttribute('placeholder', 'Inherited. Type to override.')
    expect(mail.getByText('Using the default.')).toBeInTheDocument()
    expect(mail.getByLabelText('Port')).toHaveAttribute('type', 'number')
    expect(mail.getByLabelText('Port')).toHaveAttribute('placeholder', '587')
    expect(mail.getByLabelText('Site')).toHaveAttribute('type', 'url')
    expect(mail.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(mail.queryByText(/Not set up|Own app|Using platform/)).not.toBeInTheDocument()

    const googleCard = card('Google')
    expect(googleCard.getByText('Not set up')).toBeInTheDocument()
    expect(googleCard.getByLabelText('Client ID')).toHaveAttribute('type', 'text')
    expect(googleCard.getByLabelText('Client secret')).toHaveAttribute('placeholder', 'Not set')
    expect(within(googleCard.getByLabelText('Debug')).getByRole('option', { name: 'Default (off)' })).toBeInTheDocument()
    expect(googleCard.getByText('Using the default: false')).toBeInTheDocument()
    expect(googleCard.getByText(/Leave these empty to use the platform's app/)).toBeInTheDocument()
    await user.click(googleCard.getByRole('button', { name: 'Copy' }))
    expect(googleCard.getByRole('button', { name: 'Copied' })).toBeInTheDocument()
    await expect(navigator.clipboard.readText()).resolves.toBe('https://api.test/oauth/google/')

    expect(card('Zoom').getByText('Own app')).toBeInTheDocument()
    expect(card('Zoom').queryByText(/Leave these empty/)).not.toBeInTheDocument()
    expect(card('Image storage').getByText('Using platform')).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Beta Hub' }))
    expect(await screen.findByRole('heading', { name: 'Branding' })).toBeInTheDocument()
    expect(screen.getByText(/Settings for Beta Hub/)).toBeInTheDocument()
  })

  it('saves only the settings that changed, and shows what went wrong', async () => {
    // After saving, the server reports the new values.
    let groups = [email]
    const savedEmail = configGroup({ ...email, fields: email.fields.map((f) => (f.key === 'sender_name' ? { ...f, is_set: true, value: 'Acme' } : f)) })
    const saved = later()
    const replies = [
      () => reply(400, { sender_name: ['Too long.'] }),
      () => reply(409, { detail: 'Someone else saved first.' }),
      () => saved.promise,
    ]
    const { user, fetch } = show(undefined, {
      'GET /configuration/org-1/': () => groups,
      'PUT /configuration/org-1/': () => replies.shift()!(),
    })
    const mail = await waitFor(() => card('Email'))
    const save = mail.getByRole('button', { name: 'Save' })

    await user.type(mail.getByLabelText('Sender name'), 'Draft')
    await user.click(mail.getByRole('button', { name: 'Discard changes' }))
    expect(mail.getByLabelText('Sender name')).toHaveValue('')
    expect(mail.queryByRole('button', { name: 'Discard changes' })).not.toBeInTheDocument()

    // Typing a value back to what is saved is no change.
    await user.type(mail.getByLabelText('Reply-to'), 'x')
    expect(save).toBeEnabled()
    await user.type(mail.getByLabelText('Reply-to'), '{Backspace}')
    expect(save).toBeDisabled()

    await user.type(mail.getByLabelText('Sender name'), 'Acme')
    await user.clear(mail.getByLabelText('Reply-to'))
    await user.selectOptions(mail.getByLabelText('Tracking'), 'Default (on)')
    expect(mail.getByLabelText('Tracking')).toHaveValue('')
    await user.selectOptions(mail.getByLabelText('Tracking'), 'Off')
    await user.selectOptions(mail.getByLabelText('Tracking'), 'On')

    await user.click(mail.getByRole('button', { name: 'Clear' }))
    expect(mail.getByLabelText('SMTP password')).toHaveAttribute('placeholder', 'Will be cleared')
    await user.click(mail.getByRole('button', { name: 'Undo' }))
    expect(mail.getByLabelText('SMTP password')).toHaveAttribute('placeholder', '•••••••• saved. Type to replace.')
    await user.click(mail.getByRole('button', { name: 'Clear' }))

    await user.type(mail.getByLabelText('API key'), 'k')
    await user.type(mail.getByLabelText('API key'), '{Backspace}')
    await user.type(mail.getByLabelText('Port'), '2525')

    // A problem with one setting shows beside it; a problem with the card, above it.
    await user.click(save)
    expect(await mail.findByRole('alert')).toHaveTextContent('Too long.')
    expect(mail.queryByText(/Shown as the sender/)).not.toBeInTheDocument()
    await user.click(save)
    expect(await mail.findByText('Someone else saved first.')).toBeInTheDocument()
    expect(mail.getByText(/Shown as the sender/)).toBeInTheDocument()

    await user.click(save)
    expect(await mail.findByRole('button', { name: 'Saving…' })).toBeDisabled()
    groups = [savedEmail]
    saved.resolve(groups)
    expect(await mail.findByText('Saved')).toBeInTheDocument()
    expect(sentBody(fetch, 'PUT /configuration/org-1/')).toEqual({
      values: { sender_name: 'Acme', reply_to: null, smtp_password: null, port: '2525' },
    })
    expect(save).toBeDisabled()
    expect(mail.getByLabelText('Sender name')).toHaveValue('Acme')

    await user.type(mail.getByLabelText('Sender name'), 'X')
    expect(mail.queryByText('Saved')).not.toBeInTheDocument()
  })

  it('sends a test email', async () => {
    const sent = later()
    const replies = [
      () => reply(400, { to: ['Enter a valid email address.'] }),
      () => reply(502, { detail: 'The mail server refused.' }),
      () => sent.promise,
    ]
    const { user, fetch } = show(undefined, { 'POST /configuration/org-1/test-email/': () => replies.shift()!() })
    const mail = await waitFor(() => card('Email'))
    expect(card('Google').queryByPlaceholderText('you@example.com')).not.toBeInTheDocument()
    await user.type(mail.getByPlaceholderText('you@example.com'), 'me@example.com')
    await user.click(mail.getByRole('button', { name: 'Send test' }))
    expect(await mail.findByText('Enter a valid email address.')).toBeInTheDocument()
    await user.click(mail.getByRole('button', { name: 'Send test' }))
    expect(await mail.findByText('The mail server refused.')).toBeInTheDocument()
    await user.click(mail.getByRole('button', { name: 'Send test' }))
    expect(await mail.findByRole('button', { name: 'Sending…' })).toBeDisabled()
    sent.resolve({ sent_to: 'me@example.com', from: 'Acme <no-reply@acme.org>' })
    expect(await mail.findByText('Sent to me@example.com, from Acme <no-reply@acme.org>.')).toBeInTheDocument()
    expect(sentBody(fetch, 'POST /configuration/org-1/test-email/')).toEqual({ to: 'me@example.com' })
  })

  it('shows the platform’s own settings to a platform admin, and each scope only to its admins', async () => {
    const admin = show('platform')
    expect(await screen.findByRole('heading', { level: 1, name: 'Platform configuration' })).toBeInTheDocument()
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
    expect(await screen.findByText('Ready')).toBeInTheDocument()
    expect(card('SMTP').getByText('Not set up')).toBeInTheDocument()
    expect(within(card('SMTP').getByLabelText('Debug')).getByRole('option', { name: 'Default (off)' })).toBeInTheDocument()
    admin.unmount()

    const orgAdmin = show('platform', { 'GET /configuration/': [acme] })
    expect(await screen.findByText('Only platform admins can change platform settings.')).toBeInTheDocument()
    orgAdmin.unmount()

    show(undefined, { 'GET /configuration/': [platform] })
    expect(await screen.findByText('Only an organisation’s admins can change its settings.')).toBeInTheDocument()
  })

  it('shows why the settings did not load, without retrying', async () => {
    const { fetch } = show(undefined, { 'GET /configuration/org-1/': reply(500, { detail: 'Server error.' }) })
    expect(await screen.findByRole('alert')).toHaveTextContent('Server error.')
    expect(callsTo(fetch, 'GET /configuration/org-1/')).toHaveLength(1)
  })
})
