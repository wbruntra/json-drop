import { Database } from 'bun:sqlite'
import { Kysely } from 'kysely'
import { BunSqliteDialect } from 'kysely-bun-dialects'
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

let rawDb: Database | null = null
let kysely: Kysely<DatabaseSchema> | null = null

export async function initDatabase(
  path: string,
  options: { silent?: boolean } = {},
): Promise<Kysely<DatabaseSchema>> {
  rawDb?.close()
  rawDb = new Database(path, { create: true })
  await runMigrations(rawDb, { silent: options.silent })

  kysely = new Kysely<DatabaseSchema>({
    dialect: new BunSqliteDialect({ database: rawDb }),
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
  if (!rawDb) {
    throw new Error('Database not initialized. Call initDatabase() before using the database.')
  }
  return rawDb
}
