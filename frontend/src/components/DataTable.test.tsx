import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { DataTable, downloadCsv } from './DataTable'
import type { Col } from './DataTable'

interface Person {
  name: string
  email: string
  score: number | null
}

const people: Person[] = [
  { name: 'Wanjiru', email: 'wanjiru@example.com', score: 90 },
  { name: 'Otieno', email: 'otieno@example.com', score: null },
  { name: 'Amina', email: 'amina@example.com', score: 75 },
]

const columns: Col<Person>[] = [
  { title: 'Name', value: (p) => p.name, priority: 1 },
  { title: 'Email', value: (p) => p.email, hidden: true },
  { title: 'Score', value: (p) => p.score, align: 'right', sortable: false, width: '6rem' },
  { title: 'Actions', value: () => '', cell: (p) => <button type="button">Message {p.name}</button> },
]

// DataTables redefines `relatedTarget` on the events it handles, which user-event makes
// read-only, so these tests use fireEvent for anything DataTables listens to.
const search = (box: HTMLElement, text: string) => fireEvent.input(box, { target: { value: text } })

const bodyRows = () => within(screen.getByRole('table')).getAllByRole('row').slice(1)

describe('DataTable', () => {
  it('shows rows sorted as asked, drawing cells with React', () => {
    render(<DataTable rows={people} columns={columns} order={[0, 'asc']} toolbar={<button type="button">Export</button>} />)
    expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /Name/ })).toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: /Email/ })).not.toBeInTheDocument()
    expect(bodyRows().map((r) => within(r).getAllByRole('cell')[0].textContent)).toEqual(['Amina', 'Otieno', 'Wanjiru'])
    expect(within(bodyRows()[0]).getByRole('button', { name: 'Message Amina' })).toBeInTheDocument()
    expect(screen.getByText('1–3 of 3')).toBeInTheDocument()
  })

  it('searches, including hidden columns', () => {
    render(<DataTable rows={people} columns={columns} searchPlaceholder="Search people" />)
    search(screen.getByPlaceholderText('Search people'), 'otieno@')
    expect(bodyRows()).toHaveLength(1)
    expect(bodyRows()[0]).toHaveTextContent('Otieno')
    search(screen.getByPlaceholderText('Search people'), 'nobody')
    expect(screen.getByText('Nothing matches your search.')).toBeInTheDocument()
  })

  it('opens a row on click or Enter, but not from a button inside it', () => {
    const onOpen = vi.fn()
    render(<DataTable rows={people} columns={columns} onOpen={onOpen} order={[0, 'asc']} />)
    const [amina, otieno] = bodyRows()
    expect(amina).toHaveClass('is-clickable')

    fireEvent.click(within(otieno).getAllByRole('cell')[1])
    expect(onOpen).toHaveBeenLastCalledWith(people[1])

    fireEvent.click(within(amina).getByRole('button', { name: 'Message Amina' }))
    expect(onOpen).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(amina, { key: 'a' })
    expect(onOpen).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(amina, { key: 'Enter' })
    expect(onOpen).toHaveBeenLastCalledWith(people[2])
  })

  it('uses the latest handler after a re-render', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = render(<DataTable rows={people} columns={columns} onOpen={first} />)
    rerender(<DataTable rows={people} columns={columns} onOpen={second} />)
    fireEvent.click(within(bodyRows()[0]).getAllByRole('cell')[1])
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalled()
  })

  it('leaves rows alone when they do not open', () => {
    render(<DataTable rows={people} columns={columns} />)
    expect(bodyRows()[0]).not.toHaveClass('is-clickable')
  })

  it('says when there is nothing to show', () => {
    render(<DataTable rows={[]} columns={columns} empty="No members yet." />)
    expect(screen.getByText('No members yet.')).toBeInTheDocument()
    expect(screen.getByText('0 of 0')).toBeInTheDocument()
  })
})

describe('a column drawn with React', () => {
  const drawn: Col<Person>[] = [{ title: 'Name', value: (p) => p.name, cell: (p) => <b>{p.name}</b> }]

  it('sorts by its value', () => {
    render(<DataTable rows={people} columns={drawn} order={[0, 'asc']} />)
    expect(bodyRows().map((r) => r.textContent)).toEqual(['Amina', 'Otieno', 'Wanjiru'])
  })

  it('searches on its value', () => {
    render(<DataTable rows={people} columns={drawn} />)
    search(screen.getByRole('searchbox'), 'Otieno')
    expect(bodyRows().map((r) => r.textContent)).toEqual(['Otieno'])
  })
})

describe('downloadCsv', () => {
  it('downloads quoted rows as a CSV file', async () => {
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:csv')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL }))
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)

    downloadCsv('people.csv', ['Name', 'Note'], [['Wanjiru', 'Says "hi"'], ['Otieno', null], ['Amina', 3]])

    const link = click.mock.contexts[0] as HTMLAnchorElement
    expect(link.download).toBe('people.csv')
    expect(link.href).toBe('blob:csv')
    expect(await createObjectURL.mock.calls[0][0].text()).toBe('"Name","Note"\n"Wanjiru","Says ""hi"""\n"Otieno",""\n"Amina","3"')
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:csv')
    click.mockRestore()
  })
})
