import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { RichText, asHtml, isHtml } from './RichText'

describe('RichText', () => {
  it('tells HTML from plain text, escaping plain text into paragraphs', () => {
    expect(isHtml('<p>Hi</p>')).toBe(true)
    expect(isHtml('2 < 3 and 4 > 1')).toBe(false)
    expect(asHtml('Tom & Jerry\nsay 2 < 3\n\nNext > last')).toBe('<p>Tom &amp; Jerry<br>say 2 &lt; 3</p><p>Next &gt; last</p>')
    expect(asHtml('<h2>Title</h2>')).toBe('<h2>Title</h2>')
    expect(asHtml('')).toBe('')
  })

  it('shows HTML from the editor, and older plain text with its line breaks', () => {
    render(
      <>
        <RichText html="<h2>Agenda</h2><ul><li>Talks</li></ul>" className="mt-2" />
        <RichText html={'Bring a laptop.\nAnd water.'} />
      </>,
    )
    expect(screen.getByRole('heading', { name: 'Agenda' })).toBeInTheDocument()
    expect(screen.getByRole('listitem')).toHaveTextContent('Talks')
    expect(screen.getByText(/Bring a laptop/)).toHaveClass('whitespace-pre-line')
  })
})
