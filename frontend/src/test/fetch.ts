/**
 * A small fetch mock keyed by "METHOD /path", where the path is what follows `${VITE_API_URL}/api`.
 *
 *   const fetch = mockFetch({
 *     'GET /me/': me({ is_platform_admin: true }),   // 200 with this JSON
 *     'POST /events/demo/register/': reply(400, { detail: 'Full.' }),
 *     'DELETE /events/demo/': reply(204),
 *     'GET /stats/': () => ({ members: n++ }),                   // a function runs per request
 *   })
 *   expect(sentBody(fetch, 'POST /events/demo/register/')).toEqual({ ... })
 *
 * A request with no entry gets a 404 "No mock for ..." so a missing stub shows up in the UI.
 * setup.ts restores the real fetch after each test.
 */
import { vi } from 'vitest'
import type { Mock } from 'vitest'

const BASE = `${import.meta.env.VITE_API_URL}/api`

// A response with a status and an optional JSON body (leave it out for 204).
export interface Reply {
  status: number
  body?: unknown
  __reply: true
}

// Build a reply with the given status and body.
export const reply = (status: number, body?: unknown): Reply => ({ status, body, __reply: true })

// A paginated list body ({ count, next, results }); pass `next` when there is a further page.
export const page = <T,>(results: T[], next: string | null = null) => ({ count: results.length, next, results })

type Handler = unknown

const isReply = (value: unknown): value is Reply => typeof value === 'object' && value !== null && '__reply' in value

const toResponse = (result: unknown) => {
  const { status, body } = isReply(result) ? result : { status: 200, body: result }
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// "GET /me/" for a call made to `${BASE}/me/`.
const keyOf = (input: unknown, init?: RequestInit) => `${init?.method ?? 'GET'} ${String(input).replace(BASE, '')}`

export type FetchMock = Mock<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>

// Replace the global fetch with one that answers from `routes`; returns the mock for assertions.
export function mockFetch(routes: Record<string, Handler>): FetchMock {
  const fetch: FetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const key = keyOf(input, init)
    const handler = routes[key]
    const result = typeof handler === 'function' ? await handler(init ?? {}) : handler
    return key in routes ? toResponse(result) : toResponse(reply(404, { detail: `No mock for ${key}` }))
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}

// Make every request fail as if the network were down.
export function mockFetchOffline(): FetchMock {
  const fetch: FetchMock = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')))
  vi.stubGlobal('fetch', fetch)
  return fetch
}

// The calls made for "METHOD /path", as [input, init] pairs.
export const callsTo = (fetch: FetchMock, key: string) => fetch.mock.calls.filter(([input, init]) => keyOf(input, init) === key)

// The parsed JSON body of the last call to "METHOD /path".
export const sentBody = (fetch: FetchMock, key: string) => JSON.parse(String(callsTo(fetch, key).at(-1)?.[1]?.body))
