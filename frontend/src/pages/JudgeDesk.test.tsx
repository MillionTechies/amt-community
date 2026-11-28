import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { mockFetch, page, reply } from '../test/fetch'
import { hackathon } from '../test/fixtures'
import { renderApp } from '../test/render'
import JudgeDesk from './JudgeDesk'

const LIST = 'GET /hackathons/?scope=judging&ordering=-starts_at'

describe('Judge desk', () => {
  it('lists the hackathons the member judges and their scoring progress', async () => {
    mockFetch({
      [LIST]: page([
        hackathon({ is_judge: true, status: 'judging', my_scores: 2, submission_count: 5 }),
        hackathon({ slug: 'past', title: 'Past hack', is_judge: true, status: 'completed', my_scores: null, submission_count: 0 }),
      ]),
    })
    renderApp(<JudgeDesk />)
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()
    expect(await screen.findByText('2 of 5 projects scored')).toBeInTheDocument()
    expect(screen.getByText('Scoring is open.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Score projects' })).toHaveAttribute('href', '/hackathons/climate-hack/judge')
    expect(screen.getByText('0 of 0 projects scored')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open' })).toHaveAttribute('href', '/hackathons/past/judge')
  })

  it('says when there is nothing to judge, or the list fails', async () => {
    mockFetch({ [LIST]: page([]) })
    const { unmount } = renderApp(<JudgeDesk />)
    expect(await screen.findByText(/You are not judging any hackathons/)).toBeInTheDocument()
    unmount()
    mockFetch({ [LIST]: reply(500, { detail: 'Server error.' }) })
    renderApp(<JudgeDesk />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Server error.')
  })
})
