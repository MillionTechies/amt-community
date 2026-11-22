/**
 * Render a component the way the app does: React Query (no retries), a router, and the
 * in-app dialogs and toasts. Auth comes from ./auth (call signIn() first for a member).
 *
 *   const { user } = renderApp(<EventCard event={event()} />, { route: '/events' })
 *   await user.click(screen.getByRole('link', { name: /React workshop/ }))
 *   expect(currentPath()).toBe('/events/react-workshop')
 *
 * For a page that reads URL params, pass `path`: renderApp(<EventDetail />, { route: '/events/demo', path: '/events/:slug' }).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

import { FeedbackProvider } from '../components/feedback'
import { LocationProbe } from './LocationProbe'

interface Options {
  /** The address the router starts on. */
  route?: string
  /** A route pattern for the element, when it reads params. */
  path?: string
  queryClient?: QueryClient
}

// A query client like the app's, minus retries.
export const testQueryClient = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })

// The address the router is on now (path and query string).
export const currentPath = () => screen.getByTestId('location').textContent

// Render `ui` inside the app's providers; returns Testing Library's result plus a user-event `user` and the query client.
export function renderApp(ui: ReactElement, { route = '/', path, queryClient = testQueryClient() }: Options = {}) {
  const element = path ? (
    <Routes>
      <Route path={path} element={ui} />
      <Route path="*" element={null} />
    </Routes>
  ) : ui
  const user = userEvent.setup()
  const result = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[route]}>
        <FeedbackProvider>
          {element}
          <LocationProbe />
        </FeedbackProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { ...result, user, queryClient }
}
