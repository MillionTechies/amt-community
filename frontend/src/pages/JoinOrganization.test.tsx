import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { auth, signIn } from '../test/auth'
import { mockFetch, reply, sentBody, sequence } from '../test/fetch'
import { organizationApplication } from '../test/fixtures'
import { renderApp } from '../test/render'
import JoinOrganization from './JoinOrganization'

const LIST = 'GET /organizations/applications/'
const SEND = 'POST /organizations/applications/'

describe('bringing an organisation onto Community', () => {
  it('explains who can join and asks visitors to sign in first', async () => {
    const { user } = renderApp(<JoinOrganization />, { route: '/organizations/join' })
    expect(screen.getByRole('heading', { name: 'Bring your organisation to the community' })).toBeInTheDocument()
    const who = within(screen.getByRole('region', { name: 'Who can join' }))
    expect(who.getByText('University, college or school')).toBeInTheDocument()
    expect(who.getByText('Tech community')).toBeInTheDocument()
    expect(who.getByText('Club or student group')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'What you get' })).getByText('Hackathons')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'How it works' })).getAllByRole('listitem')).toHaveLength(3)

    await user.click(screen.getByRole('button', { name: 'Create an account' }))
    expect(auth.signinRedirect).toHaveBeenLastCalledWith(expect.objectContaining({ prompt: 'create' }))
    await user.click(screen.getByRole('button', { name: 'Sign in to apply' }))
    expect(auth.signinRedirect).toHaveBeenLastCalledWith(expect.not.objectContaining({ prompt: 'create' }))
    expect(screen.queryByRole('button', { name: 'Send application' })).not.toBeInTheDocument()
  })

  it('sends an application and confirms it', async () => {
    signIn()
    const fetch = mockFetch({
      [LIST]: sequence([], [organizationApplication({ name: 'PyData Nairobi', kind_label: 'Tech community' })]),
      [SEND]: reply(201, organizationApplication({ name: 'PyData Nairobi' })),
    })
    const { user } = renderApp(<JoinOrganization />, { route: '/organizations/join' })

    await user.type(await screen.findByRole('textbox', { name: 'Organisation name' }), 'PyData Nairobi')
    await user.selectOptions(screen.getByRole('combobox', { name: 'What kind of organisation is it?' }), 'community')
    await user.type(screen.getByRole('textbox', { name: 'Website or social page' }), 'https://pydata.org/nairobi')
    await user.type(screen.getByRole('textbox', { name: 'Where are you based?' }), 'Nairobi')
    await user.type(screen.getByRole('textbox', { name: 'About your organisation' }), 'Python and data folks.')
    await user.type(screen.getByRole('textbox', { name: 'What would you like to run here?' }), 'Monthly meetups')
    await user.type(screen.getByRole('textbox', { name: 'Phone number' }), '0700')
    await user.click(screen.getByRole('button', { name: 'Send application' }))

    expect(await screen.findByText('Application sent')).toBeInTheDocument()
    expect(screen.getByText(/will let you know as soon as PyData Nairobi is reviewed/)).toBeInTheDocument()
    expect(sentBody(fetch, SEND)).toEqual({
      name: 'PyData Nairobi', kind: 'community', website: 'https://pydata.org/nairobi', location: 'Nairobi',
      about: 'Python and data folks.', plans: 'Monthly meetups', contact_phone: '0700',
    })
    // The list refreshes with the new application.
    const mine = await screen.findByRole('heading', { name: 'Your applications' })
    expect(mine.parentElement).toHaveTextContent('Waiting for review')

    await user.click(screen.getByRole('button', { name: 'Apply for another organisation' }))
    expect(screen.getByRole('textbox', { name: 'Organisation name' })).toHaveValue('')
  })

  it('says it is sending while the application is on its way', async () => {
    signIn()
    mockFetch({ [LIST]: [], [SEND]: () => new Promise(() => {}) })
    const { user } = renderApp(<JoinOrganization />, { route: '/organizations/join' })
    await user.type(await screen.findByRole('textbox', { name: 'Organisation name' }), 'PyData')
    await user.selectOptions(screen.getByRole('combobox', { name: 'What kind of organisation is it?' }), 'community')
    await user.type(screen.getByRole('textbox', { name: 'About your organisation' }), 'Python folks.')
    await user.click(screen.getByRole('button', { name: 'Send application' }))
    expect(await screen.findByRole('button', { name: 'Sending…' })).toBeDisabled()
  })

  it('shows what is wrong with the form', async () => {
    signIn()
    mockFetch({ [LIST]: [], [SEND]: reply(400, { name: ['JKUAT is already on Community.'] }) })
    const { user } = renderApp(<JoinOrganization />, { route: '/organizations/join' })
    await user.type(await screen.findByRole('textbox', { name: 'Organisation name' }), 'JKUAT')
    await user.selectOptions(screen.getByRole('combobox', { name: 'What kind of organisation is it?' }), 'institution')
    await user.type(screen.getByRole('textbox', { name: 'About your organisation' }), 'A university.')
    await user.click(screen.getByRole('button', { name: 'Send application' }))
    expect(await screen.findAllByText('JKUAT is already on Community.')).toHaveLength(2)
  })

  it('shows how earlier applications went', async () => {
    signIn()
    mockFetch({
      [LIST]: [
        organizationApplication({ id: 2, name: 'Moi University', status: 'approved', review_note: 'Welcome!', organization_id: 'kc-moi' }),
        organizationApplication({ id: 1, name: 'Old Club', status: 'declined', review_note: 'Use an official email.' }),
      ],
    })
    const { user } = renderApp(<JoinOrganization />, { route: '/organizations/join' })
    const [approved, declined] = within((await screen.findByRole('heading', { name: 'Your applications' })).parentElement!).getAllByRole('listitem')
    expect(approved).toHaveTextContent('Approved')
    expect(approved).toHaveTextContent('Welcome!')
    expect(declined).toHaveTextContent('Declined')
    expect(declined).toHaveTextContent('Use an official email.')
    expect(within(declined).queryByRole('button')).not.toBeInTheDocument()

    // Signing in again picks up the new organisation in the member's token.
    await user.click(within(approved).getByRole('button', { name: 'Open the organiser console' }))
    expect(auth.signinRedirect).toHaveBeenCalled()
  })

  it('explains when applications cannot load', async () => {
    signIn()
    mockFetch({ [LIST]: reply(500, { detail: 'Try again later.' }) })
    renderApp(<JoinOrganization />, { route: '/organizations/join' })
    expect(await screen.findByRole('alert')).toHaveTextContent('Try again later.')
  })
})
