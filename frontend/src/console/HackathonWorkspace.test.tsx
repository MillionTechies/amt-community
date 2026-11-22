import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import type { UserEvent } from '@testing-library/user-event'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Announcement, Hackathon } from '../api'
import { announcement, captureDownloads, judge, person, renderConsole, team } from '../test/console'
import { callsTo, reply, sentBody, sequence } from '../test/fetch'
import { hackathon, leaderboardRow } from '../test/fixtures'
import { currentPath } from '../test/render'

// ProseMirror measures the page to place the cursor; jsdom has no layout, so give it empty boxes.
beforeAll(() => {
  const rect = () => new DOMRect(0, 0, 0, 0)
  const list = () => Object.assign([rect()], { item: () => rect() }) as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = rect
  Range.prototype.getClientRects = list
  Element.prototype.getClientRects = list
  document.elementFromPoint = () => null
})

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-22T12:00:00Z'))
})

const BASE = '/manage/hackathons/climate-hack'
const API = '/hackathons/climate-hack'

const open = (section: string, item: Partial<Hackathon> = {}, routes: Record<string, unknown> = {}) =>
  renderConsole(`${BASE}${section}`, { [`GET ${API}/`]: hackathon({ can_manage: true, ...item }), ...routes })

const title = () => screen.findByRole('heading', { level: 1, name: 'Climate hack' })
const dialog = () => screen.getByRole('alertdialog')
const answer = (user: UserEvent, choice: string) => user.click(within(dialog()).getByRole('button', { name: choice }))
const bodyRows = () => within(screen.getByRole('table')).getAllByRole('row').slice(1)
const kpi = (label: string) => screen.getAllByText(label, { selector: 'span' }).find((el) => el.nextElementSibling)!.parentElement!.parentElement!
const panel = async (name: string) => within((await screen.findByRole('heading', { name })).closest('section')!)
const main = () => within(screen.getByRole('main'))

// A hackathon on the server, moved on to whatever stage the console asks for.
function server(start: Partial<Hackathon>) {
  let current = hackathon({ can_manage: true, ...start })
  return {
    get: () => current,
    move: (init: RequestInit) => {
      const { status } = JSON.parse(String(init.body))
      current = { ...current, status, cancelled_from: status === 'cancelled' ? current.status : current.cancelled_from }
      return {}
    },
  }
}

const challenge = (id: number, title: string, description = '') => ({ id, title, description })
const criterion = (id: number, name: string, weight = 1, description = '') => ({ id, name, description, max_score: 10, weight })

