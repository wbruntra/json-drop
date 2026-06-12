import type { Context } from 'hono'
import { generateToken } from '../middleware'
import { createApiToken, listApiTokens, revokeApiToken } from '../services'
import { createTokenSchema, formatZodError } from '../schemas'

export async function handleCreateToken(c: Context): Promise<Response> {
  const auth = c.get('auth')
  if (!auth.user || auth.tokenPermissions !== 'admin') {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const rawBody = await c.req.json()
  const parsed = createTokenSchema.safeParse(rawBody)
  if (!parsed.success) {
    return c.json({ error: formatZodError(parsed.error) }, 400)
  }

  const rawToken = generateToken()

  await createApiToken(auth.user.id, parsed.data.name, rawToken, parsed.data.permissions)

  return c.json(
    {
      token: rawToken,
      name: parsed.data.name,
      permissions: parsed.data.permissions,
      message: 'Token created successfully',
    },
    201,
  )
}

export async function handleListTokens(c: Context): Promise<Response> {
  const auth = c.get('auth')
  if (!auth.user) {
    return c.json({ error: 'Not authenticated' }, 401)
  }

  const tokens = await listApiTokens(auth.user.id)

  return c.json(
    tokens.map((t) => ({
      id: t.id,
      name: t.name,
      token: t.token_hash,
      permissions: t.permissions,
      created_at: t.created_at,
    })),
  )
}

export async function handleDeleteToken(c: Context): Promise<Response> {
  const auth = c.get('auth')
  if (!auth.user || auth.tokenPermissions !== 'admin') {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const id = parseInt(c.req.param('id')!, 10)
  if (isNaN(id)) {
    return c.json({ error: 'Invalid token ID' }, 400)
  }

  const deleted = await revokeApiToken(id, auth.user.id)
  if (!deleted) {
    return c.json({ error: 'Token not found' }, 404)
  }

  return c.json({ deleted: true })
}
