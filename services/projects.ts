import { getDb } from '../kysely-db'
import type { Project } from '../kysely-db'
import short from 'short-uuid'

const translator = short.createTranslator()

export function generateProjectId(): string {
  return translator.generate()
}

export async function createProject(userId: number, name: string): Promise<Project> {
  return getDb()
    .insertInto('projects')
    .values({
      id: generateProjectId(),
      user_id: userId,
      name,
    })
    .returningAll()
    .executeTakeFirstOrThrow()
}

export async function listProjects(userId: number): Promise<Project[]> {
  return getDb()
    .selectFrom('projects')
    .selectAll()
    .where('user_id', '=', userId)
    .orderBy('created_at', 'asc')
    .execute()
}

export async function getProject(id: string): Promise<Project | null> {
  const result = await getDb()
    .selectFrom('projects')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst()
  return result ?? null
}

export async function deleteProject(id: string, userId: number): Promise<boolean> {
  const result = await getDb()
    .deleteFrom('projects')
    .where('id', '=', id)
    .where('user_id', '=', userId)
    .executeTakeFirst()
  return result.numDeletedRows > 0
}

export type ProjectWithStats = {
  id: string
  name: string
  created_at: string
  doc_count: number
  last_write_at: string | null
  key_count: number
}

function projectsWithStats() {
  return getDb()
    .selectFrom('projects as p')
    .select(['p.id', 'p.name', 'p.created_at', 'p.user_id'])
    .select((eb) => [
      eb
        .selectFrom('documents as d')
        .select((e) => e.fn.countAll<number>().as('n'))
        .whereRef('d.project_id', '=', 'p.id')
        .as('doc_count'),
      eb
        .selectFrom('documents as d')
        .select((e) => e.fn.max('d.updated_at').as('m'))
        .whereRef('d.project_id', '=', 'p.id')
        .as('last_write_at'),
      eb
        .selectFrom('api_tokens as t')
        .select((e) => e.fn.countAll<number>().as('n'))
        .whereRef('t.project_id', '=', 'p.id')
        .where('t.revoked_at', 'is', null)
        .as('key_count'),
    ])
}

function toStats(row: {
  id: string
  name: string
  created_at: string
  doc_count: number | null
  last_write_at: string | null
  key_count: number | null
}): ProjectWithStats {
  return {
    id: row.id,
    name: row.name,
    created_at: row.created_at,
    doc_count: Number(row.doc_count ?? 0),
    last_write_at: row.last_write_at ?? null,
    key_count: Number(row.key_count ?? 0),
  }
}

export async function listProjectsWithStats(userId: number): Promise<ProjectWithStats[]> {
  const rows = await projectsWithStats()
    .where('p.user_id', '=', userId)
    .orderBy('p.created_at', 'asc')
    .execute()
  return rows.map(toStats)
}

export async function getProjectWithStats(
  id: string,
  userId: number,
): Promise<ProjectWithStats | null> {
  const row = await projectsWithStats()
    .where('p.id', '=', id)
    .where('p.user_id', '=', userId)
    .executeTakeFirst()
  return row ? toStats(row) : null
}

export async function renameProject(id: string, userId: number, name: string): Promise<boolean> {
  const result = await getDb()
    .updateTable('projects')
    .set({ name })
    .where('id', '=', id)
    .where('user_id', '=', userId)
    .executeTakeFirst()
  return result.numUpdatedRows > 0
}
