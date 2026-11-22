import * as tiptap from '@tiptap/react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { mockFetch, reply } from '../test/fetch'
import { renderApp } from '../test/render'
import { RichTextEditor } from './RichTextEditor'

// Lets one test see the moment before TipTap has an editor ready.
vi.mock('@tiptap/react', async (importOriginal) => {
  const actual = await importOriginal<typeof tiptap>()
  return { ...actual, useEditor: vi.fn(actual.useEditor) }
})

// ProseMirror measures the page to place the cursor; jsdom has no layout, so give it empty boxes.
beforeAll(() => {
  const rect = () => new DOMRect(0, 0, 0, 0)
  const list = () => Object.assign([rect()], { item: () => rect() }) as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = rect
  Range.prototype.getClientRects = list
  Element.prototype.getClientRects = list
  document.elementFromPoint = () => null
})

function Form({ initial = '', onSave = vi.fn() }: { initial?: string; onSave?: (html: string) => void }) {
  const [html, setHtml] = useState(initial)
  return (
    <>
      <RichTextEditor
        value={html}
        onChange={(next) => {
          setHtml(next)
          onSave(next)
        }}
        placeholder="Describe the event"
        minHeight="10rem"
      />
      <button type="button" onClick={() => setHtml('<p>Loaded from the server</p>')}>Load saved</button>
      <button type="button" onClick={() => setHtml('')}>Reset</button>
    </>
  )
}

const editorBox = () => document.querySelector<HTMLElement>('.ProseMirror')!
const tool = (name: string | RegExp) => screen.getByRole('button', { name })
const fileInput = () => document.querySelector<HTMLInputElement>('input[type="file"]')!

const setup = (initial = 'Hello world') => {
  const onSave = vi.fn()
  const result = renderApp(<Form initial={initial} onSave={onSave} />)
  const selectAll = async () => {
    editorBox().focus()
    await result.user.keyboard('{Control>}a{/Control}')
  }
  // StarterKit keeps an empty paragraph after a block so there is always somewhere to type; ignore it.
  const lastHtml = () => {
    const [html] = onSave.mock.lastCall as [string]
    return html.replace(/<p><\/p>$/, '')
  }
  return { ...result, onSave, selectAll, lastHtml }
}

