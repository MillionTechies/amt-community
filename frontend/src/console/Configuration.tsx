/**
 * Configuration: Google, Microsoft and Zoom apps, email and image storage, in one place.
 * Platform admins set the defaults; an organisation's admins may override some of them
 * (their own Google, Microsoft or Zoom app, their sender name and reply-to address).
 */
import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { ApiError, api } from '../api'
import type { ConfigField, ConfigGroup, ConfigScope } from '../api'
import { Icon } from '../components/icons'
import { Badge, Button, Empty, ErrorNote, Input, Notice, Select, Spinner } from '../components/ui'
import { useAct } from '../hooks'
import { ConsoleHeader, FilterChips } from './shared'

const SOURCE: Record<string, string> = {
  platform: 'the platform setting',
  environment: 'the server environment',
  default: 'the built-in default',
}

function status(group: ConfigGroup, scope: ConfigScope) {
  if (scope.kind === 'organization') {
    if (group.own) return <Badge tone="green">Own app</Badge>
    if (group.ready) return <Badge tone="blue">Using platform</Badge>
    return group.fields.some((f) => f.key.endsWith('client_id')) ? <Badge>Not set up</Badge> : null
  }
  return group.ready ? <Badge tone="green">Ready</Badge> : <Badge>Not set up</Badge>
}

function FieldInput({
  field,
  value,
  onChange,
  error,
}: {
  field: ConfigField
  /** undefined: unchanged; null: clear; string: new value */
  value: string | null | undefined
  onChange: (value: string | null | undefined) => void
  error?: string
}) {
  const inheritedNote = field.inherited
    ? field.kind === 'secret'
      ? `Using ${SOURCE[field.source] ?? 'the default'}.`
      : `Using ${SOURCE[field.source] ?? 'the default'}: ${field.inherited}`
    : ''
  const id = `cfg-${field.key}`
  let control
  if (field.kind === 'boolean') {
    const current = value === undefined ? field.value : value ?? ''
    control = (
      <Select id={id} value={current} onChange={(e) => onChange(e.target.value === field.value ? undefined : e.target.value || null)}>
        <option value="">{field.inherited ? `Default (${field.inherited === 'true' ? 'on' : 'off'})` : 'Default (off)'}</option>
        <option value="true">On</option>
        <option value="false">Off</option>
      </Select>
    )
  } else if (field.kind === 'secret') {
    control = (
      <div className="flex gap-2">
        <Input
          id={id}
          type="password"
          autoComplete="new-password"
          value={typeof value === 'string' ? value : ''}
          placeholder={value === null ? 'Will be cleared' : field.is_set ? '•••••••• saved. Type to replace.' : field.inherited ? 'Inherited. Type to override.' : 'Not set'}
          onChange={(e) => onChange(e.target.value || undefined)}
        />
        {field.is_set && value !== null && (
          <Button variant="ghost" className="shrink-0 px-2" onClick={() => onChange(null)}>Clear</Button>
        )}
        {value === null && <Button variant="ghost" className="shrink-0 px-2" onClick={() => onChange(undefined)}>Undo</Button>}
      </div>
    )
  } else {
    const current = value === undefined ? field.value : value ?? ''
    control = (
      <Input
        id={id}
        type={field.kind === 'number' ? 'number' : field.kind === 'email' ? 'email' : field.kind === 'url' ? 'url' : 'text'}
        value={current}
        placeholder={field.inherited || field.placeholder}
        onChange={(e) => onChange(e.target.value === field.value ? undefined : e.target.value === '' ? null : e.target.value)}
      />
    )
  }
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block font-mono text-xs font-semibold uppercase tracking-wider text-stone-700">{field.label}</label>
      {control}
      {error ? (
        <p role="alert" className="mt-1 text-xs text-red-700">{error}</p>
      ) : (
        (field.help || (!field.is_set && inheritedNote)) && (
          <p className="mt-1 text-xs text-stone-500">{[field.help, !field.is_set ? inheritedNote : ''].filter(Boolean).join(' ')}</p>
        )
      )}
    </div>
  )
}

function CopyBox({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex items-center gap-2 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2">
      <code className="min-w-0 flex-1 truncate font-mono text-xs">{value}</code>
      <button
        type="button"
        className="font-mono text-[11px] font-semibold uppercase tracking-wider text-brand-700 hover:underline"
        onClick={() => void navigator.clipboard?.writeText(value).then(() => setCopied(true))}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}

function TestEmail({ scope }: { scope: string }) {
  const [to, setTo] = useState('')
  const send = useAct(() => api<{ sent_to: string; from: string }>(`/configuration/${scope}/test-email/`, { method: 'POST', body: { to } }))
  return (
    <div className="rounded-lg border border-dashed border-stone-300 p-3">
      <p className="mb-2 font-mono text-xs font-semibold uppercase tracking-wider text-stone-700">Send a test email</p>
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault()
          send.mutate()
        }}
      >
        <Input type="email" required placeholder="you@example.com" value={to} onChange={(e) => setTo(e.target.value)} />
        <Button type="submit" variant="secondary" className="shrink-0" disabled={send.isPending}>{send.isPending ? 'Sending…' : 'Send test'}</Button>
      </form>
      <div className="mt-2 empty:hidden">
        {send.data && <Notice>Sent to {send.data.sent_to}, from {send.data.from}.</Notice>}
        {send.error && <ErrorNote error={send.error instanceof ApiError ? (send.error.fields.to ?? send.error.message) : send.error} />}
      </div>
    </div>
  )
}

