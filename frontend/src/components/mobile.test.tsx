import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { auth, signIn } from '../test/auth'
import { mockFetch } from '../test/fetch'
import { me } from '../test/fixtures'
import { currentPath, renderApp } from '../test/render'
import { BottomNav, ReadMore, StickyAction, TicketSheet, useScrolledPast } from './mobile'

describe('BottomNav', () => {
  it('marks the current page and offers sign-in to visitors', async () => {
    const { user } = renderApp(<BottomNav />, { route: '/events' })
    expect(screen.getByRole('link', { name: 'Events' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('navigation', { name: 'Main' })).not.toHaveTextContent('Profile')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(auth.signinRedirect).toHaveBeenCalled()
  })

  it('offers activity and profile to members', async () => {
    signIn()
    mockFetch({ 'GET /me/': me({ judges_anything: true }) })
    const { user } = renderApp(<BottomNav />)
    expect(await screen.findByRole('link', { name: 'Judging' })).toHaveAttribute('href', '/judging')
    expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Profile' })).toHaveAttribute('href', '/profile')
    await user.click(screen.getByRole('link', { name: 'My activity' }))
    expect(currentPath()).toBe('/dashboard')
  })
})

function Header() {
  const [ref, past] = useScrolledPast()
  return (
    <>
      <h1 ref={ref}>Title</h1>
      <StickyAction show={past}>
        <button type="button">Register</button>
      </StickyAction>
    </>
  )
}

describe('useScrolledPast and StickyAction', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('shows the sticky copy once the element scrolls up out of view, never without IntersectionObserver', () => {
    const sticky = () => screen.getByRole('button', { name: 'Register', hidden: true }).parentElement
    const first = render(<Header />)
    expect(sticky()).toHaveAttribute('aria-hidden', 'true')
    first.unmount()

    let report: (entries: Partial<IntersectionObserverEntry>[]) => void = () => undefined
    const disconnect = vi.fn()
    const observe = vi.fn()
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: typeof report) {
          report = callback
        }
        observe = observe
        disconnect = disconnect
      },
    )
    const { unmount } = render(<Header />)
    expect(observe).toHaveBeenCalledWith(screen.getByRole('heading', { name: 'Title' }))

    act(() => report([{ isIntersecting: false, boundingClientRect: { top: -40 } as DOMRect }]))
    expect(sticky()).toHaveAttribute('aria-hidden', 'false')

    // Below the fold (not yet reached) does not count as scrolled past.
    act(() => report([{ isIntersecting: false, boundingClientRect: { top: 900 } as DOMRect }]))
    expect(sticky()).toHaveAttribute('aria-hidden', 'true')

    act(() => report([{ isIntersecting: true, boundingClientRect: { top: -10 } as DOMRect }]))
    expect(sticky()).toHaveAttribute('aria-hidden', 'true')

    unmount()
    expect(disconnect).toHaveBeenCalled()
  })
})

describe('ReadMore', () => {
  let height = 0
  const scrollHeight = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get')
  scrollHeight.mockImplementation(() => height)
  afterEach(() => {
    height = 0
    vi.unstubAllGlobals()
  })

  it('folds long text and opens it on request', async () => {
    height = 1000
    render(<ReadMore height={200}>Long text</ReadMore>)
    const fold = screen.getByText('Long text').parentElement!
    expect(fold).toHaveStyle({ maxHeight: '200px' })
    await userEvent.click(screen.getByRole('button', { name: 'Read more' }))
    expect(fold).not.toHaveStyle({ maxHeight: '200px' })
    await userEvent.click(screen.getByRole('button', { name: 'Show less' }))
    expect(fold).toHaveStyle({ maxHeight: '200px' })
  })

  it('shows short text in full, checking again when it changes size', () => {
    let resized = () => undefined as void
    const disconnect = vi.fn()
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          resized = callback
        }
        observe() {}
        disconnect = disconnect
      },
    )
    height = 100
    const { unmount } = render(<ReadMore>Growing text</ReadMore>)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    height = 1000
    act(() => resized())
    expect(screen.getByRole('button', { name: 'Read more' })).toBeInTheDocument()
    unmount()
    expect(disconnect).toHaveBeenCalled()
  })
})

describe('TicketSheet', () => {
  it('shows the ticket with its QR code and closes on the button or Escape', async () => {
    const onClose = vi.fn()
    const overflow = document.body.style.overflow
    const { unmount } = render(
      <TicketSheet code="TICKET-1" title="React workshop" name="Wanjiru" when="Sat, 28 Nov · 08:00" order="AMT-1" onClose={onClose} />,
    )
    const sheet = screen.getByRole('dialog', { name: 'Your ticket' })
    expect(sheet).toHaveTextContent('React workshop')
    expect(sheet).toHaveTextContent('Order #AMT-1')
    expect(sheet.querySelector('svg path')).toBeInTheDocument()
    expect(document.body.style.overflow).toBe('hidden')

    await userEvent.keyboard('a')
    expect(onClose).not.toHaveBeenCalled()
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
    await userEvent.click(screen.getByRole('button', { name: 'Close ticket' }))
    expect(onClose).toHaveBeenCalledTimes(2)

    unmount()
    expect(document.body.style.overflow).toBe(overflow)
  })
})
