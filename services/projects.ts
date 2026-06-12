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
