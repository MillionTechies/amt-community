import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Logo, LogoMark, LogoTile, Rhino } from './brand'
import { Icon } from './icons'

describe('brand marks and icons', () => {
  it('names the full logo and hides the decorative marks and icons', () => {
    const { container } = render(
      <>
        <Logo />
        <LogoMark />
        <LogoMark className="h-4" />
        <LogoTile />
        <LogoTile className="h-12 w-12" />
        <Logo className="h-8" />
        <Rhino />
        <Rhino className="w-40" fold="#000" far="#111" />
        <Icon name="check" />
        <Icon name="close" className="h-4 w-4" />
      </>,
    )
    expect(screen.getAllByRole('img', { name: 'A Million Techies' })[0]).toHaveAttribute('src', '/amt-logo.png')
    expect(container.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThanOrEqual(8)
  })
})
