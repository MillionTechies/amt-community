import { describe, expect, it } from 'vitest'

import { detectMeeting } from './meetings'

describe('detectMeeting', () => {
  it.each([
    ['https://meet.google.com/abc-defg-hij', 'google_meet', 'Google Meet'],
    ['https://us02web.zoom.us/j/123', 'zoom', 'Zoom'],
    ['https://TEAMS.MICROSOFT.COM/l/meetup-join/x', 'teams', 'Microsoft Teams'],
    ['https://youtu.be/xyz', 'youtube', 'YouTube Live'],
    ['https://www.youtube.com/live/xyz', 'youtube', 'YouTube Live'],
  ])('recognises %s', (url, id, name) => {
    expect(detectMeeting(url)).toEqual({ id, name })
  })

  it('does not match a host that only ends with the same letters', () => {
    expect(detectMeeting('https://notzoom.us/j/1')).toBeNull()
  })

  it('returns null for unknown services', () => {
    expect(detectMeeting('https://example.com/call')).toBeNull()
  })

  it('returns null for text that is not an address', () => {
    expect(detectMeeting('see the venue')).toBeNull()
  })
})
