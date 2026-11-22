import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { mockFetch, reply } from '../test/fetch'
import { renderApp } from '../test/render'
import CertificatePage from './Certificate'

const certificate = {
  certificate_code: 'CERT-42',
  recipient: 'Wanjiru Kamau',
  event: 'React workshop',
  event_type: 'Workshop',
  organization: 'Acme Labs',
  starts_at: '2026-11-30T06:00:00Z',
  ends_at: '2026-11-30T09:00:00Z',
}

const open = () => renderApp(<CertificatePage />, { route: '/certificates/CERT-42', path: '/certificates/:code' })

describe('Certificate page', () => {
  it('shows who attended what, and prints', async () => {
    mockFetch({ 'GET /certificates/CERT-42/': certificate })
    const print = vi.fn()
    vi.stubGlobal('print', print)
    const { user } = open()
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()
    expect(await screen.findByText('Wanjiru Kamau')).toBeInTheDocument()
    expect(screen.getByText('attended the workshop')).toBeInTheDocument()
    expect(screen.getByText('hosted by Acme Labs on 30 Nov 2026')).toBeInTheDocument()
    expect(screen.getByText('Certificate ID CERT-42')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Print or save as PDF' }))
    expect(print).toHaveBeenCalled()
  })

  it('says so when the link matches no certificate', async () => {
    mockFetch({ 'GET /certificates/CERT-42/': reply(404, { detail: 'Not found.' }) })
    open()
    expect(await screen.findByText('No certificate matches this link.')).toBeInTheDocument()
  })
})
