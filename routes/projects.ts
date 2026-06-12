import type { Context } from 'hono'
import { createProject, listProjects, getProject, deleteProject } from '../services'
import { createProjectSchema, formatZodError } from '../schemas'

export async function handleCreateProject(c: Context): Promise<Response> {
  const auth = c.get('auth')
  if (!auth.user) {
    return c.json({ error: 'Not authenticated' }, 401)
  }

  const rawBody = await c.req.json().catch(() => ({}))
  const parsed = createProjectSchema.safeParse(rawBody)
  if (!parsed.success) {
    return c.json({ error: formatZodError(parsed.error) }, 400)
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
    return c.json({ error: 'Not authenticated' }, 401)
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
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const id = c.req.param('id')!

  const existing = await getProject(id)
  if (!existing) {
    return c.json({ error: 'Project not found' }, 404)
  }
  if (existing.user_id !== auth.user.id) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const deleted = await deleteProject(id, auth.user.id)
  if (!deleted) {
    return c.json({ error: 'Project not found' }, 404)
  }

  return c.json({ deleted: true })
}
