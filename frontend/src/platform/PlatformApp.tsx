/** The platform admin area, under /platform. Loaded on demand. */
import { Route, Routes } from 'react-router-dom'

import Configuration from '../console/Configuration'
import Applications, { ApplicationDetail } from './Applications'
import PlatformLayout from './Layout'
import { NotFound, OrganizationDetail, Organizations } from './Organizations'
import Overview from './Overview'
import { Emails, Members } from './People'

export default function PlatformApp() {
  return (
    <Routes>
      <Route element={<PlatformLayout />}>
        <Route index element={<Overview />} />
        <Route path="organizations" element={<Organizations />} />
        <Route path="organizations/:id" element={<OrganizationDetail />} />
        <Route path="applications" element={<Applications />} />
        <Route path="applications/:id" element={<ApplicationDetail />} />
        <Route path="members" element={<Members />} />
        <Route path="emails" element={<Emails />} />
        <Route path="configuration" element={<Configuration mode="platform" />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}
