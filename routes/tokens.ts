import type { Context } from 'hono'
import { generateToken } from '../middleware'
import { createApiToken, listApiTokens, revokeApiToken, getProject } from '../services'
import { createTokenSchema, formatZodError } from '../schemas'
import { badRequest, unauthenticated, forbidden, notFound } from './errors'

export async function handleCreateToken(c: Context): Promise<Response> {
  const auth = c.get('auth')
  if (!auth.user || auth.tokenPermissions !== 'admin') {
    return unauthenticated(c, 'Unauthorized')
  }

  const rawBody = await c.req.json()
  const parsed = createTokenSchema.safeParse(rawBody)
  if (!parsed.success) {
    return badRequest(c, formatZodError(parsed.error))
  }

  let projectId: string | null = null
  if (parsed.data.project_id) {
    const project = await getProject(parsed.data.project_id)
    if (!project) {
      return notFound(c, 'Project not found')
    }
    if (project.user_id !== auth.user.id) {
      return forbidden(c)
    }
    projectId = project.id
  }

  const rawToken = generateToken()

  await createApiToken(
    auth.user.id,
    parsed.data.name,
    rawToken,
    parsed.data.permissions,
    projectId,
  )

  return c.json(
    {
      token: rawToken,
      name: parsed.data.name,
      permissions: parsed.data.permissions,
      project_id: projectId,
      message: 'Token created successfully',
    },
    201,
  )
}

export async function handleListTokens(c: Context): Promise<Response> {
  const auth = c.get('auth')
  if (!auth.user) {
    return unauthenticated(c)
  }

  const tokens = await listApiTokens(auth.user.id)

  return c.json(
    tokens.map((t) => ({
      id: t.id,
      name: t.name,
      token: t.token_hash,
      permissions: t.permissions,
      project_id: t.project_id,
      created_at: t.created_at,
    })),
  )
}

export async function handleDeleteToken(c: Context): Promise<Response> {
  const auth = c.get('auth')
  if (!auth.user || auth.tokenPermissions !== 'admin') {
    return unauthenticated(c, 'Unauthorized')
  }

  const id = parseInt(c.req.param('id')!, 10)
  if (isNaN(id)) {
    return badRequest(c, 'Invalid token ID')
  }

  const deleted = await revokeApiToken(id, auth.user.id)
  if (!deleted) {
    return notFound(c, 'Token not found')
  }

  return c.json({ deleted: true })
}
