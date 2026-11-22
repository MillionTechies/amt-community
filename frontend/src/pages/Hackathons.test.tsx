import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { signIn } from '../test/auth'
import { mockFetch, page, reply } from '../test/fetch'
import { hackathon, me, membership } from '../test/fixtures'
import { renderApp } from '../test/render'
import Hackathons from './Hackathons'

describe('Hackathons page', () => {
  it('lists hackathons, searches them, and shows a failed search', async () => {
    mockFetch({
      'GET /hackathons/?': page([hackathon()]),
      'GET /hackathons/?search=zzz': page([]),
      'GET /hackathons/?search=zzzz': reply(500, { detail: 'Server down.' }),
    })
    const { user } = renderApp(<Hackathons />)
    expect(await screen.findByRole('heading', { name: 'Climate hack' })).toBeInTheDocument()
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Create hackathon' })).not.toBeInTheDocument()
    await user.type(screen.getByRole('searchbox', { name: 'Search hackathons' }), 'zzz')
    expect(await screen.findByText('No hackathons match your search.')).toBeInTheDocument()

    // A failed load shows the error, not an empty list.
    await user.type(screen.getByRole('searchbox', { name: 'Search hackathons' }), 'z')
    expect(await screen.findByRole('alert')).toHaveTextContent('Server down.')
    expect(screen.queryByText('No hackathons match your search.')).not.toBeInTheDocument()
  })

  it('lets hackathon managers create and see the ones they manage when none are public', async () => {
    signIn()
    mockFetch({
      'GET /me/': me({ organizations: [membership({ can_manage_hackathons: true })] }),
      'GET /hackathons/?': page([]),
      'GET /hackathons/?scope=managed': page([hackathon({ title: 'Mine' })]),
    })
    const { user } = renderApp(<Hackathons />)
    expect(await screen.findByRole('link', { name: 'Create hackathon' })).toHaveAttribute('href', '/manage/hackathons/new')
    expect(await screen.findByText('No hackathons yet.')).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Hackathons I manage' }))
    expect(await screen.findByRole('heading', { name: 'Mine' })).toBeInTheDocument()
  })
})
