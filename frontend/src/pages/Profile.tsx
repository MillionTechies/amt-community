import { useEffect, useState } from 'react'

import { ApiError, api } from '../api'
import type { Me } from '../api'
import { Badge, Button, Card, ErrorNote, Field, Input, Notice, PageHeader, Spinner, Textarea, label } from '../components/ui'
import { useAct, useMe } from '../hooks'

export default function Profile() {
  const me = useMe()
  const [form, setForm] = useState({ headline: '', bio: '', institution: '', skills: '', github_url: '', linkedin_url: '' })
  useEffect(() => {
    if (me)
      setForm({
        headline: me.headline,
        bio: me.bio,
        institution: me.institution,
        skills: me.skills.join(', '),
        github_url: me.github_url,
        linkedin_url: me.linkedin_url,
      })
  }, [me])
  const set = (field: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [field]: e.target.value }))
  const save = useAct(() =>
    api<Me>('/me/', { method: 'PATCH', body: { ...form, skills: form.skills.split(',').map((s) => s.trim()).filter(Boolean) } }),
  )
  const errors = save.error instanceof ApiError ? save.error.fields : {}
  if (!me) return <Spinner />

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Your profile" />
      <Card className="space-y-2">
        <p className="text-xl font-semibold">{me.full_name || 'Member'}</p>
        <p className="text-stone-600">{me.email}</p>
        <p className="text-sm text-stone-500">Your name and email come from your A Million Techies account.</p>
        {me.is_platform_admin && <Badge tone="amber">Platform administrator</Badge>}
        {!!me.organizations.length && (
          <ul className="space-y-1 pt-2 text-sm">
            {me.organizations.map((o) => (
              <li key={o.id}>
                <span className="font-semibold">{o.name}</span>{' '}
                {o.is_admin ? <Badge tone="green">Admin</Badge> : o.roles.map((r) => <Badge key={r} tone="blue">{label(r)}</Badge>)}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card>
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate()
          }}
        >
          <Field label="Headline" hint="For example: Computer science student, backend developer." error={errors.headline}>
            <Input maxLength={160} value={form.headline} onChange={set('headline')} />
          </Field>
          <Field label="University or organisation" error={errors.institution}>
            <Input value={form.institution} onChange={set('institution')} />
          </Field>
          <Field label="About you" error={errors.bio}><Textarea value={form.bio} onChange={set('bio')} /></Field>
          <Field label="Skills" hint="Separate with commas: Python, React, UI design." error={errors.skills}>
            <Input value={form.skills} onChange={set('skills')} />
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="GitHub" error={errors.github_url}><Input type="url" placeholder="https://github.com/" value={form.github_url} onChange={set('github_url')} /></Field>
            <Field label="LinkedIn" error={errors.linkedin_url}><Input type="url" placeholder="https://linkedin.com/in/" value={form.linkedin_url} onChange={set('linkedin_url')} /></Field>
          </div>
          <ErrorNote error={save.error} />
          {save.isSuccess && <Notice>Profile saved.</Notice>}
          <Button type="submit" disabled={save.isPending}>Save profile</Button>
        </form>
      </Card>
    </div>
  )
}
