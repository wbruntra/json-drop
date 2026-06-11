import { Database } from 'bun:sqlite'

const DB_PATH = process.env.DATABASE_URL || 'db.sqlite'

const db = new Database(DB_PATH, { create: true })

db.run('PRAGMA journal_mode = WAL')
db.run('PRAGMA foreign_keys = ON')

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
  user_id: number
  name: string
  content: string
  access_mode: string
  access_secret: string | null
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

export function createDocument(
  id: string,
  userId: number,
  name: string,
  content: string,
  accessMode: string,
  accessSecret: string | null,
): Document {
  const stmt = db.prepare(
    `INSERT INTO documents (id, user_id, name, content, access_mode, access_secret)
     VALUES (?, ?, ?, ?, ?, ?) RETURNING *`,
  )
  return stmt.get(id, userId, name, content, accessMode, accessSecret) as Document
}

export function getDocument(id: string): Document | null {
  return db.prepare('SELECT * FROM documents WHERE id = ?').get(id) as Document | null
}

export function listDocuments(userId: number): Document[] {
  return db
    .prepare('SELECT * FROM documents WHERE user_id = ? ORDER BY created_at DESC')
    .all(userId) as Document[]
}

export function updateDocument(
  id: string,
  userId: number,
  name: string,
  content: string,
  accessMode: string,
  accessSecret: string | null,
): Document | null {
  const result = db
    .prepare(
      `UPDATE documents
     SET name = ?, content = ?, access_mode = ?, access_secret = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND user_id = ?
     RETURNING *`,
    )
    .get(name, content, accessMode, accessSecret, id, userId) as Document | null
  return result
}

export function deleteDocument(id: string, userId: number): boolean {
  const result = db.prepare('DELETE FROM documents WHERE id = ? AND user_id = ?').run(id, userId)
  return result.changes > 0
}

export function getDb(): Database {
  return db
}

export default db
