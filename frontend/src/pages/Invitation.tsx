/**
 * Where an invitation email lands. Anyone can read it; to answer, the invited person signs
 * up or in with the invited address, comes straight back here, and accepts.
 */
import { useQuery } from '@tanstack/react-query'
import { useAuth } from 'react-oidc-context'
import { useNavigate, useParams } from 'react-router-dom'

import { api } from '../api'
import type { Invitation } from '../api'
import { LogoTile } from '../components/brand'
import { useToast } from '../components/feedback'
import { Button, Card, ErrorNote, Notice, Spinner } from '../components/ui'
import { useAct, useSignIn, useSignUp } from '../hooks'
import { destination } from '../invitations'

const answered: Record<string, string> = {
  accepted: 'This invitation has been accepted.',
  declined: 'This invitation was declined.',
  revoked: 'This invitation was withdrawn by whoever sent it.',
}

export default function InvitationPage() {
  const { token } = useParams()
  const auth = useAuth()
  const signIn = useSignIn()
  const signUp = useSignUp()
  const navigate = useNavigate()
  const toast = useToast()
  const invitation = useQuery({ queryKey: ['invitation', token], queryFn: () => api<Invitation>(`/invitations/${token}/`) })
  const accept = useAct(() => api<Invitation>(`/invitations/${token}/accept/`, { method: 'POST' }))
  const decline = useAct(() => api<Invitation>(`/invitations/${token}/decline/`, { method: 'POST' }))

  if (invitation.isLoading) return <Spinner />
  if (!invitation.data) return <ErrorNote error={invitation.error ?? 'Invitation not found.'} />
  const i = invitation.data

  return (
    <div className="mx-auto max-w-md">
      <Card className="space-y-4 text-center">
        <LogoTile className="mx-auto h-12 w-12" />
        <p className="eyebrow">You're invited</p>
        <h1 className="text-2xl font-bold tracking-tight">{i.invited_by} invited you to {i.summary}</h1>
        <p className="text-sm text-stone-600">Sent to {i.email_hint}</p>
        {i.status !== 'pending' ? (
          <Notice tone="amber">{answered[i.status]}</Notice>
        ) : !auth.isAuthenticated ? (
          <div className="space-y-3 text-left">
            <p className="text-sm text-stone-600">
              New to Community? Create a free account with {i.email_hint}; you will come straight back here to accept.
            </p>
            <Button className="w-full" onClick={signUp}>Create an account</Button>
            <Button className="w-full" variant="secondary" onClick={signIn}>I already have an account</Button>
          </div>
        ) : i.is_for_you ? (
          <div className="space-y-3">
            <ErrorNote error={accept.error ?? decline.error} />
            <Button
              className="w-full"
              disabled={accept.isPending}
              onClick={() =>
                accept.mutate(undefined, {
                  onSuccess: (done) => {
                    toast({ title: 'Invitation accepted', message: `You can now ${done.summary}.` })
                    navigate(destination(done))
                  },
                })
              }
            >
              Accept
            </Button>
            <Button
              className="w-full"
              variant="ghost"
              disabled={decline.isPending}
              onClick={() => decline.mutate(undefined, { onSuccess: () => toast({ tone: 'info', title: 'Invitation declined' }) })}
            >
              Decline
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <Notice tone="amber">
              This invitation is for {i.email_hint}, and you are signed in with another address. Sign out, then open
              the link in the email again.
            </Notice>
            <Button className="w-full" variant="secondary" onClick={() => void auth.signoutRedirect()}>Sign out</Button>
          </div>
        )}
      </Card>
    </div>
  )
}
