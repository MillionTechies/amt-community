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
import type { IconName } from '../components/icons'
import { Badge, Button, Card, ErrorNote, Field, Input, Notice, PageHeader, Select, Textarea, formatDate } from '../components/ui'
import { useAct, useOrganiserSignIn, useSignIn, useSignUp } from '../hooks'

const KINDS: { value: OrganizationKind; label: string; blurb: string; icon: IconName }[] = [
  { value: 'institution', label: 'University, college or school', blurb: 'Run tech events for your students and staff.', icon: 'school' },
  { value: 'community', label: 'Tech community', blurb: 'Meetups, study groups, conferences, GDGs and more.', icon: 'users' },
  { value: 'company', label: 'Company', blurb: 'Host workshops and hackathons, and meet talent.', icon: 'code' },
  { value: 'group', label: 'Club or student group', blurb: 'A campus club, chapter or society.', icon: 'sparkles' },
  { value: 'nonprofit', label: 'Non-profit or foundation', blurb: 'Programmes that bring more people into tech.', icon: 'globe' },
  { value: 'other', label: 'Something else', blurb: 'Tell us about it.', icon: 'star' },
]

const BENEFITS: { icon: IconName; title: string; text: string }[] = [
  { icon: 'calendar', title: 'Events', text: 'Workshops and meetups with registration, waiting lists, QR tickets and check-in.' },
  { icon: 'trophy', title: 'Hackathons', text: 'Teams, project submissions, judges, scoring and a public leaderboard.' },
  { icon: 'users', title: 'Your team', text: 'Make people event organisers or hackathon managers for your organisation.' },
  { icon: 'star', title: 'Certificates', text: 'Attendees get participation certificates anyone can verify.' },
  { icon: 'video', title: 'Your own tools', text: 'Use your Google, Microsoft or Zoom account and your own email sender.' },
  { icon: 'megaphone', title: 'Reach', text: 'Your events are listed for every member of A Million Techies.' },
]

const STEPS = [
  ['Apply', 'Sign in with your A Million Techies account and tell us about your organisation. It takes two minutes.'],
  ['We review it', 'Our team checks every application, usually within two working days, and emails you the answer.'],
  ['Start organising', 'You become your organisation’s admin. Create events, run hackathons and add your team.'],
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
        <Field label="Organisation name" error={errors.name}>
          <Input required maxLength={255} placeholder="For example: Moi University, PyData Nairobi" value={form.name} onChange={set('name')} />
        </Field>
        <Field label="What kind of organisation is it?" error={errors.kind}>
          <Select required value={form.kind} onChange={set('kind')}>
            <option value="" disabled>Choose one</option>
            {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </Select>
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Website or social page" hint="Optional" error={errors.website}>
            <Input type="url" placeholder="https://" value={form.website} onChange={set('website')} />
          </Field>
          <Field label="Where are you based?" hint="Optional" error={errors.location}>
            <Input maxLength={255} placeholder="City, country" value={form.location} onChange={set('location')} />
          </Field>
        </div>
        <Field label="About your organisation" hint="Who you are and who your members are." error={errors.about}>
          <Textarea required value={form.about} onChange={set('about')} />
        </Field>
        <Field label="What would you like to run here?" hint="Optional. Meetups, workshops, a hackathon, a bootcamp…" error={errors.plans}>
          <Textarea rows={3} value={form.plans} onChange={set('plans')} />
        </Field>
        <Field label="Phone number" hint="Optional. In case we need to reach you quickly." error={errors.contact_phone}>
          <Input type="tel" maxLength={40} value={form.contact_phone} onChange={set('contact_phone')} />
        </Field>
        <p className="text-sm text-stone-500">You will be the organisation’s first admin, and can add more people once it is approved.</p>
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
      <p className="text-stone-600">
        Applications come from a member account, which becomes your organisation’s first admin. Creating one is free.
      </p>
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
    <div className="space-y-12">
      <PageHeader
        eyebrow="For organisations"
        title="Bring your organisation to the community"
        subtitle="Universities, companies, tech communities and student groups run their events and hackathons on A Million Techies Community. Joining is free."
      />

      <section aria-labelledby="who" className="space-y-4">
        <h2 id="who" className="text-xl font-bold">Who can join</h2>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {KINDS.map((k) => (
            <li key={k.value} className="flex gap-3 rounded-xl border border-stone-200 bg-white p-4">
              <Icon name={k.icon} className="h-9 w-9 shrink-0 rounded-lg bg-brand-50 p-2 text-brand-700" />
              <span>
                <span className="block font-semibold">{k.label}</span>
                <span className="block text-sm text-stone-600">{k.blurb}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="get" className="space-y-4">
        <h2 id="get" className="text-xl font-bold">What you get</h2>
        <ul className="grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
          {BENEFITS.map((b) => (
            <li key={b.title} className="flex gap-3">
              <Icon name={b.icon} className="mt-0.5 h-5 w-5 shrink-0 text-brand-700" />
              <span>
                <span className="block font-semibold">{b.title}</span>
                <span className="block text-sm text-stone-600">{b.text}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <div className="grid gap-8 lg:grid-cols-5">
        <section aria-labelledby="how" className="space-y-4 lg:col-span-2">
          <h2 id="how" className="text-xl font-bold">How it works</h2>
          <ol className="space-y-5">
            {STEPS.map(([title, text], i) => (
              <li key={title} className="flex gap-4">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-ink font-mono text-sm font-semibold text-white">{i + 1}</span>
                <span>
                  <span className="block font-semibold">{title}</span>
                  <span className="block text-sm text-stone-600">{text}</span>
                </span>
              </li>
            ))}
          </ol>
          <Notice tone="amber">
            Already on Community? Ask your organisation’s admin to add you. They can make you an event organiser or hackathon manager.
          </Notice>
        </section>

        <div id="apply" className="space-y-6 lg:col-span-3">
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
