import { z } from 'zod'

const PATH_SEGMENT = /^[a-zA-Z0-9_-]+$/

export const pathSchema = z
  .string()
  .min(1, 'Path is required')
  .refine((p) => !p.startsWith('/') && !p.endsWith('/'), {
    message: 'Path must not start or end with /',
  })
  .refine((p) => !p.includes('//'), {
    message: 'Path must not contain empty segments',
  })
  .refine((p) => p.split('/').every((s) => PATH_SEGMENT.test(s)), {
    message:
      'Path segments contain invalid characters. Only alphanumeric, hyphens, and underscores allowed.',
  })

export const createProjectSchema = z.object({
  name: z.string().min(1).max(100),
})

// Account keys (admin) manage projects and keys and are never tied to a
// project. Project keys (read, read_write) only touch one project's documents.
// Legacy 'write' keys still authenticate but can no longer be created.
export const createTokenSchema = z
  .object({
    name: z.string().default('Unnamed token'),
    permissions: z.enum(['read', 'read_write', 'admin']).default('read_write'),
    project_id: z.string().optional(),
  })
  .refine((t) => (t.permissions === 'admin') === !t.project_id, {
    message: 'admin keys cannot have a project_id; read and read_write keys require one',
    path: ['project_id'],
  })

export const upsertDocSchema = z.object({
  content: z.unknown().default({}),
  access_mode: z.enum(['public', 'public_read_secret_write', 'private']).default('public'),
})

export const workspaceRoleSchema = z.enum(['owner', 'admin', 'editor', 'viewer'])

export const createWorkspaceSchema = z.object({
  name: z.string().min(1).max(100),
  project_id: z.string().optional(),
})

export const updateWorkspaceSchema = z.object({
  name: z.string().min(1).max(100),
})

export const createInviteSchema = z.object({
  role: workspaceRoleSchema.exclude(['owner']),
  expires_at: z.string().datetime().optional(),
  max_uses: z.number().int().positive().optional(),
})

export const redeemInviteSchema = z.object({
  secret: z.string().min(1),
})

export const updateMemberRoleSchema = z.object({
  role: workspaceRoleSchema,
})

export const recoverSessionSchema = z.object({
  secret: z.string().min(1),
})

export function formatZodError(err: z.ZodError): string {
  return err.issues[0]?.message ?? 'Invalid request'
}
