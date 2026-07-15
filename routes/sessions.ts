import type { Context } from 'hono'
import { createAnonymousSession } from '../services/sessions'
import { recoverSession } from '../services/recovery'
import { redeemInvite } from '../services/invites'
import { recoverSessionSchema, redeemInviteSchema, formatZodError } from '../schemas'
import { badRequest, unauthenticated, notFound, conflict } from './errors'

export async function handleCreateAnonymousSession(c: Context): Promise<Response> {
  const { token, user } = await createAnonymousSession()

  return c.json(
    {
      token,
      user: { id: user.id, kind: user.kind },
    },
    201,
  )
}

export async function handleRecoverSession(c: Context): Promise<Response> {
  const rawBody = await c.req.json().catch(() => ({}))
  const parsed = recoverSessionSchema.safeParse(rawBody)
  if (!parsed.success) return badRequest(c, formatZodError(parsed.error))

  const result = await recoverSession(parsed.data.secret)
  if (!result.ok) {
    if (result.reason === 'not_found') return notFound(c, 'Recovery link not found')
    return conflict(c, `Recovery link ${result.reason}`)
  }

  return c.json({ token: result.token })
}

export async function handleRedeemInvite(c: Context): Promise<Response> {
  const auth = c.get('auth')
  if (!auth.user) return unauthenticated(c)

  const rawBody = await c.req.json().catch(() => ({}))
  const parsed = redeemInviteSchema.safeParse(rawBody)
  if (!parsed.success) return badRequest(c, formatZodError(parsed.error))

  const result = await redeemInvite(parsed.data.secret, auth.user.id)
  if (!result.ok) {
    if (result.reason === 'not_found') return notFound(c, 'Invite not found')
    return conflict(c, `Invite ${result.reason}`)
  }

  return c.json({
    workspace_id: result.workspaceId,
    role: result.member.role,
  })
}
