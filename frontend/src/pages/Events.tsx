import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { api } from '../api'
import type { CommunityEvent, Paginated } from '../api'
import { EventCard, grid } from '../components/cards'
import { Button, Empty, ErrorNote, Input, LinkButton, PageHeader, Select, Spinner, Tabs } from '../components/ui'
import { useMe } from '../hooks'

export const EVENT_TYPES = ['workshop', 'outreach', 'conference', 'meetup', 'webinar', 'training', 'networking']
export const EVENT_TYPE_LABELS: Record<string, string> = {
  workshop: 'Technical workshop',
  outreach: 'University outreach',
  conference: 'Conference',
  meetup: 'Developer meetup',
  webinar: 'Webinar',
  training: 'Training session',
  networking: 'Networking event',
}

type Tab = 'upcoming' | 'past' | 'managed'

export default function Events() {
  const me = useMe()
  const canManage = me?.organizations.some((o) => o.can_manage_events) ?? false
  const [tab, setTab] = useState<Tab>('upcoming')
  const [search, setSearch] = useState('')
  const [type, setType] = useState('')
  const [page, setPage] = useState(1)

  const params = new URLSearchParams({ page: String(page) })
  if (tab === 'managed') params.set('scope', 'managed')
  else params.set('when', tab)
  if (search) params.set('search', search)
  if (type) params.set('event_type', type)
  const events = useQuery({
    queryKey: ['events', params.toString()],
    queryFn: () => api<Paginated<CommunityEvent>>(`/events/?${params}`),
  })
  const reset = <T,>(set: (value: T) => void) => (value: T) => {
    set(value)
    setPage(1)
  }

  return (
    <>
      <PageHeader
        title="Events"
        subtitle="Workshops, meetups, webinars and outreach days."
        action={canManage && <LinkButton to="/events/new">Create event</LinkButton>}
      />
      <Tabs
        tabs={[
          { id: 'upcoming' as Tab, label: 'Upcoming' },
          { id: 'past' as Tab, label: 'Past' },
          ...(canManage ? [{ id: 'managed' as Tab, label: 'Events I manage' }] : []),
        ]}
        current={tab}
        onChange={reset(setTab)}
      />
      <div className="mb-6 flex flex-col gap-3 sm:flex-row">
        <Input
          type="search"
          placeholder="Search events"
          aria-label="Search events"
          value={search}
          onChange={(e) => reset(setSearch)(e.target.value)}
        />
        <Select aria-label="Event type" className="sm:w-56" value={type} onChange={(e) => reset(setType)(e.target.value)}>
          <option value="">All types</option>
          {EVENT_TYPES.map((t) => <option key={t} value={t}>{EVENT_TYPE_LABELS[t]}</option>)}
        </Select>
      </div>
      <ErrorNote error={events.error} />
      {events.isLoading ? (
        <Spinner />
      ) : events.data?.results.length ? (
        <>
          <div className={grid}>
            {events.data.results.map((event) => <EventCard key={event.id} event={event} />)}
          </div>
          {(page > 1 || events.data.next) && (
            <div className="mt-6 flex justify-center gap-3">
              <Button variant="secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</Button>
              <Button variant="secondary" disabled={!events.data.next} onClick={() => setPage(page + 1)}>Next</Button>
            </div>
          )}
        </>
      ) : (
        !events.error && (
          <Empty>
            {search || type
              ? 'No events match your search.'
              : tab === 'managed'
                ? 'You have not created any events yet.'
                : `No ${tab} events.`}
          </Empty>
        )
      )}
    </>
  )
}
