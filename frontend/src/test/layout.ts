/**
 * jsdom does no layout, but ProseMirror (inside RichTextEditor) measures the page to place the
 * cursor. Call stubLayout() in a beforeAll of any test file that edits rich text:
 *
 *   beforeAll(stubLayout)
 *   await editRichText(user, 'Description')   // select all, make it bold: the editor reports a change
 */
import { screen, within } from '@testing-library/react'
import type { UserEvent } from '@testing-library/user-event'

// Give every range and element an empty box.
export function stubLayout() {
  const rect = () => new DOMRect(0, 0, 0, 0)
  const list = () => Object.assign([rect()], { item: () => rect() }) as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = rect
  Range.prototype.getClientRects = list
  Element.prototype.getClientRects = list
  document.elementFromPoint = () => null
}

// Make a change in the rich text editor labelled `label` (a Field with `group`): bold everything in it.
export async function editRichText(user: UserEvent, label: string) {
  const group = screen.getByRole('group', { name: label })
  group.querySelector<HTMLElement>('.ProseMirror')!.focus()
  await user.keyboard('{Control>}a{/Control}')
  await user.click(within(group).getByRole('button', { name: 'Bold' }))
}