describe('the hackathon header', () => {
  it.each([
    ['cannot be found', null, 'Hackathon not found.'],
    ['did not load', reply(500, { detail: 'Server error.' }), 'Server error.'],
    ['is not theirs to manage', hackathon(), 'You do not manage this hackathon.'],
  ])('says when the hackathon %s', async (_, response, message) => {
    renderConsole(BASE, { [`GET ${API}/`]: response })
    expect(await screen.findByText(message)).toBeInTheDocument()
  })

  it('publishes a draft after asking, then cancels and restores it', async () => {
    const hack = server({ status: 'draft' })
    let attempts = 0
    const { user, fetch } = renderConsole(BASE, {
      [`GET ${API}/`]: hack.get,
      [`POST ${API}/transition/`]: (init: RequestInit) => (attempts++ ? hack.move(init) : reply(400, { detail: 'Add a criterion first.' })),
    })
    await title()
    expect(screen.getByText('This is a draft. Only managers can see it until you publish.')).toBeInTheDocument()
    expect(main().getByRole('link', { name: 'Public page' })).toHaveAttribute('href', '/hackathons/climate-hack')

    await user.click(main().getByRole('button', { name: 'Publish' }))
    await answer(user, 'Cancel')
    expect(callsTo(fetch, `POST ${API}/transition/`)).toHaveLength(0)

    await user.click(main().getByRole('button', { name: 'Publish' }))
    await answer(user, 'Publish')
    expect(await screen.findByText('Could not update the hackathon')).toBeInTheDocument()
    expect(screen.getByText('Add a criterion first.')).toBeInTheDocument()

    await user.click(main().getByRole('button', { name: 'Publish' }))
    await answer(user, 'Publish')
    expect(await screen.findByText('Hackathon published')).toBeInTheDocument()
    expect(sentBody(fetch, `POST ${API}/transition/`)).toEqual({ status: 'published' })

    await user.click(await main().findByRole('button', { name: 'Cancel' }))
    await answer(user, 'Yes, cancel it')
    expect(await screen.findByText('Hackathon cancelled')).toBeInTheDocument()
    expect(sentBody(fetch, `POST ${API}/transition/`)).toEqual({ status: 'cancelled' })
    expect(await screen.findByText('This hackathon was cancelled. Use Restore at the top of the page to bring it back.')).toBeInTheDocument()

    await user.click(main().getByRole('button', { name: 'Restore' }))
    expect(within(dialog()).getByText('It goes back to open, just as it was before it was cancelled.')).toBeInTheDocument()
    await answer(user, 'Restore')
    expect(await screen.findByText('It is open again.')).toBeInTheDocument()
    expect(sentBody(fetch, `POST ${API}/transition/`)).toEqual({ status: 'published' })
  })

  it('deletes a draft after asking, then goes back to the list', async () => {
    const { user, fetch } = open('', { status: 'draft' }, { [`DELETE ${API}/`]: sequence(reply(403, { detail: 'Not yours.' }), reply(204)) })
    await title()
    await user.click(main().getByRole('button', { name: 'Delete' }))
    expect(within(dialog()).getByText('“Climate hack” and its challenges and criteria are removed for good.')).toBeInTheDocument()
    await answer(user, 'Cancel')
    expect(callsTo(fetch, `DELETE ${API}/`)).toHaveLength(0)

    await user.click(main().getByRole('button', { name: 'Delete' }))
    await answer(user, 'Delete draft')
    expect(await screen.findByText('Could not delete the draft')).toBeInTheDocument()
    expect(currentPath()).toBe(BASE)

    await user.click(main().getByRole('button', { name: 'Delete' }))
    await answer(user, 'Delete draft')
    expect(await screen.findByText('Draft deleted')).toBeInTheDocument()
    await waitFor(() => expect(currentPath()).toBe('/manage/hackathons'))
  })

  it('takes an open hackathon through judging to its results, restoring it to judging on the way', async () => {
    const hack = server({
      registration_deadline: '2026-11-20T12:00:00Z', submission_deadline: '2026-11-21T12:00:00Z', team_count: 2, submission_count: 2,
      challenges: [challenge(1, 'Water')], criteria: [criterion(1, 'Impact')],
    })
    const { user, fetch } = renderConsole(BASE, {
      [`GET ${API}/`]: hack.get,
      [`POST ${API}/transition/`]: hack.move,
      [`GET ${API}/judges/`]: [judge()],
    })
    await title()
    expect(kpi('Participants')).toHaveTextContent('Registration closed')
    expect(kpi('Projects submitted')).toHaveTextContent('100% of teams')
    expect(kpi('Projects submitted')).not.toHaveTextContent('closes')

    await user.click(main().getByRole('button', { name: 'Start judging' }))
    await answer(user, 'Start judging')
    expect(await screen.findByText('Judging has started')).toBeInTheDocument()
    expect(sentBody(fetch, `POST ${API}/transition/`)).toEqual({ status: 'judging' })

    await user.click(await main().findByRole('button', { name: 'Cancel' }))
    await answer(user, 'Yes, cancel it')
    await user.click(await main().findByRole('button', { name: 'Restore' }))
    expect(within(dialog()).getByText('It goes back to judging, just as it was before it was cancelled.')).toBeInTheDocument()
    await answer(user, 'Restore')
    expect(await screen.findByText('It is back in judging.')).toBeInTheDocument()
    expect(sentBody(fetch, `POST ${API}/transition/`)).toEqual({ status: 'judging' })

    await user.click(await main().findByRole('button', { name: 'Publish results' }))
    await answer(user, 'Publish results')
    expect(await screen.findByText('Results published')).toBeInTheDocument()
    expect(sentBody(fetch, `POST ${API}/transition/`)).toEqual({ status: 'completed' })
    expect(await (await panel('Getting it right')).findByText('6 of 6')).toBeInTheDocument()
    expect(main().queryAllByRole('button')).toHaveLength(0)
  })
})

