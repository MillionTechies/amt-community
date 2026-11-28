import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { person } from '../test/console'
import { mockFetch, page, reply } from '../test/fetch'
import { event, hackathon } from '../test/fixtures'
import { renderApp } from '../test/render'
import Organization from './Organization'

const open = () => renderApp(<Organization />, { route: '/organizations/acme', path: '/organizations/:alias' })

describe('Organisation page', () => {
  it.each([
    ['the request fails', reply(404, { detail: 'Not found.' }), 'Not found.'],
    ['the API returns nothing', null, 'Organisation not found.'],
  ])('shows an error when %s', async (_, answer, message) => {
    mockFetch({ 'GET /organizations/acme/page/': answer })
    open()
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
  })

  it('shows who leads the organisation and what it runs', async () => {
    mockFetch({
      'GET /organizations/acme/page/': {
        id: 'org-1', name: 'Acme Labs', alias: 'acme',
        leadership: [
          { id: 1, title: 'Chairperson', person: person({ name: 'Wanjiru', headline: 'Student, JKUAT' }) },
          { id: 2, title: 'Treasurer', person: person({ name: 'Otieno' }) },
        ],
      },
      'GET /events/?organization=org-1&when=upcoming&ordering=starts_at': page([event()]),
      'GET /hackathons/?organization=org-1': page([hackathon()]),
    })
    open()
    expect(await screen.findByRole('heading', { name: 'Acme Labs' })).toBeInTheDocument()
    expect(screen.getByText('Chairperson')).toBeInTheDocument()
    expect(screen.getByText('Student, JKUAT')).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: /React workshop/ })).toHaveAttribute('href', '/events/react-workshop')
    expect(await screen.findByRole('link', { name: /Climate hack/ })).toHaveAttribute('href', '/hackathons/climate-hack')
  })

  it('keeps a new organisation short', async () => {
    mockFetch({
      'GET /organizations/acme/page/': { id: 'org-1', name: 'Acme Labs', alias: 'acme', leadership: [] },
      'GET /events/?organization=org-1&when=upcoming&ordering=starts_at': page([]),
      'GET /hackathons/?organization=org-1': page([]),
    })
    open()
    expect(await screen.findByText('No upcoming events.')).toBeInTheDocument()
    expect(screen.getByText('No hackathons yet.')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Leadership' })).not.toBeInTheDocument()
  })
})
