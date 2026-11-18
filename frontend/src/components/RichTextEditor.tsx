/**
 * The rich text editor for organisers: headings, text sizes, lists, links, alignment,
 * uploaded images and YouTube videos. Loaded only in the console.
 */
import Image from '@tiptap/extension-image'
import TextAlign from '@tiptap/extension-text-align'
import { FontSize, TextStyle } from '@tiptap/extension-text-style'
import Youtube from '@tiptap/extension-youtube'
import { Placeholder } from '@tiptap/extensions'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import type { Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import { uploadImage } from '../api'
import { asHtml } from './RichText'

const SIZES = [
  { label: 'Small', value: '14px' },
  { label: 'Normal', value: '' },
  { label: 'Large', value: '20px' },
  { label: 'Huge', value: '28px' },
]

function Tool({
  label,
  active = false,
  disabled = false,
  onClick,
  children,
}: {
  label: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      // Keep the editor's selection when a toolbar button is clicked.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`grid h-8 min-w-8 place-items-center rounded-md px-1.5 font-mono text-xs font-semibold transition disabled:opacity-40 ${
        active ? 'bg-ink text-white' : 'text-stone-700 hover:bg-stone-200'
      }`}
    >
      {children}
    </button>
  )
}

const Divider = () => <span className="mx-1 h-5 w-px bg-stone-300" aria-hidden="true" />

/** Small line icons for the toolbar (24px grid). */
function Glyph({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

function Toolbar({ editor, onImage, uploading }: { editor: Editor; onImage: () => void; uploading: boolean }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      block: e.isActive('heading', { level: 2 }) ? 'h2' : e.isActive('heading', { level: 3 }) ? 'h3' : e.isActive('heading', { level: 4 }) ? 'h4' : 'p',
      size: (e.getAttributes('textStyle').fontSize as string | undefined) ?? '',
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      strike: e.isActive('strike'),
      bullets: e.isActive('bulletList'),
      numbers: e.isActive('orderedList'),
      quote: e.isActive('blockquote'),
      link: e.isActive('link'),
      center: e.isActive({ textAlign: 'center' }),
      right: e.isActive({ textAlign: 'right' }),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  })
  const chain = () => editor.chain().focus()
  const select = 'h-8 rounded-md border border-stone-300 bg-white px-2 font-mono text-xs'

  const setBlock = (value: string) => {
    if (value === 'p') chain().setParagraph().run()
    else chain().setHeading({ level: Number(value[1]) as 2 | 3 | 4 }).run()
  }
  const setLink = () => {
    const current = editor.getAttributes('link').href as string | undefined
    const url = window.prompt('Link address', current ?? 'https://')
    if (url === null) return
    if (!url || url === 'https://') chain().extendMarkRange('link').unsetLink().run()
    else chain().extendMarkRange('link').setLink({ href: url, target: '_blank' }).run()
  }
  const addVideo = () => {
    const url = window.prompt('YouTube video address (for example https://youtu.be/…)')
    if (!url) return
    if (!chain().setYoutubeVideo({ src: url }).run()) window.alert('That does not look like a YouTube video address.')
  }

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-stone-200 bg-stone-50 px-2 py-1.5">
      <select aria-label="Text style" className={select} value={state.block} onChange={(e) => setBlock(e.target.value)}>
        <option value="p">Paragraph</option>
        <option value="h2">Heading</option>
        <option value="h3">Subheading</option>
        <option value="h4">Small heading</option>
      </select>
      <select
        aria-label="Text size"
        className={`${select} ml-1`}
        value={state.size}
        onChange={(e) => (e.target.value ? chain().setFontSize(e.target.value).run() : chain().unsetFontSize().run())}
      >
        {SIZES.map((s) => <option key={s.label} value={s.value}>{s.label}</option>)}
      </select>
      <Divider />
      <Tool label="Bold" active={state.bold} onClick={() => chain().toggleBold().run()}><b>B</b></Tool>
      <Tool label="Italic" active={state.italic} onClick={() => chain().toggleItalic().run()}><i>I</i></Tool>
      <Tool label="Underline" active={state.underline} onClick={() => chain().toggleUnderline().run()}><u>U</u></Tool>
      <Tool label="Strikethrough" active={state.strike} onClick={() => chain().toggleStrike().run()}><s>S</s></Tool>
      <Divider />
      <Tool label="Bulleted list" active={state.bullets} onClick={() => chain().toggleBulletList().run()}><Glyph d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" /></Tool>
      <Tool label="Numbered list" active={state.numbers} onClick={() => chain().toggleOrderedList().run()}><Glyph d="M10 6h10M10 12h10M10 18h10M4 4.5h1.5V9M4 9h3M4 15h3l-3 3.5h3" /></Tool>
      <Tool label="Quote" active={state.quote} onClick={() => chain().toggleBlockquote().run()}><Glyph d="M7 7h4v4c0 3-1.5 5-4 6M15 7h4v4c0 3-1.5 5-4 6" /></Tool>
      <Divider />
      <Tool label="Align left" active={!state.center && !state.right} onClick={() => chain().setTextAlign('left').run()}><Glyph d="M4 6h16M4 12h10M4 18h14" /></Tool>
      <Tool label="Align centre" active={state.center} onClick={() => chain().setTextAlign('center').run()}><Glyph d="M4 6h16M7 12h10M5 18h14" /></Tool>
      <Tool label="Align right" active={state.right} onClick={() => chain().setTextAlign('right').run()}><Glyph d="M4 6h16M10 12h10M6 18h14" /></Tool>
      <Divider />
      <Tool label="Link" active={state.link} onClick={setLink}><Glyph d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></Tool>
      <Tool label={uploading ? 'Uploading image…' : 'Image'} disabled={uploading} onClick={onImage}><Glyph d="M4 5h16v14H4zM4 15l4.5-4.5 4 4 2.5-2.5L20 17M15.5 9.5h.01" /></Tool>
      <Tool label="YouTube video" onClick={addVideo}><Glyph d="M3 7.5C3 6 4 5 5.5 5h13C20 5 21 6 21 7.5v9c0 1.5-1 2.5-2.5 2.5h-13C4 19 3 18 3 16.5zM10 9v6l5-3z" /></Tool>
      <Divider />
      <Tool label="Undo" disabled={!state.canUndo} onClick={() => chain().undo().run()}><Glyph d="M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3" /></Tool>
      <Tool label="Redo" disabled={!state.canRedo} onClick={() => chain().redo().run()}><Glyph d="m15 14 5-5-5-5M20 9H9a5 5 0 0 0 0 10h3" /></Tool>
    </div>
  )
}

/** The rich text editor. `value` and `onChange` carry HTML. */
export function RichTextEditor({
  value,
  onChange,
  placeholder = 'Write here…',
  minHeight = '14rem',
}: {
  value: string
  onChange: (html: string) => void
  placeholder?: string
  minHeight?: string
}) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const changed = useRef(onChange)
  changed.current = onChange

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3, 4] },
        link: { openOnClick: false, autolink: true, defaultProtocol: 'https' },
      }),
      TextStyle,
      FontSize,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Image.configure({ HTMLAttributes: { loading: 'lazy' } }),
      Youtube.configure({ nocookie: true, modestBranding: true, width: 640, height: 360 }),
      Placeholder.configure({ placeholder }),
    ],
    content: asHtml(value),
    editorProps: { attributes: { class: 'rich min-h-[var(--editor-min)] px-4 py-3 focus:outline-none' } },
    // An empty editor still holds "<p></p>"; store nothing instead.
    onUpdate: ({ editor: e }) => changed.current(e.isEmpty ? '' : e.getHTML()),
  })

  // The form may load the saved text after the editor has started.
  useEffect(() => {
    if (!editor) return
    const incoming = asHtml(value)
    const current = editor.isEmpty ? '' : editor.getHTML()
    if (incoming !== current) editor.commands.setContent(incoming || '', { emitUpdate: false })
  }, [editor, value])

  const pick = async (file: File | undefined) => {
    if (!file || !editor) return
    setError('')
    setUploading(true)
    try {
      const src = await uploadImage(file)
      editor.chain().focus().setImage({ src, alt: file.name.replace(/\.[^.]+$/, '') }).run()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not upload the image.')
    } finally {
      setUploading(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  if (!editor) return null
  return (
    <div>
      <div
        className="overflow-hidden rounded-lg border border-stone-300 bg-white shadow-sm focus-within:border-brand-600 focus-within:ring-2 focus-within:ring-brand-200"
        style={{ ['--editor-min' as string]: minHeight }}
      >
        <Toolbar editor={editor} uploading={uploading} onImage={() => fileInput.current?.click()} />
        <EditorContent editor={editor} />
      </div>
      <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
      {error && <p role="alert" className="mt-1 text-xs text-red-700">{error}</p>}
    </div>
  )
}
