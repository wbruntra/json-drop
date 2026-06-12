import { Database } from 'bun:sqlite'
import { Kysely, sql } from 'kysely'
import { BunSqliteDialect } from 'kysely-bun-dialects'
import short from 'short-uuid'
import { runMigrations } from './migrate'
import type { DatabaseSchema } from './kysely-types'

export type { DatabaseSchema } from './kysely-types'

export type User = {
  id: number
  github_id: string
  email: string | null
  display_name: string | null
  created_at: string
}

export type ApiToken = {
  id: number
  user_id: number
  name: string
  token_hash: string
  permissions: string
  created_at: string
  revoked_at: string | null
}

export type Document = {
  id: string
  path: string
  user_id: number
  content: string
  access_mode: string
  access_secret: string | null
  size_bytes: number
  created_at: string
  updated_at: string
}

let db: Database | null = null
let kysely: Kysely<DatabaseSchema> | null = null

const translator = short.createTranslator()

export async function initDatabase(
  path: string,
  options: { silent?: boolean } = {},
): Promise<Kysely<DatabaseSchema>> {
  db?.close()
  db = new Database(path, { create: true })
  await runMigrations(db, { silent: options.silent })

  kysely = new Kysely<DatabaseSchema>({
    dialect: new BunSqliteDialect({ database: db }),
  })

  return kysely
}

export function getDb(): Kysely<DatabaseSchema> {
  if (!kysely) {
    throw new Error('Database not initialized. Call initDatabase() before using the database.')
  }
  return kysely
}

export function getRawDb(): Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() before using the database.')
  }
  return db
}

export function createUser(
  githubId: string,
  email: string | null,
  displayName: string | null,
): User {
  const stmt = getRawDb().prepare(
    `INSERT INTO users (github_id, email, display_name)
     VALUES (?, ?, ?)
     ON CONFLICT(github_id) DO UPDATE SET email = excluded.email, display_name = excluded.display_name
     RETURNING *`,
  )
  return stmt.get(githubId, email, displayName) as User
}

export function getUser(id: number): User | null {
  return getRawDb().prepare('SELECT * FROM users WHERE id = ?').get(id) as User | null
}

export function getUserByGithubId(githubId: string): User | null {
  return getRawDb().prepare('SELECT * FROM users WHERE github_id = ?').get(githubId) as User | null
}

export function createApiToken(
  userId: number,
  name: string,
  tokenHash: string,
  permissions: string,
): ApiToken {
  const stmt = getRawDb().prepare(
    `INSERT INTO api_tokens (user_id, name, token_hash, permissions) VALUES (?, ?, ?, ?) RETURNING *`,
  )
  return stmt.get(userId, name, tokenHash, permissions) as ApiToken
}

export function listApiTokens(userId: number): ApiToken[] {
  return getRawDb()
    .prepare('SELECT * FROM api_tokens WHERE user_id = ? AND revoked_at IS NULL')
    .all(userId) as ApiToken[]
}

export function getApiTokenByHash(tokenHash: string): ApiToken | null {
  return getRawDb()
    .prepare('SELECT * FROM api_tokens WHERE token_hash = ? AND revoked_at IS NULL')
    .get(tokenHash) as ApiToken | null
}

export function revokeApiToken(id: number, userId: number): boolean {
  const result = getRawDb()
    .prepare('UPDATE api_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?')
    .run(id, userId)
  return result.changes > 0
}

// Kysely-based document functions
export async function upsertDocument(
  path: string,
  userId: number,
  content: string,
  accessMode: string,
  accessSecret: string | null,
  sizeBytes: number,
): Promise<Document> {
  const db = getDb()

  const existing = await db
    .selectFrom('documents')
    .select('id')
    .where('user_id', '=', userId)
    .where('path', '=', path)
    .executeTakeFirst()

  const id = existing?.id ?? translator.generate()

  const doc = await db
    .insertInto('documents')
    .values({
      id,
      path,
      user_id: userId,
      content,
      access_mode: accessMode,
      access_secret: accessSecret,
      size_bytes: sizeBytes,
    })
    .onConflict((oc) =>
      oc.columns(['user_id', 'path']).doUpdateSet({
        content,
        access_mode: accessMode,
        access_secret: accessSecret,
        size_bytes: sizeBytes,
        updated_at: sql`CURRENT_TIMESTAMP`,
      }),
    )
    .returningAll()
    .executeTakeFirstOrThrow()

  return doc
}

export async function getDocument(id: string): Promise<Document | null> {
  const result = await getDb()
    .selectFrom('documents')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst()
  return result ?? null
}

export async function getDocumentByPathAndSecret(
  path: string,
  secret: string,
): Promise<Document | null> {
  const result = await getDb()
    .selectFrom('documents')
    .selectAll()
    .where('path', '=', path)
    .where('access_secret', '=', secret)
    .executeTakeFirst()
  return result ?? null
}

export async function getDocumentByPath(path: string, userId: number): Promise<Document | null> {
  const result = await getDb()
    .selectFrom('documents')
    .selectAll()
    .where('path', '=', path)
    .where('user_id', '=', userId)
    .executeTakeFirst()
  return result ?? null
}

export async function listDocuments(userId: number, prefix?: string): Promise<Document[]> {
  let query = getDb().selectFrom('documents').selectAll().where('user_id', '=', userId)

  if (prefix) {
    const prefixPattern = prefix.endsWith('/') ? `${prefix}%` : `${prefix}/%`
    query = query.where('path', 'like', prefixPattern)
  }

  return query.orderBy('path', 'asc').execute()
}

export async function getUserTotalSize(userId: number): Promise<number> {
  const result = await getDb()
    .selectFrom('documents')
    .select((eb) => eb.fn.coalesce(eb.fn.sum('size_bytes'), sql`0`).as('total'))
    .where('user_id', '=', userId)
    .executeTakeFirstOrThrow()

  return result.total as number
}

export async function deleteDocument(id: string, userId: number): Promise<boolean> {
  const result = await getDb()
    .deleteFrom('documents')
    .where('id', '=', id)
    .where('user_id', '=', userId)
    .executeTakeFirst()

  return result.numDeletedRows > 0
}
