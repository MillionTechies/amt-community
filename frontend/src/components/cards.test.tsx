import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { event, hackathon, registration } from '../test/fixtures'
import { currentPath, renderApp } from '../test/render'
import { Cover, DateBlock, EventCard, Faces, HackathonCard, Pill, dateSpan, eventPlace, grid, when } from './cards'

const local = (y: number, m: number, d: number, h = 9, min = 0) => new Date(y, m - 1, d, h, min).toISOString()

describe('DateBlock', () => {
  it('shows the month and day', () => {
    render(<DateBlock iso={local(2026, 11, 30)} />)
    expect(screen.getByText('Nov')).toBeInTheDocument()
    expect(screen.getByText('30')).toHaveClass('text-lg')
  })

  it('can be large', () => {
    render(<DateBlock iso={local(2026, 11, 30)} large />)
    expect(screen.getByText('30')).toHaveClass('text-2xl')
  })
})

describe('date and place text', () => {
  it('gives one date for a single day and both for longer', () => {
    expect(dateSpan(local(2026, 11, 30, 9), local(2026, 11, 30, 17))).toBe('30 Nov 2026')
    expect(dateSpan(local(2026, 11, 30), local(2026, 12, 2))).toBe('30 Nov 2026 to 2 Dec 2026')
  })

  it('gives the day and time', () => {
    expect(when(local(2026, 11, 28, 8))).toMatch(/^Sat,? 28 Nov · 08:00$/)
  })

  it('says where an event is for each way of attending', () => {
    expect(eventPlace(event({ delivery_mode: 'online' }))).toBe('Online')
    expect(eventPlace(event({ delivery_mode: 'hybrid', venue: 'iHub' }))).toBe('iHub or online')
    expect(eventPlace(event({ delivery_mode: 'hybrid', venue: '' }))).toBe('In person or online')
    expect(eventPlace(event({ delivery_mode: 'in_person', venue: 'iHub' }))).toBe('iHub')
    expect(eventPlace(event({ delivery_mode: 'in_person', venue: '' }))).toBe('Venue to be confirmed')
    expect(eventPlace(event({ delivery_mode: 'other', venue: 'Somewhere' }))).toBe('Somewhere')
  })

  it('exports the card grid layout', () => {
    expect(grid).toContain('grid')
  })
})

describe('Cover', () => {
  it('shows the organiser’s image', () => {
    const { container } = render(<Cover image="https://cdn.test/a.png" kind="workshop" title="Demo" />)
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://cdn.test/a.png')
    expect(screen.queryByText('Demo')).not.toBeInTheDocument()
  })

  it('draws a cover from the kind and title when there is no image', () => {
    render(<Cover image="" kind="conference" title="DevFest" className="rounded-none"><Pill>Free</Pill></Cover>)
    expect(screen.getByText('DevFest')).toBeInTheDocument()
    expect(screen.getByText('Conference')).toBeInTheDocument()
    expect(screen.getByText('Free')).toBeInTheDocument()
  })

  it('draws a default cover for an unknown kind', () => {
    const { container } = render(<Cover image="" kind="party" title="Party" />)
    expect(screen.getByText('Party', { selector: 'p:last-child' })).toBeInTheDocument()
    expect(container.querySelector('.bg-brand-500\\/45')).toBeInTheDocument()
  })
})

describe('Faces', () => {
  it('shows initials and how many are going', () => {
    render(<Faces initials={['AB', 'CD']} count={12} noun="going" />)
    expect(screen.getByText('AB')).toBeInTheDocument()
    expect(screen.getByText('12 going')).toBeInTheDocument()
  })

  it('invites the first person to join', () => {
    render(<Faces initials={[]} count={0} noun="going" />)
    expect(screen.getByText('Be the first to join')).toBeInTheDocument()
  })
})

