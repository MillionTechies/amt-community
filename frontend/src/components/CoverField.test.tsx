import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { mockFetch, reply } from '../test/fetch'
import { CoverField } from './CoverField'

function Form() {
  const [cover, setCover] = useState('')
  return (
    <>
      <CoverField value={cover} onChange={setCover} kind="hackathon" title="" />
      <p>Saved cover: {cover || 'none'}</p>
    </>
  )
}

const banner = new File(['png'], 'banner.png', { type: 'image/png' })
const fileInput = () => document.querySelector<HTMLInputElement>('input[type="file"]')!

describe('CoverField', () => {
  it('draws a cover until an image is uploaded, and draws it again once removed', async () => {
    let finish: (value: unknown) => void = () => undefined
    const fetch = mockFetch({ 'POST /uploads/': () => new Promise((resolve) => (finish = resolve)) })
    const user = userEvent.setup()
    render(<Form />)
    expect(screen.getByRole('group', { name: 'Cover image' })).toHaveTextContent('Until you add one, a cover is drawn from the title.')
    expect(screen.getByText('Your title here')).toBeInTheDocument()

    fireEvent.change(fileInput(), { target: { files: [] } })
    expect(fetch).not.toHaveBeenCalled()

    const click = vi.spyOn(fileInput(), 'click')
    await user.click(screen.getByRole('button', { name: 'Upload image' }))
    expect(click).toHaveBeenCalled()

    await user.upload(fileInput(), banner)
    expect(screen.getByRole('button', { name: 'Uploading…' })).toBeDisabled()
    finish(reply(201, { url: 'https://cdn.test/banner.png' }))

    expect(await screen.findByText('Saved cover: https://cdn.test/banner.png')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Change image' })).toBeEnabled()
    expect(fileInput()).toHaveValue('')
    expect(screen.queryByText('Your title here')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Remove' }))
    expect(screen.getByText('Saved cover: none')).toBeInTheDocument()
    expect(screen.getByText('Your title here')).toBeInTheDocument()
  })

  it('explains why an upload failed, or says so plainly when it cannot tell', async () => {
    mockFetch({ 'POST /uploads/': reply(400, { file: ['That file is too big.'] }) })
    const user = userEvent.setup()
    render(<Form />)
    await user.upload(fileInput(), banner)
    expect(await screen.findByRole('alert')).toHaveTextContent('That file is too big.')
    expect(screen.getByText('Saved cover: none')).toBeInTheDocument()

    vi.stubGlobal('FormData', class {
      append() {
        throw 'no form data'
      }
    })
    await user.upload(fileInput(), banner)
    expect(await screen.findByText('Could not upload that image.')).toBeInTheDocument()
  })
})
