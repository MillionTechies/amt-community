import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from 'react-oidc-context'

import { api } from './api'
import type { Me } from './api'
import { signInArgs } from './auth'

/** The signed-in member, or undefined when signed out. */
export function useMe() {
  const auth = useAuth()
  const query = useQuery({
    queryKey: ['me'],
    queryFn: () => api<Me>('/me/'),
    enabled: auth.isAuthenticated,
  })
  return auth.isAuthenticated ? query.data : undefined
}

/** Run a change against the API, then refresh everything on screen. */
export function useAct<TArgs = void, TResult = unknown>(fn: (args: TArgs) => Promise<TResult>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: async () => {
      // A list still loading for the first time would otherwise keep the answer it
      // asked for before this change: invalidating does not restart a first fetch.
      await queryClient.cancelQueries()
      await queryClient.invalidateQueries()
    },
  })
}

/** Send the visitor to Keycloak, returning to this page afterwards. */
export function useSignIn() {
  const auth = useAuth()
  return () => void auth.signinRedirect(signInArgs())
}

/** Send the visitor straight to Keycloak's sign-up form (OIDC `prompt=create`). */
export function useSignUp() {
  const auth = useAuth()
  return () => void auth.signinRedirect({ ...signInArgs(), prompt: 'create' })
}
