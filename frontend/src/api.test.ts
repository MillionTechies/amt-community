import { describe, expect, it } from 'vitest'

import { ApiError, api, setToken, uploadImage } from './api'
import { callsTo, mockFetch, mockFetchOffline, reply, sentBody, sequence } from './test/fetch'

const failure = (promise: Promise<unknown>) => promise.then(() => Promise.reject(new Error('expected a failure')), (e: ApiError) => e)

describe('api', () => {
  it('sends JSON with the token, and nothing extra when signed out', async () => {
    const fetch = mockFetch({
      'GET /stats/': { members: 12 },
      'POST /events/': reply(201, { slug: 'new' }),
      'DELETE /events/old/': reply(204),
      'GET /empty/': reply(200),
    })
    await expect(api('/stats/')).resolves.toEqual({ members: 12 })
    const [url, init] = callsTo(fetch, 'GET /stats/')[0]
    expect(url).toBe('http://api.test/api/stats/')
    expect(init?.headers).toEqual({})
    expect(init?.body).toBeUndefined()

    setToken('secret')
    await expect(api('/events/', { method: 'POST', body: { title: 'New' } })).resolves.toEqual({ slug: 'new' })
    expect(sentBody(fetch, 'POST /events/')).toEqual({ title: 'New' })
    expect(callsTo(fetch, 'POST /events/')[0][1]?.headers).toEqual({ Authorization: 'Bearer secret', 'Content-Type': 'application/json' })

    await expect(api('/events/old/', { method: 'DELETE' })).resolves.toBeUndefined()
    await expect(api('/empty/')).resolves.toBeNull()
  })

  it('explains when the server cannot be reached', async () => {
    mockFetchOffline()
    const error = await failure(api('/stats/'))
    expect(error).toBeInstanceOf(ApiError)
    expect(error.status).toBe(0)
    expect(error.message).toMatch(/Could not reach the server/)
  })

  it.each([
    ['the first detail, however nested', reply(403, { detail: [['Not allowed.'], 'Second.'] }), 'Not allowed.', {}],
    ['the first message of a list body', reply(400, ['Already registered.', 'Other']), 'Already registered.', {}],
    [
      'non-field errors over field errors',
      reply(400, { title: ['Required.'], non_field_errors: ['Ends before it starts.'] }),
      'Ends before it starts.',
      { title: 'Required.', non_field_errors: 'Ends before it starts.' },
    ],
    ['the first field error', reply(400, { email: ['Enter a valid email.'], name: 'Too long.' }), 'Enter a valid email.', { email: 'Enter a valid email.', name: 'Too long.' }],
    ['a general message for an empty object', reply(500, {}), 'Something went wrong.', {}],
    ['"Not found." for a bare 404', reply(404), 'Not found.', {}],
    ['a general message for a non-object body', reply(500, 'Server error'), 'Something went wrong.', {}],
  ])('reports %s', async (_, response, message, fields) => {
    mockFetch({ 'POST /a/': response })
    const error = await failure(api('/a/', { method: 'POST', body: {} }))
    expect(error.status).toBe(response.status)
    expect(error.message).toBe(message)
    expect(error.fields).toEqual(fields)
  })
})

describe('uploadImage', () => {
  const file = new File(['png'], 'banner.png', { type: 'image/png' })

  it('posts the file as form data, with the token once signed in', async () => {
    const fetch = mockFetch({ 'POST /uploads/': reply(201, { url: 'https://cdn.test/banner.png' }) })
    await expect(uploadImage(file)).resolves.toBe('https://cdn.test/banner.png')
    expect(callsTo(fetch, 'POST /uploads/')[0][1]?.headers).toEqual({})

    setToken('secret')
    await uploadImage(file)
    const [, init] = callsTo(fetch, 'POST /uploads/')[1]
    expect(init?.headers).toEqual({ Authorization: 'Bearer secret' })
    const form = init?.body as FormData
    expect(form.get('file')).toBeInstanceOf(File)
  })

  it('reports a refusal, or that the server cannot be reached', async () => {
    mockFetch({ 'POST /uploads/': sequence(reply(400, { file: ['Images only.'] }), reply(413)) })
    expect((await failure(uploadImage(file))).message).toBe('Images only.')
    expect((await failure(uploadImage(file))).message).toBe('Something went wrong.')

    mockFetchOffline()
    expect((await failure(uploadImage(file))).status).toBe(0)
  })
})
