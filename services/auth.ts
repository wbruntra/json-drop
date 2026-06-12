import { getApiToken } from './tokens'
import { getUser } from './users'
import type { User } from '../kysely-db'

export type AuthContext = {
  user: User | null
  tokenPermissions: string | null
}

export async function extractAuth(req: Request): Promise<AuthContext> {
  const ctx: AuthContext = { user: null, tokenPermissions: null }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return ctx

  const token = authHeader.slice(7)
  const apiToken = await getApiToken(token)
  if (!apiToken) return ctx

  const user = await getUser(apiToken.user_id)
  if (!user) return ctx

  ctx.user = user
  ctx.tokenPermissions = apiToken.permissions
  return ctx
}
