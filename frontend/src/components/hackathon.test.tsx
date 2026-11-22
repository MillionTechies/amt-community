import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { leaderboardRow, submission } from '../test/fixtures'
import { Leaderboard, ProjectLinks } from './hackathon'

describe('ProjectLinks', () => {
  it('links only to what the team provided', () => {
    render(<ProjectLinks submission={submission({ demo_url: 'https://demo.test', video_url: '' })} />)
    expect(screen.getByRole('link', { name: 'Repository' })).toHaveAttribute('href', 'https://github.com/example/solar')
    expect(screen.getByRole('link', { name: 'Live demo' })).toHaveAttribute('target', '_blank')
    expect(screen.queryByRole('link', { name: 'Video' })).not.toBeInTheDocument()
  })
})

describe('Leaderboard', () => {
  it('ranks submissions with their scores and judges', () => {
    render(
      <Leaderboard
        rows={[
          leaderboardRow(),
          leaderboardRow({
            rank: 2,
            score: 70,
            evaluations: 1,
            submission: submission({ id: 2, title: 'Water meter', team_name: 'Drops', challenge: { id: 1, title: 'Water', description: '' } }),
          }),
          leaderboardRow({ rank: null, score: null, evaluations: 0, submission: submission({ id: 3, title: 'Late entry' }) }),
        ]}
      />,
    )
    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(3)
    expect(screen.getByLabelText('Rank 1')).toBeInTheDocument()
    expect(screen.getByLabelText('Rank 2')).toBeInTheDocument()
    expect(screen.getByLabelText('Not ranked')).toHaveTextContent('-')
    expect(screen.getByText('87.3%')).toBeInTheDocument()
    expect(screen.getByText('Water')).toBeInTheDocument()
    expect(screen.getByText('by Drops')).toBeInTheDocument()
    expect(screen.getByText('1 of 3 judges')).toBeInTheDocument()
    expect(screen.getByText('No scores')).toBeInTheDocument()
  })
})
