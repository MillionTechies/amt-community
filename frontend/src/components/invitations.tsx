/** Invitations already sent and still waiting for an answer, with resend and withdraw. */
import type { SentInvitation, TeamInvitation } from '../api'
import { api } from '../api'
import { useConfirm, useToast } from './feedback'
import { Button, ErrorNote, formatDate } from './ui'
import { useAct } from '../hooks'

export function PendingInvitations({ invitations }: { invitations: (SentInvitation | TeamInvitation)[] }) {
  const toast = useToast()
  const confirm = useConfirm()
  const resend = useAct((id: number) => api(`/invitations/sent/${id}/`, { method: 'POST' }))
  const withdraw = useAct((id: number) => api(`/invitations/sent/${id}/`, { method: 'DELETE' }))
  return (
    invitations.length > 0 && (
      <div>
        <p className="mb-2 text-sm font-semibold">Waiting for an answer ({invitations.length})</p>
        <ErrorNote error={resend.error ?? withdraw.error} />
        <ul className="divide-y divide-stone-100 rounded-lg border border-stone-200">
          {invitations.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{i.name}</span>
                <span className="block text-xs text-stone-500">Invited {formatDate(i.created_at)}</span>
              </span>
              <Button variant="ghost" onClick={() => resend.mutate(i.id, { onSuccess: () => toast({ title: 'Invitation sent again', message: i.name }) })}>
                Resend
              </Button>
              <Button
                variant="ghost"
                onClick={async () => {
                  if (await confirm({ tone: 'danger', title: `Withdraw the invitation to ${i.name}?`, message: 'The link in their email stops working.', confirmLabel: 'Withdraw' }))
                    withdraw.mutate(i.id, { onSuccess: () => toast({ tone: 'info', title: 'Invitation withdrawn' }) })
                }}
              >
                Withdraw
              </Button>
            </li>
          ))}
        </ul>
      </div>
    )
  )
}
