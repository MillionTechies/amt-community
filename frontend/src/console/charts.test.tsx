import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DailyBars } from './charts'

// 22 Nov 2026, mid-afternoon in the browser's own time zone.
const daysAgo = (n: number, hour = 10) => new Date(2026, 10, 22 - n, hour).toISOString()

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 10, 22, 15))
})

describe('DailyBars', () => {
  it('shows at least a week, one bar a day, with its count on hover or focus', async () => {
    const user = userEvent.setup()
    render(<DailyBars dates={[daysAgo(0), daysAgo(0, 8), daysAgo(2)]} noun="sign-up" />)
    expect(screen.getByText('3 sign-ups in the last 7 days.')).toBeInTheDocument()
    expect(screen.getByLabelText('21 Nov: 0 sign-ups')).toBeInTheDocument()
    expect(screen.getByLabelText('20 Nov: 1 sign-up')).toBeInTheDocument()
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(8)

    const bar = screen.getByLabelText('22 Nov: 2 sign-ups')
    const tooltip = () => screen.queryByText('2 sign-ups', { selector: 'span' })
    await user.hover(bar)
    expect(tooltip()).toBeInTheDocument()
    await user.unhover(bar)
    expect(tooltip()).not.toBeInTheDocument()
    fireEvent.focus(bar)
    expect(tooltip()).toBeInTheDocument()
    fireEvent.blur(bar)
    expect(tooltip()).not.toBeInTheDocument()
  })

  it('stops at 30 days and counts older ones in the total', () => {
    render(<DailyBars dates={[daysAgo(0), daysAgo(100)]} noun="sign-up" />)
    expect(screen.getByText('1 sign-up in the last 30 days, 2 sign-ups in all.')).toBeInTheDocument()
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(31)
  })
})