describe('HackathonOverview', () => {
  const stage = (name: string) => screen.getByText(name, { selector: 'ol span' }).closest('li')!

  it('shows the stage, numbers, dates and set-up of an open hackathon', async () => {
    const { user } = open('', {
      participant_count: 14, team_count: 4, submission_count: 2,
      challenges: [challenge(1, 'Water')],
      criteria: [criterion(1, 'Impact', 2), criterion(2, 'Polish')],
    }, {
      [`GET ${API}/judges/`]: [judge({ evaluations: 1 }), judge({ id: 2, evaluations: 2 })],
    })
    await title()
    expect(stage('Open')).toHaveClass('border-brand-600')
    expect(stage('Open')).toHaveTextContent('Registration closes')
    expect(stage('Judging')).toHaveTextContent('Submissions close')
    expect(stage('Results out')).toHaveTextContent('Ends')

    expect(kpi('Participants')).toHaveTextContent('14Registration closes in 8 days')
    expect(kpi('Teams')).toHaveTextContent('1 to 4 people each')
    expect(kpi('Projects submitted')).toHaveTextContent('50% of teams, closes in 11 days')
    expect(await screen.findByText('3 of 4 scores in')).toBeInTheDocument()
    expect(kpi('Judging')).toHaveTextContent('75%')
    expect((await panel('Key dates')).getByText('in 9 days')).toBeInTheDocument()

    const setup = await panel('Set-up')
    expect(setup.getByText('Water')).toBeInTheDocument()
    expect(setup.getByText('out of 10, ×2')).toBeInTheDocument()
    expect(setup.getByText('out of 10')).toBeInTheDocument()

    const steps = await panel('Getting it right')
    expect(steps.getByText('4 of 6')).toBeInTheDocument()
    await user.click(steps.getByRole('link', { name: 'Start judging after submissions close' }))
    expect(currentPath()).toBe(BASE)
  })

  it('guides a new draft through set-up', async () => {
    const { user } = open('', { status: 'draft' }, { [`GET ${API}/judges/`]: [] })
    await title()
    expect(stage('Draft')).toHaveClass('border-brand-600')
    expect(kpi('Projects submitted')).toHaveTextContent('No teams yet')
    expect(await screen.findByText('0 judges, 0 criteria')).toBeInTheDocument()
    expect(kpi('Judging')).toHaveTextContent('–')
    expect(screen.getByText('None yet. Teams can build anything.')).toBeInTheDocument()
    expect(screen.getByText('None yet. Judges need at least one.')).toBeInTheDocument()
    expect((await panel('Getting it right')).getByText('0 of 6')).toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: 'Invite judges' }))
    expect(currentPath()).toBe(`${BASE}/judges`)
  })
})