describe('RichTextEditor', () => {
  it('shows older plain text as paragraphs, with the toolbar', () => {
    setup('First line\n\nSecond line')
    expect(editorBox().innerHTML).toContain('<p>First line</p><p>Second line</p>')
    expect(editorBox().parentElement?.parentElement).toHaveStyle({ '--editor-min': '10rem' })
    expect(screen.getByRole('combobox', { name: 'Text style' })).toHaveValue('p')
    expect(screen.getByRole('combobox', { name: 'Text size' })).toHaveValue('')
    expect(tool('Undo')).toBeDisabled()
    expect(tool('Align left')).toHaveAttribute('aria-pressed', 'true')
  })

  it('shows the placeholder when empty', () => {
    setup('')
    expect(editorBox().querySelector('[data-placeholder="Describe the event"]')).toBeInTheDocument()
  })

  it('turns the line into headings and back', async () => {
    const { user, lastHtml } = setup()
    const style = screen.getByRole('combobox', { name: 'Text style' })
    for (const [option, tag] of [['Heading', 'h2'], ['Subheading', 'h3'], ['Small heading', 'h4'], ['Paragraph', 'p']]) {
      await user.selectOptions(style, option)
      expect(lastHtml()).toBe(`<${tag}>Hello world</${tag}>`)
      expect(style).toHaveValue(tag)
    }
  })

  it('changes the text size', async () => {
    const { user, selectAll, lastHtml } = setup()
    await selectAll()
    const size = screen.getByRole('combobox', { name: 'Text size' })
    await user.selectOptions(size, 'Large')
    expect(lastHtml()).toContain('font-size: 20px')
    expect(size).toHaveValue('20px')
    await user.selectOptions(size, 'Normal')
    expect(lastHtml()).toBe('<p>Hello world</p>')
  })

  it('formats the selected text', async () => {
    const { user, selectAll, lastHtml } = setup()
    await selectAll()
    for (const [name, tag] of [['Bold', 'strong'], ['Italic', 'em'], ['Underline', 'u'], ['Strikethrough', 's']]) {
      await user.click(tool(name))
      expect(lastHtml()).toContain(`<${tag}>`)
      expect(tool(name)).toHaveAttribute('aria-pressed', 'true')
    }
  })

  it('makes lists and quotes', async () => {
    const { user, lastHtml } = setup()
    await user.click(tool('Bulleted list'))
    expect(lastHtml()).toBe('<ul><li><p>Hello world</p></li></ul>')
    expect(tool('Bulleted list')).toHaveAttribute('aria-pressed', 'true')
    await user.click(tool('Numbered list'))
    expect(lastHtml()).toBe('<ol><li><p>Hello world</p></li></ol>')
    await user.click(tool('Numbered list'))
    await user.click(tool('Quote'))
    expect(lastHtml()).toBe('<blockquote><p>Hello world</p></blockquote>')
    expect(tool('Quote')).toHaveAttribute('aria-pressed', 'true')
  })

  it('aligns text', async () => {
    const { user, lastHtml } = setup()
    await user.click(tool('Align centre'))
    expect(lastHtml()).toBe('<p style="text-align: center;">Hello world</p>')
    expect(tool('Align centre')).toHaveAttribute('aria-pressed', 'true')
    expect(tool('Align left')).toHaveAttribute('aria-pressed', 'false')
    await user.click(tool('Align right'))
    expect(tool('Align right')).toHaveAttribute('aria-pressed', 'true')
    await user.click(tool('Align left'))
    expect(tool('Align left')).toHaveAttribute('aria-pressed', 'true')
  })

  it('undoes and redoes changes', async () => {
    const { user, lastHtml } = setup()
    await user.click(tool('Quote'))
    expect(tool('Undo')).toBeEnabled()
    expect(tool('Redo')).toBeDisabled()
    await user.click(tool('Undo'))
    expect(lastHtml()).toBe('<p>Hello world</p>')
    expect(tool('Redo')).toBeEnabled()
    await user.click(tool('Redo'))
    expect(lastHtml()).toBe('<blockquote><p>Hello world</p></blockquote>')
  })

  it('stores nothing once everything is deleted', async () => {
    const { user, selectAll, lastHtml } = setup()
    await selectAll()
    await user.keyboard('{Backspace}')
    expect(lastHtml()).toBe('')
  })

  it('adds, edits and removes a link', async () => {
    const { user, selectAll, lastHtml } = setup()
    await selectAll()
    await user.click(tool('Link'))
    expect(screen.getByRole('alertdialog', { name: 'Add a link' })).toBeInTheDocument()
    const address = screen.getByLabelText('Link address')
    expect(address).toHaveValue('https://')
    await user.type(address, 'example.com')
    await user.click(screen.getByRole('button', { name: 'Save link' }))
    expect(lastHtml()).toContain('href="https://example.com"')
    expect(lastHtml()).toContain('target="_blank"')
    expect(tool('Link')).toHaveAttribute('aria-pressed', 'true')

    await user.click(tool('Link'))
    expect(screen.getByRole('alertdialog', { name: 'Edit link' })).toHaveTextContent('Clear the address to remove the link.')
    expect(screen.getByLabelText('Link address')).toHaveValue('https://example.com')
    await user.clear(screen.getByLabelText('Link address'))
    await user.click(screen.getByRole('button', { name: 'Save link' }))
    expect(lastHtml()).toBe('<p>Hello world</p>')
  })

  it('treats a bare "https://" as no link, and leaves things alone when cancelled', async () => {
    const { user, selectAll, onSave } = setup()
    await selectAll()
    await user.click(tool('Link'))
    await user.click(screen.getByRole('button', { name: 'Save link' }))
    await user.click(tool('Link'))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(onSave.mock.calls.every(([html]) => !html.includes('<a'))).toBe(true)
  })

  it('embeds a YouTube video', async () => {
    const { user, lastHtml } = setup()
    await user.click(tool('YouTube video'))
    const address = screen.getByLabelText('Video address')
    expect(address).toHaveAttribute('type', 'url')
    await user.type(address, 'https://youtu.be/dQw4w9WgXcQ')
    await user.click(screen.getByRole('button', { name: 'Add video' }))
    expect(lastHtml()).toContain('youtube-nocookie.com/embed/dQw4w9WgXcQ')
  })

  it('explains when a video address is not YouTube', async () => {
    const { user, onSave } = setup()
    await user.click(tool('YouTube video'))
    await user.type(screen.getByLabelText('Video address'), 'https://vimeo.com/1')
    await user.click(screen.getByRole('button', { name: 'Add video' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('That is not a YouTube address')
    expect(onSave).not.toHaveBeenCalled()
  })

  it('adds nothing when the video prompt is cancelled', async () => {
    const { user, onSave } = setup()
    await user.click(tool('YouTube video'))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onSave).not.toHaveBeenCalled()
  })

  it('uploads and inserts an image', async () => {
    let finish: (value: unknown) => void = () => undefined
    mockFetch({ 'POST /uploads/': () => new Promise((resolve) => (finish = resolve)) })
    const { user, lastHtml } = setup()
    const click = vi.spyOn(fileInput(), 'click')
    await user.click(tool('Image'))
    expect(click).toHaveBeenCalled()

    await user.upload(fileInput(), new File(['png'], 'stage.photo.png', { type: 'image/png' }))
    expect(tool('Uploading image…')).toBeDisabled()
    finish(reply(201, { url: 'https://cdn.test/stage.png' }))

    await waitFor(() => expect(lastHtml()).toContain('src="https://cdn.test/stage.png"'))
    expect(lastHtml()).toContain('alt="stage.photo"')
    expect(tool('Image')).toBeEnabled()
    expect(fileInput()).toHaveValue('')
  })

  it('explains why an image upload failed', async () => {
    mockFetch({ 'POST /uploads/': reply(400, { file: ['Images only.'] }) })
    const { user } = setup()
    await user.upload(fileInput(), new File(['x'], 'notes.png', { type: 'image/png' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Images only.')
  })

  it('falls back to a general message for an unexpected upload failure', async () => {
    vi.stubGlobal('FormData', class {
      append() {
        throw 'no form data'
      }
    })
    const { user } = setup()
    await user.upload(fileInput(), new File(['x'], 'notes.png', { type: 'image/png' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not upload the image.')
  })

  it('does nothing when the file picker is closed without a choice', () => {
    const fetch = mockFetch({})
    setup()
    fireEvent.change(fileInput(), { target: { files: [] } })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('finishes quietly if the form closes during an upload', async () => {
    let finish: (value: unknown) => void = () => undefined
    mockFetch({ 'POST /uploads/': () => new Promise((resolve) => (finish = resolve)) })
    const { user, unmount } = setup()
    await user.upload(fileInput(), new File(['x'], 'late.png', { type: 'image/png' }))
    unmount()
    finish(reply(201, { url: 'https://cdn.test/late.png' }))
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

  it('shows text loaded after it started, without reporting it as a change', async () => {
    const { user, onSave } = setup('')
    await user.click(screen.getByRole('button', { name: 'Load saved' }))
    expect(editorBox()).toHaveTextContent('Loaded from the server')
    await user.click(screen.getByRole('button', { name: 'Reset' }))
    expect(editorBox()).not.toHaveTextContent('Loaded from the server')
    expect(onSave).not.toHaveBeenCalled()
  })

  it('shows nothing until the editor is ready', () => {
    vi.mocked(tiptap.useEditor).mockImplementation(() => null as unknown as tiptap.Editor)
    const { container } = renderApp(<RichTextEditor value="Hello" onChange={vi.fn()} />)
    expect(container.querySelector('.ProseMirror')).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    vi.mocked(tiptap.useEditor).mockRestore()
  })
})
