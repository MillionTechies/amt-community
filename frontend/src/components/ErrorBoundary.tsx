/** Catches a crash while rendering, so the page shows what went wrong instead of going blank. */
import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { Outlet, useLocation } from 'react-router-dom'

export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack)
  }

  // Moving to another page clears the error.
  componentDidUpdate(previous: { resetKey?: string }) {
    if (this.state.error && previous.resetKey !== this.props.resetKey) this.setState({ error: null })
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <p className="eyebrow mb-3">Error</p>
        <h1 className="text-xl font-bold">Something went wrong on this page</h1>
        <p className="mt-2 text-sm text-stone-600">Reload to try again. If it keeps happening, send this message to the team:</p>
        <pre className="mt-4 overflow-x-auto rounded-lg bg-stone-100 p-3 text-left font-mono text-xs text-stone-700">{this.state.error.message}</pre>
        <div className="mt-6 flex justify-center gap-2">
          <button type="button" className="rounded-lg bg-brand-600 px-4 py-2 font-mono text-xs font-semibold uppercase tracking-wider text-white" onClick={() => location.reload()}>Reload</button>
          <a href="/" className="rounded-lg border border-stone-300 px-4 py-2 font-mono text-xs font-semibold uppercase tracking-wider">Home</a>
        </div>
      </div>
    )
  }
}

/** The current route's page, with its own error screen, so the header and menus around it
 * keep working when a page crashes. Moving to another page clears the error. */
export function PageOutlet() {
  const { pathname } = useLocation()
  return (
    <ErrorBoundary resetKey={pathname}>
      <Outlet />
    </ErrorBoundary>
  )
}
