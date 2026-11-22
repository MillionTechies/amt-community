import { render, screen, within } from '@testing-library/react'
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
  it('runs a plain button without submitting forms, and links to other pages', async () => {
    const onClick = vi.fn()
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault())
    const { user } = renderApp(
      <>
        <form onSubmit={onSubmit}>
          <Button onClick={onClick}>Save</Button>
          <Button variant="danger" className="extra">Delete</Button>
        </form>
        <LinkButton to="/events">Browse events</LinkButton>
        <LinkButton to="/hackathons" variant="secondary">Hackathons</LinkButton>
      </>,
    )
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(onClick).toHaveBeenCalled()
    expect(onSubmit).not.toHaveBeenCalled()

    expect(screen.getByRole('link', { name: 'Browse events' })).toHaveAttribute('href', '/events')
    await user.click(screen.getByRole('link', { name: 'Hackathons' }))
    expect(currentPath()).toBe('/hackathons')
  })
})

describe('layout pieces, badges and notes', () => {
  it('shows sections, headers, states, stats, badges and errors', () => {
    const { rerender } = render(
      <>
        <PageHeader title="Events" eyebrow="community" subtitle="What is on" action={<Button>New</Button>} />
        <PageHeader title="Profile" />
        <Section title="Speakers" action={<Button>Add</Button>}>
          <Card className="mt-4">Nobody yet</Card>
        </Section>
        <Spinner />
        <Empty>No events yet.</Empty>
        <Stat label="Members" value={42} />
        <Prose>{'Line one\nLine two'}</Prose>
        <StatusBadge status="published" />
        <StatusBadge status="waitlisted" />
        <StatusBadge status="checked_in" />
        <Badge>Plain</Badge>
        <Notice>Saved.</Notice>
        <Notice tone="amber">Check this.</Notice>
        <ErrorNote error={new Error('Not allowed.')} />
      </>,
    )
    expect(screen.getByRole('heading', { level: 1, name: 'Events' })).toBeInTheDocument()
    expect(screen.getByText('What is on')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Profile' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Speakers' })).toBeInTheDocument()
    expect(screen.getByText('Nobody yet')).toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()
    expect(screen.getByText('42')).toBeInTheDocument()
    expect(screen.getByText(/Line one/)).toHaveClass('whitespace-pre-line')
    expect(screen.getByText('Open')).toBeInTheDocument()
    expect(screen.getByText('Checked in')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Not allowed.')

    rerender(<ErrorNote error="Plain text" />)
    expect(screen.getByRole('alert')).toHaveTextContent('Plain text')
    rerender(<ErrorNote error={null} />)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('form fields', () => {
  it('labels controls with hints, required marks, errors and groups', () => {
    render(
      <>
        <Field label="Title" hint="Keep it short" required>
          <Input defaultValue="Demo" required />
        </Field>
        <Field label="Summary" hint="One line" error="Required.">
          <Textarea />
        </Field>
        <Field label="Type" group>
          <Select defaultValue="b">
            <option value="a">A</option>
            <option value="b">B</option>
          </Select>
        </Field>
      </>,
    )
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('Demo')
    expect(screen.getByRole('textbox', { name: 'Title' })).toBeRequired()
    expect(screen.getByText('Keep it short')).toBeInTheDocument()
    expect(screen.getByText('*')).toHaveAttribute('aria-hidden', 'true')

    expect(screen.getByRole('alert')).toHaveTextContent('Required.')
    expect(screen.queryByText('One line')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Summary')).toHaveAttribute('rows', '4')

    expect(within(screen.getByRole('group', { name: 'Type' })).getByRole('combobox')).toHaveValue('b')
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
  it('turns codes into labels and formats dates in British English, local time', () => {
    expect(label('in_person')).toBe('In person')
    expect(label('')).toBe('')

    const at = (d: number, h: number, m = 0) => new Date(2026, 11, d, h, m).toISOString()
    expect(formatDate(at(12, 9))).toBe('12 Dec 2026')
    expect(formatDateTime(at(12, 9))).toBe('12 Dec 2026, 09:00')
    expect(formatRange(at(12, 9), at(12, 12))).toBe('12 Dec 2026, 09:00 to 12:00')
    expect(formatRange(at(12, 9), at(14, 17, 30))).toBe('12 Dec 2026, 09:00 to 14 Dec 2026, 17:30')

    const iso = new Date(2026, 0, 5, 7, 3).toISOString()
    expect(toLocalInput(iso)).toBe('2026-01-05T07:03')
    expect(fromLocalInput('2026-01-05T07:03')).toBe(iso)
    expect(toLocalInput(null)).toBe('')
    expect(toLocalInput(undefined)).toBe('')
    expect(fromLocalInput('')).toBeNull()
  })
})
