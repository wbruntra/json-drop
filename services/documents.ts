import { getDb } from '../kysely-db'
import { sql } from 'kysely'
import short from 'short-uuid'
import type { Document } from '../kysely-db'

const translator = short.createTranslator()

export type DocScope = {
  projectId?: string | null
  userId?: number
}

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
  projectId: string | null = null,
): Promise<Document> {
  const db = getDb()

  const existing = await db
    .selectFrom('documents')
    .select('id')
    .where((eb) => {
      if (projectId) {
        return eb.and([
          eb('user_id', '=', userId),
          eb('project_id', '=', projectId),
          eb('path', '=', path),
        ])
      }
      return eb.and([
        eb('user_id', '=', userId),
        eb('project_id', 'is', null),
        eb('path', '=', path),
      ])
    })
    .executeTakeFirst()

  const id = existing?.id ?? translator.generate()

  return db
    .insertInto('documents')
    .values({
      id,
      path,
      user_id: userId,
      project_id: projectId,
      content,
      access_mode: accessMode,
      access_secret: accessSecret,
      size_bytes: sizeBytes,
    })
    .onConflict((oc) =>
      oc.expression(sql`IFNULL(project_id, 'u' || user_id), path`).doUpdateSet({
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
    .where('project_id', 'is', null)
    .executeTakeFirst()
  return result ?? null
}

export async function getDocumentByScopeAndPath(
  scope: DocScope,
  path: string,
): Promise<Document | null> {
  const db = getDb()
  let query = db.selectFrom('documents').selectAll().where('path', '=', path)
  if (scope.projectId) {
    query = query.where('project_id', '=', scope.projectId)
    if (scope.userId) {
      query = query.where('user_id', '=', scope.userId)
    }
  } else {
    query = query.where('project_id', 'is', null)
    if (scope.userId) {
      query = query.where('user_id', '=', scope.userId)
    }
  }
  const result = await query.executeTakeFirst()
  return result ?? null
}

export async function listDocuments(
  userId: number,
  options: { projectId?: string | null; prefix?: string } = {},
): Promise<Document[]> {
  const db = getDb()
  let query = db.selectFrom('documents').selectAll()

  if (options.projectId) {
    query = query.where('project_id', '=', options.projectId)
    query = query.where('user_id', '=', userId)
  } else {
    query = query.where('project_id', 'is', null)
    query = query.where('user_id', '=', userId)
  }

  if (options.prefix) {
    const prefixPattern = options.prefix.endsWith('/')
      ? `${options.prefix}%`
      : `${options.prefix}/%`
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

export async function deleteDocumentByScopeAndPath(
  scope: DocScope,
  path: string,
): Promise<boolean> {
  const db = getDb()
  let query = db.deleteFrom('documents').where('path', '=', path)
  if (scope.projectId) {
    query = query.where('project_id', '=', scope.projectId)
    if (scope.userId) {
      query = query.where('user_id', '=', scope.userId)
    }
  } else {
    query = query.where('project_id', 'is', null)
    if (scope.userId) {
      query = query.where('user_id', '=', scope.userId)
    }
  }

  const result = await query.executeTakeFirst()
  return result.numDeletedRows > 0
}
