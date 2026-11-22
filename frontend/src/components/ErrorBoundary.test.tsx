import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ErrorBoundary } from './ErrorBoundary'

function Page({ broken }: { broken: boolean }) {
  if (broken) throw new Error('Cannot read the event')
  return <p>All good</p>
}

describe('ErrorBoundary', () => {
  it('shows the page when nothing goes wrong', () => {
    render(<ErrorBoundary><Page broken={false} /></ErrorBoundary>)
    expect(screen.getByText('All good')).toBeInTheDocument()
  })

  it('shows what went wrong, offers a reload, and clears on another page', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const reload = vi.fn()
    vi.stubGlobal('location', { ...window.location, reload })

    const { rerender } = render(<ErrorBoundary resetKey="/events/a"><Page broken /></ErrorBoundary>)
    expect(screen.getByRole('heading', { name: 'Something went wrong on this page' })).toBeInTheDocument()
    expect(screen.getByText('Cannot read the event')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/')
    expect(consoleError).toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Reload' }))
    expect(reload).toHaveBeenCalled()

    // Same page: the error stays.
    rerender(<ErrorBoundary resetKey="/events/a"><Page broken={false} /></ErrorBoundary>)
    expect(screen.getByText('Cannot read the event')).toBeInTheDocument()

    // Another page: it clears.
    rerender(<ErrorBoundary resetKey="/events/b"><Page broken={false} /></ErrorBoundary>)
    expect(screen.getByText('All good')).toBeInTheDocument()

    // And moving again without an error changes nothing.
    rerender(<ErrorBoundary resetKey="/events/c"><Page broken={false} /></ErrorBoundary>)
    expect(screen.getByText('All good')).toBeInTheDocument()
    consoleError.mockRestore()
  })
})
