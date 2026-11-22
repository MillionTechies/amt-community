import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { auth, signIn } from '../test/auth'
import { mockFetch, reply, sentBody } from '../test/fetch'
import { me, membership } from '../test/fixtures'
import { renderApp } from '../test/render'
import Profile from './Profile'

describe('Profile page', () => {
  it('waits for the member to load', () => {
    renderApp(<Profile />)
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()
  })

  it('fills the form from the account and saves changes', async () => {
    signIn()
    const fetch = mockFetch({
      'GET /me/': me({ full_name: 'Wanjiru Kamau', headline: 'Student', skills: ['Python', 'React'], github_url: 'https://github.com/w' }),
      'PATCH /me/': me(),
    })
    const { user } = renderApp(<Profile />)
    expect(await screen.findByText('Wanjiru Kamau')).toBeInTheDocument()
    expect(screen.getByText('member@example.com')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Headline' })).toHaveValue('Student')
    expect(screen.getByRole('textbox', { name: 'Skills' })).toHaveValue('Python, React')
    expect(screen.queryByText('Platform administrator')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Organiser console/ })).not.toBeInTheDocument()

    await user.type(screen.getByRole('textbox', { name: 'University or organisation' }), 'UoN')
    await user.type(screen.getByRole('textbox', { name: 'About you' }), 'I build things.')
    await user.type(screen.getByRole('textbox', { name: 'Skills' }), ', , Go')
    await user.type(screen.getByRole('textbox', { name: 'LinkedIn' }), 'https://linkedin.com/in/w')
    await user.clear(screen.getByRole('textbox', { name: 'GitHub' }))
    await user.click(screen.getByRole('button', { name: 'Save profile' }))

    expect(await screen.findByText('Profile saved.')).toBeInTheDocument()
    expect(sentBody(fetch, 'PATCH /me/')).toEqual({
      headline: 'Student',
      bio: 'I build things.',
      institution: 'UoN',
      skills: ['Python', 'React', 'Go'],
      github_url: '',
      linkedin_url: 'https://linkedin.com/in/w',
    })
  })

  it('shows what the API rejected next to each field', async () => {
    signIn()
    mockFetch({
      'GET /me/': me(),
      'PATCH /me/': reply(400, { github_url: ['Enter a valid URL.'] }),
    })
    const { user } = renderApp(<Profile />)
    await user.click(await screen.findByRole('button', { name: 'Save profile' }))
    const alerts = await screen.findAllByRole('alert')
    expect(alerts.map((a) => a.textContent)).toEqual(['Enter a valid URL.', 'Enter a valid URL.'])
    expect(screen.queryByText('Profile saved.')).not.toBeInTheDocument()
  })

  it('lists organisations and roles, with links to the organiser and platform areas', async () => {
    signIn()
    mockFetch({
      'GET /me/': me({
        full_name: '',
        is_platform_admin: true,
        organizations: [
          membership({ id: 'a', name: 'Acme Labs', is_admin: true }),
          membership({ id: 'b', name: 'Beta Club', roles: ['event_organiser'], can_manage_events: true }),
        ],
      }),
    })
    const { user } = renderApp(<Profile />)
    expect(await screen.findByText('Member')).toBeInTheDocument()
    expect(screen.getByText('Platform administrator')).toBeInTheDocument()
    expect(screen.getByText('Acme Labs').closest('li')).toHaveTextContent('Admin')
    expect(screen.getByText('Beta Club').closest('li')).toHaveTextContent('Event organiser')
    expect(screen.getByRole('link', { name: 'Organiser console' })).toHaveAttribute('href', '/manage')
    expect(screen.getByRole('link', { name: 'Platform admin' })).toHaveAttribute('href', '/platform')
    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(auth.signoutRedirect).toHaveBeenCalled()
  })
})
