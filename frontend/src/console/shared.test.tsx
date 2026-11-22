import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { Meter, relative } from './shared'

// The other pieces (headers, tiles, panels, filter chips) are exercised through the pages that use them.

describe('Meter', () => {
  const fill = (name: string) => screen.getByRole('meter', { name }).firstElementChild as HTMLElement

  it('fills to the share used, capped at full, and warns when a capacity is nearly full', () => {
    render(
      <>
        <Meter value={1} max={4} label="Quarter" />
        <Meter value={3} max={0} label="Nothing to fill" />
        <Meter value={9} max={10} label="Nearly full" warn />
        <Meter value={5} max={10} label="Half full" warn />
        <Meter value={12} max={10} label="Over, but fine" />
      </>,
    )
    expect(screen.getByRole('meter', { name: 'Quarter' })).toHaveAttribute('aria-valuenow', '1')
    expect(fill('Quarter')).toHaveStyle({ width: '25%' })
    expect(fill('Nothing to fill')).toHaveStyle({ width: '0%' })
    expect(fill('Over, but fine')).toHaveStyle({ width: '100%' })
    expect(fill('Over, but fine')).toHaveClass('bg-brand-600')
    expect(fill('Nearly full')).toHaveClass('bg-amber-500')
    expect(fill('Half full')).toHaveClass('bg-brand-600')
  })
})

describe('relative', () => {
  it('says how far away a date is, in words', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-22T12:00:00Z'))
    expect(relative('2026-11-22T12:00:00Z')).toBe('today')
    expect(relative('2026-11-23T12:00:00Z')).toBe('tomorrow')
    expect(relative('2026-11-21T12:00:00Z')).toBe('yesterday')
    expect(relative('2026-11-25T12:00:00Z')).toBe('in 3 days')
    expect(relative('2026-11-19T12:00:00Z')).toBe('3 days ago')
    expect(relative('2026-12-13T12:00:00Z')).toBe('in 3 weeks')
    expect(relative('2027-03-22T12:00:00Z')).toBe('in 4 months')
    expect(relative('2026-08-24T12:00:00Z')).toBe('3 months ago')
  })
})
