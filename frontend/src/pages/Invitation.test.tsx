import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { Invitation } from '../api'
import { auth, signIn } from '../test/auth'
import { mockFetch, reply, sequence } from '../test/fetch'
import { currentPath, renderApp } from '../test/render'
import InvitationPage from './Invitation'

const invitation = (overrides: Partial<Invitation> = {}): Invitation => ({
  token: 'tok',
  kind: 'judge',
  status: 'pending',
  email_hint: 'k***@example.com',
  summary: 'judge Climate hack',
  invited_by: 'Alice',
  organization: null,
  role: '',
  hackathon: { slug: 'climate-hack', title: 'Climate hack' },
  team: null,
  is_for_you: true,
  created_at: '2026-11-20T08:00:00Z',
  ...overrides,
})

const open = () => renderApp(<InvitationPage />, { route: '/invitations/tok', path: '/invitations/:token' })

describe('Invitation page', () => {
  it.each([
    ['the request fails', reply(404, { detail: 'Not found.' }), 'Not found.'],
    ['the API returns nothing', null, 'Invitation not found.'],
  ])('shows an error when %s', async (_, answer, message) => {
    mockFetch({ 'GET /invitations/tok/': answer })
    open()
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
  })

  it('lets someone new create an account, or sign in, to answer', async () => {
    mockFetch({ 'GET /invitations/tok/': invitation({ is_for_you: false }) })
    const { user } = open()
    expect(await screen.findByRole('heading', { name: 'Alice invited you to judge Climate hack' })).toBeInTheDocument()
    expect(screen.getByText('Sent to k***@example.com')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Create an account' }))
    expect(auth.signinRedirect).toHaveBeenLastCalledWith(expect.objectContaining({ prompt: 'create' }))
    await user.click(screen.getByRole('button', { name: 'I already have an account' }))
    expect(auth.signinRedirect).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['judge', {}, '/judging'],
    ['org_role', { kind: 'org_role', summary: 'be an event organiser at Acme Labs' }, '/manage'],
    ['team', { kind: 'team', summary: 'join Rocket at Climate hack' }, '/hackathons/climate-hack/workspace'],
  ] as const)('accepts a %s invitation and goes where it leads', async (_, overrides, path) => {
    signIn()
    mockFetch({
      'GET /invitations/tok/': invitation(overrides),
      'POST /invitations/tok/accept/': sequence(reply(400, { detail: 'This team is full.' }), invitation({ ...overrides, status: 'accepted' })),
    })
    const { user } = open()
    await user.click(await screen.findByRole('button', { name: 'Accept' }))
    expect(await screen.findByText('This team is full.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Accept' }))
    expect(await screen.findByText('Invitation accepted')).toBeInTheDocument()
    expect(currentPath()).toBe(path)
  })

  it('declines', async () => {
    signIn()
    mockFetch({
      'GET /invitations/tok/': sequence(invitation(), invitation({ status: 'declined' })),
      'POST /invitations/tok/decline/': invitation({ status: 'declined' }),
    })
    const { user } = open()
    await user.click(await screen.findByRole('button', { name: 'Decline' }))
    expect(await screen.findByText('Invitation declined')).toBeInTheDocument()
    expect(await screen.findByText('This invitation was declined.')).toBeInTheDocument()
  })

  it('tells a member signed in with another address to switch', async () => {
    signIn()
    mockFetch({ 'GET /invitations/tok/': invitation({ is_for_you: false }) })
    const { user } = open()
    expect(await screen.findByText(/you are signed in with another address/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(auth.signoutRedirect).toHaveBeenCalled()
  })

  it('says when the invitation was already answered or withdrawn', async () => {
    mockFetch({ 'GET /invitations/tok/': invitation({ status: 'revoked' }) })
    open()
    expect(await screen.findByText('This invitation was withdrawn by whoever sent it.')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
