import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { FeedbackProvider, useConfirm, usePrompt, useToast } from './feedback'
import type { ConfirmOptions, PromptOptions, ToastOptions } from './feedback'

function Asker({ confirm: confirmOptions, prompt: promptOptions }: { confirm?: ConfirmOptions; prompt?: PromptOptions }) {
  const confirm = useConfirm()
  const prompt = usePrompt()
  const [answer, setAnswer] = useState('none')
  return (
    <>
      {confirmOptions && (
        <button type="button" onClick={async () => setAnswer(String(await confirm(confirmOptions)))}>Ask</button>
      )}
      {promptOptions && (
        <button type="button" onClick={async () => setAnswer(JSON.stringify(await prompt(promptOptions)))}>Ask</button>
      )}
      <p>Answer: {answer}</p>
    </>
  )
}

const renderAsker = (props: Parameters<typeof Asker>[0]) => {
  const user = userEvent.setup()
  render(<FeedbackProvider><Asker {...props} /></FeedbackProvider>)
  return { user, ask: () => user.click(screen.getByRole('button', { name: 'Ask' })) }
}

describe('useConfirm', () => {
  it('needs the provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(() => render(<Asker confirm={{ title: 'x' }} />)).toThrow('Wrap the app in <FeedbackProvider>.')
    vi.mocked(console.error).mockRestore()
  })

  it('resolves true when confirmed, starting on the confirm button', async () => {
    const { user, ask } = renderAsker({ confirm: { title: 'Publish this event?', message: 'Members will see it.' } })
    await ask()
    const dialog = screen.getByRole('alertdialog', { name: 'Publish this event?' })
    expect(dialog).toHaveTextContent('Members will see it.')
    expect(screen.getByRole('button', { name: 'Confirm' })).toHaveFocus()
    expect(document.body.style.overflow).toBe('hidden')
    await user.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(screen.getByText('Answer: true')).toBeInTheDocument()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(document.body.style.overflow).toBe('')
  })

  it('starts on Cancel for destructive actions and resolves false when cancelled', async () => {
    const { user, ask } = renderAsker({
      confirm: { title: 'Delete this draft?', tone: 'danger', confirmLabel: 'Delete', cancelLabel: 'Keep it' },
    })
    await ask()
    expect(screen.getByRole('button', { name: 'Keep it' })).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveClass('!bg-red-600')
    await user.click(screen.getByRole('button', { name: 'Keep it' }))
    expect(screen.getByText('Answer: false')).toBeInTheDocument()
  })

  it('closes on Escape but not on other keys', async () => {
    const { user, ask } = renderAsker({ confirm: { title: 'Close registration?', tone: 'warning', icon: 'clock' } })
    await ask()
    expect(screen.getByRole('button', { name: 'Confirm' })).toHaveClass('!bg-amber-600')
    await user.keyboard('a')
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.getByText('Answer: false')).toBeInTheDocument()
  })

  it('closes when the backdrop is clicked', async () => {
    const { user, ask } = renderAsker({ confirm: { title: 'Leave?' } })
    await ask()
    await user.click(document.querySelector('.fade-in')!)
    expect(screen.getByText('Answer: false')).toBeInTheDocument()
  })
})

describe('usePrompt', () => {
  it('returns what was typed', async () => {
    const { user, ask } = renderAsker({
      prompt: { title: 'Rename team', label: 'Team name', initial: 'Rockets', placeholder: 'Name', confirmLabel: 'Save' },
    })
    await ask()
    const input = screen.getByLabelText('Team name')
    expect(input).toHaveValue('Rockets')
    expect(input).toHaveAttribute('type', 'text')
    // The suggested text starts selected, ready to be typed over.
    expect([(input as HTMLInputElement).selectionStart, (input as HTMLInputElement).selectionEnd]).toEqual([0, 7])
    await user.clear(input)
    await user.type(input, 'Comets{Enter}')
    expect(screen.getByText('Answer: "Comets"')).toBeInTheDocument()
  })

  it('starts empty with the given input type and returns null when cancelled', async () => {
    const { user, ask } = renderAsker({ prompt: { title: 'Invite', label: 'Email', type: 'email' } })
    await ask()
    expect(screen.getByLabelText('Email')).toHaveValue('')
    expect(screen.getByLabelText('Email')).toHaveAttribute('type', 'email')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByText('Answer: null')).toBeInTheDocument()
  })

  it('returns an empty answer when confirmed without typing', async () => {
    const { user, ask } = renderAsker({ prompt: { title: 'Note', label: 'Note' } })
    await ask()
    await user.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(screen.getByText('Answer: ""')).toBeInTheDocument()
  })
})

function Toaster({ toasts }: { toasts: ToastOptions[] }) {
  const toast = useToast()
  return <button type="button" onClick={() => toasts.forEach(toast)}>Notify</button>
}

describe('useToast', () => {
  it('shows a notification that can be dismissed', async () => {
    const user = userEvent.setup()
    render(<FeedbackProvider><Toaster toasts={[{ title: 'Saved', message: 'Your changes are live.' }]} /></FeedbackProvider>)
    await user.click(screen.getByRole('button', { name: 'Notify' }))
    expect(screen.getByRole('status')).toHaveTextContent('SavedYour changes are live.')
    await user.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('keeps the latest three and hides each after a while, errors for longer', async () => {
    vi.useFakeTimers()
    render(
      <FeedbackProvider>
        <Toaster
          toasts={[
            { title: 'One' },
            { title: 'Two', tone: 'info' },
            { title: 'Three' },
            { title: 'Failed', tone: 'error', message: 'Try again.' },
          ]}
        />
      </FeedbackProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Notify' }))
    expect(screen.queryByText('One')).not.toBeInTheDocument()
    expect(screen.getAllByRole('status')).toHaveLength(2)
    expect(screen.getByRole('alert')).toHaveTextContent('FailedTry again.')

    act(() => vi.advanceTimersByTime(4500))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toBeInTheDocument()

    act(() => vi.advanceTimersByTime(2500))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
