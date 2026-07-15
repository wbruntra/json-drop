import type { Context } from 'hono'
import { getProject } from '../services'
import {
  createWorkspace,
  listWorkspacesForUser,
  getWorkspace,
  updateWorkspace,
  deleteWorkspace,
} from '../services/workspaces'
import { listMembersWithUsers, updateMemberRole, removeMember } from '../services/memberships'
import { createInvite, listInvites, revokeInvite } from '../services/invites'
import { createRecoveryLink } from '../services/recovery'
import {
  createWorkspaceSchema,
  updateWorkspaceSchema,
  createInviteSchema,
  updateMemberRoleSchema,
  formatZodError,
} from '../schemas'
import { badRequest, unauthenticated, forbidden, notFound } from './errors'
import { requireWorkspacePermission, isResponse } from './workspaceAuth'

export async function handleCreateWorkspace(c: Context): Promise<Response> {
  const auth = c.get('auth')
  if (!auth.user) return unauthenticated(c)

  const rawBody = await c.req.json().catch(() => ({}))
  const parsed = createWorkspaceSchema.safeParse(rawBody)
  if (!parsed.success) return badRequest(c, formatZodError(parsed.error))

  let projectId: string | null = null
  if (parsed.data.project_id) {
    const project = await getProject(parsed.data.project_id)
    if (!project) return notFound(c, 'Project not found')
    if (project.user_id !== auth.user.id) return forbidden(c)
    projectId = project.id
  }

  const workspace = await createWorkspace(parsed.data.name, auth.user.id, projectId)

  return c.json(
    {
      id: workspace.id,
      name: workspace.name,
      project_id: workspace.project_id,
      created_at: workspace.created_at,
    },
    201,
  )
}

export async function handleListWorkspaces(c: Context): Promise<Response> {
  const auth = c.get('auth')
  if (!auth.user) return unauthenticated(c)

  const workspaces = await listWorkspacesForUser(auth.user.id)

  return c.json(
    workspaces.map((w) => ({
      id: w.id,
      name: w.name,
      project_id: w.project_id,
      created_at: w.created_at,
    })),
  )
}

export async function handleGetWorkspace(c: Context): Promise<Response> {
  const auth = c.get('auth')
  const workspaceId = c.req.param('id')!

  const permCheck = await requireWorkspacePermission(c, auth, workspaceId, 'documents.read')
  if (isResponse(permCheck)) return permCheck

  const workspace = await getWorkspace(workspaceId)
  if (!workspace) return notFound(c, 'Workspace not found')

  return c.json({
    id: workspace.id,
    name: workspace.name,
    project_id: workspace.project_id,
    created_at: workspace.created_at,
    role: permCheck.role,
  })
}

export async function handleUpdateWorkspace(c: Context): Promise<Response> {
  const auth = c.get('auth')
  const workspaceId = c.req.param('id')!

  const permCheck = await requireWorkspacePermission(c, auth, workspaceId, 'workspace.manage')
  if (isResponse(permCheck)) return permCheck

  const rawBody = await c.req.json().catch(() => ({}))
  const parsed = updateWorkspaceSchema.safeParse(rawBody)
  if (!parsed.success) return badRequest(c, formatZodError(parsed.error))

  const workspace = await updateWorkspace(workspaceId, parsed.data.name)
  if (!workspace) return notFound(c, 'Workspace not found')

  return c.json({
    id: workspace.id,
    name: workspace.name,
    project_id: workspace.project_id,
    created_at: workspace.created_at,
  })
}

export async function handleDeleteWorkspace(c: Context): Promise<Response> {
  const auth = c.get('auth')
  const workspaceId = c.req.param('id')!

  const permCheck = await requireWorkspacePermission(c, auth, workspaceId, 'workspace.delete')
  if (isResponse(permCheck)) return permCheck

  const deleted = await deleteWorkspace(workspaceId)
  if (!deleted) return notFound(c, 'Workspace not found')

  return c.json({ deleted: true })
}

export async function handleListMembers(c: Context): Promise<Response> {
  const auth = c.get('auth')
  const workspaceId = c.req.param('id')!

  const permCheck = await requireWorkspacePermission(c, auth, workspaceId, 'documents.read')
  if (isResponse(permCheck)) return permCheck

  const members = await listMembersWithUsers(workspaceId)

  return c.json(
    members.map((m) => ({
      user_id: m.user_id,
      role: m.role,
      display_name: m.display_name,
      kind: m.kind,
      joined_at: m.joined_at,
    })),
  )
}

