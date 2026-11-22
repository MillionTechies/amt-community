import { useQuery } from '@tanstack/react-query'
import { screen } from '@testing-library/react'
import { useAuth } from 'react-oidc-context'
import { useParams } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { api } from '../api'
import { auth, signIn } from './auth'
import { mockFetch } from './fetch'
import { currentPath, renderApp } from './render'

function Slug() {
  const { slug } = useParams()
  return <p>Slug: {slug}</p>
}

function Stats() {
  const stats = useQuery({ queryKey: ['stats'], queryFn: () => api('/stats/') })
  return <p>{stats.error?.message}</p>
}

function Who() {
  const { user } = useAuth()
  return <p>{user?.profile.name ?? 'Visitor'}</p>
}

describe('test helpers', () => {
  it('render at a route and read its params', () => {
    renderApp(<Slug />, { route: '/events/demo?tab=people', path: '/events/:slug' })
    expect(screen.getByText('Slug: demo')).toBeInTheDocument()
    expect(currentPath()).toBe('/events/demo?tab=people')
  })

  it('answer an unmocked request with a 404 naming it', async () => {
    mockFetch({})
    renderApp(<Stats />)
    expect(await screen.findByText('No mock for GET /stats/')).toBeInTheDocument()
  })

  it('sign a member in and out between tests', () => {
    expect(auth.isAuthenticated).toBe(false)
    signIn({ name: 'Wanjiru' })
    renderApp(<Who />)
    expect(screen.getByText('Wanjiru')).toBeInTheDocument()
  })
})
