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

export const createTokenSchema = z.object({
  name: z.string().default('Unnamed token'),
  permissions: z.enum(['read', 'write', 'read_write', 'admin']).default('read_write'),
  project_id: z.string().optional(),
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
