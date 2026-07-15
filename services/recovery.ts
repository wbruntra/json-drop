import { getDb } from '../kysely-db'
import { hashToken } from '../middleware'
import { createSessionForUser } from './sessions'
import short from 'short-uuid'

const translator = short.createTranslator()

const RECOVERY_LINK_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

function generateSecret(): string {
  return `${crypto.randomUUID().replace(/-/g, '')}${crypto.randomUUID().replace(/-/g, '')}`
}

export async function createRecoveryLink(
  workspaceId: string,
  userId: number,
  createdBy: number,
): Promise<{ secret: string; expiresAt: string }> {
  const secret = generateSecret()
  const expiresAt = new Date(Date.now() + RECOVERY_LINK_TTL_MS).toISOString()

  await getDb()
    .insertInto('member_recovery_links')
    .values({
      id: translator.generate(),
      workspace_id: workspaceId,
      user_id: userId,
      secret_hash: hashToken(secret),
      expires_at: expiresAt,
      created_by: createdBy,
    })
    .execute()

  return { secret, expiresAt }
}

export type RecoverSessionResult =
  | { ok: true; token: string }
  | { ok: false; reason: 'not_found' | 'expired' | 'used' }

export async function recoverSession(secret: string): Promise<RecoverSessionResult> {
  const db = getDb()

  return db.transaction().execute(async (trx) => {
    const link = await trx
      .selectFrom('member_recovery_links')
      .selectAll()
      .where('secret_hash', '=', hashToken(secret))
      .where('revoked_at', 'is', null)
      .executeTakeFirst()

    if (!link) return { ok: false, reason: 'not_found' as const }
    if (link.used_at) return { ok: false, reason: 'used' as const }
    if (link.expires_at < new Date().toISOString())
      return { ok: false, reason: 'expired' as const }

    await trx
      .updateTable('member_recovery_links')
      .set({ used_at: new Date().toISOString() })
      .where('id', '=', link.id)
      .execute()

    const { token } = await createSessionForUser(link.user_id, trx)
    return { ok: true, token }
  })
}
