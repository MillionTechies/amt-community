import { useQuery } from '@tanstack/react-query'
import { screen } from '@testing-library/react'
import { useAuth } from 'react-oidc-context'
import { useParams } from 'react-router-dom'
import { expect, it } from 'vitest'

import { api } from '../api'
import { auth, signIn } from './auth'
import { mockFetch } from './fetch'
import { currentPath, renderApp } from './render'

function Page() {
  const { slug } = useParams()
  const { user } = useAuth()
  const stats = useQuery({ queryKey: ['stats'], queryFn: () => api('/stats/') })
  return (
    <>
      <p>Slug: {slug}</p>
      <p>{user?.profile.name}</p>
      <p>{stats.error?.message}</p>
    </>
  )
}

it('renders at a route as a signed-in member, answering unmocked requests with a 404 naming them', async () => {
  // setup.ts signs everyone out after each test.
  expect(auth.isAuthenticated).toBe(false)
  signIn({ name: 'Wanjiru' })
  mockFetch({})
  renderApp(<Page />, { route: '/events/demo?tab=people', path: '/events/:slug' })
  expect(screen.getByText('Slug: demo')).toBeInTheDocument()
  expect(screen.getByText('Wanjiru')).toBeInTheDocument()
  expect(currentPath()).toBe('/events/demo?tab=people')
  expect(await screen.findByText('No mock for GET /stats/')).toBeInTheDocument()
})
