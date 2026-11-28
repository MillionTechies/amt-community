import type { Invitation } from './api'

/** Where accepting an invitation takes the member. */
export function destination(invitation: Invitation) {
  if (invitation.kind === 'org_role') return '/manage'
  if (invitation.kind === 'judge') return '/judging'
  return `/hackathons/${invitation.hackathon?.slug}/workspace`
}
