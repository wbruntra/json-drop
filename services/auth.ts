import { getApiToken } from './tokens'
import { getUser } from './users'
import { getUserBySessionToken } from './sessions'
import type { User } from '../kysely-db'

export type AuthContext = {
  user: User | null
  kind: 'session' | 'api_key' | null
  tokenPermissions: string | null
  projectId: string | null
}

// Account-level auth can manage projects and API keys: a GitHub user's
// dashboard session, or an unscoped admin API key. Project-scoped keys and
// anonymous (workspace-only) sessions cannot.
export function isAccountAuth(auth: AuthContext): boolean {
  if (!auth.user) return false
  if (auth.kind === 'session') return auth.user.kind === 'github'
  return auth.tokenPermissions === 'admin' && auth.projectId === null
}

export async function extractAuth(req: Request): Promise<AuthContext> {
  const ctx: AuthContext = { user: null, kind: null, tokenPermissions: null, projectId: null }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return ctx

  const token = authHeader.slice(7)

  // Session tokens (jds_...) authenticate a principal only — they carry no
  // legacy project/permission scope. Workspace routes authorize via
  // workspace_members role instead of tokenPermissions.
  if (token.startsWith('jds_')) {
    const user = await getUserBySessionToken(token)
    if (user) {
      ctx.user = user
      ctx.kind = 'session'
    }
    return ctx
  }

  const apiToken = await getApiToken(token)
  if (!apiToken) return ctx

  const user = await getUser(apiToken.user_id)
  if (!user) return ctx

  ctx.user = user
  ctx.kind = 'api_key'
  ctx.tokenPermissions = apiToken.permissions
  ctx.projectId = apiToken.project_id
  return ctx
}
