import { Database } from 'bun:sqlite'
import { Kysely } from 'kysely'
import { BunSqliteDialect } from 'kysely-bun-dialects'
import { runMigrations } from './migrate'
import type { DatabaseSchema } from './kysely-types'

export type { DatabaseSchema } from './kysely-types'

// SQLite's PRAGMA table_info reports FK columns as notnull=0, but the codegen
// conservatively treats every FK as NOT NULL. Widen these to nullable so
// services can read/write documents and tokens that aren't scoped to a project.
declare module './kysely-types' {
  interface DocumentsTable {
    project_id: string | null
    workspace_id: string | null
  }
  interface ApiTokensTable {
    project_id: string | null
  }
  interface WorkspacesTable {
    project_id: string | null
  }
  interface AuditEventsTable {
    workspace_id: string | null
    user_id: number | null
  }
}

export type UserKind = 'github' | 'anonymous'

export type User = {
  id: number
  github_id: string
  email: string | null
  display_name: string | null
  created_at: string
  kind: string
}

export type Project = {
  id: string
  user_id: number
  name: string
  created_at: string
}

export type ApiToken = {
  id: number
  user_id: number
  project_id: string | null
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
  project_id: string | null
  workspace_id: string | null
  content: string
  access_mode: string
  access_secret: string | null
  size_bytes: number
  version: number
  created_at: string
  updated_at: string
}

export type Session = {
  id: string
  user_id: number
  token_hash: string
  expires_at: string
  revoked_at: string | null
  created_at: string
}

export type Workspace = {
  id: string
  project_id: string | null
  name: string
  created_by: number
  created_at: string
  deleted_at: string | null
}

export type WorkspaceRole = 'owner' | 'admin' | 'editor' | 'viewer'

export type WorkspaceMember = {
  id: number
  workspace_id: string
  user_id: number
  role: string
  joined_at: string
  removed_at: string | null
}

export type WorkspaceInvite = {
  id: string
  workspace_id: string
  role: string
  secret_hash: string
  expires_at: string | null
  max_uses: number | null
  use_count: number
  created_by: number
  revoked_at: string | null
  created_at: string
}

export type MemberRecoveryLink = {
  id: string
  workspace_id: string
  user_id: number
  secret_hash: string
  expires_at: string
  used_at: string | null
  revoked_at: string | null
  created_by: number
  created_at: string
}

let rawDb: Database | null = null
let kysely: Kysely<DatabaseSchema> | null = null

export async function initDatabase(
  path: string,
  options: { silent?: boolean } = {},
): Promise<Kysely<DatabaseSchema>> {
  rawDb?.close()
  rawDb = new Database(path, { create: true })
  rawDb.run('PRAGMA journal_mode = WAL')
  rawDb.run('PRAGMA foreign_keys = ON')

  kysely = new Kysely<DatabaseSchema>({
    dialect: new BunSqliteDialect({ database: rawDb }),
  })

  await runMigrations(kysely, { silent: options.silent })

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
