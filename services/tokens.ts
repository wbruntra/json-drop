import { getDb } from '../kysely-db'
import type { ApiToken } from '../kysely-db'

export async function createApiToken(
  userId: number,
  name: string,
  tokenHash: string,
  permissions: string,
): Promise<ApiToken> {
  return getDb()
    .insertInto('api_tokens')
    .values({
      user_id: userId,
      name,
      token_hash: tokenHash,
      permissions,
    })
    .returningAll()
    .executeTakeFirstOrThrow()
}

export async function listApiTokens(userId: number): Promise<ApiToken[]> {
  return getDb()
    .selectFrom('api_tokens')
    .selectAll()
    .where('user_id', '=', userId)
    .where('revoked_at', 'is', null)
    .execute()
}

export async function getApiTokenByHash(tokenHash: string): Promise<ApiToken | null> {
  const result = await getDb()
    .selectFrom('api_tokens')
    .selectAll()
    .where('token_hash', '=', tokenHash)
    .where('revoked_at', 'is', null)
    .executeTakeFirst()
  return result ?? null
}

export async function revokeApiToken(id: number, userId: number): Promise<boolean> {
  const result = await getDb()
    .updateTable('api_tokens')
    .set({ revoked_at: new Date().toISOString() })
    .where('id', '=', id)
    .where('user_id', '=', userId)
    .executeTakeFirst()
  return result.numUpdatedRows > 0
}
