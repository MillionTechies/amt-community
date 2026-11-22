import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { event, hackathon, registration } from '../test/fixtures'
import { currentPath, renderApp } from '../test/render'
import { Cover, DateBlock, EventCard, HackathonCard, dateSpan, eventPlace, when } from './cards'

const local = (y: number, m: number, d: number, h = 9, min = 0) => new Date(y, m - 1, d, h, min).toISOString()

const card = (title: string) => within(screen.getByRole('link', { name: new RegExp(title) }))

describe('date and place', () => {
  it('shows a calendar leaf, a date span, a day and time, and where an event is', () => {
    render(
      <>
        <DateBlock iso={local(2026, 11, 30)} />
        <DateBlock iso={local(2026, 12, 2)} large />
      </>,
    )
    expect(screen.getByText('Nov')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()

    expect(dateSpan(local(2026, 11, 30, 9), local(2026, 11, 30, 17))).toBe('30 Nov 2026')
    expect(dateSpan(local(2026, 11, 30), local(2026, 12, 2))).toBe('30 Nov 2026 to 2 Dec 2026')
    expect(when(local(2026, 11, 28, 8))).toMatch(/^Sat,? 28 Nov · 08:00$/)

    expect(eventPlace(event({ delivery_mode: 'online' }))).toBe('Online')
    expect(eventPlace(event({ delivery_mode: 'hybrid', venue: 'iHub' }))).toBe('iHub or online')
    expect(eventPlace(event({ delivery_mode: 'hybrid', venue: '' }))).toBe('In person or online')
    expect(eventPlace(event({ delivery_mode: 'in_person', venue: 'iHub' }))).toBe('iHub')
    expect(eventPlace(event({ delivery_mode: 'in_person', venue: '' }))).toBe('Venue to be confirmed')
    expect(eventPlace(event({ delivery_mode: 'other', venue: 'Somewhere' }))).toBe('Somewhere')
  })
})

describe('Cover', () => {
  it('shows the organiser’s image instead of a drawn cover', () => {
    const { container } = render(<Cover image="https://cdn.test/a.png" kind="workshop" title="Demo" />)
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://cdn.test/a.png')
    expect(screen.queryByText('Demo')).not.toBeInTheDocument()
  })
})

describe('EventCard', () => {
  it('lists each event with its essentials, the member’s place and the seats left', async () => {
    const { user } = renderApp(
      <>
        <EventCard event={event({ registered_count: 3, attendee_preview: ['AK'], my_registration: registration(), spots_left: 0 })} />
        <EventCard event={event({ slug: 'b', title: 'Waitlist meetup', event_type: 'conference', my_registration: registration({ status: 'waitlisted' }) })} />
        <EventCard event={event({ slug: 'c', title: 'Cancelled talk', event_type: 'party', my_registration: registration({ status: 'cancelled' }), spots_left: 0 })} />
        <EventCard event={event({ slug: 'd', title: 'Last seat', spots_left: 1 })} />
        <EventCard event={event({ slug: 'e', title: 'Few seats', spots_left: 7 })} />
        <EventCard event={event({ slug: 'f', title: 'Big hall', spots_left: 50 })} />
        <EventCard event={event({ slug: 'g', title: 'Past webinar', status: 'completed', delivery_mode: 'online' })} />
      </>,
    )
    expect(card('React workshop').getByText('by Acme Labs · Nairobi Garage')).toBeInTheDocument()
    expect(card('React workshop').getByText('3 going')).toBeInTheDocument()
    expect(card('React workshop').getByText('Going')).toBeInTheDocument()
    expect(card('React workshop').queryByText('Full')).not.toBeInTheDocument()

    expect(card('Waitlist meetup').getByText('Waiting list')).toBeInTheDocument()
    expect(card('Waitlist meetup').getByText('Conference')).toBeInTheDocument()
    expect(card('Waitlist meetup').getByText('Be the first to join')).toBeInTheDocument()
    expect(card('Cancelled talk').getByText('Full')).toBeInTheDocument()
    expect(card('Cancelled talk').queryByText('Going')).not.toBeInTheDocument()
    expect(card('Last seat').getByText('1 seat left')).toBeInTheDocument()
    expect(card('Few seats').getByText('7 seats left')).toBeInTheDocument()
    expect(card('Big hall').queryByText(/left/)).not.toBeInTheDocument()
    expect(card('Past webinar').getByText('Completed')).toBeInTheDocument()
    expect(card('Past webinar').getByText('by Acme Labs · Online')).toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: /React workshop/ }))
    expect(currentPath()).toBe('/events/react-workshop')
  })
})

describe('HackathonCard', () => {
  it('lists each hackathon with its essentials, the member’s part and the top prize', async () => {
    const { user } = renderApp(
      <>
        <HackathonCard hackathon={hackathon({ participant_count: 5, team_count: 1, participant_preview: ['ZK'] })} />
        <HackathonCard
          hackathon={hackathon({
            slug: 'b',
            title: 'Judged hack',
            my_team_id: 4,
            is_judge: true,
            registration_open: true,
            venue: 'iHub',
            team_count: 3,
            participant_count: 9,
            prizes: [{ title: 'First', value: 'KES 50,000' }],
          })}
        />
        <HackathonCard hackathon={hackathon({ slug: 'c', title: 'Open hack', registration_open: true, prizes: [{ title: 'Swag', value: '' }] })} />
      </>,
    )
    expect(card('Climate hack').getByText('Open')).toBeInTheDocument()
    expect(card('Climate hack').getByText('by Acme Labs · Online')).toBeInTheDocument()
    expect(card('Climate hack').getByText('5 taking part in 1 team')).toBeInTheDocument()

    expect(card('Judged hack').getByText('Taking part')).toBeInTheDocument()
    expect(card('Judged hack').getByText('Judge')).toBeInTheDocument()
    expect(card('Judged hack').queryByText('Open to join')).not.toBeInTheDocument()
    expect(card('Judged hack').getByText('KES 50,000')).toBeInTheDocument()
    expect(card('Judged hack').getByText('by Acme Labs · iHub')).toBeInTheDocument()
    expect(card('Judged hack').getByText('9 taking part in 3 teams')).toBeInTheDocument()

    expect(card('Open hack').getByText('Open to join')).toBeInTheDocument()
    expect(card('Open hack').getByText('Swag')).toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: /Climate hack/ }))
    expect(currentPath()).toBe('/hackathons/climate-hack')
  })
})