describe('HackathonSetup', () => {
  it('adds and removes challenges', async () => {
    const { user, fetch } = open('/setup', { challenges: [challenge(1, 'Water', 'Clean water for all'), challenge(2, 'Energy')] }, {
      [`POST ${API}/challenges/`]: sequence(reply(400, { title: ['Already exists.'] }), reply(201, {})),
      [`DELETE ${API}/challenges/1/`]: reply(204),
    })
    const challenges = await panel('Challenges')
    expect(challenges.getByText('Clean water for all')).toBeInTheDocument()

    await user.type(challenges.getByLabelText('Title'), 'Food')
    await user.type(challenges.getByLabelText('Description'), 'Feed cities')
    await user.click(challenges.getByRole('button', { name: 'Add challenge' }))
    expect(await challenges.findByText('Already exists.')).toBeInTheDocument()
    await user.click(challenges.getByRole('button', { name: 'Add challenge' }))
    expect(await screen.findByText('Challenge added')).toBeInTheDocument()
    expect(sentBody(fetch, `POST ${API}/challenges/`)).toEqual({ title: 'Food', description: 'Feed cities' })
    expect(challenges.getByLabelText('Title')).toHaveValue('')

    await user.click(challenges.getAllByRole('button', { name: 'Remove' })[0])
    expect(within(dialog()).getByText('Remove this challenge?')).toBeInTheDocument()
    await answer(user, 'Cancel')
    expect(callsTo(fetch, `DELETE ${API}/challenges/1/`)).toHaveLength(0)
    await user.click(challenges.getAllByRole('button', { name: 'Remove' })[0])
    await answer(user, 'Remove')
    expect(await screen.findByText('Challenge removed')).toBeInTheDocument()
  })

  it('adds criteria with their weight, and removes them', async () => {
    const { user, fetch } = open('/setup', { criteria: [criterion(1, 'Impact', 3, 'Who it helps'), criterion(2, 'Polish')] }, {
      [`POST ${API}/criteria/`]: sequence(reply(400, { name: ['Already exists.'] }), reply(201, {})),
      [`DELETE ${API}/criteria/1/`]: sequence(reply(400, { detail: 'Criterion has scores.' }), reply(204)),
    })
    const criteria = await panel('Judging criteria')
    expect(criteria.getByText('75% of the score')).toBeInTheDocument()
    expect(criteria.getByText('Out of 10, weight 3. Who it helps')).toBeInTheDocument()
    expect(criteria.getByText('Out of 10, weight 1')).toBeInTheDocument()

    await user.type(criteria.getByLabelText('Name'), 'Design')
    await user.type(criteria.getByLabelText('What judges should look for'), 'Ease of use')
    await user.clear(criteria.getByLabelText('Highest score'))
    await user.type(criteria.getByLabelText('Highest score'), '20')
    await user.clear(criteria.getByLabelText('Weight'))
    await user.type(criteria.getByLabelText('Weight'), '2')
    await user.click(criteria.getByRole('button', { name: 'Add criterion' }))
    expect(await criteria.findByText('Already exists.')).toBeInTheDocument()
    await user.click(criteria.getByRole('button', { name: 'Add criterion' }))
    expect(await screen.findByText('Criterion added')).toBeInTheDocument()
    expect(sentBody(fetch, `POST ${API}/criteria/`)).toEqual({ name: 'Design', description: 'Ease of use', max_score: 20, weight: 2 })
    expect(criteria.getByLabelText('Highest score')).toHaveValue(10)

    await user.click(criteria.getAllByRole('button', { name: 'Remove' })[0])
    await answer(user, 'Remove')
    expect(await screen.findByText('Could not remove the criterion')).toBeInTheDocument()
    expect(criteria.getByRole('alert')).toHaveTextContent('Criterion has scores.')
    await user.click(criteria.getAllByRole('button', { name: 'Remove' })[0])
    await answer(user, 'Remove')
    expect(await screen.findByText('Criterion removed')).toBeInTheDocument()
  })

  it('locks the criteria once judging starts', async () => {
    open('/setup', { status: 'judging', criteria: [criterion(1, 'Impact')] })
    const criteria = await panel('Judging criteria')
    expect(criteria.getByText('Criteria are fixed once judging starts.')).toBeInTheDocument()
    expect(criteria.queryByRole('button')).not.toBeInTheDocument()
  })
})

