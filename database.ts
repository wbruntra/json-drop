import { Database } from 'bun:sqlite'
import short from 'short-uuid'

const DB_PATH = process.env.DATABASE_URL || 'db.sqlite'

const db = new Database(DB_PATH, { create: true })

db.run('PRAGMA journal_mode = WAL')
db.run('PRAGMA foreign_keys = ON')

const translator = short.createTranslator()

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

export function createUser(
  githubId: string,
  email: string | null,
  displayName: string | null,
): User {
  const stmt = db.prepare(
    `INSERT INTO users (github_id, email, display_name)
     VALUES (?, ?, ?)
     ON CONFLICT(github_id) DO UPDATE SET email = excluded.email, display_name = excluded.display_name
     RETURNING *`,
  )
  return stmt.get(githubId, email, displayName) as User
}

export function getUser(id: number): User | null {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as User | null
}

export function getUserByGithubId(githubId: string): User | null {
  return db.prepare('SELECT * FROM users WHERE github_id = ?').get(githubId) as User | null
}

export function createApiToken(
  userId: number,
  name: string,
  tokenHash: string,
  permissions: string,
): ApiToken {
  const stmt = db.prepare(
    `INSERT INTO api_tokens (user_id, name, token_hash, permissions) VALUES (?, ?, ?, ?) RETURNING *`,
  )
  return stmt.get(userId, name, tokenHash, permissions) as ApiToken
}

export function listApiTokens(userId: number): ApiToken[] {
  return db
    .prepare('SELECT * FROM api_tokens WHERE user_id = ? AND revoked_at IS NULL')
    .all(userId) as ApiToken[]
}

export function getApiTokenByHash(tokenHash: string): ApiToken | null {
  return db
    .prepare('SELECT * FROM api_tokens WHERE token_hash = ? AND revoked_at IS NULL')
    .get(tokenHash) as ApiToken | null
}

export function revokeApiToken(id: number, userId: number): boolean {
  const result = db
    .prepare('UPDATE api_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?')
    .run(id, userId)
  return result.changes > 0
}

export function upsertDocument(
  path: string,
  userId: number,
  content: string,
  accessMode: string,
  accessSecret: string | null,
  sizeBytes: number,
): Document {
  const existing = db
    .prepare('SELECT id FROM documents WHERE user_id = ? AND path = ?')
    .get(userId, path) as { id: string } | null

  const id = existing?.id || translator.generate()

  const stmt = db.prepare(
    `INSERT INTO documents (id, path, user_id, content, access_mode, access_secret, size_bytes)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, path) DO UPDATE SET
       content = excluded.content,
       access_mode = excluded.access_mode,
       access_secret = excluded.access_secret,
       size_bytes = excluded.size_bytes,
       updated_at = CURRENT_TIMESTAMP
     RETURNING *`,
  )
  return stmt.get(id, path, userId, content, accessMode, accessSecret, sizeBytes) as Document
}

export function getDocument(id: string): Document | null {
  return db.prepare('SELECT * FROM documents WHERE id = ?').get(id) as Document | null
}

export function getDocumentByPath(path: string, userId: number): Document | null {
  return db
    .prepare('SELECT * FROM documents WHERE path = ? AND user_id = ?')
    .get(path, userId) as Document | null
}

export function listDocuments(userId: number, prefix?: string): Document[] {
  if (prefix) {
    const prefixPattern = prefix.endsWith('/') ? `${prefix}%` : `${prefix}/%`
    return db
      .prepare('SELECT * FROM documents WHERE user_id = ? AND path LIKE ? ORDER BY path ASC')
      .all(userId, prefixPattern) as Document[]
  }
  return db
    .prepare('SELECT * FROM documents WHERE user_id = ? ORDER BY path ASC')
    .all(userId) as Document[]
}

export function getUserTotalSize(userId: number): number {
  const result = db
    .prepare('SELECT COALESCE(SUM(size_bytes), 0) as total FROM documents WHERE user_id = ?')
    .get(userId) as { total: number }
  return result.total
}

export function deleteDocument(id: string, userId: number): boolean {
  const result = db.prepare('DELETE FROM documents WHERE id = ? AND user_id = ?').run(id, userId)
  return result.changes > 0
}

export function getDb(): Database {
  return db
}

export default db
