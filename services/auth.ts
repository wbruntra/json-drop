import { getApiToken } from './tokens'
import { getUser } from './users'
import { getUserBySessionToken } from './sessions'
import type { User } from '../kysely-db'

export type AuthContext = {
  user: User | null
  tokenPermissions: string | null
  projectId: string | null
}

export async function extractAuth(req: Request): Promise<AuthContext> {
  const ctx: AuthContext = { user: null, tokenPermissions: null, projectId: null }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return ctx

  const token = authHeader.slice(7)

  // Session tokens (jds_...) authenticate a principal only — they carry no
  // legacy project/permission scope. Workspace routes authorize via
  // workspace_members role instead of tokenPermissions.
  if (token.startsWith('jds_')) {
    const user = await getUserBySessionToken(token)
    if (user) ctx.user = user
    return ctx
  }

  const apiToken = await getApiToken(token)
  if (!apiToken) return ctx

  const user = await getUser(apiToken.user_id)
  if (!user) return ctx

  ctx.user = user
  ctx.tokenPermissions = apiToken.permissions
  ctx.projectId = apiToken.project_id
  return ctx
}
