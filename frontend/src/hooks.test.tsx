import { useQuery } from '@tanstack/react-query'
import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { api } from './api'
import { useAct, useMe, useOrganiserSignIn, useSignIn, useSignUp } from './hooks'
import { auth, signIn } from './test/auth'
import { me } from './test/fixtures'
import { callsTo, mockFetch, reply } from './test/fetch'
import { renderApp } from './test/render'

function WhoAmI() {
  const member = useMe()
  return <p>{member ? `Hello ${member.full_name}` : 'Signed out'}</p>
}

describe('useMe', () => {
  it('asks nothing of the API when signed out', () => {
    const fetch = mockFetch({})
    renderApp(<WhoAmI />)
    expect(screen.getByText('Signed out')).toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('loads the signed-in member', async () => {
    signIn()
    mockFetch({ 'GET /me/': me({ full_name: 'Wanjiru Kamau' }) })
    renderApp(<WhoAmI />)
    expect(await screen.findByText('Hello Wanjiru Kamau')).toBeInTheDocument()
  })
})

function Counter() {
  const count = useQuery({ queryKey: ['count'], queryFn: () => api<{ n: number }>('/count/') })
  const bump = useAct((by: number) => api('/count/', { method: 'POST', body: { by } }))
  return (
    <div>
      <p>Count: {count.data?.n ?? '…'}</p>
      <button type="button" onClick={() => bump.mutate(1)}>Bump</button>
    </div>
  )
}

describe('useAct', () => {
  it('runs the change, then refreshes what is on screen', async () => {
    let n = 1
    const fetch = mockFetch({
      'GET /count/': () => ({ n }),
      'POST /count/': () => {
        n += 1
        return reply(204)
      },
    })
    const { user } = renderApp(<Counter />)
    expect(await screen.findByText('Count: 1')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Bump' }))
    expect(await screen.findByText('Count: 2')).toBeInTheDocument()
    expect(callsTo(fetch, 'GET /count/')).toHaveLength(2)
  })
})

function SignInButtons() {
  const signInHere = useSignIn()
  const organiser = useOrganiserSignIn()
  const signUp = useSignUp()
  return (
    <>
      <button type="button" onClick={signInHere}>Sign in</button>
      <button type="button" onClick={organiser}>Organiser sign in</button>
      <button type="button" onClick={signUp}>Sign up</button>
    </>
  )
}

describe('sign-in hooks', () => {
  it('return to the current page, the console, or the sign-up form', async () => {
    window.history.replaceState({}, '', '/events/demo')
    const { user } = renderApp(<SignInButtons />)
    const origin = window.location.origin

    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(auth.signinRedirect).toHaveBeenLastCalledWith({ redirect_uri: `${origin}/events/demo` })

    await user.click(screen.getByRole('button', { name: 'Organiser sign in' }))
    expect(auth.signinRedirect).toHaveBeenLastCalledWith({ redirect_uri: `${origin}/manage` })

    await user.click(screen.getByRole('button', { name: 'Sign up' }))
    expect(auth.signinRedirect).toHaveBeenLastCalledWith({ redirect_uri: `${origin}/events/demo`, prompt: 'create' })
  })
})
