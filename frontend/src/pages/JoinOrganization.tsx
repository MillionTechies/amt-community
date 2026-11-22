/**
 * How a university, company, tech community or group joins Community: who it is for,
 * what they get, the application form, and how their applications are going.
 */
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useAuth } from 'react-oidc-context'

import { ApiError, api } from '../api'
import type { ApplicationStatus, OrganizationApplication, OrganizationKind } from '../api'
import { Icon } from '../components/icons'
import { Badge, Button, Card, ErrorNote, Field, Input, PageHeader, Select, Textarea, formatDate } from '../components/ui'
import { useAct, useOrganiserSignIn, useSignIn, useSignUp } from '../hooks'

const KINDS: { value: OrganizationKind; label: string }[] = [
  { value: 'institution', label: 'University, college or school' },
  { value: 'community', label: 'Tech community' },
  { value: 'company', label: 'Company' },
  { value: 'group', label: 'Club or student group' },
  { value: 'nonprofit', label: 'Non-profit or foundation' },
  { value: 'other', label: 'Something else' },
]

const STEPS = [
  ['Apply', 'Tell us about your organisation.'],
  ['We review it', 'Usually within two working days.'],
  ['Start organising', 'You become its admin and can add your team.'],
]

const STATUS: Record<ApplicationStatus, { tone: string; text: string }> = {
  pending: { tone: 'amber', text: 'Waiting for review' },
  approved: { tone: 'green', text: 'Approved' },
  declined: { tone: 'red', text: 'Declined' },
}

const EMPTY = { name: '', kind: '' as OrganizationKind | '', website: '', location: '', about: '', plans: '', contact_phone: '' }

function ApplicationForm() {
  const [form, setForm] = useState(EMPTY)
  const set = (field: keyof typeof EMPTY) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [field]: e.target.value }))
  const send = useAct(() => api<OrganizationApplication>('/organizations/applications/', { method: 'POST', body: form }))
  const errors = send.error instanceof ApiError ? send.error.fields : {}

  if (send.isSuccess)
    return (
      <Card className="space-y-3 text-center">
        <Icon name="check" className="mx-auto h-10 w-10 rounded-full bg-brand-50 p-2 text-brand-700" />
        <p className="text-lg font-semibold">Application sent</p>
        <p className="text-stone-600">
          Thank you. We emailed you a copy and will let you know as soon as {send.data.name} is reviewed.
        </p>
        <Button variant="secondary" onClick={() => { setForm(EMPTY); send.reset() }}>Apply for another organisation</Button>
      </Card>
    )

  return (
    <Card>
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault()
          send.mutate()
        }}
      >
        <h2 className="text-lg font-semibold">Tell us about your organisation</h2>
        <Field label="Organisation name" required error={errors.name}>
          <Input required maxLength={255} placeholder="For example: Moi University, PyData Nairobi" value={form.name} onChange={set('name')} />
        </Field>
        <Field label="What kind of organisation is it?" required error={errors.kind}>
          <Select required value={form.kind} onChange={set('kind')}>
            <option value="" disabled>Choose one</option>
            {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </Select>
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Website or social page" error={errors.website}>
            <Input type="url" placeholder="https://" value={form.website} onChange={set('website')} />
          </Field>
          <Field label="Where are you based?" error={errors.location}>
            <Input maxLength={255} placeholder="City, country" value={form.location} onChange={set('location')} />
          </Field>
        </div>
        <Field label="About your organisation" required hint="Who you are and who your members are." error={errors.about}>
          <Textarea required value={form.about} onChange={set('about')} />
        </Field>
        <Field label="What would you like to run here?" hint="Meetups, workshops, a hackathon, a bootcamp…" error={errors.plans}>
          <Textarea rows={3} value={form.plans} onChange={set('plans')} />
        </Field>
        <Field label="Phone number" hint="In case we need to reach you quickly." error={errors.contact_phone}>
          <Input type="tel" maxLength={40} value={form.contact_phone} onChange={set('contact_phone')} />
        </Field>
        <p className="text-sm text-stone-500"><span className="text-red-600">*</span> Required</p>
        <ErrorNote error={send.error} />
        <Button type="submit" disabled={send.isPending}>{send.isPending ? 'Sending…' : 'Send application'}</Button>
      </form>
    </Card>
  )
}

function MyApplications({ applications }: { applications: OrganizationApplication[] }) {
  const openConsole = useOrganiserSignIn()
  return (
    <Card className="space-y-4">
      <h2 className="text-lg font-semibold">Your applications</h2>
      <ul className="divide-y divide-stone-100">
        {applications.map((a) => (
          <li key={a.id} className="space-y-2 py-3 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>
                <span className="block font-semibold">{a.name}</span>
                <span className="block text-xs text-stone-500">{a.kind_label} · applied {formatDate(a.created_at)}</span>
              </span>
              <Badge tone={STATUS[a.status].tone}>{STATUS[a.status].text}</Badge>
            </div>
            {a.review_note && <p className="rounded-lg bg-stone-50 px-3 py-2 text-sm text-stone-700">{a.review_note}</p>}
            {a.status === 'approved' && (
              <Button variant="secondary" onClick={openConsole}>Open the organiser console</Button>
            )}
          </li>
        ))}
      </ul>
    </Card>
  )
}

function SignedOut() {
  const signIn = useSignIn()
  const signUp = useSignUp()
  return (
    <Card className="space-y-4 text-center">
      <p className="text-lg font-semibold">Ready to apply?</p>
      <p className="text-stone-600">You need a free account to apply. It becomes your organisation’s admin.</p>
      <div className="flex flex-wrap justify-center gap-3">
        <Button onClick={signUp}>Create an account</Button>
        <Button variant="secondary" onClick={signIn}>Sign in to apply</Button>
      </div>
    </Card>
  )
}

export default function JoinOrganization() {
  const auth = useAuth()
  const applications = useQuery({
    queryKey: ['organization-applications'],
    queryFn: () => api<OrganizationApplication[]>('/organizations/applications/'),
    enabled: auth.isAuthenticated,
  })

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        eyebrow="For organisations"
        title="Bring your organisation"
        subtitle="Universities, companies, tech communities and student groups run their events and hackathons here. It’s free."
      />
      <div className="grid gap-8 lg:grid-cols-3">
        <section aria-labelledby="how" className="space-y-4">
          <h2 id="how" className="eyebrow text-stone-700">How it works</h2>
          <ol className="space-y-4">
            {STEPS.map(([title, text], i) => (
              <li key={title} className="flex gap-3">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-ink font-mono text-xs font-semibold text-white">{i + 1}</span>
                <span>
                  <span className="block font-semibold">{title}</span>
                  <span className="block text-sm text-stone-600">{text}</span>
                </span>
              </li>
            ))}
          </ol>
          <p className="text-sm text-stone-500">Already on Community? Ask your organisation’s admin to add you.</p>
        </section>

        <div id="apply" className="space-y-6 lg:col-span-2">
          {auth.isAuthenticated ? (
            <>
              <ErrorNote error={applications.error} />
              {!!applications.data?.length && <MyApplications applications={applications.data} />}
              <ApplicationForm />
            </>
          ) : (
            <SignedOut />
          )}
        </div>
      </div>
    </div>
  )
}
