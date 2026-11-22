import { describe, expect, it } from 'vitest'

import { ApiError, api, setToken, uploadImage } from './api'
import { callsTo, mockFetch, mockFetchOffline, reply, sentBody } from './test/fetch'

const failure = (promise: Promise<unknown>) => promise.then(() => Promise.reject(new Error('expected a failure')), (e: ApiError) => e)

describe('api', () => {
  it('gets JSON from the API without a token when signed out', async () => {
    const fetch = mockFetch({ 'GET /stats/': { members: 12 } })
    await expect(api('/stats/')).resolves.toEqual({ members: 12 })
    const [url, init] = callsTo(fetch, 'GET /stats/')[0]
    expect(url).toBe('http://api.test/api/stats/')
    expect(init?.headers).toEqual({})
    expect(init?.body).toBeUndefined()
  })

  it('sends the token and a JSON body', async () => {
    setToken('secret')
    const fetch = mockFetch({ 'POST /events/': reply(201, { slug: 'new' }) })
    await expect(api('/events/', { method: 'POST', body: { title: 'New' } })).resolves.toEqual({ slug: 'new' })
    expect(sentBody(fetch, 'POST /events/')).toEqual({ title: 'New' })
    expect(callsTo(fetch, 'POST /events/')[0][1]?.headers).toEqual({
      Authorization: 'Bearer secret',
      'Content-Type': 'application/json',
    })
  })

  it('returns nothing for 204 No Content', async () => {
    mockFetch({ 'DELETE /events/old/': reply(204) })
    await expect(api('/events/old/', { method: 'DELETE' })).resolves.toBeUndefined()
  })

  it('returns null when a success has no JSON body', async () => {
    mockFetch({ 'GET /empty/': reply(200) })
    await expect(api('/empty/')).resolves.toBeNull()
  })

  it('explains when the server cannot be reached', async () => {
    mockFetchOffline()
    const error = await failure(api('/stats/'))
    expect(error).toBeInstanceOf(ApiError)
    expect(error.status).toBe(0)
    expect(error.message).toMatch(/Could not reach the server/)
  })

  it('uses the detail message, taking the first of a list', async () => {
    mockFetch({ 'GET /a/': reply(403, { detail: 'Not allowed.' }), 'GET /b/': reply(400, { detail: [['First.'], 'Second.'] }) })
    expect((await failure(api('/a/'))).message).toBe('Not allowed.')
    expect((await failure(api('/b/'))).message).toBe('First.')
  })

  it('uses the first message of a list body', async () => {
    mockFetch({ 'POST /a/': reply(400, ['Already registered.', 'Other']) })
    const error = await failure(api('/a/', { method: 'POST', body: {} }))
    expect(error.message).toBe('Already registered.')
    expect(error.fields).toEqual({})
  })

  it('collects per-field messages and prefers non-field errors', async () => {
    mockFetch({ 'POST /a/': reply(400, { title: ['Required.'], non_field_errors: ['Ends before it starts.'] }) })
    const error = await failure(api('/a/', { method: 'POST', body: {} }))
    expect(error.status).toBe(400)
    expect(error.message).toBe('Ends before it starts.')
    expect(error.fields).toEqual({ title: 'Required.', non_field_errors: 'Ends before it starts.' })
  })

  it('uses the first field message when there is no general one', async () => {
    mockFetch({ 'POST /a/': reply(400, { email: ['Enter a valid email.'], name: 'Too long.' }) })
    expect((await failure(api('/a/', { method: 'POST', body: {} }))).message).toBe('Enter a valid email.')
  })

  it('falls back to a general message for an empty error object', async () => {
    mockFetch({ 'GET /a/': reply(500, {}) })
    expect((await failure(api('/a/'))).message).toBe('Something went wrong.')
  })

  it('says "Not found." for a 404 without a JSON body', async () => {
    mockFetch({ 'GET /gone/': reply(404) })
    const error = await failure(api('/gone/'))
    expect(error.status).toBe(404)
    expect(error.message).toBe('Not found.')
  })

  it('says something went wrong for other errors without a JSON body', async () => {
    mockFetch({ 'GET /boom/': reply(502), 'GET /text/': reply(500, 'Server error') })
    expect((await failure(api('/boom/'))).message).toBe('Something went wrong.')
    expect((await failure(api('/text/'))).message).toBe('Something went wrong.')
  })
})

describe('uploadImage', () => {
  const file = new File(['png'], 'banner.png', { type: 'image/png' })

  it('posts the file as form data and returns its address', async () => {
    setToken('secret')
    const fetch = mockFetch({ 'POST /uploads/': reply(201, { url: 'https://cdn.test/banner.png' }) })
    await expect(uploadImage(file)).resolves.toBe('https://cdn.test/banner.png')
    const [, init] = callsTo(fetch, 'POST /uploads/')[0]
    expect(init?.headers).toEqual({ Authorization: 'Bearer secret' })
    const form = init?.body as FormData
    expect(form.get('file')).toBeInstanceOf(File)
  })

  it('uploads without a token when signed out', async () => {
    const fetch = mockFetch({ 'POST /uploads/': { url: 'https://cdn.test/a.png' } })
    await uploadImage(file)
    expect(callsTo(fetch, 'POST /uploads/')[0][1]?.headers).toEqual({})
  })

  it('reports why the upload was refused', async () => {
    mockFetch({ 'POST /uploads/': reply(400, { file: ['Images only.'] }) })
    const error = await failure(uploadImage(file))
    expect(error.message).toBe('Images only.')
    expect(error.fields).toEqual({ file: 'Images only.' })
  })

  it('reports a refusal without a JSON body', async () => {
    mockFetch({ 'POST /uploads/': reply(413) })
    expect((await failure(uploadImage(file))).message).toBe('Something went wrong.')
  })

  it('explains when the server cannot be reached', async () => {
    mockFetchOffline()
    expect((await failure(uploadImage(file))).status).toBe(0)
  })
})
