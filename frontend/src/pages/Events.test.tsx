import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { signIn } from '../test/auth'
import { mockFetch, page, reply } from '../test/fetch'
import { event, me, membership } from '../test/fixtures'
import { renderApp } from '../test/render'
import Events, { EVENT_TYPES, EVENT_TYPE_LABELS } from './Events'

describe('Events page', () => {
  it('names every event type', () => {
    expect(EVENT_TYPES.map((t) => EVENT_TYPE_LABELS[t])).toContain('Developer meetup')
  })

  it('lists upcoming events and filters them', async () => {
    mockFetch({
      'GET /events/?page=1&when=upcoming': page([event()]),
      'GET /events/?page=1&when=upcoming&event_type=meetup': page([]),
      'GET /events/?page=1&when=upcoming&within=today': page([]),
      'GET /events/?page=1&when=upcoming&delivery_mode=online': page([]),
      'GET /events/?page=1&when=upcoming&search=x': page([]),
    })
    const { user } = renderApp(<Events />)
    expect(await screen.findByRole('heading', { name: 'React workshop' })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Events I manage' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument()

    const meetup = screen.getByRole('button', { name: 'Developer meetup' })
    await user.click(meetup)
    expect(meetup).toHaveAttribute('aria-pressed', 'true')
    expect(await screen.findByText('No events match. Try another day or type.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'All events' }))

    const today = screen.getByRole('button', { name: 'Today' })
    await user.click(today)
    expect(today).toHaveAttribute('aria-pressed', 'true')
    expect(await screen.findByText('No events match. Try another day or type.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Any day' }))

    await user.click(screen.getByRole('button', { name: 'Online only' }))
    expect(await screen.findByText('No events match. Try another day or type.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Online only' }))
    expect(await screen.findByRole('heading', { name: 'React workshop' })).toBeInTheDocument()

    await user.type(screen.getByRole('searchbox', { name: 'Search events' }), 'x')
    expect(await screen.findByText('No events match. Try another day or type.')).toBeInTheDocument()
  })

  it('shows past events without the day filters', async () => {
    mockFetch({
      'GET /events/?page=1&when=upcoming': page([event()]),
      'GET /events/?page=1&when=past': page([]),
    })
    const { user } = renderApp(<Events />)
    await user.click(screen.getByRole('tab', { name: 'Past' }))
    expect(await screen.findByText('No past events.')).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'When' })).not.toBeInTheDocument()
  })

  it('pages through long lists', async () => {
    mockFetch({
      'GET /events/?page=1&when=upcoming': page([event({ title: 'First' })], 'next'),
      'GET /events/?page=2&when=upcoming': page([event({ slug: 'b', title: 'Second' })]),
    })
    const { user } = renderApp(<Events />)
    expect(await screen.findByRole('heading', { name: 'First' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByRole('heading', { name: 'Second' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Previous' }))
    expect(await screen.findByRole('heading', { name: 'First' })).toBeInTheDocument()
  })

  it('shows the error instead of an empty list when loading fails', async () => {
    mockFetch({ 'GET /events/?page=1&when=upcoming': reply(500, { detail: 'Server down.' }) })
    renderApp(<Events />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Server down.')
    expect(screen.queryByText('No upcoming events.')).not.toBeInTheDocument()
  })

  it('lets event organisers create and see the events they manage', async () => {
    signIn()
    mockFetch({
      'GET /me/': me({ organizations: [membership({ can_manage_events: true })] }),
      'GET /events/?page=1&when=upcoming': page([]),
      'GET /events/?page=1&scope=managed': page([]),
    })
    const { user } = renderApp(<Events />)
    expect(await screen.findByRole('link', { name: 'Create event' })).toHaveAttribute('href', '/manage/events/new')
    expect(await screen.findByText('No upcoming events.')).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Events I manage' }))
    expect(await screen.findByText('You have not created any events yet.')).toBeInTheDocument()
  })
})
