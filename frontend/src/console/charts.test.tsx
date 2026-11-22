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
  it('shows at least a week, one bar a day, with a table for screen readers', () => {
    render(<DailyBars dates={[daysAgo(0), daysAgo(0, 8), daysAgo(2)]} noun="sign-up" />)
    expect(screen.getByText('3 sign-ups in the last 7 days.')).toBeInTheDocument()
    expect(screen.getByLabelText('22 Nov: 2 sign-ups')).toBeInTheDocument()
    expect(screen.getByLabelText('21 Nov: 0 sign-ups')).toBeInTheDocument()
    expect(screen.getByLabelText('20 Nov: 1 sign-up')).toBeInTheDocument()
    expect(screen.getByText('16 Nov', { selector: 'span' })).toBeInTheDocument()

    const table = screen.getByRole('table')
    expect(within(table).getByText('sign-ups per day')).toBeInTheDocument()
    expect(within(table).getAllByRole('row')).toHaveLength(8)
  })

  it('stops at 30 days and counts older ones in the total', () => {
    render(<DailyBars dates={[daysAgo(0), daysAgo(100)]} noun="sign-up" />)
    expect(screen.getByText('1 sign-up in the last 30 days, 2 sign-ups in all.')).toBeInTheDocument()
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(31)
  })

  it('shows a bar’s count on hover or focus', async () => {
    const user = userEvent.setup()
    render(<DailyBars dates={[daysAgo(1), daysAgo(1), daysAgo(9)]} noun="sign-up" />)
    expect(screen.getByText('3 sign-ups in the last 10 days.')).toBeInTheDocument()
    const bar = screen.getByLabelText('21 Nov: 2 sign-ups')
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
})
