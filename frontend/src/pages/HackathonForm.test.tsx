import { screen, within } from '@testing-library/react'
import { beforeAll, describe, expect, it } from 'vitest'

import { signIn } from '../test/auth'
import { mockFetch, reply, sentBody } from '../test/fetch'
import { hackathon, me, membership } from '../test/fixtures'
import { editRichText, stubLayout } from '../test/layout'
import { currentPath, renderApp } from '../test/render'
import HackathonForm from './HackathonForm'

beforeAll(stubLayout)

const manager = (...organizations: ReturnType<typeof membership>[]) =>
  me({ organizations: organizations.length ? organizations : [membership({ can_manage_hackathons: true })] })

const create = () => renderApp(<HackathonForm />, { route: '/manage/hackathons/new', history: ['/manage/hackathons'] })
const edit = () =>
  renderApp(<HackathonForm />, { route: '/manage/hackathons/climate-hack/edit', path: '/manage/hackathons/:slug/edit' })

const coverInput = () => screen.getByRole('group', { name: 'Cover image' }).querySelector<HTMLInputElement>('input[type="file"]')!
const local = (value: string) => new Date(value).toISOString()

describe('Hackathon form', () => {
  it('turns away members who manage no hackathons once they load', async () => {
    signIn()
    mockFetch({ 'GET /me/': me({ organizations: [membership({ can_manage_events: true })] }) })
    create()
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()
    expect(await screen.findByText('You do not manage hackathons for any organisation.')).toBeInTheDocument()
  })

  it('creates a draft with prizes and opens it in the console', async () => {
    signIn()
    const fetch = mockFetch({
      'GET /me/': manager(),
      'POST /uploads/': reply(201, { url: 'https://cdn.test/cover.png' }),
      'POST /hackathons/': reply(201, hackathon({ slug: 'new-hack' })),
    })
    const { user } = create()
    expect(await screen.findByRole('heading', { name: 'Create hackathon' })).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Organisation' })).not.toBeInTheDocument()

    await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Water hack')
    await user.type(screen.getByRole('textbox', { name: 'Tagline' }), 'Clean water for all.')
    await user.upload(coverInput(), new File(['x'], 'c.png', { type: 'image/png' }))
    expect(await screen.findByRole('button', { name: 'Change image' })).toBeInTheDocument()
    await user.type(screen.getByRole('textbox', { name: 'Theme' }), 'Water')
    await user.type(screen.getByRole('textbox', { name: 'Venue' }), 'iHub')
    await user.type(screen.getByRole('textbox', { name: 'Rules' }), 'Be kind.')
    await user.type(screen.getByRole('textbox', { name: 'Who can take part' }), 'Students')

    const prizes = screen.getByRole('group', { name: 'Prizes' })
    await user.type(within(prizes).getByRole('textbox', { name: 'Prize 1 title' }), 'Winner')
    await user.type(within(prizes).getByRole('textbox', { name: 'Prize 1 value' }), 'KES 50,000')
    await user.click(within(prizes).getByRole('button', { name: 'Add prize' }))
    await user.click(within(prizes).getByRole('button', { name: 'Add prize' }))
    await user.type(within(prizes).getByRole('textbox', { name: 'Prize 3 title' }), 'Best design')
    await user.click(within(prizes).getByRole('button', { name: 'Remove prize 2' }))
    expect(within(prizes).queryByRole('textbox', { name: 'Prize 3 title' })).not.toBeInTheDocument()

    await user.type(screen.getByLabelText('Starts'), '2026-12-01T09:00')
    await user.type(screen.getByLabelText('Ends'), '2026-12-03T17:00')
    await user.type(screen.getByLabelText('Registration closes'), '2026-11-30T23:00')
    await user.type(screen.getByLabelText('Submissions close'), '2026-12-03T12:00')
    await user.clear(screen.getByRole('spinbutton', { name: 'Smallest team' }))
    await user.type(screen.getByRole('spinbutton', { name: 'Smallest team' }), '2')
    await user.clear(screen.getByRole('spinbutton', { name: 'Largest team' }))
    await user.type(screen.getByRole('spinbutton', { name: 'Largest team' }), '5')
    await user.click(screen.getByRole('button', { name: 'Save draft' }))

    expect(await screen.findByText('/manage/hackathons/new-hack', { selector: 'output' })).toBeInTheDocument()
    expect(sentBody(fetch, 'POST /hackathons/')).toEqual({
      organization_id: 'org-1',
      title: 'Water hack',
      tagline: 'Clean water for all.',
      cover_image: 'https://cdn.test/cover.png',
      theme: 'Water',
      description: '',
      rules: 'Be kind.',
      eligibility: 'Students',
      venue: 'iHub',
      prizes: [{ title: 'Winner', value: 'KES 50,000' }, { title: 'Best design', value: '' }],
      starts_at: local('2026-12-01T09:00'),
      ends_at: local('2026-12-03T17:00'),
      registration_deadline: local('2026-11-30T23:00'),
      submission_deadline: local('2026-12-03T12:00'),
      min_team_size: 2,
      max_team_size: 5,
    })
  })

  it('lets managers of several organisations pick one, shows what the API rejected, and goes back on cancel', async () => {
    signIn()
    const fetch = mockFetch({
      'GET /me/': manager(
        membership({ id: 'a', name: 'Acme Labs', can_manage_hackathons: true }),
        membership({ id: 'c', name: 'Code Club', can_manage_hackathons: true }),
      ),
      'POST /hackathons/': reply(400, { prizes: ['Give every prize a title.'] }),
    })
    const { user } = create()
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Organisation' }), 'Code Club')
    await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Water hack')
    await user.type(screen.getByLabelText('Starts'), '2026-12-01T09:00')
    await user.type(screen.getByLabelText('Ends'), '2026-12-01T09:00')
    await user.type(screen.getByLabelText('Registration closes'), '2026-12-01T09:00')
    await user.type(screen.getByLabelText('Submissions close'), '2026-12-01T09:00')
    await user.click(screen.getByRole('button', { name: 'Save draft' }))

    const prizes = screen.getByRole('group', { name: 'Prizes' })
    expect(await within(prizes).findByRole('alert')).toHaveTextContent('Give every prize a title.')
    expect(sentBody(fetch, 'POST /hackathons/')).toMatchObject({ organization_id: 'c', prizes: [{ title: '', value: '' }] })

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(currentPath()).toBe('/manage/hackathons')
  })

  it('edits an existing hackathon and its prizes', async () => {
    signIn()
    const fetch = mockFetch({
      'GET /me/': manager(),
      'GET /hackathons/climate-hack/': hackathon({ description: '<p>Build it.</p>', prizes: [{ title: 'First', value: 'KES 10' }] }),
      'PATCH /hackathons/climate-hack/': hackathon(),
    })
    const { user } = edit()
    expect(await screen.findByRole('textbox', { name: 'Title' })).toHaveValue('Climate hack')
    expect(screen.getByRole('textbox', { name: 'Prize 1 title' })).toHaveValue('First')
    await editRichText(user, 'Description')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByText('/manage/hackathons/climate-hack', { selector: 'output' })).toBeInTheDocument()
    expect(sentBody(fetch, 'PATCH /hackathons/climate-hack/')).toMatchObject({
      description: expect.stringContaining('<strong>Build it.</strong>'),
      prizes: [{ title: 'First', value: 'KES 10' }],
      min_team_size: 1,
      max_team_size: 4,
      starts_at: '2026-12-01T06:00:00.000Z',
    })
  })

  it('offers one empty prize row for a hackathon without prizes', async () => {
    signIn()
    mockFetch({ 'GET /me/': manager(), 'GET /hackathons/climate-hack/': hackathon() })
    edit()
    expect(await screen.findByRole('textbox', { name: 'Prize 1 title' })).toHaveValue('')
    expect(screen.queryByRole('textbox', { name: 'Prize 2 title' })).not.toBeInTheDocument()
  })
})
