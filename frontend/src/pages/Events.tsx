import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import type { ReactNode } from 'react'

import { api } from '../api'
import type { CommunityEvent, Paginated } from '../api'
import { EVENT_TYPE_ICONS, EventCard, grid } from '../components/cards'
import { Icon } from '../components/icons'
import { Button, Empty, ErrorNote, Input, LinkButton, PageHeader, Spinner, Tabs } from '../components/ui'
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
  const [within, setWithin] = useState('')
  const [online, setOnline] = useState(false)
  const [page, setPage] = useState(1)

  const params = new URLSearchParams({ page: String(page) })
  if (tab === 'managed') params.set('scope', 'managed')
  else params.set('when', tab)
  if (search) params.set('search', search)
  if (type) params.set('event_type', type)
  if (within) params.set('within', within)
  if (online) params.set('delivery_mode', 'online')
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
        action={canManage && <LinkButton to="/manage/events/new">Create event</LinkButton>}
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
      <div className="mb-6 space-y-4">
        <Input
          type="search"
          placeholder="Search events"
          aria-label="Search events"
          value={search}
          onChange={(e) => reset(setSearch)(e.target.value)}
        />
        {/* Categories, Meetup style: swipe sideways on a phone. */}
        <div
          role="group"
          aria-label="Event type"
          className="-mx-4 flex gap-1 overflow-x-auto border-b border-stone-200 px-4 [scrollbar-width:none] sm:mx-0 sm:px-0"
        >
          {[['', 'All events'], ...EVENT_TYPES.map((t) => [t, EVENT_TYPE_LABELS[t]])].map(([value, text]) => (
            <button
              key={value}
              type="button"
              aria-pressed={type === value}
              onClick={() => reset(setType)(value)}
              className={`-mb-px flex w-24 shrink-0 flex-col items-center gap-1.5 border-b-2 px-1 pb-3 pt-1 text-center text-xs font-semibold leading-tight transition ${
                type === value ? 'border-ink text-ink' : 'border-transparent text-stone-500 hover:text-ink'
              }`}
            >
              <span className={`grid h-10 w-10 place-items-center rounded-full ${type === value ? 'bg-brand-600 text-white' : 'bg-white text-brand-700 ring-1 ring-stone-200'}`}>
                <Icon name={value ? EVENT_TYPE_ICONS[value] : 'sparkles'} className="h-5 w-5" />
              </span>
              {text}
            </button>
          ))}
        </div>
        {tab === 'upcoming' && (
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0" role="group" aria-label="When">
            {[['', 'Any day'], ['today', 'Today'], ['week', 'This week'], ['weekend', 'This weekend']].map(([value, text]) => (
              <Chip key={value} on={within === value} onClick={() => reset(setWithin)(value)}>
                {value === '' && <Icon name="clock" className="h-4 w-4" />}{text}
              </Chip>
            ))}
            <span className="mx-1 w-px shrink-0 bg-stone-200" aria-hidden="true" />
            <Chip on={online} onClick={() => reset(setOnline)(!online)}>
              <Icon name="video" className="h-4 w-4" />Online only
            </Chip>
          </div>
        )}
      </div>
      <ErrorNote error={events.error} />
      {events.isLoading ? (
        <Spinner />
      ) : events.data?.results.length ? (
        <>
          <div className={grid}>
            {events.data.results.map((event) => <EventCard key={event.slug} event={event} />)}
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
            {search || type || within || online
              ? 'No events match. Try another day or type.'
              : tab === 'managed'
                ? 'You have not created any events yet.'
                : `No ${tab} events.`}
          </Empty>
        )
      )}
    </>
  )
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-sm font-semibold transition ${
        on ? 'border-ink bg-ink text-white' : 'border-stone-300 bg-white text-stone-700 hover:border-stone-400'
      }`}
    >
      {children}
    </button>
  )
}
