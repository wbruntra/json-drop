import { getDb } from '../kysely-db'
import type { WorkspaceMember, WorkspaceRole } from '../kysely-db'

export async function getMembership(
  workspaceId: string,
  userId: number,
): Promise<WorkspaceMember | null> {
  const result = await getDb()
    .selectFrom('workspace_members')
    .selectAll()
    .where('workspace_id', '=', workspaceId)
    .where('user_id', '=', userId)
    .where('removed_at', 'is', null)
    .executeTakeFirst()
  return result ?? null
}

export async function listMembers(workspaceId: string): Promise<WorkspaceMember[]> {
  return getDb()
    .selectFrom('workspace_members')
    .selectAll()
    .where('workspace_id', '=', workspaceId)
    .where('removed_at', 'is', null)
    .orderBy('joined_at', 'asc')
    .execute()
}

export async function countActiveOwners(workspaceId: string): Promise<number> {
  const result = await getDb()
    .selectFrom('workspace_members')
    .select((eb) => eb.fn.countAll().as('count'))
    .where('workspace_id', '=', workspaceId)
    .where('role', '=', 'owner')
    .where('removed_at', 'is', null)
    .executeTakeFirstOrThrow()
  return Number(result.count)
}

export async function addMember(
  workspaceId: string,
  userId: number,
  role: WorkspaceRole,
): Promise<WorkspaceMember> {
  const db = getDb()
  const existing = await getMembership(workspaceId, userId)
  if (existing) return existing

  return db
    .insertInto('workspace_members')
    .values({ workspace_id: workspaceId, user_id: userId, role })
    .returningAll()
    .executeTakeFirstOrThrow()
}

export type UpdateRoleResult =
  | { ok: true; member: WorkspaceMember }
  | { ok: false; reason: 'not_found' | 'last_owner' }

export async function updateMemberRole(
  workspaceId: string,
  userId: number,
  role: WorkspaceRole,
): Promise<UpdateRoleResult> {
  const existing = await getMembership(workspaceId, userId)
  if (!existing) return { ok: false, reason: 'not_found' }

  if (existing.role === 'owner' && role !== 'owner') {
    const owners = await countActiveOwners(workspaceId)
    if (owners <= 1) return { ok: false, reason: 'last_owner' }
  }

  const member = await getDb()
    .updateTable('workspace_members')
    .set({ role })
    .where('workspace_id', '=', workspaceId)
    .where('user_id', '=', userId)
    .where('removed_at', 'is', null)
    .returningAll()
    .executeTakeFirstOrThrow()

  return { ok: true, member }
}

export type RemoveMemberResult = { ok: true } | { ok: false; reason: 'not_found' | 'last_owner' }

export async function removeMember(
  workspaceId: string,
  userId: number,
): Promise<RemoveMemberResult> {
  const existing = await getMembership(workspaceId, userId)
  if (!existing) return { ok: false, reason: 'not_found' }

  if (existing.role === 'owner') {
    const owners = await countActiveOwners(workspaceId)
    if (owners <= 1) return { ok: false, reason: 'last_owner' }
  }

  await getDb()
    .updateTable('workspace_members')
    .set({ removed_at: new Date().toISOString() })
    .where('workspace_id', '=', workspaceId)
    .where('user_id', '=', userId)
    .where('removed_at', 'is', null)
    .execute()

  return { ok: true }
}

export type MemberWithUser = WorkspaceMember & {
  display_name: string | null
  kind: string
}

export async function listMembersWithUsers(workspaceId: string): Promise<MemberWithUser[]> {
  return getDb()
    .selectFrom('workspace_members')
    .innerJoin('users', 'users.id', 'workspace_members.user_id')
    .select([
      'workspace_members.id',
      'workspace_members.workspace_id',
      'workspace_members.user_id',
      'workspace_members.role',
      'workspace_members.joined_at',
      'workspace_members.removed_at',
      'users.display_name',
      'users.kind',
    ])
    .where('workspace_members.workspace_id', '=', workspaceId)
    .where('workspace_members.removed_at', 'is', null)
    .orderBy('workspace_members.joined_at', 'asc')
    .execute()
}

export async function listWorkspaceIdsForUser(userId: number): Promise<string[]> {
  const rows = await getDb()
    .selectFrom('workspace_members')
    .select('workspace_id')
    .where('user_id', '=', userId)
    .where('removed_at', 'is', null)
    .execute()
  return rows.map((r) => r.workspace_id)
}