function GroupCard({ group, scope }: { group: ConfigGroup; scope: ConfigScope }) {
  const [draft, setDraft] = useState<Record<string, string | null>>({})
  const save = useAct(() => api<ConfigGroup[]>(`/configuration/${scope.id}/`, { method: 'PUT', body: { values: draft } }))
  const [saved, setSaved] = useState(false)
  useEffect(() => setDraft({}), [group])
  const errors = save.error instanceof ApiError ? save.error.fields : {}
  const dirty = Object.keys(draft).length > 0

  return (
    <section className="overflow-hidden rounded-xl border border-stone-200 bg-white">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-stone-200 px-5 py-4">
        <div className="min-w-0">
          <h2 className="font-bold">{group.title}</h2>
          <p className="mt-1 max-w-2xl text-sm text-stone-600">{group.description}</p>
        </div>
        {status(group, scope)}
      </div>
      <form
        className="space-y-4 px-5 py-4"
        onSubmit={(e) => {
          e.preventDefault()
          setSaved(false)
          save.mutate(undefined, { onSuccess: () => setSaved(true) })
        }}
      >
        {group.redirect_uri && (
          <div>
            <p className="mb-1.5 font-mono text-xs font-semibold uppercase tracking-wider text-stone-700">Redirect URI to register</p>
            <CopyBox value={group.redirect_uri} />
          </div>
        )}
        {scope.kind === 'organization' && group.redirect_uri && !group.own && (
          <p className="text-sm text-stone-600">
            Leave these empty to use the platform's app. Fill both in to use your organisation's own app (for example, your
            institution's Google Workspace or Microsoft tenant).
          </p>
        )}
        <div className="grid gap-4 md:grid-cols-2">
          {group.fields.map((f) => (
            <FieldInput
              key={f.key}
              field={f}
              value={f.key in draft ? draft[f.key] : undefined}
              error={errors[f.key]}
              onChange={(value) => {
                setSaved(false)
                setDraft((d) => {
                  const next = { ...d }
                  if (value === undefined) delete next[f.key]
                  else next[f.key] = value
                  return next
                })
              }}
            />
          ))}
        </div>
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={!dirty || save.isPending}>{save.isPending ? 'Saving…' : 'Save'}</Button>
          {dirty && <Button variant="ghost" onClick={() => setDraft({})}>Discard changes</Button>}
          {saved && !dirty && <span className="inline-flex items-center gap-1 text-sm text-brand-700"><Icon name="check" className="h-4 w-4" />Saved</span>}
          {save.error && !Object.keys(errors).length && <ErrorNote error={save.error} />}
        </div>
      </form>
      {/* Its own form, so it sits after the settings form rather than inside it. */}
      {group.id === 'email' && <div className="px-5 pb-5"><TestEmail scope={scope.id} /></div>}
    </section>
  )
}

/**
 * `platform`: the platform's own settings (in the platform admin area).
 * `organizations`: one organisation's settings (in the organiser console).
 */
export default function Configuration({ mode = 'organizations' }: { mode?: 'platform' | 'organizations' }) {
  const all = useQuery({ queryKey: ['configuration'], queryFn: () => api<ConfigScope[]>('/configuration/') })
  const scopes = { ...all, data: all.data?.filter((s) => (mode === 'platform' ? s.kind === 'platform' : s.kind === 'organization')) }
  const [picked, setPicked] = useState('')
  const scope = scopes.data?.find((s) => s.id === picked) ?? scopes.data?.[0]
  const groups = useQuery({
    queryKey: ['configuration', scope?.id],
    queryFn: () => api<ConfigGroup[]>(`/configuration/${scope!.id}/`),
    enabled: !!scope,
  })

  if (scopes.isLoading) return <Spinner />
  if (!scope)
    return (
      <Empty>
        {mode === 'platform' ? 'Only platform admins can change platform settings.' : 'Only an organisation’s admins can change its settings.'}
      </Empty>
    )

  return (
    <>
      <ConsoleHeader
        title={mode === 'platform' ? 'Platform configuration' : 'Configuration'}
        subtitle={
          scope.kind === 'platform'
            ? 'Settings for the whole platform. Organisations use these unless they set their own.'
            : `Settings for ${scope.name}. Anything left empty uses the platform's setting.`
        }
      />
      {scopes.data!.length > 1 && (
        <div className="mb-5">
          <FilterChips current={scope.id} onChange={setPicked} options={scopes.data!.map((s) => ({ id: s.id, label: s.name }))} />
        </div>
      )}
      <ErrorNote error={groups.error} />
      {groups.isLoading ? (
        <Spinner />
      ) : (
        <div className="space-y-5">
          {groups.data?.map((g) => <GroupCard key={`${scope.id}-${g.id}`} group={g} scope={scope} />)}
        </div>
      )}
    </>
  )
}
