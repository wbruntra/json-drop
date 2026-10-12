import type { Context } from 'hono'
import {
  createProject,
  getProject,
  deleteProject,
  isAccountAuth,
  listProjectsWithStats,
  getProjectWithStats,
  renameProject,
} from '../services'
import { createProjectSchema, formatZodError } from '../schemas'
import { badRequest, unauthenticated, forbidden, notFound } from './errors'

export async function handleCreateProject(c: Context): Promise<Response> {
  const auth = c.get('auth')
  if (!auth.user) return unauthenticated(c)
  if (!isAccountAuth(auth)) return forbidden(c, 'Requires a dashboard session or account key')

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
  if (!auth.user) return unauthenticated(c)

  if (isAccountAuth(auth)) {
    return c.json(await listProjectsWithStats(auth.user.id))
  }

  // A project-scoped key sees only its own project, without stats.
  if (auth.projectId) {
    const own = await getProject(auth.projectId)
    return c.json(own ? [{ id: own.id, name: own.name, created_at: own.created_at }] : [])
  }

  return forbidden(c, 'Requires a dashboard session or account key')
}

export async function handleGetProject(c: Context): Promise<Response> {
  const auth = c.get('auth')
  if (!auth.user) return unauthenticated(c)
  if (!isAccountAuth(auth)) return forbidden(c, 'Requires a dashboard session or account key')

  const project = await getProjectWithStats(c.req.param('id')!, auth.user.id)
  if (!project) return notFound(c, 'Project not found')
  return c.json(project)
}

export async function handleUpdateProject(c: Context): Promise<Response> {
  const auth = c.get('auth')
  if (!auth.user) return unauthenticated(c)
  if (!isAccountAuth(auth)) return forbidden(c, 'Requires a dashboard session or account key')

  const rawBody = await c.req.json().catch(() => ({}))
  const parsed = createProjectSchema.safeParse(rawBody)
  if (!parsed.success) return badRequest(c, formatZodError(parsed.error))

  const id = c.req.param('id')!
  if (!(await renameProject(id, auth.user.id, parsed.data.name))) {
    return notFound(c, 'Project not found')
  }
  return c.json(await getProjectWithStats(id, auth.user.id))
}

export async function handleDeleteProject(c: Context): Promise<Response> {
  const auth = c.get('auth')
  if (!auth.user) return unauthenticated(c)
  if (!isAccountAuth(auth)) return forbidden(c, 'Requires a dashboard session or account key')

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
