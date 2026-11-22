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
  it('shows an error when the hackathon cannot be loaded', async () => {
    mockFetch({})
    open()
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()
    expect(await screen.findByRole('alert')).toHaveTextContent('No mock for GET /hackathons/climate-hack/')
  })

  it('says the hackathon was not found when the API returns nothing', async () => {
    mockFetch({ 'GET /hackathons/climate-hack/': null })
    open()
    expect(await screen.findByRole('alert')).toHaveTextContent('Hackathon not found.')
  })

  it('turns away members who are not judges', async () => {
    mockFetch({ 'GET /hackathons/climate-hack/': hackathon() })
    open()
    expect(await screen.findByText('You are not a judge for this hackathon.')).toBeInTheDocument()
  })

  it('lets judges read projects before scoring opens', async () => {
    mockFetch({
      'GET /hackathons/climate-hack/': hackathon({ is_judge: true, criteria }),
      'GET /hackathons/climate-hack/submissions/': [judged({ challenge: { id: 3, title: 'Water', description: '' } })],
    })
    open()
    expect(await screen.findByText(/Scoring opens when the organisers close submissions/)).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Solar tracker' })).toBeInTheDocument()
    expect(screen.getByText('Water')).toBeInTheDocument()
    expect(screen.getByText('Not scored')).toBeInTheDocument()
    expect(screen.getByText('Team Rocket: Wanjiru, Otieno')).toBeInTheDocument()
    expect(screen.getByText('You have scored 0 of 1 projects.')).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: 'Impact (0 to 10)' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: /scores/ })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Hackathon page' })).toHaveAttribute('href', '/hackathons/climate-hack')
  })

  it('says when judging is over', async () => {
    mockFetch({
      'GET /hackathons/climate-hack/': hackathon({ is_judge: true, status: 'completed' }),
      'GET /hackathons/climate-hack/submissions/': [],
    })
    open()
    expect(await screen.findByText('Judging is over. Scores can no longer be changed.')).toBeInTheDocument()
    expect(await screen.findByText('No projects have been submitted yet.')).toBeInTheDocument()
  })

  it('scores a project while judging is open', async () => {
    const fetch = mockFetch({
      'GET /hackathons/climate-hack/': hackathon({ is_judge: true, status: 'judging', criteria }),
      'GET /hackathons/climate-hack/submissions/': [judged()],
      'PUT /hackathons/climate-hack/submissions/1/evaluation/': {},
    })
    const { user } = open()
    await user.type(await screen.findByRole('spinbutton', { name: 'Impact (0 to 10)' }), '8')
    await user.type(screen.getByRole('spinbutton', { name: 'Code (0 to 5)' }), '4')
    await user.type(screen.getByRole('textbox', { name: 'Comment (optional)' }), 'Nice.')
    expect(screen.queryByText(/Scoring opens/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save scores' }))
    expect(await screen.findByText('Scores saved.')).toBeInTheDocument()
    expect(sentBody(fetch, 'PUT /hackathons/climate-hack/submissions/1/evaluation/')).toEqual({
      comment: 'Nice.',
      scores: [{ criterion: 1, value: 8 }, { criterion: 2, value: 4 }],
    })
  })

  it('updates scores already given and shows a rejected save', async () => {
    mockFetch({
      'GET /hackathons/climate-hack/': hackathon({ is_judge: true, status: 'judging', criteria }),
      'GET /hackathons/climate-hack/submissions/': [
        judged({ my_evaluation: { id: 9, comment: 'Good', scores: [{ criterion: 1, value: 7 }, { criterion: 2, value: 3 }] } }),
      ],
      'PUT /hackathons/climate-hack/submissions/1/evaluation/': reply(400, { detail: 'Scores are locked.' }),
    })
    const { user } = open()
    const card = (await screen.findByRole('heading', { name: 'Solar tracker' })).closest('div')!.parentElement!
    expect(within(card).getByText('Scored')).toBeInTheDocument()
    expect(screen.getByText('You have scored 1 of 1 projects.')).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: 'Impact (0 to 10)' })).toHaveValue(7)
    expect(screen.getByRole('textbox', { name: 'Comment (optional)' })).toHaveValue('Good')
    await user.click(screen.getByRole('button', { name: 'Update scores' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Scores are locked.')
  })
})
