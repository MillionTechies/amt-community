/** Connected accounts: an organiser links Google, Microsoft or Zoom to make meetings and sync calendars. */
import { useQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'

import { api } from '../api'
import type { Integration } from '../api'
import { Icon } from '../components/icons'
import { Badge, Button, ErrorNote, Notice, Spinner } from '../components/ui'
import { useConfirm, useToast } from '../components/feedback'
import { useAct } from '../hooks'
import { ConsoleHeader } from './shared'

const WHAT: Record<Integration['id'], string> = {
  google: 'Create Google Meet links, and keep your events in your Google Calendar.',
  microsoft: 'Create Microsoft Teams meetings, and keep your events in your Outlook calendar.',
  zoom: 'Create Zoom meetings for your online events.',
}

export function useIntegrations(organization?: string) {
  return useQuery({
    queryKey: ['integrations', organization ?? 'all'],
    queryFn: () => api<Integration[]>(`/integrations/${organization ? `?organization=${encodeURIComponent(organization)}` : ''}`),
  })
}

export default function Integrations() {
  const integrations = useIntegrations()
  const [params] = useSearchParams()
  const connect = useAct(async (i: Integration) => {
    const { authorize_url } = await api<{ authorize_url: string }>(`/integrations/${i.id}/`, { method: 'POST', body: { app: i.app } })
    window.location.assign(authorize_url)
  })
  const disconnect = useAct((i: Integration) => api(`/integrations/${i.id}/${i.app ? `?app=${encodeURIComponent(i.app)}` : ''}`, { method: 'DELETE' }))
  const confirm = useConfirm()
  const toast = useToast()
  const disconnectApp = async (i: Integration) => {
    if (await confirm({ tone: 'danger', title: `Disconnect ${i.name}?`, message: 'Events already in your calendar stay there. New events are no longer added.', confirmLabel: 'Disconnect' })) {
      disconnect.mutate(i, { onSuccess: () => toast({ title: `${i.name} disconnected` }) })
    }
  }
  const connected = integrations.data?.find((i) => i.id === params.get('connected'))
  const failed = integrations.data?.find((i) => i.id === params.get('error'))

  return (
    <>
      <ConsoleHeader
        title="Connected accounts"
        subtitle="Connect your own accounts to create meetings and keep events in your calendar. Only you can use them."
      />
      <div className="mb-4 space-y-3 empty:hidden">
        {connected && <Notice>Your {connected.name} account is connected.</Notice>}
        {failed && <Notice tone="amber">{failed.name} did not connect. Try again, and allow the access it asks for.</Notice>}
        <ErrorNote error={connect.error ?? disconnect.error ?? integrations.error} />
      </div>
      {!integrations.data ? (
        <Spinner />
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {integrations.data.map((i) => (
            <section key={`${i.id}-${i.app ?? 'platform'}`} className="flex flex-col rounded-xl border border-stone-200 bg-white p-5">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="text-lg font-bold">
                  {i.name}
                  {i.app && <span className="block text-xs font-normal text-stone-500">{i.app_name}'s own app, for its events</span>}
                </h2>
                {i.connected ? <Badge tone="green">Connected</Badge> : !i.configured ? <Badge>Not set up</Badge> : null}
              </div>
              <p className="text-sm text-stone-600">{WHAT[i.id]}</p>
              <ul className="mt-3 space-y-1 text-sm">
                {i.meeting_name && <li className="flex items-center gap-2"><Icon name="check" className="h-4 w-4 text-brand-600" />{i.meeting_name} meetings</li>}
                {i.has_calendar && <li className="flex items-center gap-2"><Icon name="check" className="h-4 w-4 text-brand-600" />Calendar sync</li>}
              </ul>
              <div className="mt-auto pt-5">
                {i.connected ? (
                  <div className="space-y-2">
                    <p className="truncate font-mono text-xs text-stone-500">{i.account_email || 'Connected'}</p>
                    <Button variant="secondary" className="w-full" disabled={disconnect.isPending} onClick={() => void disconnectApp(i)}>
                      Disconnect
                    </Button>
                  </div>
                ) : i.configured ? (
                  <Button className="w-full" disabled={connect.isPending} onClick={() => connect.mutate(i)}>Connect {i.name}</Button>
                ) : (
                  <p className="rounded-lg bg-stone-50 p-3 text-xs text-stone-600">
                    Not set up yet. An admin can add the {i.name} app's keys on the{' '}
                    <Link to="/manage/configuration" className="font-semibold text-brand-700 hover:underline">Configuration</Link> page.
                  </p>
                )}
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  )
}
