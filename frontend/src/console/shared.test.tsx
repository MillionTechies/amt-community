import { render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { currentPath, renderApp } from '../test/render'
import { ConsoleHeader, FilterChips, Kpi, Meter, Panel, relative } from './shared'

describe('ConsoleHeader', () => {
  it('shows the title, with a subtitle and actions when given', () => {
    const { rerender } = render(<ConsoleHeader title="Events" subtitle="Every event you run." actions={<button type="button">New event</button>} />)
    expect(screen.getByRole('heading', { level: 1, name: 'Events' })).toBeInTheDocument()
    expect(screen.getByText('Every event you run.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New event' })).toBeInTheDocument()

    rerender(<ConsoleHeader title="Events" />)
    expect(screen.queryByText('Every event you run.')).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})

describe('Kpi', () => {
  it('links to more detail when it has somewhere to go', async () => {
    const { user } = renderApp(<Kpi label="Registered" value={12} icon="users" note="Of 40 places" to="/manage/events/demo/registrations" />)
    expect(screen.getByText('Of 40 places')).toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: /Registered/ }))
    expect(currentPath()).toBe('/manage/events/demo/registrations')
  })

  it('is a plain tile otherwise', () => {
    render(<Kpi label="Drafts" value={0} icon="pencil" />)
    expect(screen.getByText('Drafts')).toBeInTheDocument()
    expect(screen.getByText('0')).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})

describe('Meter', () => {
  const fill = (name: string) => screen.getByRole('meter', { name }).firstElementChild as HTMLElement

  it('fills to the share used, capped at full', () => {
    render(
      <>
        <Meter value={1} max={4} label="Quarter" />
        <Meter value={9} max={4} label="Over" />
        <Meter value={3} max={0} label="Nothing to fill" />
      </>,
    )
    expect(fill('Quarter')).toHaveStyle({ width: '25%' })
    expect(fill('Over')).toHaveStyle({ width: '100%' })
    expect(fill('Nothing to fill')).toHaveStyle({ width: '0%' })
    expect(screen.getByRole('meter', { name: 'Quarter' })).toHaveAttribute('aria-valuenow', '1')
  })

  it('turns amber when a capacity meter is nearly full', () => {
    render(
      <>
        <Meter value={9} max={10} label="Nearly full" warn />
        <Meter value={5} max={10} label="Half full" warn />
        <Meter value={10} max={10} label="Full but fine" />
      </>,
    )
    expect(fill('Nearly full')).toHaveClass('bg-amber-500')
    expect(fill('Half full')).toHaveClass('bg-brand-600')
    expect(fill('Full but fine')).toHaveClass('bg-brand-600')
  })
})

describe('Panel', () => {
  it('pads its content unless it runs edge to edge', () => {
    render(
      <>
        <Panel title="Padded" action={<a href="/x">See all</a>}><p>Inside</p></Panel>
        <Panel title="Flush" flush><p>Table</p></Panel>
      </>,
    )
    expect(screen.getByRole('heading', { name: 'Padded' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'See all' })).toBeInTheDocument()
    expect(screen.getByText('Inside').parentElement).toHaveClass('p-5')
    expect(screen.getByText('Table').parentElement).not.toHaveClass('p-5')
  })
})

describe('FilterChips', () => {
  function Chips({ onChange }: { onChange: (id: string) => void }) {
    const [current, setCurrent] = useState('all')
    return (
      <FilterChips
        current={current}
        onChange={(id) => {
          setCurrent(id)
          onChange(id)
        }}
        options={[
          { id: 'all', label: 'All', count: 3 },
          { id: 'draft', label: 'Drafts', count: 1 },
          { id: 'other', label: 'Other' },
        ]}
      />
    )
  }

  it('marks the chosen filter and reports a change', async () => {
    const onChange = vi.fn()
    const { user } = renderApp(<Chips onChange={onChange} />)
    expect(screen.getByRole('tab', { name: 'All3' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Other' })).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Drafts1' }))
    expect(onChange).toHaveBeenCalledWith('draft')
    expect(screen.getByRole('tab', { name: 'Drafts1' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'All3' })).toHaveAttribute('aria-selected', 'false')
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