describe('EventCard', () => {
  const pills = () => within(screen.getByRole('link'))

  it('links to the event and shows its essentials', async () => {
    const { user } = renderApp(
      <EventCard event={event({ title: 'React workshop', registered_count: 3, attendee_preview: ['AK'] })} />,
    )
    expect(screen.getByRole('heading', { name: 'React workshop' })).toBeInTheDocument()
    expect(screen.getByText('by Acme Labs · Nairobi Garage')).toBeInTheDocument()
    expect(screen.getByText('3 going')).toBeInTheDocument()
    await user.click(screen.getByRole('link'))
    expect(currentPath()).toBe('/events/react-workshop')
  })

  it('shows that the member is going', () => {
    renderApp(<EventCard event={event({ my_registration: registration(), spots_left: 0 })} />)
    expect(pills().getByText('Going')).toBeInTheDocument()
    expect(pills().queryByText('Full')).not.toBeInTheDocument()
  })

  it('shows that the member is on the waiting list', () => {
    renderApp(<EventCard event={event({ my_registration: registration({ status: 'waitlisted' }) })} />)
    expect(pills().getByText('Waiting list')).toBeInTheDocument()
  })

  it('treats a cancelled registration as not registered', () => {
    renderApp(<EventCard event={event({ my_registration: registration({ status: 'cancelled' }), spots_left: 0 })} />)
    expect(pills().getByText('Full')).toBeInTheDocument()
    expect(pills().queryByText('Going')).not.toBeInTheDocument()
  })

  it('warns when few seats are left', () => {
    const { unmount } = renderApp(<EventCard event={event({ spots_left: 1 })} />)
    expect(pills().getByText('1 seat left')).toBeInTheDocument()
    unmount()
    renderApp(<EventCard event={event({ spots_left: 7 })} />)
    expect(pills().getByText('7 seats left')).toBeInTheDocument()
  })

  it('says nothing about seats when plenty are left', () => {
    renderApp(<EventCard event={event({ spots_left: 50 })} />)
    expect(pills().queryByText(/left/)).not.toBeInTheDocument()
  })

  it('marks events that are not open and online events', () => {
    renderApp(<EventCard event={event({ status: 'completed', delivery_mode: 'online' })} />)
    expect(pills().getByText('Completed')).toBeInTheDocument()
    expect(pills().getByText('Online')).toBeInTheDocument()
    expect(screen.getByText('by Acme Labs · Online')).toBeInTheDocument()
  })
})

describe('HackathonCard', () => {
  it('links to the hackathon and shows its essentials', async () => {
    const { user } = renderApp(
      <HackathonCard hackathon={hackathon({ participant_count: 5, team_count: 1, participant_preview: ['ZK'] })} />,
    )
    expect(screen.getByRole('heading', { name: 'Climate hack' })).toBeInTheDocument()
    expect(screen.getByText('Open')).toBeInTheDocument()
    expect(screen.getByText('by Acme Labs · Online')).toBeInTheDocument()
    expect(screen.getByText('5 taking part in 1 team')).toBeInTheDocument()
    await user.click(screen.getByRole('link'))
    expect(currentPath()).toBe('/hackathons/climate-hack')
  })

  it('shows the member’s team, judging and the top prize value', () => {
    renderApp(
      <HackathonCard
        hackathon={hackathon({
          my_team_id: 4,
          is_judge: true,
          registration_open: true,
          venue: 'iHub',
          team_count: 3,
          participant_count: 9,
          prizes: [{ title: 'First', value: 'KES 50,000' }],
        })}
      />,
    )
    expect(screen.getByText('Taking part')).toBeInTheDocument()
    expect(screen.getByText('Judge')).toBeInTheDocument()
    expect(screen.queryByText('Open to join')).not.toBeInTheDocument()
    expect(screen.getByText('KES 50,000')).toBeInTheDocument()
    expect(screen.getByText('by Acme Labs · iHub')).toBeInTheDocument()
    expect(screen.getByText('9 taking part in 3 teams')).toBeInTheDocument()
  })

  it('invites people to join and falls back to the prize title', () => {
    renderApp(<HackathonCard hackathon={hackathon({ registration_open: true, prizes: [{ title: 'Swag', value: '' }] })} />)
    expect(screen.getByText('Open to join')).toBeInTheDocument()
    expect(screen.getByText('Swag')).toBeInTheDocument()
    expect(screen.getByText('Be the first to join')).toBeInTheDocument()
  })
})
