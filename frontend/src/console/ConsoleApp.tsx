/** The organiser console's routes, under /manage. Loaded on demand, with DataTables. */
import { Link, Route, Routes } from 'react-router-dom'

import { Empty } from '../components/ui'
import EventForm from '../pages/EventForm'
import HackathonForm from '../pages/HackathonForm'
import EventWorkspace, { EventCheckIn, EventContent, EventFeedback, EventOverview, EventRegistrations } from './EventWorkspace'
import HackathonWorkspace, {
  HackathonJudges, HackathonLeaderboard, HackathonOverview, HackathonSetup, HackathonTeams,
} from './HackathonWorkspace'
import Integrations from './Integrations'
import ConsoleLayout from './Layout'
import { EventsList, HackathonsList } from './Lists'
import Overview from './Overview'
import { Platform, Team } from './Team'

export default function ConsoleApp() {
  return (
    <Routes>
    <Route element={<ConsoleLayout />}>
      <Route index element={<Overview />} />
      <Route path="events" element={<EventsList />} />
      <Route path="events/new" element={<EventForm />} />
      <Route path="events/:slug" element={<EventWorkspace />}>
        <Route index element={<EventOverview />} />
        <Route path="registrations" element={<EventRegistrations />} />
        <Route path="check-in" element={<EventCheckIn />} />
        <Route path="content" element={<EventContent />} />
        <Route path="feedback" element={<EventFeedback />} />
        <Route path="edit" element={<EventForm />} />
      </Route>
      <Route path="hackathons" element={<HackathonsList />} />
      <Route path="hackathons/new" element={<HackathonForm />} />
      <Route path="hackathons/:slug" element={<HackathonWorkspace />}>
        <Route index element={<HackathonOverview />} />
        <Route path="setup" element={<HackathonSetup />} />
        <Route path="teams" element={<HackathonTeams />} />
        <Route path="judges" element={<HackathonJudges />} />
        <Route path="leaderboard" element={<HackathonLeaderboard />} />
        <Route path="edit" element={<HackathonForm />} />
      </Route>
      <Route path="team" element={<Team />} />
      <Route path="integrations" element={<Integrations />} />
      <Route path="platform" element={<Platform />} />
      <Route path="*" element={<Empty>This page does not exist. <Link className="font-semibold text-brand-700" to="/manage">Back to the console</Link></Empty>} />
    </Route>
    </Routes>
  )
}
