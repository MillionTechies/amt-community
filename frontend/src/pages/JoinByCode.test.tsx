import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { auth, signIn } from '../test/auth'
import { mockFetch, reply, sentBody, sequence } from '../test/fetch'
import { currentPath, renderApp } from '../test/render'
import JoinByCode from './JoinByCode'

describe('Join with a code', () => {
  it('asks visitors to create an account or sign in first', async () => {
    const { user } = renderApp(<JoinByCode />, { route: '/join?code=482913' })
    await user.click(screen.getByRole('button', { name: 'Create an account' }))
    expect(auth.signinRedirect).toHaveBeenLastCalledWith(expect.objectContaining({ prompt: 'create' }))
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(auth.signinRedirect).toHaveBeenCalledTimes(2)
  })

  it('registers with a hackathon code and opens the workspace', async () => {
    signIn()
    const fetch = mockFetch({
      'POST /join/': sequence(reply(400, { code: 'No hackathon or team has this code.' }), { hackathon: 'climate-hack', team_id: null }),
    })
    const { user } = renderApp(<JoinByCode />, { route: '/join' })
    await user.type(screen.getByRole('textbox', { name: 'Code' }), '482913')
    await user.click(screen.getByRole('button', { name: 'Join' }))
    expect(await screen.findByText('No hackathon or team has this code.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Join' }))
    expect(await screen.findByText('You are registered')).toBeInTheDocument()
    expect(currentPath()).toBe('/hackathons/climate-hack/workspace')
    expect(sentBody(fetch, 'POST /join/')).toEqual({ code: '482913' })
  })

  it('joins a team with its code from the link', async () => {
    signIn()
    mockFetch({ 'POST /join/': { hackathon: 'climate-hack', team_id: 5 } })
    const { user } = renderApp(<JoinByCode />, { route: '/join?code=111222' })
    expect(screen.getByRole('textbox', { name: 'Code' })).toHaveValue('111222')
    await user.click(screen.getByRole('button', { name: 'Join' }))
    expect(await screen.findByText('You joined the team')).toBeInTheDocument()
  })
})
