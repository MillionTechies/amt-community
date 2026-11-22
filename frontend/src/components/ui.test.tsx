import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { currentPath, renderApp } from '../test/render'
import {
  Badge,
  Button,
  Card,
  Empty,
  ErrorNote,
  Field,
  Input,
  LinkButton,
  Notice,
  PageHeader,
  Prose,
  Section,
  Select,
  Spinner,
  Stat,
  StatusBadge,
  Tabs,
  Textarea,
  formatDate,
  formatDateTime,
  formatRange,
  fromLocalInput,
  label,
  toLocalInput,
} from './ui'

describe('buttons', () => {
  it('is a plain button that does not submit forms', async () => {
    const onClick = vi.fn()
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault())
    render(
      <form onSubmit={onSubmit}>
        <Button onClick={onClick}>Save</Button>
        <Button variant="danger" className="extra">Delete</Button>
      </form>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onClick).toHaveBeenCalled()
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveClass('extra', 'text-red-700')
  })

  it('links to another page', async () => {
    const { user } = renderApp(
      <>
        <LinkButton to="/events">Browse events</LinkButton>
        <LinkButton to="/hackathons" variant="secondary">Hackathons</LinkButton>
      </>,
    )
    await user.click(screen.getByRole('link', { name: 'Hackathons' }))
    expect(currentPath()).toBe('/hackathons')
    expect(screen.getByRole('link', { name: 'Browse events' })).toHaveAttribute('href', '/events')
  })
})

