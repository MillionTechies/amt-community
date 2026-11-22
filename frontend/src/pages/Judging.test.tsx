import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { JudgedSubmission } from '../api'
import { mockFetch, reply, sentBody } from '../test/fetch'
import { hackathon, submission } from '../test/fixtures'
import { renderApp } from '../test/render'
import Judging from './Judging'

const criteria = [
  { id: 1, name: 'Impact', description: 'Does it matter?', max_score: 10, weight: 1 },
  { id: 2, name: 'Code', description: '', max_score: 5, weight: 1 },
]

const judged = (overrides: Partial<JudgedSubmission> = {}): JudgedSubmission => ({
  ...submission(),
  members: ['Wanjiru', 'Otieno'],
  my_evaluation: null,
  ...overrides,
})

const open = () => renderApp(<Judging />, { route: '/hackathons/climate-hack/judge', path: '/hackathons/:slug/judge' })

describe('Judging page', () => {
  it.each([
    ['the request fails', reply(500, { detail: 'Server error.' }), 'Server error.'],
    ['the API returns nothing', null, 'Hackathon not found.'],
    ['the member is not a judge', hackathon(), 'You are not a judge for this hackathon.'],
  ])('turns the member away when %s', async (_, answer, message) => {
    mockFetch({ 'GET /hackathons/climate-hack/': answer })
    open()
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()
    expect(await screen.findByText(message)).toBeInTheDocument()
  })

  it('lets judges read projects before scoring opens, and not score them once judging is over', async () => {
    mockFetch({
      'GET /hackathons/climate-hack/': hackathon({ is_judge: true, criteria }),
      'GET /hackathons/climate-hack/submissions/': [judged({ challenge: { id: 3, title: 'Water', description: '' } })],
    })
    const { unmount } = open()
    expect(await screen.findByText(/Scoring opens when the organisers close submissions/)).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Solar tracker' })).toBeInTheDocument()
    expect(screen.getByText('Water')).toBeInTheDocument()
    expect(screen.getByText('Not scored')).toBeInTheDocument()
    expect(screen.getByText('You have scored 0 of 1 projects.')).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: 'Impact (0 to 10)' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: /scores/ })).not.toBeInTheDocument()
    unmount()

    mockFetch({
      'GET /hackathons/climate-hack/': hackathon({ is_judge: true, status: 'completed' }),
      'GET /hackathons/climate-hack/submissions/': [],
    })
    open()
    expect(await screen.findByText('Judging is over. Scores can no longer be changed.')).toBeInTheDocument()
    expect(await screen.findByText('No projects have been submitted yet.')).toBeInTheDocument()
  })

  it('scores new projects and updates scores already given while judging is open', async () => {
    const fetch = mockFetch({
      'GET /hackathons/climate-hack/': hackathon({ is_judge: true, status: 'judging', criteria }),
      'GET /hackathons/climate-hack/submissions/': [
        judged(),
        judged({ id: 2, title: 'Pump finder', my_evaluation: { id: 9, comment: 'Good', scores: [{ criterion: 1, value: 7 }, { criterion: 2, value: 3 }] } }),
      ],
      'PUT /hackathons/climate-hack/submissions/1/evaluation/': {},
      'PUT /hackathons/climate-hack/submissions/2/evaluation/': reply(400, { detail: 'Scores are locked.' }),
    })
    const { user } = open()
    const card = async (title: string) => (await screen.findByRole('heading', { name: title })).closest('div')!.parentElement!

    const scored = within(await card('Pump finder'))
    expect(scored.getByText('Scored')).toBeInTheDocument()
    expect(screen.getByText('You have scored 1 of 2 projects.')).toBeInTheDocument()
    expect(scored.getByRole('spinbutton', { name: 'Impact (0 to 10)' })).toHaveValue(7)
    expect(scored.getByRole('textbox', { name: 'Comment (optional)' })).toHaveValue('Good')
    await user.click(scored.getByRole('button', { name: 'Update scores' }))
    expect(await scored.findByRole('alert')).toHaveTextContent('Scores are locked.')

    const fresh = within(await card('Solar tracker'))
    await user.type(fresh.getByRole('spinbutton', { name: 'Impact (0 to 10)' }), '8')
    await user.type(fresh.getByRole('spinbutton', { name: 'Code (0 to 5)' }), '4')
    await user.type(fresh.getByRole('textbox', { name: 'Comment (optional)' }), 'Nice.')
    expect(screen.queryByText(/Scoring opens/)).not.toBeInTheDocument()
    await user.click(fresh.getByRole('button', { name: 'Save scores' }))
    expect(await fresh.findByText('Scores saved.')).toBeInTheDocument()
    expect(sentBody(fetch, 'PUT /hackathons/climate-hack/submissions/1/evaluation/')).toEqual({
      comment: 'Nice.',
      scores: [{ criterion: 1, value: 8 }, { criterion: 2, value: 4 }],
    })
  })
})
