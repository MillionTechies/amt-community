import { screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Hackathon, MyTeam, Participant, Team, TeamMember } from '../api'
import { signIn } from '../test/auth'
import { teammate } from '../test/console'
import { callsTo, mockFetch, reply, sentBody, sequence } from '../test/fetch'
import { hackathon, submission } from '../test/fixtures'
import { currentPath, renderApp } from '../test/render'
import MyHackathon from './MyHackathon'

const BASE = '/hackathons/climate-hack'
const TEAM = `GET ${BASE}/my-team/`
const PEOPLE = `GET ${BASE}/participants/`

// 2 Dec 2026: hacking has started; submissions are still open.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-12-02T06:00:00Z'))
})

const member = (id: number, name: string, overrides: Partial<TeamMember> = {}): TeamMember => ({
  id,
  person: teammate({ sub: `user-${id}`, name }),
  is_leader: false,
  ...overrides,
})

const myTeam = (overrides: Partial<MyTeam> = {}): MyTeam => ({
  id: 5,
  name: 'Team Rocket',
  members: [member(1, 'Wanjiru', { is_leader: true }), member(2, 'Otieno')],
  has_submission: false,
  is_open: false,
  spots_left: 2,
  invite_code: '482913',
  submission: null,
  pending_invitations: [],
  ...overrides,
})

const participant = (overrides: Partial<Participant> = {}): Participant => ({
  id: 1,
  person: teammate({ sub: 'user-1', name: 'Wanjiru' }),
  looking_for_team: false,
  team_name: null,
  registered_at: '2026-11-20T08:00:00Z',
  ...overrides,
})

const challenges = [
  { id: 3, title: 'Water', description: '' },
  { id: 4, title: 'Energy', description: '' },
]

const registered = (overrides: Partial<Hackathon> = {}) => hackathon({ is_registered: true, ...overrides })
const inTeam = (overrides: Partial<Hackathon> = {}) => registered({ my_team_id: 5, ...overrides })

const show = (h: unknown, routes: Record<string, unknown> = {}) => {
  signIn({ sub: 'user-1' })
  const fetch = mockFetch({ [`GET ${BASE}/`]: h, [`GET ${BASE}/announcements/`]: [], ...routes })
  return { fetch, ...renderApp(<MyHackathon />, { route: `${BASE}/workspace`, path: '/hackathons/:slug/workspace' }) }
}

