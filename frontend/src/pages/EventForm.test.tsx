import { screen, within } from '@testing-library/react'
import { beforeAll, describe, expect, it } from 'vitest'

import { toLocalInput } from '../components/ui'
import { signIn } from '../test/auth'
import { mockFetch, reply, sentBody } from '../test/fetch'
import { event, me, membership } from '../test/fixtures'
import { editRichText, stubLayout } from '../test/layout'
import { currentPath, renderApp } from '../test/render'
import EventForm from './EventForm'

beforeAll(stubLayout)

const organiser = (...organizations: ReturnType<typeof membership>[]) =>
  me({ organizations: organizations.length ? organizations : [membership({ can_manage_events: true })] })

const create = () => renderApp(<EventForm />, { route: '/manage/events/new', history: ['/manage/events'] })
const edit = () => renderApp(<EventForm />, { route: '/manage/events/react-workshop/edit', path: '/manage/events/:slug/edit' })

const coverInput = () => screen.getByRole('group', { name: 'Cover image' }).querySelector<HTMLInputElement>('input[type="file"]')!

const local = (iso: string) => new Date(iso).toISOString()

describe('Event form', () => {
  it('waits for the member to load', () => {
    create()
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()
  })

  it('turns away members who organise no events', async () => {
    signIn()
    mockFetch({ 'GET /me/': me({ organizations: [membership()] }) })
    create()
    expect(await screen.findByText('You do not organise events for any organisation.')).toBeInTheDocument()
  })

  it('creates an in-person draft and opens it in the console', async () => {
    signIn()
    const fetch = mockFetch({
      'GET /me/': organiser(),
      'POST /uploads/': reply(201, { url: 'https://cdn.test/cover.png' }),
      'POST /events/': reply(201, event({ slug: 'new-one' })),
    })
    const { user } = create()
    expect(await screen.findByRole('heading', { name: 'Create event' })).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Organisation' })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Meeting link' })).not.toBeInTheDocument()

    await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Hack night')
    await user.type(screen.getByRole('textbox', { name: 'Summary' }), 'Bring a laptop.')
    await user.upload(coverInput(), new File(['x'], 'c.png', { type: 'image/png' }))
    expect(await screen.findByRole('button', { name: 'Change image' })).toBeInTheDocument()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Type' }), 'Developer meetup')
    await user.type(screen.getByLabelText('Starts'), '2026-12-05T18:00')
    await user.type(screen.getByLabelText('Ends'), '2026-12-05T21:00')
    await user.type(screen.getByRole('textbox', { name: 'Venue' }), 'iHub')
    await user.type(screen.getByRole('spinbutton', { name: 'Places' }), '40')
    await user.type(screen.getByRole('textbox', { name: 'Who can attend' }), 'Anyone')
    await user.click(screen.getByRole('button', { name: 'Save draft' }))

    expect(await screen.findByText('/manage/events/new-one', { selector: 'output' })).toBeInTheDocument()
    expect(sentBody(fetch, 'POST /events/')).toEqual({
      organization_id: 'org-1',
      title: 'Hack night',
      summary: 'Bring a laptop.',
      cover_image: 'https://cdn.test/cover.png',
      description: '',
      event_type: 'meetup',
      delivery_mode: 'in_person',
      venue: 'iHub',
      online_url: '',
      starts_at: local('2026-12-05T18:00'),
      ends_at: local('2026-12-05T21:00'),
      registration_deadline: null,
      capacity: 40,
      eligibility: 'Anyone',
    })
  })

  it('lets organisers of several organisations pick one, and recognises meeting links', async () => {
    signIn()
    const fetch = mockFetch({
      'GET /me/': organiser(
        membership({ id: 'a', name: 'Acme Labs', can_manage_events: true }),
        membership({ id: 'b', name: 'Beta Club' }),
        membership({ id: 'c', name: 'Code Club', can_manage_events: true }),
      ),
      'POST /events/': reply(400, { online_url: ['Enter a valid URL.'] }),
    })
    const { user } = create()
    const organisation = await screen.findByRole('combobox', { name: 'Organisation' })
    expect(within(organisation).getAllByRole('option').map((o) => o.textContent)).toEqual(['Acme Labs', 'Code Club'])
    await user.selectOptions(organisation, 'Code Club')

    await user.selectOptions(screen.getByRole('combobox', { name: 'How people attend' }), 'Online')
    expect(screen.queryByRole('textbox', { name: 'Venue' })).not.toBeInTheDocument()
    const link = screen.getByRole('textbox', { name: 'Meeting link' })
    expect(screen.getByText(/Paste the link from Google Meet/)).toBeInTheDocument()
    await user.type(link, 'https://meet.google.com/abc')
    expect(screen.getByText('✓ Google Meet link. Only people who register will see it.')).toBeInTheDocument()

    await user.selectOptions(screen.getByRole('combobox', { name: 'How people attend' }), 'Hybrid')
    expect(screen.getByRole('textbox', { name: 'Venue' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Meeting link' })).toBeInTheDocument()

    await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Hybrid talk')
    await user.type(screen.getByLabelText('Starts'), '2026-12-05T18:00')
    await user.type(screen.getByLabelText('Ends'), '2026-12-05T21:00')
    await user.type(screen.getByLabelText('Registration closes'), '2026-12-04T18:00')
    await user.click(screen.getByRole('button', { name: 'Save draft' }))

    expect(await screen.findAllByRole('alert')).toHaveLength(2)
    expect(sentBody(fetch, 'POST /events/')).toMatchObject({
      organization_id: 'c',
      delivery_mode: 'hybrid',
      registration_deadline: local('2026-12-04T18:00'),
      capacity: null,
    })
  })

  it('edits an existing event', async () => {
    signIn()
    const existing = event({
      description: '<p>All about React.</p>',
      capacity: 30,
      registration_deadline: '2026-11-29T06:00:00Z',
      delivery_mode: 'online',
      online_url: 'https://zoom.us/j/1',
    })
    const fetch = mockFetch({
      'GET /me/': organiser(),
      'GET /events/react-workshop/': existing,
      'PATCH /events/react-workshop/': event(),
    })
    const { user } = edit()
    expect(await screen.findByRole('textbox', { name: 'Title' })).toHaveValue('React workshop')
    expect(screen.queryByRole('heading', { name: 'Create event' })).not.toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: 'Places' })).toHaveValue(30)
    expect(screen.getByLabelText('Registration closes')).toHaveValue(toLocalInput('2026-11-29T06:00:00Z'))

    await editRichText(user, 'Description')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByText('/manage/events/react-workshop', { selector: 'output' })).toBeInTheDocument()
    expect(sentBody(fetch, 'PATCH /events/react-workshop/')).toMatchObject({
      description: expect.stringContaining('<strong>All about React.</strong>'),
      capacity: 30,
      online_url: 'https://zoom.us/j/1',
      registration_deadline: '2026-11-29T06:00:00.000Z',
    })
  })

  it('leaves an unlimited event without a capacity', async () => {
    signIn()
    mockFetch({ 'GET /me/': organiser(), 'GET /events/react-workshop/': event() })
    edit()
    expect(await screen.findByRole('textbox', { name: 'Title' })).toHaveValue('React workshop')
    expect(screen.getByRole('spinbutton', { name: 'Places' })).toHaveValue(null)
    expect(screen.getByLabelText('Registration closes')).toHaveValue('')
  })

  it('goes back on cancel', async () => {
    signIn()
    mockFetch({ 'GET /me/': organiser() })
    const { user } = create()
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(currentPath()).toBe('/manage/events')
  })
})