describe('layout pieces', () => {
  it('shows a section with its title and action', () => {
    render(
      <Section title="Speakers" action={<Button>Add</Button>}>
        <p>Nobody yet</p>
      </Section>,
    )
    expect(screen.getByRole('heading', { name: 'Speakers' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument()
    expect(screen.getByText('Nobody yet')).toBeInTheDocument()
  })

  it('shows a card with extra classes', () => {
    render(<Card className="mt-4">Inside</Card>)
    expect(screen.getByText('Inside')).toHaveClass('mt-4')
  })

  it('shows a page header with eyebrow, subtitle and action', () => {
    render(<PageHeader title="Events" eyebrow="community" subtitle="What is on" action={<Button>New</Button>} />)
    expect(screen.getByRole('heading', { level: 1, name: 'Events' })).toBeInTheDocument()
    expect(screen.getByText('community')).toBeInTheDocument()
    expect(screen.getByText('What is on')).toBeInTheDocument()
  })

  it('shows just the title when that is all there is', () => {
    const { container } = render(<PageHeader title="Profile" />)
    expect(container.querySelectorAll('p')).toHaveLength(0)
  })

  it('shows a spinner, an empty state, a stat and prose', () => {
    render(
      <>
        <Spinner />
        <Empty>No events yet.</Empty>
        <Stat label="Members" value={42} />
        <Prose>{'Line one\nLine two'}</Prose>
      </>,
    )
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()
    expect(screen.getByText('No events yet.')).toBeInTheDocument()
    expect(screen.getByText('42')).toBeInTheDocument()
    expect(screen.getByText('Members')).toBeInTheDocument()
    expect(screen.getByText(/Line one/)).toHaveClass('whitespace-pre-line')
  })
})

describe('badges and notes', () => {
  it('names statuses, calling published events "Open"', () => {
    render(
      <>
        <StatusBadge status="published" />
        <StatusBadge status="waitlisted" />
        <StatusBadge status="checked_in" />
        <Badge>Plain</Badge>
      </>,
    )
    expect(screen.getByText('Open')).toHaveClass('bg-brand-100')
    expect(screen.getByText('Waitlisted')).toHaveClass('bg-amber-100')
    expect(screen.getByText('Checked in')).toHaveClass('bg-stone-200')
    expect(screen.getByText('Plain')).toHaveClass('bg-stone-200')
  })

  it('shows an error message from an Error or anything else, and nothing without one', () => {
    const { rerender } = render(<ErrorNote error={new Error('Not allowed.')} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Not allowed.')
    rerender(<ErrorNote error="Plain text" />)
    expect(screen.getByRole('alert')).toHaveTextContent('Plain text')
    rerender(<ErrorNote error={null} />)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows notices in green or amber', () => {
    render(
      <>
        <Notice>Saved.</Notice>
        <Notice tone="amber">Check this.</Notice>
      </>,
    )
    expect(screen.getByText('Saved.')).toHaveClass('bg-brand-50')
    expect(screen.getByText('Check this.')).toHaveClass('bg-amber-50')
  })
})

describe('form fields', () => {
  it('labels an input and shows its hint', () => {
    render(
      <Field label="Title" hint="Keep it short">
        <Input defaultValue="Demo" className="w-1/2" />
      </Field>,
    )
    expect(screen.getByLabelText('Title')).toHaveValue('Demo')
    expect(screen.getByLabelText('Title')).toHaveClass('w-1/2')
    expect(screen.getByText('Keep it short')).toBeInTheDocument()
  })

  it('shows the error in place of the hint', () => {
    render(
      <Field label="Summary" hint="One line" error="Required.">
        <Textarea />
      </Field>,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('Required.')
    expect(screen.queryByText('One line')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Summary')).toHaveAttribute('rows', '4')
  })

  it('groups a control with several parts', () => {
    render(
      <Field label="Type" group>
        <Select defaultValue="b">
          <option value="a">A</option>
          <option value="b">B</option>
        </Select>
      </Field>,
    )
    expect(screen.getByRole('group', { name: 'Type' })).toBeInTheDocument()
    expect(screen.getByRole('combobox')).toHaveValue('b')
  })
})

describe('Tabs', () => {
  function Demo() {
    const [tab, setTab] = useState<'about' | 'people'>('about')
    return (
      <>
        <Tabs tabs={[{ id: 'about', label: 'About' }, { id: 'people', label: 'People' }]} current={tab} onChange={setTab} />
        <p>Showing {tab}</p>
      </>
    )
  }

  it('switches to the clicked tab', async () => {
    render(<Demo />)
    expect(screen.getByRole('tab', { name: 'About' })).toHaveAttribute('aria-selected', 'true')
    await userEvent.click(screen.getByRole('tab', { name: 'People' }))
    expect(screen.getByRole('tab', { name: 'People' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Showing people')).toBeInTheDocument()
  })
})

describe('text helpers', () => {
  it('turns codes into labels', () => {
    expect(label('in_person')).toBe('In person')
    expect(label('')).toBe('')
  })

  it('formats dates in British English', () => {
    const iso = new Date(2026, 11, 12, 9, 0).toISOString()
    expect(formatDate(iso)).toBe('12 Dec 2026')
    expect(formatDateTime(iso)).toBe('12 Dec 2026, 09:00')
  })

  it('formats a range on one day with just the end time', () => {
    const start = new Date(2026, 11, 12, 9, 0).toISOString()
    const end = new Date(2026, 11, 12, 12, 0).toISOString()
    expect(formatRange(start, end)).toBe('12 Dec 2026, 09:00 to 12:00')
  })

  it('formats a range across days with both dates', () => {
    const start = new Date(2026, 11, 12, 9, 0).toISOString()
    const end = new Date(2026, 11, 14, 17, 30).toISOString()
    expect(formatRange(start, end)).toBe('12 Dec 2026, 09:00 to 14 Dec 2026, 17:30')
  })

  it('converts to and from datetime-local values in local time', () => {
    const iso = new Date(2026, 0, 5, 7, 3).toISOString()
    expect(toLocalInput(iso)).toBe('2026-01-05T07:03')
    expect(fromLocalInput('2026-01-05T07:03')).toBe(iso)
    expect(toLocalInput(null)).toBe('')
    expect(toLocalInput(undefined)).toBe('')
    expect(fromLocalInput('')).toBeNull()
  })
})
