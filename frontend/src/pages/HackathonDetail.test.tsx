import { screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { auth, signIn } from '../test/auth'
import { mockFetch, reply, sequence } from '../test/fetch'
import { hackathon, leaderboardRow, submission } from '../test/fixtures'
import { currentPath, renderApp } from '../test/render'
import HackathonDetail from './HackathonDetail'

const HACK = 'GET /hackathons/climate-hack/'

// 2 Dec 2026: registration has closed and hacking has started; submissions are still open.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-12-02T06:00:00Z'))
})

const challenges = [
  { id: 3, title: 'Water', description: 'Clean water for all.' },
  { id: 4, title: 'Energy', description: '' },
]

// The hackathon page with no announcements, plus any other routes.
const show = (h: unknown, routes: Record<string, unknown> = {}, route = '/hackathons/climate-hack') => {
  const fetch = mockFetch({ [HACK]: h, 'GET /hackathons/climate-hack/announcements/': [], ...routes })
  return { fetch, ...renderApp(<HackathonDetail />, { route, path: '/hackathons/:slug' }) }
}

describe('Hackathon page', () => {
  it.each([
    ['the request fails', reply(500, { detail: 'Server error.' }), 'Server error.'],
    ['the API returns nothing', null, 'Hackathon not found.'],
  ])('shows an error when %s', async (_, answer, message) => {
    show(answer)
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
  })

  it('describes the hackathon in full', async () => {
    show(
      hackathon({
        theme: 'Climate',
        venue: 'iHub',
        description: '<p>Build for the planet.</p>',
        rules: 'Be kind.',
        eligibility: 'Students',
        challenges,
        prizes: [{ title: 'Winner', value: 'KES 50,000' }, { title: 'Runner-up', value: '' }],
        criteria: [
          { id: 1, name: 'Impact', description: 'Does it matter?', max_score: 10, weight: 2 },
          { id: 2, name: 'Code', description: '', max_score: 5, weight: 1 },
        ],
        team_count: 1,
        participant_count: 1,
        submission_count: 1,
        can_manage: true,
      }),
      {
        'GET /hackathons/climate-hack/announcements/': [{ id: 1, title: 'Kick-off moved', body: '<p>Now at 10.</p>', created_at: '2026-11-28T06:00:00Z' }],
      },
    )
    expect(await screen.findByRole('heading', { level: 1, name: 'Climate hack' })).toBeInTheDocument()
    expect(screen.getByText('Teams of 1 to 4, 1 team so far')).toBeInTheDocument()
    expect(screen.getByText('1 participant in 1 team, 1 project submitted')).toBeInTheDocument()

    expect(screen.getByText('Registration closes')).toHaveClass('line-through')
    expect(screen.getByText('Submissions close')).not.toHaveClass('line-through')

    expect(await screen.findByText('Kick-off moved')).toBeInTheDocument()
    expect(screen.getByText('Build for the planet.')).toBeInTheDocument()
    expect(screen.getByText('Clean water for all.')).toBeInTheDocument()
    expect(screen.getByText('Energy')).toBeInTheDocument()
    expect(screen.getByText('Be kind.')).toBeInTheDocument()
    expect(screen.getByText('Students')).toBeInTheDocument()
    expect(screen.getByText('KES 50,000')).toBeInTheDocument()
    expect(screen.getByText('Runner-up').parentElement).toHaveTextContent(/^Runner-up$/)
    expect(screen.getByText('Out of 10, counts 2 times')).toBeInTheDocument()
    expect(screen.getByText('Out of 5')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Edit details' })).toHaveAttribute('href', '/manage/hackathons/climate-hack/edit')
    expect(screen.getByText('Registration is closed.')).toBeInTheDocument()
  })

  it('keeps a bare hackathon short', async () => {
    show(hackathon({ min_team_size: 3, max_team_size: 3, status: 'cancelled' }), { 'GET /hackathons/climate-hack/announcements/': reply(500) })
    expect(await screen.findByText('Teams of 3, 0 teams so far')).toBeInTheDocument()
    expect(screen.getByText('0 participants in 0 teams, 0 projects submitted')).toBeInTheDocument()
    expect(screen.getByText('This hackathon has been cancelled.')).toBeInTheDocument()
    expect(screen.getByText('This hackathon is not taking registrations.')).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: /^(Announcements|About|Challenges|Rules|Who can take part|Prizes|How projects are judged|Results)$/ }),
    ).not.toBeInTheDocument()
  })

  it('publishes results and the project showcase, and tells judges judging is over', async () => {
    let finish: (value: unknown) => void = () => undefined
    show(hackathon({ status: 'completed', results_published: true, is_judge: true }), {
      'GET /hackathons/climate-hack/leaderboard/': () => new Promise((resolve) => (finish = resolve)),
      'GET /hackathons/climate-hack/submissions/': [{ ...submission({ description: 'Tracks the sun.' }), members: ['Wanjiru', 'Otieno'], my_evaluation: null }],
    })
    const results = (await screen.findByRole('heading', { name: 'Results' })).parentElement!.parentElement!
    expect(within(results).getByRole('status', { name: 'Loading' })).toBeInTheDocument()
    finish([leaderboardRow()])
    expect(await within(results).findByText('87.3%')).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Project showcase' })).toBeInTheDocument()
    expect(screen.getByText('Team Rocket: Wanjiru, Otieno')).toBeInTheDocument()
    expect(screen.getByText('Tracks the sun.')).toBeInTheDocument()
    expect(screen.getByText('Judging is over.')).toBeInTheDocument()
  })

  it('says when no projects were submitted, and sends participants to their workspace', async () => {
    show(hackathon({ status: 'completed', results_published: true, is_registered: true, my_team_id: 5 }), {
      'GET /hackathons/climate-hack/leaderboard/': [],
      'GET /hackathons/climate-hack/submissions/': [],
    })
    expect(await screen.findByText('No projects were submitted.')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Project showcase' })).not.toBeInTheDocument()
    expect(screen.getByText('Your team, project and teammates are in your workspace.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open your workspace' })).toHaveAttribute('href', '/hackathons/climate-hack/workspace')
  })

  it('sends judges to the judging page once scoring opens', async () => {
    const { unmount } = show(hackathon({ is_judge: true }))
    expect(await screen.findByText('Scoring opens when submissions close.')).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: 'Go to judging', hidden: true })).toHaveLength(1)
    unmount()

    show(hackathon({ is_judge: true, status: 'judging' }))
    expect(await screen.findByText('Scoring is open.')).toBeInTheDocument()
    const links = screen.getAllByRole('link', { name: 'Go to judging', hidden: true })
    expect(links).toHaveLength(2)
    expect(links[1]).toHaveAttribute('href', '/hackathons/climate-hack/judge')
  })

  it('asks visitors to sign in to register, with a shortcut on phones', async () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    const { user } = show(hackathon({ registration_open: true, status: 'draft' }))
    await user.click(await screen.findByRole('button', { name: 'Sign in to register' }))
    expect(auth.signinRedirect).toHaveBeenCalled()
    expect(screen.getByRole('link', { name: 'Have a code?' })).toHaveAttribute('href', '/join')
    await user.click(screen.getByRole('button', { name: 'Take part', hidden: true }))
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth' })
  })

  it('registers a member in one click and opens their workspace', async () => {
    signIn()
    const { user } = show(hackathon({ registration_open: true }), {
      'POST /hackathons/climate-hack/registration/': sequence(reply(400, { detail: 'Registration for this hackathon is closed.' }), reply(201, {})),
    })
    await user.click(await screen.findByRole('button', { name: 'Register' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Registration for this hackathon is closed.')
    await user.click(screen.getByRole('button', { name: 'Register' }))
    expect(await screen.findByText('You are registered')).toBeInTheDocument()
    expect(currentPath()).toBe('/hackathons/climate-hack/workspace')
  })

  it('tells a registered member without a team to find one', async () => {
    show(hackathon({ is_registered: true }))
    expect(await screen.findByText('Find a team or start one in your workspace.')).toBeInTheDocument()
  })

  it('sends old team invite links to the code page', () => {
    show(hackathon(), {}, '/hackathons/climate-hack?join=482913')
    expect(currentPath()).toBe('/join?code=482913')
  })
})