describe('HackathonTeams', () => {
  const teams = [
    team({ id: 1, name: 'Rockets', has_submission: true, members: [
      { id: 1, person: person({ name: 'Wanjiru' }), is_leader: true },
      { id: 2, person: person({ name: 'Otieno' }), is_leader: false },
    ] }),
    team({ id: 2, name: 'Comets' }),
  ]

  it('lists teams and who submitted, and exports them once there are any', async () => {
    const empty = open('/teams', {}, { [`GET ${API}/teams/`]: [] })
    expect(await screen.findByRole('button', { name: 'Export CSV' })).toBeDisabled()
    empty.unmount()

    const downloads = captureDownloads()
    const { user } = open('/teams', {}, { [`GET ${API}/teams/`]: teams })
    expect(await screen.findByText('2 teams')).toBeInTheDocument()
    expect(screen.getByText(/1 submitted a project/)).toBeInTheDocument()
    expect(bodyRows()[0]).toHaveTextContent('Comets')
    expect(within(bodyRows()[0]).getByText('Not yet')).toBeInTheDocument()
    expect(within(bodyRows()[1]).getByText('Wanjiru (lead), Otieno')).toBeInTheDocument()
    expect(within(bodyRows()[1]).getByText('Submitted')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Export CSV' }))
    expect(downloads.name()).toBe('climate-hack-teams.csv')
    expect(await downloads.text()).toBe('"Team","Members","Size","Submitted"\n"Rockets","Wanjiru; Otieno","2","yes"\n"Comets","Wanjiru Kamau","1","no"')
  })
})

describe('HackathonJudges', () => {
  const judges = [
    judge({ id: 1, person: person({ name: 'Ann Fresh' }), email: 'ann@example.com', evaluations: 0 }),
    judge({ id: 2, person: person({ name: 'Ben Busy' }), email: 'ben@example.com', evaluations: 1 }),
    judge({ id: 3, person: person({ name: 'Cy Done' }), email: 'cy@example.com', evaluations: 3 }),
  ]
  const removeButton = (name: string) => within(bodyRows().find((r) => r.textContent?.includes(name))!).getByRole('button', { name: 'Remove' })

  it('shows each judge’s progress and removes judges after warning about their scores', async () => {
    const { user, fetch } = open('/judges', { submission_count: 3 }, {
      [`GET ${API}/judges/`]: judges,
      [`DELETE ${API}/judges/1/`]: reply(204),
      [`DELETE ${API}/judges/3/`]: reply(400, { detail: 'Results are out.' }),
    })
    expect(await screen.findByText('Judges (3)')).toBeInTheDocument()
    expect(screen.getByText('3/3')).toBeInTheDocument()
    expect(screen.getByRole('meter', { name: 'Ann Fresh: projects scored' })).toHaveAttribute('aria-valuemax', '3')

    fireEvent.click(removeButton('Ben Busy'))
    expect(await screen.findByText('They have scored 1 project. Those scores are deleted too.')).toBeInTheDocument()
    await answer(user, 'Cancel')

    fireEvent.click(removeButton('Cy Done'))
    expect(await screen.findByText('They have scored 3 projects. Those scores are deleted too.')).toBeInTheDocument()
    await answer(user, 'Remove judge')
    expect(await screen.findByText('Could not remove the judge')).toBeInTheDocument()
    expect(screen.getByText('Results are out.')).toBeInTheDocument()

    fireEvent.click(removeButton('Ann Fresh'))
    expect(await screen.findByText('They have not scored anything yet.')).toBeInTheDocument()
    await answer(user, 'Remove judge')
    expect(await screen.findByText('Ann Fresh can no longer score projects.')).toBeInTheDocument()
    expect(callsTo(fetch, `DELETE ${API}/judges/2/`)).toHaveLength(0)
  })

  it('invites a judge by email', async () => {
    const { user, fetch } = open('/judges', {}, {
      [`GET ${API}/judges/`]: [],
      [`POST ${API}/judges/`]: sequence(reply(400, { email: ['No member with that email.'] }), reply(201, {})),
    })
    expect(await screen.findByText('Judges (0)')).toBeInTheDocument()
    const invite = await panel('Invite a judge')
    await user.type(invite.getByLabelText('Email'), 'new@example.com')
    await user.click(invite.getByRole('button', { name: 'Add judge' }))
    expect(await invite.findByText('No member with that email.')).toBeInTheDocument()

    await user.click(invite.getByRole('button', { name: 'Add judge' }))
    expect(await screen.findByText('new@example.com can now score projects.')).toBeInTheDocument()
    expect(sentBody(fetch, `POST ${API}/judges/`)).toEqual({ email: 'new@example.com' })
    expect(invite.getByLabelText('Email')).toHaveValue('')
  })
})

describe('HackathonLeaderboard', () => {
  it('shows the ranking to managers only until the results are public, and says when there is none', async () => {
    const { unmount } = open('/leaderboard', {}, { [`GET ${API}/leaderboard/`]: [leaderboardRow()] })
    expect(await screen.findByText('Managers only')).toBeInTheDocument()
    expect(screen.getByText(/Only managers see this until you publish the results/)).toBeInTheDocument()
    expect(screen.getByText('Solar tracker')).toBeInTheDocument()
    unmount()

    const published = open('/leaderboard', { status: 'completed', results_published: true }, { [`GET ${API}/leaderboard/`]: [leaderboardRow()] })
    expect(await screen.findByText('Public')).toBeInTheDocument()
    expect(screen.getByText('These results are public.')).toBeInTheDocument()
    published.unmount()

    open('/leaderboard', {}, { [`GET ${API}/leaderboard/`]: [] })
    expect(await screen.findByText('No projects have been submitted yet.')).toBeInTheDocument()
  })
})

describe('HackathonAnnouncements', () => {
  const editor = () => document.querySelector<HTMLElement>('.ProseMirror')!
  const write = async (user: UserEvent, heading: string, body: string) => {
    const form = await panel('New announcement')
    await user.type(form.getByLabelText('Title'), heading)
    await user.click(editor())
    await user.paste(body)
    return form
  }

  it('posts announcements, saying how many people were emailed, and removes one after asking', async () => {
    // The server keeps what is posted, and says how many it emailed when asked to email.
    const posted: Announcement[] = []
    const emailed = [3, 1]
    let attempts = 0
    const save = (init: RequestInit) => {
      const { title, notify } = JSON.parse(String(init.body))
      const saved = announcement({ id: posted.length + 1, title })
      posted.push(saved)
      return notify ? { ...saved, emailed_to: emailed.shift() } : saved
    }
    const { user, fetch } = open('/announcements', {}, {
      [`GET ${API}/announcements/`]: () => posted,
      [`POST ${API}/announcements/`]: (init: RequestInit) => (attempts++ ? save(init) : reply(400, { title: ['Too long.'] })),
      [`DELETE ${API}/announcements/1/`]: reply(204),
    })
    expect(await screen.findByText('No announcements yet')).toBeInTheDocument()

    const form = await write(user, 'Kick-off', 'We start at nine')
    await user.click(form.getByRole('button', { name: 'Post announcement' }))
    expect(await form.findByText('Too long.')).toBeInTheDocument()
    await user.click(form.getByRole('button', { name: 'Post announcement' }))
    expect(await screen.findByText('It is on the hackathon page and was emailed to 3 people.')).toBeInTheDocument()
    expect(sentBody(fetch, `POST ${API}/announcements/`)).toEqual({ title: 'Kick-off', body: '<p>We start at nine</p>', notify: true })
    expect(form.getByLabelText('Title')).toHaveValue('')
    expect(await screen.findByRole('heading', { name: 'Posted (1)' })).toBeInTheDocument()

    await write(user, 'Lunch', 'Lunch is served')
    await user.click(form.getByRole('button', { name: 'Post announcement' }))
    expect(await screen.findByText('It is on the hackathon page and was emailed to 1 person.')).toBeInTheDocument()

    await user.click(form.getByRole('checkbox', { name: 'Also email every team member and judge' }))
    await write(user, 'Quiet', 'No email')
    await user.click(form.getByRole('button', { name: 'Post announcement' }))
    expect(await screen.findByText('It is on the hackathon page.')).toBeInTheDocument()
    expect(sentBody(fetch, `POST ${API}/announcements/`)).toMatchObject({ title: 'Quiet', notify: false })

    await user.click((await screen.findAllByRole('button', { name: 'Remove' }))[0])
    expect(within(dialog()).getByText(/“Kick-off” disappears from the hackathon page/)).toBeInTheDocument()
    await answer(user, 'Cancel')
    expect(callsTo(fetch, `DELETE ${API}/announcements/1/`)).toHaveLength(0)
    await user.click(screen.getAllByRole('button', { name: 'Remove' })[0])
    await answer(user, 'Remove')
    expect(await screen.findByText('Announcement removed')).toBeInTheDocument()
  })
})
