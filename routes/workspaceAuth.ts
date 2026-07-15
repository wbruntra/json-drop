import type { Context } from 'hono'
import type { AuthContext } from '../services/auth'
import type { WorkspaceRole } from '../kysely-db'
import { getMembership } from '../services/memberships'
import { hasPermission, isWorkspaceRole } from '../services/permissions'
import type { Permission } from '../services/permissions'
import { unauthenticated, forbidden, notFound } from './errors'

// Returns 404 (not 403) when the caller has no membership at all, so a
// workspace's existence isn't disclosed to non-members; 403 is reserved for
// a known member lacking the specific permission requested.
export async function requireWorkspacePermission(
  c: Context,
  auth: AuthContext,
  workspaceId: string,
  permission: Permission,
): Promise<{ role: WorkspaceRole } | Response> {
  if (!auth.user) return unauthenticated(c)

  const membership = await getMembership(workspaceId, auth.user.id)
  if (!membership || !isWorkspaceRole(membership.role)) {
    return notFound(c, 'Workspace not found')
  }

  if (!hasPermission(membership.role, permission)) {
    return forbidden(c)
  }

  return { role: membership.role }
}

export function isResponse(value: unknown): value is Response {
  return value instanceof Response
}