describe('Hackathon workspace', () => {
  it.each([
    ['the request fails', reply(500, { detail: 'Server error.' }), 'Server error.'],
    ['the API returns nothing', null, 'Hackathon not found.'],
  ])('shows an error when %s', async (_, answer, message) => {
    show(answer)
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
  })

  it('sends people who are not registered to the hackathon page', async () => {
    show(hackathon())
    expect(await screen.findByText('You are not registered for Climate hack.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'See the hackathon' })).toHaveAttribute('href', BASE)
  })

  it('shows teammates with what they know, and lets the leader remove one', async () => {
    const { user, fetch } = show(inTeam({ registration_open: true }), {
      [TEAM]: myTeam({
        members: [
          member(1, 'Wanjiru', { is_leader: true }),
          { ...member(2, 'Otieno'), person: teammate({ sub: 'user-2', name: 'Otieno', headline: 'Designer', institution: 'JKUAT', skills: ['Figma'], github_url: 'https://github.com/o', linkedin_url: 'https://linkedin.com/in/o' }) },
        ],
      }),
      [PEOPLE]: [participant({ id: 9, looking_for_team: true, person: teammate({ sub: 'user-9', name: 'Akinyi', skills: ['Python'] }) })],
      [`DELETE ${BASE}/my-team/members/2/`]: sequence(reply(400, { detail: 'Not now.' }), reply(204)),
    })
    expect(await screen.findByRole('heading', { name: 'Team Rocket' })).toBeInTheDocument()
    expect(screen.getByText('Designer · JKUAT')).toBeInTheDocument()
    expect(screen.getByText('Figma')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'GitHub' })).toHaveAttribute('href', 'https://github.com/o')
    expect(screen.getByRole('link', { name: 'LinkedIn' })).toBeInTheDocument()

    // Growing the team: the code, the link, and who is looking.
    expect(screen.getByText('482913')).toBeInTheDocument()
    const link = screen.getByRole('textbox', { name: 'Invite link' })
    expect(link).toHaveValue(`${window.location.origin}/join?code=482913`)
    await user.click(link)
    expect((link as HTMLInputElement).selectionEnd).toBe((link as HTMLInputElement).value.length)
    await user.click(screen.getByRole('button', { name: 'Copy invite link' }))
    expect(await screen.findByRole('button', { name: 'Link copied' })).toBeInTheDocument()
    expect(await screen.findByText('Akinyi')).toBeInTheDocument()
    expect(screen.getByText('Python')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Remove' }))
    await user.click(within(screen.getByRole('alertdialog', { name: 'Remove Otieno?' })).getByRole('button', { name: 'Cancel' }))
    expect(callsTo(fetch, `DELETE ${BASE}/my-team/members/2/`)).toHaveLength(0)
    const remove = async () => {
      await user.click(screen.getByRole('button', { name: 'Remove' }))
      await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Remove' }))
    }
    await remove()
    expect(await screen.findByText('Not now.')).toBeInTheDocument()
    await remove()
    expect(await screen.findByText('Otieno removed from the team')).toBeInTheDocument()
  })

  it('lets the leader rename the team and open it to anyone', async () => {
    const { user, fetch } = show(inTeam({ registration_open: true, max_team_size: 2 }), {
      [TEAM]: myTeam(),
      [`PATCH ${BASE}/my-team/`]: sequence(reply(400, { name: 'A team with this name already exists.' }), {}, {}),
    })
    const name = await screen.findByRole('textbox', { name: 'Team name' })
    // A full team has nothing to grow.
    expect(screen.queryByRole('heading', { name: 'Grow your team' })).not.toBeInTheDocument()
    await user.clear(name)
    await user.type(name, 'Comets')
    await user.click(screen.getByRole('button', { name: 'Rename' }))
    expect(await screen.findByText('A team with this name already exists.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Rename' }))
    expect(await screen.findByText('Team renamed')).toBeInTheDocument()
    expect(sentBody(fetch, `PATCH ${BASE}/my-team/`)).toEqual({ name: 'Comets' })
    await user.click(screen.getByRole('checkbox', { name: /Open team/ }))
    expect(sentBody(fetch, `PATCH ${BASE}/my-team/`)).toEqual({ is_open: true })
  })

  it('lets a member leave after confirming, staying registered', async () => {
    signIn({ sub: 'user-2' })
    const fetch = mockFetch({
      [`GET ${BASE}/`]: inTeam(),
      [`GET ${BASE}/announcements/`]: [],
      [TEAM]: myTeam(),
      [`POST ${BASE}/my-team/leave/`]: sequence(reply(400, { detail: 'Submission locked.' }), reply(204)),
    })
    const { user } = renderApp(<MyHackathon />, { route: `${BASE}/workspace`, path: '/hackathons/:slug/workspace' })
    await user.click(await screen.findByRole('button', { name: 'Leave team' }))
    const dialog = screen.getByRole('alertdialog', { name: 'Leave Team Rocket?' })
    expect(dialog).toHaveTextContent('Your teammates keep the team and its submission. You stay registered.')
    await user.click(within(dialog).getByRole('button', { name: 'Stay' }))
    expect(callsTo(fetch, `POST ${BASE}/my-team/leave/`)).toHaveLength(0)
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Team settings' })).not.toBeInTheDocument()

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
    let finish: (value: unknown) => void = () => undefined
    show(inTeam({ status: 'judging', registration_open: true }), { [TEAM]: () => new Promise((resolve) => (finish = resolve)) })
    await screen.findByText('Key dates')
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()
    finish(myTeam({ submission: submission({ title: 'Solar tracker' }) }))
    expect(await screen.findByRole('heading', { name: 'Team Rocket' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Leave team' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Team settings' })).not.toBeInTheDocument()
    expect(screen.getByText('Solar tracker')).toBeInTheDocument()
    expect(screen.getByText(/^Submitted /)).toBeInTheDocument()
  })

  it('says when the team cannot be loaded, or did not submit in time', async () => {
    const { unmount } = show(inTeam(), { [TEAM]: reply(500, { detail: 'Team trouble.' }) })
    expect(await screen.findByText('Team trouble.')).toBeInTheDocument()
    unmount()
    show(inTeam(), { [TEAM]: myTeam({ members: [member(1, 'Wanjiru', { is_leader: true })] }) })
    expect(await screen.findByText('Submissions are closed. Your team did not submit a project.')).toBeInTheDocument()
  })

  it('submits a project for a challenge', async () => {
    const { user, fetch } = show(inTeam({ submissions_open: true, challenges }), {
      [TEAM]: myTeam(),
      [`PUT ${BASE}/my-team/submission/`]: {},
    })
    expect(await screen.findByRole('heading', { name: 'Submit your project' })).toBeInTheDocument()
    await user.type(screen.getByRole('textbox', { name: 'Project name' }), 'Pump finder')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Challenge' }), 'Water')
    await user.type(screen.getByRole('textbox', { name: 'What it does' }), 'Finds pumps.')
    await user.type(screen.getByRole('textbox', { name: 'GitHub repository' }), 'https://github.com/r/p')
    await user.type(screen.getByRole('textbox', { name: 'Live demo (optional)' }), 'https://demo.test')
    await user.type(screen.getByRole('textbox', { name: 'Demo video (optional)' }), 'https://video.test')
    await user.click(screen.getByRole('button', { name: 'Submit project' }))
    expect(await screen.findByText('Saved. Your project is submitted.')).toBeInTheDocument()
    expect(sentBody(fetch, `PUT ${BASE}/my-team/submission/`)).toEqual({
      title: 'Pump finder',
      description: 'Finds pumps.',
      repository_url: 'https://github.com/r/p',
      demo_url: 'https://demo.test',
      video_url: 'https://video.test',
      challenge_id: 3,
    })
  })

  it('lets a lone member update a project with no challenge, after fixing what the API rejected', async () => {
    const { user, fetch } = show(inTeam({ submissions_open: true, challenges, min_team_size: 2 }), {
      [TEAM]: myTeam({ members: [member(1, 'Wanjiru', { is_leader: true })], submission: submission({ challenge: challenges[0], description: 'Tracks the sun.' }) }),
      [`PUT ${BASE}/my-team/submission/`]: sequence(reply(400, { repository_url: ['Enter a valid URL.'] }), {}),
    })
    expect(await screen.findByText('You need 2 members before you can submit.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Leave team' }))
    expect(screen.getByRole('alertdialog', { name: 'Leave and delete your team?' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Stay' }))

    expect(screen.getByRole('textbox', { name: 'Project name' })).toHaveValue('Solar tracker')
    expect(screen.getByRole('combobox', { name: 'Challenge' })).toHaveValue('3')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Challenge' }), '')
    await user.click(screen.getByRole('button', { name: 'Update submission' }))
    expect(await screen.findAllByText('Enter a valid URL.')).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: 'Update submission' }))
    expect(await screen.findByText('Saved. Your project is submitted.')).toBeInTheDocument()
    expect(sentBody(fetch, `PUT ${BASE}/my-team/submission/`)).toMatchObject({ challenge_id: null, title: 'Solar tracker' })
  })

  it('starts a team, or joins one with its code', async () => {
    const { user, fetch } = show(registered({ registration_open: true }), {
      [`GET ${BASE}/teams/`]: [],
      [PEOPLE]: [participant()],
      [`POST ${BASE}/teams/`]: sequence(reply(400, { detail: 'That name is taken.' }), reply(201, {})),
      [`POST ${BASE}/teams/join/`]: sequence(reply(400, { detail: 'No team has this invite code.' }), reply(201, {})),
    })
    expect(await screen.findByText('No teams yet. Start the first one.')).toBeInTheDocument()
    expect(screen.getByText('Taking part alone? Create a team of one.')).toBeInTheDocument()
    await user.type(screen.getByRole('textbox', { name: 'Team name' }), 'Rocket')
    await user.click(screen.getByRole('button', { name: 'Create team' }))
    expect(await screen.findByText('That name is taken.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Create team' }))
    expect(await screen.findByText('Rocket is ready')).toBeInTheDocument()
    expect(sentBody(fetch, `POST ${BASE}/teams/`)).toEqual({ name: 'Rocket' })

    await user.type(screen.getByRole('textbox', { name: 'Team code' }), ' 482913 ')
    await user.click(screen.getByRole('button', { name: 'Join team' }))
    expect(await screen.findByText('No team has this invite code.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Join team' }))
    expect(await screen.findByText('You joined the team')).toBeInTheDocument()
    expect(sentBody(fetch, `POST ${BASE}/teams/join/`)).toEqual({ invite_code: '482913' })
  })

  it('lets a solo participant take part', async () => {
    const { user } = show(registered({ registration_open: true, max_team_size: 1 }), {
      [`GET ${BASE}/teams/`]: [],
      [PEOPLE]: [],
      [`POST ${BASE}/teams/`]: reply(201, {}),
    })
    expect(await screen.findByText('Take part on your own')).toBeInTheDocument()
    await user.type(screen.getByRole('textbox', { name: 'Team name' }), 'Solo')
    await user.click(screen.getByRole('button', { name: 'Create team' }))
    expect(await screen.findByText('You are taking part')).toBeInTheDocument()
  })

  it('lists the teams and joins an open one in a click', async () => {
    const teams: Team[] = [
      { id: 7, name: 'Open Door', members: [member(3, 'Akinyi')], has_submission: false, is_open: true, spots_left: 1 },
      { id: 8, name: 'Closed Shop', members: [member(4, 'Baraka')], has_submission: false, is_open: false, spots_left: 2 },
      { id: 9, name: 'Packed', members: [member(5, 'Chebet')], has_submission: false, is_open: true, spots_left: 0 },
    ]
    const { user } = show(registered({ registration_open: true }), {
      [`GET ${BASE}/teams/`]: teams,
      [PEOPLE]: [participant()],
      [`POST ${BASE}/teams/7/join/`]: sequence(reply(400, { detail: 'This team is full.' }), reply(201, {})),
    })
    expect(await screen.findByText('Open Door')).toBeInTheDocument()
    expect(screen.getByText('1 spot left')).toBeInTheDocument()
    expect(screen.getByText('2 spots left')).toBeInTheDocument()
    expect(screen.getByText('Full')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Join' })).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Join' }))
    expect(await screen.findByText('This team is full.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Join' }))
    expect(await screen.findByText('You joined the team')).toBeInTheDocument()
  })

  it('says whether the member is looking for a team, and withdraws them', async () => {
    const { user, fetch } = show(registered({ registration_open: true }), {
      [`GET ${BASE}/teams/`]: reply(500, { detail: 'Teams unavailable.' }),
      [PEOPLE]: [participant()],
      [`PATCH ${BASE}/registration/`]: {},
      [`DELETE ${BASE}/registration/`]: sequence(reply(400, { detail: 'Leave your team before you withdraw.' }), reply(204)),
    })
    expect(await screen.findByText('Teams unavailable.')).toBeInTheDocument()
    const looking = await screen.findByRole('checkbox', { name: /I am looking for a team/ })
    await vi.waitFor(() => expect(looking).toBeEnabled())
    await user.click(looking)
    expect(sentBody(fetch, `PATCH ${BASE}/registration/`)).toEqual({ looking_for_team: true })

    await user.click(screen.getByRole('button', { name: 'Withdraw' }))
    await user.click(within(screen.getByRole('alertdialog', { name: 'Withdraw from Climate hack?' })).getByRole('button', { name: 'Stay' }))
    expect(callsTo(fetch, `DELETE ${BASE}/registration/`)).toHaveLength(0)
    const withdraw = async () => {
      await user.click(screen.getByRole('button', { name: 'Withdraw' }))
      await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Withdraw' }))
    }
    await withdraw()
    expect(await screen.findByText('Leave your team before you withdraw.')).toBeInTheDocument()
    await withdraw()
    expect(await screen.findByText('You withdrew')).toBeInTheDocument()
    expect(currentPath()).toBe(BASE)
  })

  it('tells a member without a team when registration has closed', async () => {
    show(registered({ status: 'judging' }), { [PEOPLE]: [] })
    expect(await screen.findByText(/Registration has closed and you did not join a team/)).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Withdraw' })).not.toBeInTheDocument()
  })

  it('lets the leader invite teammates by email or from the looking-for-team list', async () => {
    const { user, fetch } = show(inTeam({ registration_open: true }), {
      [TEAM]: myTeam({ pending_invitations: [{ id: 4, name: 'friend@example.com', created_at: '2026-11-21T08:00:00Z' }] }),
      [PEOPLE]: [participant({ id: 9, looking_for_team: true, person: teammate({ sub: 'user-9', name: 'Akinyi' }) })],
      [`POST ${BASE}/my-team/invitations/`]: sequence(reply(400, { email: 'Your team is full, counting the invitations already sent.' }), reply(201, {}), reply(201, {})),
    })
    expect(await screen.findByText(/Room for 1 more/)).toBeInTheDocument()
    expect(screen.getByText('friend@example.com')).toBeInTheDocument()
    const email = screen.getByRole('textbox', { name: 'Invite by email' })
    await user.type(email, 'mate@example.com')
    await user.click(screen.getByRole('button', { name: 'Send invitation' }))
    expect(await screen.findByText('Your team is full, counting the invitations already sent.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Send invitation' }))
    expect(await screen.findByText('Invitation sent')).toBeInTheDocument()
    expect(email).toHaveValue('')

    await user.click(await screen.findByRole('button', { name: 'Invite' }))
    expect(await screen.findByText('Akinyi is invited')).toBeInTheDocument()
    expect(sentBody(fetch, `POST ${BASE}/my-team/invitations/`)).toEqual({ sub: 'user-9' })
  })
})
