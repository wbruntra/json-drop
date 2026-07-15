import { getDb } from '../kysely-db'
import type { WorkspaceInvite, WorkspaceMember, WorkspaceRole } from '../kysely-db'
import { hashToken } from '../middleware'
import short from 'short-uuid'

const translator = short.createTranslator()

function generateSecret(): string {
  // 256 bits of entropy, base64url-ish via crypto.randomUUID x2 (matches the
  // existing token generation pattern in middleware.ts).
  return `${crypto.randomUUID().replace(/-/g, '')}${crypto.randomUUID().replace(/-/g, '')}`
}

export async function createInvite(
  workspaceId: string,
  role: WorkspaceRole,
  createdBy: number,
  options: { expiresAt?: string | null; maxUses?: number | null } = {},
): Promise<{ invite: WorkspaceInvite; secret: string }> {
  const secret = generateSecret()

  const invite = await getDb()
    .insertInto('workspace_invites')
    .values({
      id: translator.generate(),
      workspace_id: workspaceId,
      role,
      secret_hash: hashToken(secret),
      expires_at: options.expiresAt ?? null,
      max_uses: options.maxUses ?? null,
      created_by: createdBy,
    })
    .returningAll()
    .executeTakeFirstOrThrow()

  return { invite, secret }
}

export async function listInvites(workspaceId: string): Promise<WorkspaceInvite[]> {
  return getDb()
    .selectFrom('workspace_invites')
    .selectAll()
    .where('workspace_id', '=', workspaceId)
    .where('revoked_at', 'is', null)
    .orderBy('created_at', 'asc')
    .execute()
}

export async function revokeInvite(workspaceId: string, inviteId: string): Promise<boolean> {
  const result = await getDb()
    .updateTable('workspace_invites')
    .set({ revoked_at: new Date().toISOString() })
    .where('id', '=', inviteId)
    .where('workspace_id', '=', workspaceId)
    .where('revoked_at', 'is', null)
    .executeTakeFirst()
  return result.numUpdatedRows > 0
}

export type RedeemInviteResult =
  | { ok: true; workspaceId: string; member: WorkspaceMember }
  | { ok: false; reason: 'not_found' | 'expired' | 'exhausted' }

export async function redeemInvite(secret: string, userId: number): Promise<RedeemInviteResult> {
  const db = getDb()

  return db.transaction().execute(async (trx) => {
    const invite = await trx
      .selectFrom('workspace_invites')
      .selectAll()
      .where('secret_hash', '=', hashToken(secret))
      .where('revoked_at', 'is', null)
      .executeTakeFirst()

    if (!invite) return { ok: false, reason: 'not_found' as const }

    if (invite.expires_at && invite.expires_at < new Date().toISOString()) {
      return { ok: false, reason: 'expired' as const }
    }
    if (invite.max_uses !== null && invite.use_count >= invite.max_uses) {
      return { ok: false, reason: 'exhausted' as const }
    }

    const existing = await trx
      .selectFrom('workspace_members')
      .selectAll()
      .where('workspace_id', '=', invite.workspace_id)
      .where('user_id', '=', userId)
      .where('removed_at', 'is', null)
      .executeTakeFirst()

    if (existing) {
      // Idempotent: reopening the same link doesn't consume a use or change role.
      return { ok: true, workspaceId: invite.workspace_id, member: existing }
    }

    const member = await trx
      .insertInto('workspace_members')
      .values({ workspace_id: invite.workspace_id, user_id: userId, role: invite.role })
      .returningAll()
      .executeTakeFirstOrThrow()

    await trx
      .updateTable('workspace_invites')
      .set({ use_count: invite.use_count + 1 })
      .where('id', '=', invite.id)
      .execute()

    return { ok: true, workspaceId: invite.workspace_id, member }
  })
}
