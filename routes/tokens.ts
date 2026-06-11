import { jsonResponse, hashToken, generateToken } from '../middleware'
import { createApiToken, listApiTokens, revokeApiToken } from '../database'
import type { AuthContext } from '../middleware'

export async function handleCreateToken(req: Request, auth: AuthContext): Promise<Response> {
  if (!auth.user || auth.tokenPermissions !== 'admin') {
    return jsonResponse({ error: 'Unauthorized' }, 401)
  }

  const body = (await req.json()) as { name?: string; permissions?: string }
  const name = body.name || 'Unnamed token'
  const permissions = body.permissions || 'read_write'

  if (!['read', 'write', 'read_write', 'admin'].includes(permissions)) {
    return jsonResponse({ error: 'Invalid permissions' }, 400)
  }

  const rawToken = generateToken()
  const tokenHash = hashToken(rawToken)

  createApiToken(auth.user.id, name, tokenHash, permissions)

  return jsonResponse(
    {
      token: rawToken,
      name,
      permissions,
      message: 'Store this token now. It will not be shown again.',
    },
    201,
  )
}

export function handleListTokens(auth: AuthContext): Response {
  if (!auth.user) {
    return jsonResponse({ error: 'Not authenticated' }, 401)
  }

  const tokens = listApiTokens(auth.user.id)

  return jsonResponse(
    tokens.map((t) => ({
      id: t.id,
      name: t.name,
      permissions: t.permissions,
      created_at: t.created_at,
    })),
  )
}

export async function handleDeleteToken(
  req: Request,
  auth: AuthContext,
  tokenId: string,
): Promise<Response> {
  if (!auth.user || auth.tokenPermissions !== 'admin') {
    return jsonResponse({ error: 'Unauthorized' }, 401)
  }

  const id = parseInt(tokenId, 10)
  if (isNaN(id)) {
    return jsonResponse({ error: 'Invalid token ID' }, 400)
  }

  const deleted = revokeApiToken(id, auth.user.id)
  if (!deleted) {
    return jsonResponse({ error: 'Token not found' }, 404)
  }

  return jsonResponse({ deleted: true })
}
