import type { WorkspaceRole } from '../kysely-db'

export type Permission =
  | 'documents.read'
  | 'documents.write'
  | 'documents.delete'
  | 'members.manage'
  | 'invites.manage'
  | 'workspace.manage'
  | 'workspace.delete'

const ROLE_PERMISSIONS: Record<WorkspaceRole, Set<Permission>> = {
  owner: new Set([
    'documents.read',
    'documents.write',
    'documents.delete',
    'members.manage',
    'invites.manage',
    'workspace.manage',
    'workspace.delete',
  ]),
  admin: new Set([
    'documents.read',
    'documents.write',
    'documents.delete',
    'members.manage',
    'invites.manage',
    'workspace.manage',
  ]),
  editor: new Set(['documents.read', 'documents.write']),
  viewer: new Set(['documents.read']),
}

export function isWorkspaceRole(value: string): value is WorkspaceRole {
  return value === 'owner' || value === 'admin' || value === 'editor' || value === 'viewer'
}

export function hasPermission(role: WorkspaceRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission)
}
