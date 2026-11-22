import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import type { CommunityEvent } from '../api'
import { event, registration } from '../test/fixtures'
import { AddToCalendar } from './AddToCalendar'

const open = async (e: CommunityEvent) => {
  const user = userEvent.setup()
  render(
    <>
      <AddToCalendar event={e} />
      <p>Elsewhere</p>
    </>,
  )
  await user.click(screen.getByRole('button', { name: 'Add to calendar' }))
  return user
}

const href = (name: string) => new URL(screen.getByRole('menuitem', { name }).getAttribute('href')!)

describe('AddToCalendar', () => {
  it('offers each calendar with the event filled in', async () => {
    await open(event())
    expect(screen.getByRole('button', { name: 'Add to calendar' })).toHaveAttribute('aria-expanded', 'true')

    const google = href('Google Calendar')
    expect(google.host).toBe('calendar.google.com')
    expect(google.searchParams.get('text')).toBe('React workshop')
    expect(google.searchParams.get('dates')).toBe('20261130T060000Z/20261130T090000Z')
    expect(google.searchParams.get('location')).toBe('Nairobi Garage')
    expect(google.searchParams.get('details')).toBe(`Build an app in a day.\n\nEvent page: ${location.origin}/events/react-workshop`)
    expect(screen.getByRole('menuitem', { name: 'Google Calendar' })).toHaveAttribute('target', '_blank')

    expect(href('Outlook.com').host).toBe('outlook.live.com')
    expect(href('Office 365').searchParams.get('startdt')).toBe('2026-11-30T06:00:00.000Z')
    expect(href('Yahoo Calendar').searchParams.get('et')).toBe('20261130T090000Z')

    const ics = screen.getByRole('menuitem', { name: 'Apple Calendar or other (.ics)' })
    expect(ics).toHaveAttribute('href', 'http://api.test/api/events/react-workshop/calendar.ics')
    expect(ics).not.toHaveAttribute('target')
  })

  it('gives a registered member their own calendar file', async () => {
    await open(event({ my_registration: registration({ ticket_code: 'T-42' }) }))
    expect(screen.getByRole('menuitem', { name: /\.ics/ })).toHaveAttribute('href', 'http://api.test/api/tickets/T-42/calendar.ics')
  })

  it('puts the meeting link and service in an online event', async () => {
    await open(
      event({
        delivery_mode: 'online',
        summary: '',
        online_url: 'https://meet.google.com/abc',
        meeting_provider: { id: 'google_meet', name: 'Google Meet' },
      }),
    )
    const google = href('Google Calendar')
    expect(google.searchParams.get('location')).toBe('https://meet.google.com/abc')
    expect(google.searchParams.get('details')).toMatch(/^Join on Google Meet: https:\/\/meet\.google\.com\/abc\n\nEvent page:/)
  })

  it('names a meeting link without a known service plainly', async () => {
    await open(event({ delivery_mode: 'hybrid', venue: '', online_url: 'https://example.com/room' }))
    expect(href('Google Calendar').searchParams.get('details')).toMatch(/^Join: https:\/\/example\.com\/room/)
  })

  it('says which service an online event uses before its link is shared', async () => {
    await open(event({ delivery_mode: 'online', meeting_provider: { id: 'zoom', name: 'Zoom' } }))
    expect(href('Google Calendar').searchParams.get('location')).toBe('Online (Zoom)')
  })

  it('says "Online" when nothing more is known', async () => {
    await open(event({ delivery_mode: 'online', venue: 'Ignored' }))
    expect(href('Yahoo Calendar').searchParams.get('in_loc')).toBe('Online')
  })

  it('closes on Escape, on a click outside, on a choice, or on the button again', async () => {
    const user = await open(event())
    await user.keyboard('a')
    await user.click(screen.getByRole('menu'))
    expect(screen.getByRole('menu')).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Add to calendar' }))
    await user.click(screen.getByText('Elsewhere'))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Add to calendar' }))
    screen.getByRole('menuitem', { name: /\.ics/ }).addEventListener('click', (e) => e.preventDefault())
    await user.click(screen.getByRole('menuitem', { name: /\.ics/ }))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Add to calendar' }))
    await user.click(screen.getByRole('button', { name: 'Add to calendar' }))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})
