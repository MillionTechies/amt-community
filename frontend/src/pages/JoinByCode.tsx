/** One box for every 6-digit code: a hackathon's registers you, a team's puts you in that team too. */
import { useState } from 'react'
import { useAuth } from 'react-oidc-context'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { api } from '../api'
import { Button, Card, ErrorNote, Field, Input, PageHeader } from '../components/ui'
import { useToast } from '../components/feedback'
import { useAct, useSignIn, useSignUp } from '../hooks'

export default function JoinByCode() {
  const auth = useAuth()
  const signIn = useSignIn()
  const signUp = useSignUp()
  const navigate = useNavigate()
  const toast = useToast()
  const [code, setCode] = useState(useSearchParams()[0].get('code') ?? '')
  const join = useAct(() => api<{ hackathon: string; team_id: number | null }>('/join/', { method: 'POST', body: { code } }))
  return (
    <div className="mx-auto max-w-md">
      <PageHeader eyebrow="Hackathons" title="Join with a code" subtitle="Enter the 6-digit code from the organisers or your team leader." />
      <Card>
        {auth.isAuthenticated ? (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault()
              join.mutate(undefined, {
                onSuccess: ({ hackathon, team_id }) => {
                  toast(team_id ? { title: 'You joined the team', message: 'Welcome aboard. Good luck!' } : { title: 'You are registered', message: 'Now find a team or start one.' })
                  navigate(`/hackathons/${hackathon}/workspace`)
                },
              })
            }}
          >
            <Field label="Code">
              <Input
                required
                autoFocus
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="482913"
                className="text-center font-mono text-2xl tracking-[0.4em]"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </Field>
            <ErrorNote error={join.error} />
            <Button type="submit" className="w-full" disabled={join.isPending}>Join</Button>
          </form>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-stone-600">Sign in to use your code. New to Community? Create an account first; you will come back here.</p>
            <Button className="w-full" onClick={signUp}>Create an account</Button>
            <Button className="w-full" variant="secondary" onClick={signIn}>Sign in</Button>
          </div>
        )}
      </Card>
    </div>
  )
}
