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

export const createTokenSchema = z.object({
  name: z.string().default('Unnamed token'),
  permissions: z.enum(['read', 'write', 'read_write', 'admin']).default('read_write'),
})

export const upsertDocSchema = z.object({
  content: z.unknown().default({}),
  access_mode: z.enum(['public', 'public_read_secret_write', 'private']).default('public'),
})

export function formatZodError(err: z.ZodError): string {
  return err.issues[0]?.message ?? 'Invalid request'
}
