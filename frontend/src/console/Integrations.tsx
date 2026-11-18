/** Connected accounts: an organiser links Google, Microsoft or Zoom to make meetings and sync calendars. */
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'

import { api } from '../api'
import type { Integration } from '../api'
import { Icon } from '../components/icons'
import { Badge, Button, ErrorNote, Notice, Spinner } from '../components/ui'
import { useAct } from '../hooks'
import { ConsoleHeader } from './shared'

const WHAT: Record<Integration['id'], string> = {
  google: 'Create Google Meet links, and keep your events in your Google Calendar.',
  microsoft: 'Create Microsoft Teams meetings, and keep your events in your Outlook calendar.',
  zoom: 'Create Zoom meetings for your online events.',
}

export function useIntegrations() {
  return useQuery({ queryKey: ['integrations'], queryFn: () => api<Integration[]>('/integrations/') })
}

export default function Integrations() {
  const integrations = useIntegrations()
  const [params] = useSearchParams()
  const connect = useAct(async (id: string) => {
    const { authorize_url } = await api<{ authorize_url: string }>(`/integrations/${id}/`, { method: 'POST' })
    window.location.assign(authorize_url)
  })
  const disconnect = useAct((id: string) => api(`/integrations/${id}/`, { method: 'DELETE' }))
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
            <section key={i.id} className="flex flex-col rounded-xl border border-stone-200 bg-white p-5">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="text-lg font-bold">{i.name}</h2>
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
                    <Button variant="secondary" className="w-full" disabled={disconnect.isPending} onClick={() => window.confirm(`Disconnect ${i.name}? Events already in your calendar stay there.`) && disconnect.mutate(i.id)}>
                      Disconnect
                    </Button>
                  </div>
                ) : i.configured ? (
                  <Button className="w-full" disabled={connect.isPending} onClick={() => connect.mutate(i.id)}>Connect {i.name}</Button>
                ) : (
                  <p className="rounded-lg bg-stone-50 p-3 text-xs text-stone-600">
                    An admin needs to register a {i.name} app and add its keys to the server (<code className="font-mono">{i.id.toUpperCase()}_OAUTH_CLIENT_ID</code>). See the README.
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
