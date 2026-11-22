import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Logo, LogoMark, LogoTile, Rhino } from './brand'
import { Icon } from './icons'

describe('brand marks', () => {
  it('shows the full logo with its name', () => {
    render(<Logo />)
    expect(screen.getByRole('img', { name: 'A Million Techies' })).toHaveAttribute('src', '/amt-logo.png')
  })

  it('draws the mark, tile and rhino as decoration', () => {
    const { container } = render(
      <>
        <LogoMark />
        <LogoMark className="h-4" />
        <LogoTile />
        <LogoTile className="h-12 w-12" />
        <Logo className="h-8" />
        <Rhino />
        <Rhino className="w-40" fold="#000" far="#111" />
      </>,
    )
    expect(container.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThanOrEqual(6)
    expect(container.querySelector('svg.w-40 g')).toHaveAttribute('fill', '#111')
    expect(container.querySelector('.h-12.w-12')).toHaveClass('bg-brand-600')
  })
})

describe('Icon', () => {
  it('draws the named icon, hidden from assistive technology', () => {
    const { container } = render(
      <>
        <Icon name="check" />
        <Icon name="close" className="h-4 w-4" />
      </>,
    )
    const [check, close] = container.querySelectorAll('svg')
    expect(check).toHaveClass('h-5', 'w-5')
    expect(check).toHaveAttribute('aria-hidden', 'true')
    expect(check.querySelector('path')).toHaveAttribute('d', 'M5 12.5 10 17l9-10')
    expect(close).toHaveClass('h-4', 'w-4')
  })
})
