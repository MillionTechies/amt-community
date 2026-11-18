/**
 * Rich text written in the editor (components/RichTextEditor.tsx). The API cleans what is
 * saved (apps/content/richtext.py), so it is safe to show. Older descriptions are plain
 * text and still show as before.
 */
import { Prose } from './ui'

export const isHtml = (value: string) => /<[a-z][\s\S]*>/i.test(value)

/** Plain text from before the editor existed, as paragraphs. */
export function asHtml(value: string) {
  if (!value || isHtml(value)) return value
  const escape = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return value.split(/\n{2,}/).map((p) => `<p>${escape(p).replace(/\n/g, '<br>')}</p>`).join('')
}

/** Show rich text written in the editor (or plain text from before it). */
export function RichText({ html, className = '' }: { html: string; className?: string }) {
  if (!isHtml(html)) return <Prose>{html}</Prose>
  return <div className={`rich ${className}`} dangerouslySetInnerHTML={{ __html: html }} />
}
