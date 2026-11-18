import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { api } from '../api'
import type { Hackathon, Paginated } from '../api'
import { HackathonCard, grid } from '../components/cards'
import { Empty, ErrorNote, Input, LinkButton, PageHeader, Spinner, Tabs } from '../components/ui'
import { useMe } from '../hooks'

type Tab = 'all' | 'managed'

export default function Hackathons() {
  const me = useMe()
  const canManage = me?.organizations.some((o) => o.can_manage_hackathons) ?? false
  const [tab, setTab] = useState<Tab>('all')
  const [search, setSearch] = useState('')
  const params = new URLSearchParams()
  if (tab === 'managed') params.set('scope', 'managed')
  if (search) params.set('search', search)
  const hackathons = useQuery({
    queryKey: ['hackathons', params.toString()],
    queryFn: () => api<Paginated<Hackathon>>(`/hackathons/?${params}`),
  })
  return (
    <>
      <PageHeader
        title="Hackathons"
        subtitle="Form a team, build a project and have it judged."
        action={canManage && <LinkButton to="/manage/hackathons/new">Create hackathon</LinkButton>}
      />
      {canManage && (
        <Tabs
          tabs={[{ id: 'all', label: 'All hackathons' }, { id: 'managed', label: 'Hackathons I manage' }]}
          current={tab}
          onChange={setTab}
        />
      )}
      <div className="mb-6">
        <Input type="search" placeholder="Search hackathons" aria-label="Search hackathons" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <ErrorNote error={hackathons.error} />
      {hackathons.isLoading ? (
        <Spinner />
      ) : hackathons.data?.results.length ? (
        <div className={grid}>
          {hackathons.data.results.map((h) => <HackathonCard key={h.id} hackathon={h} />)}
        </div>
      ) : (
        !hackathons.error && <Empty>{search ? 'No hackathons match your search.' : 'No hackathons yet.'}</Empty>
      )}
    </>
  )
}
