import { useQuery } from '@tanstack/react-query'
import { useAuth } from 'react-oidc-context'
import { Link } from 'react-router-dom'

import { api } from '../api'
import type { CommunityEvent, Hackathon, Paginated } from '../api'
import { EventCard, HackathonCard, grid } from '../components/cards'
import { Button, Empty, LinkButton, Spinner } from '../components/ui'
import { useSignIn } from '../hooks'

export default function Home() {
  const auth = useAuth()
  const signIn = useSignIn()
  const events = useQuery({
    queryKey: ['events', 'home'],
    queryFn: () => api<Paginated<CommunityEvent>>('/events/?when=upcoming&status=published'),
  })
  const hackathons = useQuery({
    queryKey: ['hackathons', 'home'],
    queryFn: () => api<Paginated<Hackathon>>('/hackathons/'),
  })
  const live = hackathons.data?.results.filter((h) => h.status !== 'cancelled').slice(0, 3)

  return (
    <div className="space-y-12">
      <section className="rounded-2xl bg-brand-900 px-6 py-12 text-white sm:px-12">
        <p className="mb-3 text-sm font-semibold uppercase tracking-widest text-brand-200">
          A Million Techies Community
        </p>
        <h1 className="max-w-2xl text-3xl font-bold tracking-tight sm:text-5xl">
          Learn it, then build it with other people.
        </h1>
        <p className="mt-4 max-w-2xl text-brand-100">
          Workshops, meetups and hackathons run by universities, developer communities and
          A Million Techies. Register once, turn up, build something and keep the record.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link to="/events" className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-brand-900 hover:bg-brand-50">
            Browse events
          </Link>
          <Link to="/hackathons" className="rounded-lg border border-brand-200 px-4 py-2 text-sm font-semibold hover:bg-brand-800">
            See hackathons
          </Link>
          {!auth.isAuthenticated && (
            <Button variant="ghost" className="text-white hover:bg-brand-800" onClick={signIn}>
              Sign in or join
            </Button>
          )}
        </div>
      </section>

      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold">Coming up</h2>
          <LinkButton to="/events" variant="ghost">All events</LinkButton>
        </div>
        {events.isLoading ? (
          <Spinner />
        ) : events.data?.results.length ? (
          <div className={grid}>
            {events.data.results.slice(0, 3).map((event) => <EventCard key={event.id} event={event} />)}
          </div>
        ) : (
          <Empty>No upcoming events yet. Check back soon.</Empty>
        )}
      </section>

      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold">Hackathons</h2>
          <LinkButton to="/hackathons" variant="ghost">All hackathons</LinkButton>
        </div>
        {hackathons.isLoading ? (
          <Spinner />
        ) : live?.length ? (
          <div className={grid}>
            {live.map((hackathon) => <HackathonCard key={hackathon.id} hackathon={hackathon} />)}
          </div>
        ) : (
          <Empty>No hackathons yet.</Empty>
        )}
      </section>
    </div>
  )
}
