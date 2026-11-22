import { describe, expect, it } from 'vitest'

import { detectMeeting } from './meetings'

describe('detectMeeting', () => {
  it('recognises the meeting services', () => {
    expect(detectMeeting('https://meet.google.com/abc-defg-hij')).toEqual({ id: 'google_meet', name: 'Google Meet' })
    expect(detectMeeting('https://us02web.zoom.us/j/123')).toEqual({ id: 'zoom', name: 'Zoom' })
    expect(detectMeeting('https://TEAMS.MICROSOFT.COM/l/meetup-join/x')).toEqual({ id: 'teams', name: 'Microsoft Teams' })
    expect(detectMeeting('https://youtu.be/xyz')).toEqual({ id: 'youtube', name: 'YouTube Live' })
    expect(detectMeeting('https://www.youtube.com/live/xyz')).toEqual({ id: 'youtube', name: 'YouTube Live' })
  })

  it('ignores look-alike hosts, other services and text that is not an address', () => {
    expect(detectMeeting('https://notzoom.us/j/1')).toBeNull()
    expect(detectMeeting('https://example.com/call')).toBeNull()
    expect(detectMeeting('see the venue')).toBeNull()
  })
})
