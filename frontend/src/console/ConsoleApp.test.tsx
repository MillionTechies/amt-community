import { screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { renderConsole } from '../test/console'
import { currentPath } from '../test/render'

describe('ConsoleApp', () => {
  it('says when a console page does not exist, with a way back', async () => {
    const { user } = renderConsole('/manage/nowhere')
    expect(await screen.findByText(/This page does not exist/)).toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: 'Back to the console' }))
    expect(currentPath()).toBe('/manage')
  })

  it('sends the old platform page to the platform area', async () => {
    renderConsole('/manage/platform')
    await waitFor(() => expect(currentPath()).toBe('/platform'))
  })

  it('opens the create forms', async () => {
    renderConsole('/manage/events/new')
    expect(await screen.findByRole('heading', { name: 'Create event' })).toBeInTheDocument()
  })
})
