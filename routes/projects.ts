import type { Context } from 'hono'
import { createProject, listProjects, getProject, deleteProject } from '../services'
import { createProjectSchema, formatZodError } from '../schemas'
import { badRequest, unauthenticated, forbidden, notFound } from './errors'

export async function handleCreateProject(c: Context): Promise<Response> {
  const auth = c.get('auth')
  if (!auth.user) {
    return unauthenticated(c)
  }

  const rawBody = await c.req.json().catch(() => ({}))
  const parsed = createProjectSchema.safeParse(rawBody)
  if (!parsed.success) {
    return badRequest(c, formatZodError(parsed.error))
  }

  const project = await createProject(auth.user.id, parsed.data.name)

  return c.json(
    {
      id: project.id,
      name: project.name,
      created_at: project.created_at,
    },
    201,
  )
}

export async function handleListProjects(c: Context): Promise<Response> {
  const auth = c.get('auth')
  if (!auth.user) {
    return unauthenticated(c)
  }

  const projects = await listProjects(auth.user.id)

  return c.json(
    projects.map((p) => ({
      id: p.id,
      name: p.name,
      created_at: p.created_at,
    })),
  )
}

export async function handleDeleteProject(c: Context): Promise<Response> {
  const auth = c.get('auth')
  if (!auth.user || auth.tokenPermissions !== 'admin') {
    return unauthenticated(c, 'Unauthorized')
  }

  const id = c.req.param('id')!

  const existing = await getProject(id)
  if (!existing) {
    return notFound(c, 'Project not found')
  }
  if (existing.user_id !== auth.user.id) {
    return forbidden(c)
  }

  const deleted = await deleteProject(id, auth.user.id)
  if (!deleted) {
    return notFound(c, 'Project not found')
  }

  return c.json({ deleted: true })
}
