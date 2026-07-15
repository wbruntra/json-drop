import { getDb } from '../kysely-db'
import type { DatabaseSchema, Session, User } from '../kysely-db'
import { generateSessionToken, hashToken } from '../middleware'
import short from 'short-uuid'
import type { Kysely } from 'kysely'

const translator = short.createTranslator()

const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000 // 90 days

export async function createAnonymousSession(): Promise<{
  token: string
  user: User
  session: Session
}> {
  const db = getDb()

  const user = await db
    .insertInto('users')
    .values({
      github_id: `anon:${crypto.randomUUID()}`,
      email: null,
      display_name: null,
      kind: 'anonymous',
    })
    .returningAll()
    .executeTakeFirstOrThrow()

  const token = generateSessionToken()
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString()

  const session = await db
    .insertInto('sessions')
    .values({
      id: translator.generate(),
      user_id: user.id,
      token_hash: hashToken(token),
      expires_at: expiresAt,
    })
    .returningAll()
    .executeTakeFirstOrThrow()

  return { token, user, session }
}

// Accepts an explicit executor so callers already inside a transaction (e.g.
// recoverSession) pass their `trx` instead of getDb() — bun:sqlite has a
// single connection, so issuing a second, unrelated query through getDb()
// while a transaction is open on that same connection deadlocks.
export async function createSessionForUser(
  userId: number,
  executor: Kysely<DatabaseSchema> = getDb(),
): Promise<{ token: string; session: Session }> {
  const token = generateSessionToken()
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString()

  const session = await executor
    .insertInto('sessions')
    .values({
      id: translator.generate(),
      user_id: userId,
      token_hash: hashToken(token),
      expires_at: expiresAt,
    })
    .returningAll()
    .executeTakeFirstOrThrow()

  return { token, session }
}

export async function getUserBySessionToken(token: string): Promise<User | null> {
  const now = new Date().toISOString()
  const result = await getDb()
    .selectFrom('sessions')
    .innerJoin('users', 'users.id', 'sessions.user_id')
    .selectAll('users')
    .where('sessions.token_hash', '=', hashToken(token))
    .where('sessions.revoked_at', 'is', null)
    .where('sessions.expires_at', '>', now)
    .executeTakeFirst()
  return result ?? null
}
