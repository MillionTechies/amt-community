import { useQuery } from '@tanstack/react-query'

import { api } from '../api'
import type { CommunityEvent, Hackathon, Paginated } from '../api'
import { EventCard, HackathonCard, grid } from '../components/cards'
import { Empty, LinkButton, PageHeader, Spinner } from '../components/ui'
import { useMe } from '../hooks'

/** What the member has signed up for. */
export default function Dashboard() {
  const me = useMe()
  const events = useQuery({
    queryKey: ['events', 'mine'],
    queryFn: () => api<Paginated<CommunityEvent>>('/events/?scope=mine&ordering=-starts_at'),
  })
  const hackathons = useQuery({
    queryKey: ['hackathons', 'mine'],
    queryFn: () => api<Paginated<Hackathon>>('/hackathons/?scope=mine'),
  })
  const attended = events.data?.results.filter((e) => e.my_registration?.checked_in_at).length ?? 0
  return (
    <div className="space-y-10">
      <PageHeader
        title={me ? `Hello, ${me.full_name.split(' ')[0] || 'there'}` : 'My activity'}
        subtitle={events.data && `${events.data.count} events registered, ${attended} attended, ${hackathons.data?.count ?? 0} hackathons.`}
      />
      <section>
        <h2 className="mb-4 text-xl font-bold">My events</h2>
        {events.isLoading ? (
          <Spinner />
        ) : events.data?.results.length ? (
          <div className={grid}>{events.data.results.map((e) => <EventCard key={e.id} event={e} />)}</div>
        ) : (
          <Empty>
            <p className="mb-4">You have not registered for any events yet.</p>
            <LinkButton to="/events">Browse events</LinkButton>
          </Empty>
        )}
      </section>
      <section>
        <h2 className="mb-4 text-xl font-bold">My hackathons</h2>
        {hackathons.isLoading ? (
          <Spinner />
        ) : hackathons.data?.results.length ? (
          <div className={grid}>{hackathons.data.results.map((h) => <HackathonCard key={h.id} hackathon={h} />)}</div>
        ) : (
          <Empty>
            <p className="mb-4">You are not taking part in or judging any hackathons.</p>
            <LinkButton to="/hackathons">See hackathons</LinkButton>
          </Empty>
        )}
      </section>
    </div>
  )
}
