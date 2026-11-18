/** Which web-conferencing service a meeting link is on. Mirrors apps/integrations/meetings.py. */

const PROVIDERS: [string, string, string[]][] = [
  ['google_meet', 'Google Meet', ['meet.google.com']],
  ['teams', 'Microsoft Teams', ['teams.microsoft.com', 'teams.live.com', 'teams.cloud.microsoft']],
  ['zoom', 'Zoom', ['zoom.us', 'zoom.com', 'zoomgov.com']],
  ['webex', 'Webex', ['webex.com']],
  ['jitsi', 'Jitsi Meet', ['meet.jit.si', '8x8.vc']],
  ['whereby', 'Whereby', ['whereby.com']],
  ['goto', 'GoTo Meeting', ['meet.goto.com', 'gotomeeting.com', 'global.gotomeeting.com']],
  ['skype', 'Skype', ['join.skype.com']],
  ['discord', 'Discord', ['discord.gg', 'discord.com']],
  ['slack', 'Slack huddle', ['app.slack.com']],
  ['youtube', 'YouTube Live', ['youtube.com', 'youtu.be']],
  ['streamyard', 'StreamYard', ['streamyard.com']],
  ['bigbluebutton', 'BigBlueButton', ['bigbluebutton.org']],
]

export interface MeetingProvider {
  id: string
  name: string
}

export function detectMeeting(url: string): MeetingProvider | null {
  let host = ''
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
  for (const [id, name, hosts] of PROVIDERS) {
    if (hosts.some((h) => host === h || host.endsWith(`.${h}`))) return { id, name }
  }
  return null
}
