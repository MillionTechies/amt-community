import { screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Hackathon, MyTeam, TeamMember } from '../api'
import { auth, signIn } from '../test/auth'
import { callsTo, mockFetch, reply, sentBody, sequence } from '../test/fetch'
import { hackathon, leaderboardRow, submission } from '../test/fixtures'
import { renderApp } from '../test/render'
import HackathonDetail from './HackathonDetail'

const HACK = 'GET /hackathons/climate-hack/'
const TEAM = 'GET /hackathons/climate-hack/my-team/'

// 2 Dec 2026: registration has closed and hacking has started; submissions are still open.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-12-02T06:00:00Z'))
})

const member = (id: number, name: string, overrides: Partial<TeamMember> = {}): TeamMember => ({
  id,
  person: { sub: `user-${id}`, name, headline: '', institution: '' },
  is_leader: false,
  ...overrides,
})

const team = (overrides: Partial<MyTeam> = {}): MyTeam => ({
  id: 5,
  name: 'Team Rocket',
  members: [member(1, 'Wanjiru', { is_leader: true }), member(2, 'Otieno')],
  has_submission: false,
  invite_code: 'INV-1',
  submission: null,
  ...overrides,
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

const inTeam = (overrides: Partial<Hackathon> = {}) => hackathon({ my_team_id: 5, ...overrides })

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

  it('says when no projects were submitted, the team among them', async () => {
    show(inTeam({ status: 'completed', results_published: true }), {
      [TEAM]: team(),
      'GET /hackathons/climate-hack/leaderboard/': [],
      'GET /hackathons/climate-hack/submissions/': [],
    })
    expect(await screen.findByText('No projects were submitted.')).toBeInTheDocument()
    expect(await screen.findByText('Submissions are closed. Your team did not submit a project.')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Project showcase' })).not.toBeInTheDocument()
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

  it('asks visitors to sign in to take part, with a shortcut on phones', async () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    const { user } = show(hackathon({ registration_open: true, status: 'draft' }))
    expect(await screen.findByText('Sign in to create a team or join one.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Sign in to take part' }))
    expect(auth.signinRedirect).toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Take part', hidden: true }))
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth' })
  })

  it('joins a team with the invite code from the link', async () => {
    signIn()
    const { user, fetch } = show(
      hackathon({ registration_open: true, min_team_size: 2 }),
      { 'POST /hackathons/climate-hack/teams/join/': sequence(reply(400, { detail: 'No team has that code.' }), reply(201, {})) },
      '/hackathons/climate-hack?join=INV-9',
    )
    const code = await screen.findByRole('textbox', { name: 'Invite code' })
    expect(code).toHaveValue('INV-9')
    await user.type(code, '  ')
    expect(screen.queryByText('Taking part alone? Create a team of one.')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Join team' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('No team has that code.')
    await user.click(screen.getByRole('button', { name: 'Join team' }))
    expect(await screen.findByText('You joined the team')).toBeInTheDocument()
    expect(sentBody(fetch, 'POST /hackathons/climate-hack/teams/join/')).toEqual({ invite_code: 'INV-9' })
  })

  it('starts a team, once the name is free', async () => {
    signIn()
    const { user, fetch } = show(hackathon({ registration_open: true }), {
      'POST /hackathons/climate-hack/teams/': sequence(reply(400, { detail: 'That name is taken.' }), reply(201, {})),
    })
    expect(await screen.findByText('Taking part alone? Create a team of one.')).toBeInTheDocument()
    await user.type(screen.getByRole('textbox', { name: 'Team name' }), 'Rocket')
    await user.click(screen.getByRole('button', { name: 'Create team' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('That name is taken.')
    await user.click(screen.getByRole('button', { name: 'Create team' }))
    expect(await screen.findByText('Rocket is ready')).toBeInTheDocument()
    expect(screen.getByText('Share the invite link with your teammates.')).toBeInTheDocument()
    expect(sentBody(fetch, 'POST /hackathons/climate-hack/teams/')).toEqual({ name: 'Rocket' })
  })

  it('lets a solo participant take part', async () => {
    signIn()
    const { user } = show(hackathon({ registration_open: true, max_team_size: 1 }), { 'POST /hackathons/climate-hack/teams/': reply(201, {}) })
    expect(await screen.findByText('Take part', { selector: 'p' })).toBeInTheDocument()
    await user.type(screen.getByRole('textbox', { name: 'Team name' }), 'Solo')
    await user.click(screen.getByRole('button', { name: 'Create team' }))
    expect(await screen.findByText('You are taking part.')).toBeInTheDocument()
  })

  it('shows the team leader their team, invite link and controls', async () => {
    signIn({ sub: 'user-1' })
    const { user, fetch } = show(inTeam({ registration_open: true, submissions_open: true, challenges }), {
      [TEAM]: team({ submission: submission({ challenge: challenges[0] }) }),
      'DELETE /hackathons/climate-hack/my-team/members/2/': sequence(reply(400, { detail: 'Not now.' }), reply(204)),
    })
    expect(await screen.findByText('Your team')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Challenge' })).toHaveValue('3')
    expect(screen.getByText('Leader')).toBeInTheDocument()
    expect(screen.getByText('Invite up to 2 more. Share this link:')).toBeInTheDocument()
    const link = screen.getByRole('textbox', { name: 'Invite link' })
    expect(link).toHaveValue(`${window.location.origin}/hackathons/climate-hack?join=INV-1`)
    await user.click(link)
    expect((link as HTMLInputElement).selectionEnd).toBe((link as HTMLInputElement).value.length)
    await user.click(screen.getByRole('button', { name: 'Copy invite link' }))
    expect(await screen.findByRole('button', { name: 'Link copied' })).toBeInTheDocument()
    expect(await navigator.clipboard.readText()).toBe(`${window.location.origin}/hackathons/climate-hack?join=INV-1`)
    expect(screen.queryByRole('button', { name: 'Take part', hidden: true })).not.toBeInTheDocument()

    // Only the leader may remove others, never themselves.
    expect(screen.getAllByRole('button', { name: 'Remove' })).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Remove' }))
    await user.click(within(screen.getByRole('alertdialog', { name: 'Remove Otieno?' })).getByRole('button', { name: 'Cancel' }))
    expect(callsTo(fetch, 'DELETE /hackathons/climate-hack/my-team/members/2/')).toHaveLength(0)
    await user.click(screen.getByRole('button', { name: 'Remove' }))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Remove' }))
    expect(await screen.findByText('Not now.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Remove' }))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Remove' }))
    expect(await screen.findByText('Otieno removed from the team')).toBeInTheDocument()
  })

  it('lets a member leave the team after confirming, once it works', async () => {
    signIn({ sub: 'user-2' })
    const { user, fetch } = show(inTeam(), {
      [TEAM]: team(),
      'POST /hackathons/climate-hack/my-team/leave/': sequence(reply(400, { detail: 'Submission locked.' }), reply(204)),
    })
    await user.click(await screen.findByRole('button', { name: 'Leave team' }))
    const dialog = screen.getByRole('alertdialog', { name: 'Leave Team Rocket?' })
    expect(dialog).toHaveTextContent('Your teammates keep the team and its submission.')
    await user.click(within(dialog).getByRole('button', { name: 'Stay' }))
    expect(callsTo(fetch, 'POST /hackathons/climate-hack/my-team/leave/')).toHaveLength(0)
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Invite link' })).not.toBeInTheDocument()

    const leave = async () => {
      await user.click(screen.getByRole('button', { name: 'Leave team' }))
      await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Leave team' }))
    }
    await leave()
    expect(await screen.findByText('Submission locked.')).toBeInTheDocument()
    await leave()
    expect(await screen.findByText('You left the team')).toBeInTheDocument()
  })

  it('freezes the team once the hackathon moves on', async () => {
    signIn({ sub: 'user-1' })
    let finish: (value: unknown) => void = () => undefined
    show(inTeam({ status: 'judging', registration_open: true, max_team_size: 2 }), {
      [TEAM]: () => new Promise((resolve) => (finish = resolve)),
    })
    await screen.findByText('Key dates')
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()
    finish(team({ submission: submission({ title: 'Solar tracker' }) }))
    expect(await screen.findByText('Your team')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Leave team' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Invite link' })).not.toBeInTheDocument()
    expect(screen.getByText('Solar tracker')).toBeInTheDocument()
    expect(screen.getByText(/^Submitted /)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Repository' })).toBeInTheDocument()
  })

  it('submits a project for a challenge', async () => {
    signIn({ sub: 'user-1' })
    const { user, fetch } = show(inTeam({ submissions_open: true, challenges }), {
      [TEAM]: team(),
      'PUT /hackathons/climate-hack/my-team/submission/': {},
    })
    expect(await screen.findByText('Submit your project')).toBeInTheDocument()
    expect(screen.getByText(/You can change it until 3 Dec 2026/)).toBeInTheDocument()
    await user.type(screen.getByRole('textbox', { name: 'Project name' }), 'Pump finder')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Challenge' }), 'Water')
    await user.type(screen.getByRole('textbox', { name: 'What it does' }), 'Finds pumps.')
    await user.type(screen.getByRole('textbox', { name: 'GitHub repository' }), 'https://github.com/r/p')
    await user.type(screen.getByRole('textbox', { name: 'Live demo (optional)' }), 'https://demo.test')
    await user.type(screen.getByRole('textbox', { name: 'Demo video (optional)' }), 'https://video.test')
    await user.click(screen.getByRole('button', { name: 'Submit project' }))
    expect(await screen.findByText('Saved. Your project is submitted.')).toBeInTheDocument()
    expect(sentBody(fetch, 'PUT /hackathons/climate-hack/my-team/submission/')).toEqual({
      title: 'Pump finder',
      description: 'Finds pumps.',
      repository_url: 'https://github.com/r/p',
      demo_url: 'https://demo.test',
      video_url: 'https://video.test',
      challenge_id: 3,
    })
  })

  it('lets a lone member update a project with no challenge, after fixing what the API rejected', async () => {
    signIn({ sub: 'user-1' })
    const { user, fetch } = show(inTeam({ submissions_open: true, challenges, min_team_size: 2 }), {
      [TEAM]: team({ members: [member(1, 'Wanjiru', { is_leader: true })], submission: submission({ description: 'Tracks the sun.' }) }),
      'PUT /hackathons/climate-hack/my-team/submission/': sequence(reply(400, { repository_url: ['Enter a valid URL.'] }), {}),
    })
    expect(await screen.findByText('You need 2 members before you can submit.')).toBeInTheDocument()
    // Leaving would delete the team, so the member is warned.
    await user.click(screen.getByRole('button', { name: 'Leave team' }))
    expect(screen.getByRole('alertdialog', { name: 'Leave and delete your team?' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Stay' }))

    expect(screen.getByText('Your project')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Project name' })).toHaveValue('Solar tracker')
    expect(screen.getByRole('combobox', { name: 'Challenge' })).toHaveValue('')
    await user.click(screen.getByRole('button', { name: 'Update submission' }))
    expect(await screen.findAllByText('Enter a valid URL.')).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: 'Update submission' }))
    expect(await screen.findByText('Saved. Your project is submitted.')).toBeInTheDocument()
    expect(sentBody(fetch, 'PUT /hackathons/climate-hack/my-team/submission/')).toMatchObject({ challenge_id: null, title: 'Solar tracker' })
  })
})
