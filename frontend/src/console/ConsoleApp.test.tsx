import { screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { renderConsole } from '../test/console'
import { currentPath } from '../test/render'

describe('ConsoleApp', () => {
  it('opens the create forms, moves the old platform page, and says when a page does not exist', async () => {
    const form = renderConsole('/manage/events/new')
    expect(await screen.findByRole('heading', { name: 'Create event' })).toBeInTheDocument()
    form.unmount()

    const platform = renderConsole('/manage/platform')
    await waitFor(() => expect(currentPath()).toBe('/platform'))
    platform.unmount()

    const { user } = renderConsole('/manage/nowhere')
    expect(await screen.findByText(/This page does not exist/)).toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: 'Back to the console' }))
    expect(currentPath()).toBe('/manage')
  })
})
