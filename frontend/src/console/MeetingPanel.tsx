/** In an event's workspace: its meeting, and its copies in organisers' calendars. */
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'

import { api } from '../api'
import type { CommunityEvent, EventLink } from '../api'
import { Icon } from '../components/icons'
import { Button, ErrorNote, Spinner } from '../components/ui'
import { useConfirm, useToast } from '../components/feedback'
import { useAct } from '../hooks'
import { useIntegrations } from './Integrations'
import { Panel } from './shared'

export function MeetingPanel({ event: e }: { event: CommunityEvent }) {
  // The apps this organisation's events use: its own, or the platform's.
  const integrations = useIntegrations(e.organization.id)
  const links = useQuery({ queryKey: ['event', e.slug, 'links'], queryFn: () => api<EventLink[]>(`/events/${e.slug}/links/`) })
  const add = useAct((body: { provider: string; meeting: boolean }) =>
    api<EventLink>(`/events/${e.slug}/links/`, { method: 'POST', body }),
  )
  const remove = useAct((id: number) => api(`/events/${e.slug}/links/${id}/`, { method: 'DELETE' }))
  const confirm = useConfirm()
  const toast = useToast()
  if (!integrations.data || !links.data) return <Panel title="Meeting and calendars"><Spinner /></Panel>

  const open = e.status !== 'cancelled' && e.status !== 'completed'
  const usable = integrations.data.filter((i) => i.configured)
  const meetingMakers = usable.filter((i) => i.meeting_name)
  const calendars = usable.filter((i) => i.has_calendar)
  const already = new Set(links.data.filter((l) => l.mine).map((l) => l.provider))
  const createMeeting = async (provider: string, name: string) => {
    // Replacing a link people already have needs a yes; a first link does not.
    const go = e.online_url
      ? await confirm({
          tone: 'warning', title: 'Replace the meeting link?', confirmLabel: `Create ${name} meeting`, icon: 'refresh',
          message: 'The current link stops being shown. Everyone registered is emailed the new one.',
        })
      : true
    if (go) add.mutate({ provider, meeting: true }, { onSuccess: () => toast({ title: `${name} meeting created`, message: 'The link is on the event page for everyone registered.' }) })
  }
  const removeLink = async (l: EventLink) => {
    if (await confirm({ tone: 'danger', title: `Remove it from ${l.provider_name}?`, message: 'The event is deleted from that calendar.', confirmLabel: 'Remove' })) {
      remove.mutate(l.id, { onSuccess: () => toast({ title: `Removed from ${l.provider_name}` }) })
    }
  }

  return (
    <Panel title="Meeting and calendars">
      <div className="space-y-4 text-sm">
        <div>
          <p className="mb-1 font-mono text-[0.6875rem] font-semibold uppercase tracking-wider text-stone-500">Join link</p>
          {e.online_url ? (
            <p className="break-all">
              <span className="font-semibold">{e.meeting_provider?.name ?? 'Link'}</span>{' '}
              <a href={e.online_url} target="_blank" rel="noreferrer" className="text-brand-700 hover:underline">{e.online_url}</a>
            </p>
          ) : (
            <p className="text-stone-600">None yet. Paste one under Details, or create one here.</p>
          )}
        </div>

        {open && meetingMakers.length > 0 && (
          <div>
            <p className="mb-2 font-mono text-[0.6875rem] font-semibold uppercase tracking-wider text-stone-500">Create a meeting</p>
            <div className="flex flex-wrap gap-2">
              {meetingMakers.map((i) =>
                i.connected ? (
                  <Button
                    key={i.id}
                    variant="secondary"
                    className="px-3 py-1.5"
                    disabled={add.isPending}
                    onClick={() => void createMeeting(i.id, i.meeting_name)}
                  >
                    <Icon name="plus" className="h-3.5 w-3.5" />{i.meeting_name}
                  </Button>
                ) : (
                  <Link key={i.id} to="/manage/integrations" className="rounded-lg border border-dashed border-stone-300 px-3 py-1.5 text-xs text-stone-600 hover:border-stone-400">
                    Connect {i.name} for {i.meeting_name}
                  </Link>
                ),
              )}
            </div>
          </div>
        )}

        {open && calendars.length > 0 && (
          <div>
            <p className="mb-2 font-mono text-[0.6875rem] font-semibold uppercase tracking-wider text-stone-500">Keep it in my calendar</p>
            <div className="flex flex-wrap gap-2">
              {calendars.filter((i) => i.connected && !already.has(i.id)).map((i) => (
                <Button key={i.id} variant="secondary" className="px-3 py-1.5" disabled={add.isPending} onClick={() => add.mutate({ provider: i.id, meeting: false })}>
                  <Icon name="calendar" className="h-3.5 w-3.5" />{i.id === 'google' ? 'Google Calendar' : 'Outlook'}
                </Button>
              ))}
              {calendars.every((i) => !i.connected) && (
                <Link to="/manage/integrations" className="text-xs font-semibold text-brand-700 hover:underline">Connect Google or Microsoft</Link>
              )}
            </div>
          </div>
        )}

        {links.data.length > 0 && (
          <ul className="divide-y divide-stone-100 border-t border-stone-200">
            {links.data.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-2 py-2">
                <span className="min-w-0">
                  <span className="block font-medium">{l.provider === 'zoom' ? 'Zoom meeting' : `${l.provider_name} ${l.is_meeting ? 'meeting and calendar' : 'calendar'}`}</span>
                  <span className="block truncate text-xs text-stone-500">{l.account_email} · kept in sync</span>
                </span>
                {l.mine && (
                  <Button variant="ghost" className="px-2 py-1" disabled={remove.isPending} onClick={() => void removeLink(l)}>
                    Remove
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}

        {usable.length === 0 && (
          <p className="text-xs text-stone-500">Google, Microsoft and Zoom are not set up on this server yet, so paste meeting links by hand.</p>
        )}
        <ErrorNote error={add.error ?? remove.error} />
      </div>
    </Panel>
  )
}
