import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { signIn } from '../test/auth'
import { mockFetch, page, reply } from '../test/fetch'
import { hackathon, me, membership } from '../test/fixtures'
import { renderApp } from '../test/render'
import Hackathons from './Hackathons'

describe('Hackathons page', () => {
  it('lists hackathons and searches them', async () => {
    mockFetch({
      'GET /hackathons/?': page([hackathon()]),
      'GET /hackathons/?search=zzz': page([]),
    })
    const { user } = renderApp(<Hackathons />)
    expect(await screen.findByRole('heading', { name: 'Climate hack' })).toBeInTheDocument()
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Create hackathon' })).not.toBeInTheDocument()
    await user.type(screen.getByRole('searchbox', { name: 'Search hackathons' }), 'zzz')
    expect(await screen.findByText('No hackathons match your search.')).toBeInTheDocument()
  })

  it('says when there are none yet', async () => {
    mockFetch({ 'GET /hackathons/?': page([]) })
    renderApp(<Hackathons />)
    expect(await screen.findByText('No hackathons yet.')).toBeInTheDocument()
  })

  it('shows the error instead of an empty list when loading fails', async () => {
    mockFetch({ 'GET /hackathons/?': reply(500, { detail: 'Server down.' }) })
    renderApp(<Hackathons />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Server down.')
    expect(screen.queryByText('No hackathons yet.')).not.toBeInTheDocument()
  })

  it('lets hackathon managers create and see the ones they manage', async () => {
    signIn()
    mockFetch({
      'GET /me/': me({ organizations: [membership({ can_manage_hackathons: true })] }),
      'GET /hackathons/?': page([]),
      'GET /hackathons/?scope=managed': page([hackathon({ title: 'Mine' })]),
    })
    const { user } = renderApp(<Hackathons />)
    expect(await screen.findByRole('link', { name: 'Create hackathon' })).toHaveAttribute('href', '/manage/hackathons/new')
    await user.click(screen.getByRole('tab', { name: 'Hackathons I manage' }))
    expect(await screen.findByRole('heading', { name: 'Mine' })).toBeInTheDocument()
  })
})
