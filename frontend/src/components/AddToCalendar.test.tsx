import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import type { CommunityEvent } from '../api'
import { event, registration } from '../test/fixtures'
import { AddToCalendar } from './AddToCalendar'

const open = async (e: CommunityEvent) => {
  const user = userEvent.setup()
  const { rerender } = render(<AddToCalendar event={e} />)
  await user.click(screen.getByRole('button', { name: 'Add to calendar' }))
  return { user, show: (next: CommunityEvent) => rerender(<AddToCalendar event={next} />) }
}

const href = (name: string) => new URL(screen.getByRole('menuitem', { name }).getAttribute('href')!)
const google = (param: string) => href('Google Calendar').searchParams.get(param)

describe('AddToCalendar', () => {
  it('offers each calendar with the event filled in, and a registered member their own file', async () => {
    const { show } = await open(event())
    expect(google('text')).toBe('React workshop')
    expect(google('dates')).toBe('20261130T060000Z/20261130T090000Z')
    expect(google('location')).toBe('Nairobi Garage')
    expect(google('details')).toBe(`Build an app in a day.\n\nEvent page: ${location.origin}/events/react-workshop`)
    expect(href('Outlook.com').host).toBe('outlook.live.com')
    expect(href('Office 365').searchParams.get('startdt')).toBe('2026-11-30T06:00:00.000Z')
    expect(href('Yahoo Calendar').searchParams.get('et')).toBe('20261130T090000Z')
    expect(screen.getByRole('menuitem', { name: /\.ics/ })).toHaveAttribute('href', 'http://api.test/api/events/react-workshop/calendar.ics')

    show(event({ my_registration: registration({ ticket_code: 'T-42' }) }))
    expect(screen.getByRole('menuitem', { name: /\.ics/ })).toHaveAttribute('href', 'http://api.test/api/tickets/T-42/calendar.ics')
  })

  it('tells people how to join an online event', async () => {
    const { show } = await open(
      event({ delivery_mode: 'online', summary: '', online_url: 'https://meet.google.com/abc', meeting_provider: { id: 'google_meet', name: 'Google Meet' } }),
    )
    expect(google('location')).toBe('https://meet.google.com/abc')
    expect(google('details')).toMatch(/^Join on Google Meet: https:\/\/meet\.google\.com\/abc\n\nEvent page:/)

    show(event({ delivery_mode: 'hybrid', venue: '', online_url: 'https://example.com/room' }))
    expect(google('details')).toMatch(/^Join: https:\/\/example\.com\/room/)

    show(event({ delivery_mode: 'online', meeting_provider: { id: 'zoom', name: 'Zoom' } }))
    expect(google('location')).toBe('Online (Zoom)')

    show(event({ delivery_mode: 'online', venue: 'Ignored' }))
    expect(google('location')).toBe('Online')
  })

  it('closes on Escape, on a click outside, on a choice, or on the button again', async () => {
    const user = userEvent.setup()
    render(
      <>
        <AddToCalendar event={event()} />
        <p>Elsewhere</p>
      </>,
    )
    const button = screen.getByRole('button', { name: 'Add to calendar' })
    await user.click(button)
    await user.keyboard('a')
    await user.click(screen.getByRole('menu'))
    expect(screen.getByRole('menu')).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()

    await user.click(button)
    await user.click(screen.getByText('Elsewhere'))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()

    await user.click(button)
    screen.getByRole('menuitem', { name: /\.ics/ }).addEventListener('click', (e) => e.preventDefault())
    await user.click(screen.getByRole('menuitem', { name: /\.ics/ }))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()

    await user.click(button)
    await user.click(button)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})
