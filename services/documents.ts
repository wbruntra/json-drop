import { getDb } from '../kysely-db'
import { sql } from 'kysely'
import short from 'short-uuid'
import type { Document } from '../kysely-db'

const translator = short.createTranslator()

export function generateDocId(): string {
  return translator.generate()
}

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

  return db
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