export async function handleUpdateMemberRole(c: Context): Promise<Response> {
  const auth = c.get('auth')
  const workspaceId = c.req.param('id')!
  const targetUserId = parseInt(c.req.param('userId')!, 10)
  if (isNaN(targetUserId)) return badRequest(c, 'Invalid user id')

  const permCheck = await requireWorkspacePermission(c, auth, workspaceId, 'members.manage')
  if (isResponse(permCheck)) return permCheck

  const rawBody = await c.req.json().catch(() => ({}))
  const parsed = updateMemberRoleSchema.safeParse(rawBody)
  if (!parsed.success) return badRequest(c, formatZodError(parsed.error))

  const result = await updateMemberRole(workspaceId, targetUserId, parsed.data.role)
  if (!result.ok) {
    if (result.reason === 'not_found') return notFound(c, 'Member not found')
    return badRequest(c, 'Cannot demote the last remaining owner')
  }

  return c.json({ user_id: result.member.user_id, role: result.member.role })
}

export async function handleRemoveMember(c: Context): Promise<Response> {
  const auth = c.get('auth')
  const workspaceId = c.req.param('id')!
  const targetUserId = parseInt(c.req.param('userId')!, 10)
  if (isNaN(targetUserId)) return badRequest(c, 'Invalid user id')

  const permCheck = await requireWorkspacePermission(c, auth, workspaceId, 'members.manage')
  if (isResponse(permCheck)) return permCheck

  const result = await removeMember(workspaceId, targetUserId)
  if (!result.ok) {
    if (result.reason === 'not_found') return notFound(c, 'Member not found')
    return badRequest(c, 'Cannot remove the last remaining owner')
  }

  return c.json({ removed: true })
}

export async function handleCreateRecoveryLink(c: Context): Promise<Response> {
  const auth = c.get('auth')
  const workspaceId = c.req.param('id')!
  const targetUserId = parseInt(c.req.param('userId')!, 10)
  if (isNaN(targetUserId)) return badRequest(c, 'Invalid user id')

  const permCheck = await requireWorkspacePermission(c, auth, workspaceId, 'members.manage')
  if (isResponse(permCheck)) return permCheck

  const { secret, expiresAt } = await createRecoveryLink(workspaceId, targetUserId, auth.user!.id)

  return c.json(
    {
      secret,
      expires_at: expiresAt,
      message: 'Store this secret now. It will not be shown again.',
    },
    201,
  )
}

export async function handleCreateInvite(c: Context): Promise<Response> {
  const auth = c.get('auth')
  const workspaceId = c.req.param('id')!

  const permCheck = await requireWorkspacePermission(c, auth, workspaceId, 'invites.manage')
  if (isResponse(permCheck)) return permCheck

  const rawBody = await c.req.json().catch(() => ({}))
  const parsed = createInviteSchema.safeParse(rawBody)
  if (!parsed.success) return badRequest(c, formatZodError(parsed.error))

  const { invite, secret } = await createInvite(workspaceId, parsed.data.role, auth.user!.id, {
    expiresAt: parsed.data.expires_at,
    maxUses: parsed.data.max_uses,
  })

  return c.json(
    {
      id: invite.id,
      role: invite.role,
      secret,
      expires_at: invite.expires_at,
      max_uses: invite.max_uses,
      message: 'Store this secret now. It will not be shown again.',
    },
    201,
  )
}

export async function handleListInvites(c: Context): Promise<Response> {
  const auth = c.get('auth')
  const workspaceId = c.req.param('id')!

  const permCheck = await requireWorkspacePermission(c, auth, workspaceId, 'invites.manage')
  if (isResponse(permCheck)) return permCheck

  const invites = await listInvites(workspaceId)

  return c.json(
    invites.map((i) => ({
      id: i.id,
      role: i.role,
      expires_at: i.expires_at,
      max_uses: i.max_uses,
      use_count: i.use_count,
      created_at: i.created_at,
    })),
  )
}

export async function handleRevokeInvite(c: Context): Promise<Response> {
  const auth = c.get('auth')
  const workspaceId = c.req.param('id')!
  const inviteId = c.req.param('inviteId')!

  const permCheck = await requireWorkspacePermission(c, auth, workspaceId, 'invites.manage')
  if (isResponse(permCheck)) return permCheck

  const revoked = await revokeInvite(workspaceId, inviteId)
  if (!revoked) return notFound(c, 'Invite not found')

  return c.json({ revoked: true })
}
