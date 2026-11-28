/** An organisation's public page: who leads it, and what it runs. */
import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'

import { api } from '../api'
import type { CommunityEvent, Hackathon, OrganizationPage, Paginated } from '../api'
import { EventCard, HackathonCard } from '../components/cards'
import { ErrorNote, PageHeader, Section, Spinner } from '../components/ui'

export default function Organization() {
  const { alias } = useParams()
  const page = useQuery({ queryKey: ['organization', alias], queryFn: () => api<OrganizationPage>(`/organizations/${alias}/page/`) })
  const id = page.data?.id
  const events = useQuery({
    queryKey: ['events', 'organization', id],
    queryFn: () => api<Paginated<CommunityEvent>>(`/events/?organization=${id}&when=upcoming&ordering=starts_at`),
    enabled: !!id,
  })
  const hackathons = useQuery({
    queryKey: ['hackathons', 'organization', id],
    queryFn: () => api<Paginated<Hackathon>>(`/hackathons/?organization=${id}`),
    enabled: !!id,
  })
  if (page.isLoading) return <Spinner />
  if (!page.data) return <ErrorNote error={page.error ?? 'Organisation not found.'} />
  const o = page.data
  const upcoming = events.data?.results ?? []
  const programmes = hackathons.data?.results ?? []
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Organisation" title={o.name} />
      {o.leadership.length > 0 && (
        <Section title="Leadership">
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {o.leadership.map((l) => (
              <li key={l.id} className="rounded-lg border border-stone-200 p-4">
                <p className="font-mono text-xs font-semibold uppercase tracking-wider text-brand-700">{l.title}</p>
                <p className="mt-1 font-semibold">{l.person.name}</p>
                {l.person.headline && <p className="text-sm text-stone-600">{l.person.headline}</p>}
              </li>
            ))}
          </ul>
        </Section>
      )}
      <Section title="Upcoming events">
        {upcoming.length ? (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{upcoming.map((e) => <li key={e.slug}><EventCard event={e} /></li>)}</ul>
        ) : (
          <p className="text-sm text-stone-500">No upcoming events.</p>
        )}
      </Section>
      <Section title="Hackathons">
        {programmes.length ? (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{programmes.map((h) => <li key={h.slug}><HackathonCard hackathon={h} /></li>)}</ul>
        ) : (
          <p className="text-sm text-stone-500">No hackathons yet.</p>
        )}
      </Section>
    </div>
  )
}
