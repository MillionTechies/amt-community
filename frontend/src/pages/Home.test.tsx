import { fireEvent, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { formatDate } from '../components/ui'
import { auth, signIn } from '../test/auth'
import { mockFetch, page } from '../test/fetch'
import { event, hackathon, me, membership } from '../test/fixtures'
import { renderApp } from '../test/render'
import Home from './Home'

const EVENTS = 'GET /events/?when=upcoming&status=published&ordering=starts_at'
const HACKATHONS = 'GET /hackathons/'
const STATS = 'GET /stats/'

const stats = { members: 1200, events: 0, check_ins: 340, hackathons: 0, projects: 0, organizations: 3 }

const live = () => screen.getByText('Happening in the community').parentElement!
const featuredCard = () => screen.getAllByRole('link').find((l) => l.querySelector('dl'))!

describe('Home page', () => {
  it('shows visitors what is on and invites them to join', async () => {
    mockFetch({
      [EVENTS]: page([
        event({ slug: 'a', title: 'Go meetup', event_type: 'meetup', registered_count: 7 }),
        event({ slug: 'b', title: 'Full house', spots_left: 0, capacity: 20 }),
        event({ slug: 'c', title: 'Last seat', spots_left: 1, capacity: 20 }),
        event({ slug: 'd', title: 'Plenty left', spots_left: 12, capacity: 20, delivery_mode: 'online' }),
      ]),
      [HACKATHONS]: page([
        hackathon({ slug: 'draft', title: 'Draft hack', status: 'draft', registration_open: true }),
        hackathon({ slug: 'off', title: 'Off hack', status: 'cancelled' }),
        hackathon({ slug: 'done', title: 'Done hack', status: 'completed' }),
        hackathon({ slug: 'scoring', title: 'Scoring hack', status: 'judging' }),
        hackathon({ slug: 'soon', title: 'Soon hack' }),
        hackathon({ slug: 'open', title: 'Open hack', registration_open: true, theme: 'Climate', tagline: 'Code for the planet.', team_count: 2, participant_count: 7 }),
      ]),
      [STATS]: stats,
    })
    const { user } = renderApp(<Home />)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Learn. Build. Grow. Together.')

    expect(await screen.findByText('7 going')).toBeInTheDocument()
    expect(screen.getByText('Full · waitlist open')).toBeInTheDocument()
    expect(screen.getByText('1 place left')).toBeInTheDocument()
    expect(screen.getByText('12 places left')).toBeInTheDocument()
    expect(screen.getByText(/^Workshop · Online · /)).toBeInTheDocument()

    expect(within(live()).getAllByRole('link').map((l) => l.getAttribute('href'))).toEqual(['/events/a', '/events/b', '/hackathons/open'])
    expect(within(live()).getByText('Hackathon · Registration open')).toBeInTheDocument()

    const card = featuredCard()
    expect(card).toHaveAttribute('href', '/hackathons/open')
    expect(card).toHaveTextContent('Climate')
    expect(card).toHaveTextContent('Code for the planet.')
    expect(card).toHaveTextContent(`Register by ${formatDate('2026-11-30T21:00:00Z')}`)
    expect(card).toHaveTextContent('Teams2Builders7Challenges0')

    expect(await screen.findByText('1,200')).toBeInTheDocument()
    expect(screen.getByText('check-ins at events')).toBeInTheDocument()
    expect(screen.queryByText('events run')).not.toBeInTheDocument()

    expect(screen.getByRole('link', { name: /Pick up the skills/ })).toHaveAttribute('href', 'https://learn.amilliontechies.com')
    expect(screen.getByText('You are here', { selector: 'span' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Apply to join' })).toHaveAttribute('href', '/organizations/join')

    await user.click(screen.getByRole('button', { name: 'Join the community' }))
    expect(auth.signinRedirect).toHaveBeenLastCalledWith(expect.objectContaining({ prompt: 'create' }))
    await user.click(screen.getByRole('button', { name: 'Join free' }))
    expect(auth.signinRedirect).toHaveBeenCalledTimes(2)
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(auth.signinRedirect).toHaveBeenLastCalledWith(expect.not.objectContaining({ prompt: 'create' }))
  })

  it('features a running hackathon when none is open for sign-ups', async () => {
    mockFetch({
      [EVENTS]: page([]),
      [HACKATHONS]: page([hackathon({ slug: 'done', status: 'completed' }), hackathon({ slug: 'scoring', title: 'Scoring hack', status: 'judging' })]),
    })
    renderApp(<Home />)
    expect(await within(live()).findByText('Hackathon · Judging')).toBeInTheDocument()
    expect(featuredCard()).toHaveTextContent('See the hackathon')
    expect(featuredCard()).not.toHaveTextContent('Climate')
  })

  it('calls a published hackathon that is not yet open upcoming', async () => {
    mockFetch({ [EVENTS]: page([]), [HACKATHONS]: page([hackathon()]) })
    renderApp(<Home />)
    expect(await within(live()).findByText('Hackathon · Upcoming')).toBeInTheDocument()
  })

  it('says what is coming while the community is new', async () => {
    mockFetch({
      [EVENTS]: page([]),
      [HACKATHONS]: page([hackathon({ status: 'draft' })]),
      [STATS]: { members: 0, events: 0, check_ins: 0, hackathons: 0, projects: 0, organizations: 0 },
    })
    renderApp(<Home />)
    expect(await screen.findByText('No upcoming events yet. New ones show up here first.')).toBeInTheDocument()
    expect(await screen.findByText('The first hackathon will be announced here.')).toBeInTheDocument()
    expect(screen.getByText(/The first events are being planned/)).toBeInTheDocument()
    expect(screen.queryByText('members')).not.toBeInTheDocument()
  })

  it('shows placeholders while the lists load', async () => {
    let finish: (value: unknown) => void = () => undefined
    mockFetch({ [EVENTS]: () => new Promise((resolve) => (finish = resolve)), [HACKATHONS]: () => new Promise(() => undefined) })
    const { container } = renderApp(<Home />)
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(4)
    expect(screen.queryByText(/No upcoming events yet/)).not.toBeInTheDocument()
    expect(screen.queryByText(/The first hackathon/)).not.toBeInTheDocument()
    finish(page([]))
    expect(await screen.findByText(/No upcoming events yet/)).toBeInTheDocument()
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(1)
  })

  it('stands a branded block in for a photo that will not load', () => {
    mockFetch({})
    renderApp(<Home />)
    const alt = 'A Million Techies members learning together'
    fireEvent.error(screen.getByRole('img', { name: alt }))
    expect(screen.getByRole('img', { name: alt }).tagName).toBe('DIV')
  })

  it('lets members who organise events create one', async () => {
    signIn()
    mockFetch({ 'GET /me/': me({ organizations: [membership({ can_manage_events: true })] }), [EVENTS]: page([]), [HACKATHONS]: page([]) })
    renderApp(<Home />)
    expect(await screen.findByRole('link', { name: 'Create an event' })).toHaveAttribute('href', '/manage/events/new')
    expect(screen.getByRole('link', { name: 'Find your next event' })).toHaveAttribute('href', '/events')
    expect(screen.queryByRole('button', { name: 'Join free' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Join the community' })).not.toBeInTheDocument()
  })

  it('offers other members nothing to organise', async () => {
    signIn()
    mockFetch({ 'GET /me/': me(), [EVENTS]: page([]), [HACKATHONS]: page([]) })
    renderApp(<Home />)
    expect(await screen.findByText('No upcoming events yet. New ones show up here first.')).toBeInTheDocument()
    const organise = screen.getByText('Organise').closest('li')!
    expect(within(organise).queryByRole('link')).not.toBeInTheDocument()
    expect(within(organise).queryByRole('button')).not.toBeInTheDocument()
  })
})
