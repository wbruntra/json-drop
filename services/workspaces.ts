import { getDb } from '../kysely-db'
import type { Workspace } from '../kysely-db'
import short from 'short-uuid'

const translator = short.createTranslator()

export function generateWorkspaceId(): string {
  return translator.generate()
}

export async function createWorkspace(
  name: string,
  createdBy: number,
  projectId: string | null = null,
): Promise<Workspace> {
  const db = getDb()
  const id = generateWorkspaceId()

  return db.transaction().execute(async (trx) => {
    const workspace = await trx
      .insertInto('workspaces')
      .values({ id, name, created_by: createdBy, project_id: projectId })
      .returningAll()
      .executeTakeFirstOrThrow()

    await trx
      .insertInto('workspace_members')
      .values({ workspace_id: id, user_id: createdBy, role: 'owner' })
      .execute()

    return workspace
  })
}

export async function getWorkspace(id: string): Promise<Workspace | null> {
  const result = await getDb()
    .selectFrom('workspaces')
    .selectAll()
    .where('id', '=', id)
    .where('deleted_at', 'is', null)
    .executeTakeFirst()
  return result ?? null
}

export async function listWorkspacesForUser(userId: number): Promise<Workspace[]> {
  return getDb()
    .selectFrom('workspaces')
    .innerJoin('workspace_members', 'workspace_members.workspace_id', 'workspaces.id')
    .selectAll('workspaces')
    .where('workspace_members.user_id', '=', userId)
    .where('workspace_members.removed_at', 'is', null)
    .where('workspaces.deleted_at', 'is', null)
    .orderBy('workspaces.created_at', 'asc')
    .execute()
}

export async function updateWorkspace(id: string, name: string): Promise<Workspace | null> {
  const result = await getDb()
    .updateTable('workspaces')
    .set({ name })
    .where('id', '=', id)
    .where('deleted_at', 'is', null)
    .returningAll()
    .executeTakeFirst()
  return result ?? null
}

export async function deleteWorkspace(id: string): Promise<boolean> {
  const result = await getDb()
    .updateTable('workspaces')
    .set({ deleted_at: new Date().toISOString() })
    .where('id', '=', id)
    .where('deleted_at', 'is', null)
    .executeTakeFirst()
  return result.numUpdatedRows > 0
}
