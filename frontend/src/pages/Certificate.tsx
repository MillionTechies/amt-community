import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'

import { api } from '../api'
import type { Certificate } from '../api'
import { Button, Empty, Spinner, formatDate } from '../components/ui'

/** A participation certificate. Anyone with the link can see it, which is how it is verified. */
export default function CertificatePage() {
  const { code } = useParams()
  const certificate = useQuery({
    queryKey: ['certificate', code],
    queryFn: () => api<Certificate>(`/certificates/${code}/`),
  })
  if (certificate.isLoading) return <Spinner />
  if (!certificate.data) return <Empty>No certificate matches this link.</Empty>
  const c = certificate.data
  return (
    <div className="mx-auto max-w-3xl">
      <div className="rounded-2xl border-8 border-double border-brand-700 bg-white px-8 py-14 text-center">
        <p className="text-sm font-semibold uppercase tracking-widest text-brand-700">A Million Techies Community</p>
        <h1 className="mt-4 text-3xl font-bold">Certificate of Participation</h1>
        <p className="mt-8 text-stone-600">This certifies that</p>
        <p className="mt-2 text-4xl font-bold text-brand-900">{c.recipient}</p>
        <p className="mt-6 text-stone-600">attended the {c.event_type.toLowerCase()}</p>
        <p className="mt-2 text-2xl font-semibold">{c.event}</p>
        <p className="mt-6 text-stone-600">
          hosted by {c.organization} on {formatDate(c.starts_at)}
        </p>
        <p className="mt-10 text-xs text-stone-500">Certificate ID {c.certificate_code}</p>
        <p className="text-xs text-stone-500">Verify at {window.location.href}</p>
      </div>
      <div className="no-print mt-6 text-center">
        <Button onClick={() => window.print()}>Print or save as PDF</Button>
      </div>
    </div>
  )
}
