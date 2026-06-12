import { createHash } from 'crypto'
import { getApiTokenByHash } from './tokens'
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

  const rawToken = authHeader.slice(7)
  const tokenHash = createHash('sha256').update(rawToken).digest('hex')
  const token = await getApiTokenByHash(tokenHash)
  if (!token) return ctx

  const user = await getUser(token.user_id)
  if (!user) return ctx

  ctx.user = user
  ctx.tokenPermissions = token.permissions
  return ctx
}
