import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { FeedbackProvider, useConfirm, usePrompt, useToast } from './feedback'
import type { ConfirmOptions, PromptOptions, ToastOptions } from './feedback'

function Asker({ confirms = [], prompts = [] }: { confirms?: ConfirmOptions[]; prompts?: PromptOptions[] }) {
  const confirm = useConfirm()
  const prompt = usePrompt()
  const [answer, setAnswer] = useState('none')
  return (
    <>
      {confirms.map((options) => (
        <button key={options.title} type="button" onClick={async () => setAnswer(String(await confirm(options)))}>Ask: {options.title}</button>
      ))}
      {prompts.map((options) => (
        <button key={options.title} type="button" onClick={async () => setAnswer(JSON.stringify(await prompt(options)))}>Ask: {options.title}</button>
      ))}
      <p>Answer: {answer}</p>
    </>
  )
}

const renderAsker = (props: Parameters<typeof Asker>[0]) => {
  const user = userEvent.setup()
  render(<FeedbackProvider><Asker {...props} /></FeedbackProvider>)
  return { user, ask: (title: string) => user.click(screen.getByRole('button', { name: `Ask: ${title}` })) }
}

describe('useConfirm', () => {
  it('needs the provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(() => render(<Asker confirms={[{ title: 'x' }]} />)).toThrow('Wrap the app in <FeedbackProvider>.')
    vi.mocked(console.error).mockRestore()
  })

  it('resolves true when confirmed, and false when cancelled, escaped or clicked away', async () => {
    const { user, ask } = renderAsker({
      confirms: [
        { title: 'Publish this event?', message: 'Members will see it.' },
        { title: 'Delete this draft?', tone: 'danger', confirmLabel: 'Delete', cancelLabel: 'Keep it' },
        { title: 'Close registration?', tone: 'warning', icon: 'clock' },
        { title: 'Leave?' },
      ],
    })
    await ask('Publish this event?')
    expect(screen.getByRole('alertdialog', { name: 'Publish this event?' })).toHaveTextContent('Members will see it.')
    expect(screen.getByRole('button', { name: 'Confirm' })).toHaveFocus()
    expect(document.body.style.overflow).toBe('hidden')
    await user.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(screen.getByText('Answer: true')).toBeInTheDocument()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(document.body.style.overflow).toBe('')

    // Destructive actions start on the safe choice.
    await ask('Delete this draft?')
    expect(screen.getByRole('button', { name: 'Keep it' })).toHaveFocus()
    await user.click(screen.getByRole('button', { name: 'Keep it' }))
    expect(screen.getByText('Answer: false')).toBeInTheDocument()

    await ask('Close registration?')
    await user.keyboard('a')
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()

    await ask('Leave?')
    await user.click(document.querySelector('.fade-in')!)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.getByText('Answer: false')).toBeInTheDocument()
  })
})

describe('usePrompt', () => {
  it('returns what was typed, an empty answer, or null when cancelled', async () => {
    const { user, ask } = renderAsker({
      prompts: [
        { title: 'Rename team', label: 'Team name', initial: 'Rockets', placeholder: 'Name', confirmLabel: 'Save' },
        { title: 'Add a note', label: 'Note' },
        { title: 'Invite', label: 'Email', type: 'email' },
      ],
    })
    await ask('Rename team')
    const input = screen.getByLabelText('Team name')
    // The suggested text starts selected, ready to be typed over.
    expect([(input as HTMLInputElement).selectionStart, (input as HTMLInputElement).selectionEnd]).toEqual([0, 7])
    await user.clear(input)
    await user.type(input, 'Comets{Enter}')
    expect(screen.getByText('Answer: "Comets"')).toBeInTheDocument()

    await ask('Add a note')
    expect(screen.getByLabelText('Note')).toHaveValue('')
    await user.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(screen.getByText('Answer: ""')).toBeInTheDocument()

    await ask('Invite')
    expect(screen.getByLabelText('Email')).toHaveAttribute('type', 'email')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByText('Answer: null')).toBeInTheDocument()
  })
})

function Toaster({ toasts }: { toasts: ToastOptions[] }) {
  const toast = useToast()
  return <button type="button" onClick={() => toasts.forEach(toast)}>Notify</button>
}

describe('useToast', () => {
  it('keeps the latest three, which can be dismissed or hide after a while, errors for longer', () => {
    vi.useFakeTimers()
    render(
      <FeedbackProvider>
        <Toaster
          toasts={[
            { title: 'One' },
            { title: 'Two', tone: 'info' },
            { title: 'Saved', message: 'Your changes are live.' },
            { title: 'Failed', tone: 'error', message: 'Try again.' },
          ]}
        />
      </FeedbackProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Notify' }))
    expect(screen.queryByText('One')).not.toBeInTheDocument()
    expect(screen.getAllByRole('status')).toHaveLength(2)
    expect(screen.getByRole('alert')).toHaveTextContent('FailedTry again.')

    const saved = screen.getByText('Your changes are live.').closest<HTMLElement>('[role="status"]')!
    fireEvent.click(within(saved).getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByText('Saved')).not.toBeInTheDocument()

    act(() => vi.advanceTimersByTime(4500))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toBeInTheDocument()

    act(() => vi.advanceTimersByTime(2500))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
