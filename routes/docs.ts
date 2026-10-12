import type { Context } from 'hono'
import {
  upsertDocument,
  getDocument,
  getDocumentByPathAndSecret,
  getDocumentByScopeAndPath,
  deleteDocumentByScopeAndPath,
  listDocuments,
  deleteDocument,
  getUserTotalSize,
  generateDocId,
  getProject,
} from '../services'
import type { AuthContext } from '../services/auth'
import { LIMITS } from '../limits'
import { pathSchema, upsertDocSchema, formatZodError } from '../schemas'
import {
  badRequest,
  unauthenticated,
  forbidden,
  notFound,
  conflict,
  storageLimit,
  serverError,
} from './errors'

function contentSize(content: string): number {
  return new TextEncoder().encode(content).byteLength
}

function canRead(
  auth: AuthContext,
  doc: { user_id: number; access_mode: string; access_secret: string | null },
  secret: string | null,
): boolean {
  if (doc.access_mode === 'public') return true
  if (doc.access_mode === 'public_read_secret_write') return true
  if (doc.access_mode === 'private') {
    if (auth.user?.id === doc.user_id) {
      if (auth.tokenPermissions) {
        return ['read', 'read_write', 'admin'].includes(auth.tokenPermissions)
      }
      return true
    }
    if (secret && doc.access_secret && secret === doc.access_secret) return true
  }
  return false
}

function canWrite(
  auth: AuthContext,
  doc: { user_id: number; access_mode: string; access_secret: string | null },
  secret: string | null,
): boolean {
  if (auth.user?.id === doc.user_id) {
    if (auth.tokenPermissions) {
      return ['write', 'read_write', 'admin'].includes(auth.tokenPermissions)
    }
    return true
  }
  if (['public_read_secret_write', 'private'].includes(doc.access_mode)) {
    if (secret && doc.access_secret && secret === doc.access_secret) return true
  }
  return false
}

function formatMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function docPayload(d: {
  id: string
  path: string
  access_mode: string
  content: string
  size_bytes: number
  version: number
  created_at: string
  updated_at: string
}) {
  return {
    id: d.id,
    path: d.path,
    access_mode: d.access_mode,
    content: JSON.parse(d.content),
    size_bytes: d.size_bytes,
    version: d.version,
    created_at: d.created_at,
    updated_at: d.updated_at,
  }
}

type ResolvedScope = {
  projectId: string
  ownerId: number
}

// Every document request is scoped to one project: a project key's own
// project, otherwise ?project=<id>. There is no account-wide document scope.
async function resolveScope(c: Context, auth: AuthContext): Promise<ResolvedScope | Response> {
  if (auth.projectId && auth.user) {
    return { projectId: auth.projectId, ownerId: auth.user.id }
  }
  const projectQuery = c.req.query('project')
  if (!projectQuery) {
    return badRequest(c, 'No project: use a project key or add ?project=<id>')
  }
  const project = await getProject(projectQuery)
  if (!project) return notFound(c, 'Project not found')
  return { projectId: project.id, ownerId: project.user_id }
}

function parseIfMatch(c: Context): number | undefined {
  const header = c.req.header('If-Match')
  if (!header) return undefined
  const n = parseInt(header.trim(), 10)
  return isNaN(n) ? undefined : n
}

function checkIfMatch(actual: number | undefined, expected: number | undefined): boolean {
  // If caller supplied If-Match, it must equal the existing doc's version.
  // When the doc doesn't exist (actual === undefined), a supplied If-Match is a
  // precondition that fails (caller expected an existing version).
  if (expected === undefined) return true
  return actual !== undefined && actual === expected
}

async function handleSecretUpsert(
  c: Context,
  auth: AuthContext,
  path: string,
  secret: string,
  content: string,
  size: number,
  ifMatch: number | undefined,
): Promise<Response> {
  const doc = await getDocumentByPathAndSecret(path, secret)
  if (!doc) {
    return notFound(c, 'Document not found')
  }

  if (!canWrite(auth, doc, secret)) {
    return forbidden(c)
  }

  if (!checkIfMatch(doc.version, ifMatch)) {
    return conflict(c, 'Version conflict', { expected: ifMatch, actual: doc.version })
  }

  const currentTotal = await getUserTotalSize(doc.user_id)
  if (currentTotal - doc.size_bytes + size > LIMITS.maxTotalSize) {
    return storageLimit(
      c,
      `Total storage would exceed ${formatMb(LIMITS.maxTotalSize)} (using ${formatMb(currentTotal)})`,
    )
  }

  const updated = await upsertDocument(
    doc.path,
    doc.user_id,
    content,
    doc.access_mode,
    doc.access_secret,
    size,
    doc.project_id,
  )

  return c.json({
    id: updated.id,
    path: updated.path,
    access_mode: updated.access_mode,
    version: updated.version,
    size_bytes: updated.size_bytes,
    created_at: updated.created_at,
    updated_at: updated.updated_at,
  })
}

export async function handleUpsertDoc(c: Context): Promise<Response> {
  const auth = c.get('auth')
  const path = c.req.param('path')!

  const pathResult = pathSchema.safeParse(path)
  if (!pathResult.success) {
    return badRequest(c, formatZodError(pathResult.error))
  }

  const secret = c.req.query('secret') ?? null
  if (!auth.user && !secret) {
    return unauthenticated(c)
  }

  if (
    auth.user &&
    auth.tokenPermissions &&
    !['write', 'read_write', 'admin'].includes(auth.tokenPermissions)
  ) {
    return forbidden(c)
  }

  // Secret-only writes locate the document by its secret and need no scope.
  let scope: ResolvedScope | null = null
  if (auth.user) {
    const resolved = await resolveScope(c, auth)
    if (resolved instanceof Response) return resolved
    if (resolved.ownerId !== auth.user.id) return forbidden(c)
    scope = resolved
  }

  const rawBody = await c.req.json()
  const parsed = upsertDocSchema.safeParse(rawBody)
  if (!parsed.success) {
    return badRequest(c, formatZodError(parsed.error))
  }

  const content = JSON.stringify(parsed.data.content)

  const size = contentSize(content)
  if (size > LIMITS.maxDocSize) {
    return storageLimit(c, `Document exceeds max size of ${formatMb(LIMITS.maxDocSize)}`)
  }

  const ifMatch = parseIfMatch(c)

  if (!auth.user) {
    return handleSecretUpsert(c, auth, path, secret!, content, size, ifMatch)
  }

  const accessMode = parsed.data.access_mode
  scope = scope!

  const existingDoc = await getDocumentByScopeAndPath(
    { projectId: scope.projectId, userId: scope.ownerId },
    path,
  )

  if (!checkIfMatch(existingDoc?.version, ifMatch)) {
    return conflict(c, 'Version conflict', {
      expected: ifMatch,
      actual: existingDoc?.version,
    })
  }

  const currentTotal = await getUserTotalSize(auth.user.id)
  const sizeDiff = existingDoc ? size - existingDoc.size_bytes : size
  if (currentTotal + sizeDiff > LIMITS.maxTotalSize) {
    return storageLimit(
      c,
      `Total storage would exceed ${formatMb(LIMITS.maxTotalSize)} (using ${formatMb(currentTotal)})`,
    )
  }

  let accessSecret: string | null
  if (existingDoc) {
    if (accessMode !== existingDoc.access_mode) {
      accessSecret =
        accessMode !== 'public' ? existingDoc.access_secret || crypto.randomUUID() : null
    } else {
      accessSecret = existingDoc.access_secret
    }
  } else {
    accessSecret = accessMode !== 'public' ? crypto.randomUUID() : null
  }

  const doc = await upsertDocument(
    path,
    auth.user.id,
    content,
    accessMode,
    accessSecret,
    size,
    scope.projectId,
  )

  return c.json(
    {
      id: doc.id,
      path: doc.path,
      access_mode: doc.access_mode,
      access_secret: doc.access_secret,
      version: doc.version,
      size_bytes: doc.size_bytes,
      created_at: doc.created_at,
      updated_at: doc.updated_at,
      message:
        accessSecret && !existingDoc
          ? 'Store the access_secret now. It will not be shown again.'
          : undefined,
    },
    existingDoc ? 200 : 201,
  )
}

export async function handleListDocs(c: Context): Promise<Response> {
  const auth = c.get('auth')
  const scope = await resolveScope(c, auth)
  if (scope instanceof Response) return scope
  const secret = c.req.query('secret') ?? null

  const pathQuery = c.req.query('path')
  if (pathQuery) {
    if (
      auth.user &&
      auth.tokenPermissions &&
      !['read', 'read_write', 'admin'].includes(auth.tokenPermissions)
    ) {
      return forbidden(c)
    }

    // Anyone may look up a path in a project; canRead then decides whether
    // the caller may see that document.
    const doc = await getDocumentByScopeAndPath(
      { projectId: scope.projectId, userId: scope.ownerId },
      pathQuery,
    )
    if (!doc) {
      return notFound(c, 'Document not found')
    }
    if (!canRead(auth, doc, secret)) {
      return forbidden(c)
    }

    return c.json(docPayload(doc))
  }

  if (!auth.user) {
    return unauthenticated(c)
  }
  if (auth.tokenPermissions && !['read', 'read_write', 'admin'].includes(auth.tokenPermissions)) {
    return forbidden(c)
  }

  const prefix = c.req.query('prefix') || undefined

  if (scope.ownerId !== auth.user.id) {
    return forbidden(c)
  }

  const docs = await listDocuments(auth.user.id, { projectId: scope.projectId, prefix })
  const total = await getUserTotalSize(auth.user.id)

  return c.json({
    prefix: prefix || null,
    order: 'path_asc',
    docs: docs.map((d) => docPayload(d)),
    storage: {
      used_bytes: total,
      used: formatMb(total),
      limit: formatMb(LIMITS.maxTotalSize),
    },
  })
}

export async function handleGetDoc(c: Context): Promise<Response> {
  const auth = c.get('auth')
  const id = c.req.param('path')!

  const doc = await getDocument(id)
  if (!doc) {
    return notFound(c, 'Document not found')
  }

  const secret = c.req.query('secret') ?? null

  if (!canRead(auth, doc, secret)) {
    return forbidden(c)
  }

  return c.json(docPayload(doc))
}

export async function handleCreateDoc(c: Context): Promise<Response> {
  const auth = c.get('auth')
  if (!auth.user) {
    return unauthenticated(c)
  }

  if (auth.tokenPermissions && !['write', 'read_write', 'admin'].includes(auth.tokenPermissions)) {
    return forbidden(c)
  }

  const collectionPath = c.req.param('path')!
  const pathResult = pathSchema.safeParse(collectionPath)
  if (!pathResult.success) {
    return badRequest(c, formatZodError(pathResult.error))
  }

  const scope = await resolveScope(c, auth)
  if (scope instanceof Response) return scope
  if (scope.ownerId !== auth.user.id) {
    return forbidden(c)
  }

  const rawBody = await c.req.json()
  const parsed = upsertDocSchema.safeParse(rawBody)
  if (!parsed.success) {
    return badRequest(c, formatZodError(parsed.error))
  }

  const content = JSON.stringify(parsed.data.content)
  const size = contentSize(content)
  if (size > LIMITS.maxDocSize) {
    return storageLimit(c, `Document exceeds max size of ${formatMb(LIMITS.maxDocSize)}`)
  }

  const currentTotal = await getUserTotalSize(auth.user.id)
  if (currentTotal + size > LIMITS.maxTotalSize) {
    return storageLimit(
      c,
      `Total storage would exceed ${formatMb(LIMITS.maxTotalSize)} (using ${formatMb(currentTotal)})`,
    )
  }

  const path = `${collectionPath}/${generateDocId()}`
  const accessMode = parsed.data.access_mode
  const accessSecret = accessMode !== 'public' ? crypto.randomUUID() : null

  const doc = await upsertDocument(
    path,
    auth.user.id,
    content,
    accessMode,
    accessSecret,
    size,
    scope.projectId,
  )

  return c.json(
    {
      id: doc.id,
      path: doc.path,
      access_mode: doc.access_mode,
      access_secret: doc.access_secret,
      version: doc.version,
      size_bytes: doc.size_bytes,
      created_at: doc.created_at,
      updated_at: doc.updated_at,
      message: accessSecret
        ? 'Store the access_secret now. It will not be shown again.'
        : undefined,
    },
    201,
  )
}

export async function handleDeleteDoc(c: Context): Promise<Response> {
  const auth = c.get('auth')
  if (!auth.user) {
    return unauthenticated(c)
  }

  if (auth.tokenPermissions && !['write', 'read_write', 'admin'].includes(auth.tokenPermissions)) {
    return forbidden(c)
  }

  const id = c.req.param('path')!

  const doc = await getDocument(id)
  if (!doc) {
    return notFound(c, 'Document not found')
  }

  if (auth.user.id !== doc.user_id) {
    return forbidden(c)
  }

  const ifMatch = parseIfMatch(c)
  if (!checkIfMatch(doc.version, ifMatch)) {
    return conflict(c, 'Version conflict', { expected: ifMatch, actual: doc.version })
  }

  const deleted = await deleteDocument(id, auth.user.id)
  if (!deleted) {
    return serverError(c, 'Delete failed')
  }

  return c.json({ deleted: true })
}

export async function handleDeleteByPath(c: Context): Promise<Response> {
  const auth = c.get('auth')
  if (!auth.user) {
    return unauthenticated(c)
  }

  if (auth.tokenPermissions && !['write', 'read_write', 'admin'].includes(auth.tokenPermissions)) {
    return forbidden(c)
  }

  const path = c.req.query('path')
  if (!path) {
    return badRequest(c, 'Missing ?path= query')
  }

  const scope = await resolveScope(c, auth)
  if (scope instanceof Response) return scope
  if (scope.ownerId !== auth.user.id) {
    return forbidden(c)
  }

  const ifMatch = parseIfMatch(c)
  if (ifMatch !== undefined) {
    const existing = await getDocumentByScopeAndPath(
      { projectId: scope.projectId, userId: scope.ownerId },
      path,
    )
    if (!existing) {
      return notFound(c, 'Document not found')
    }
    if (!checkIfMatch(existing.version, ifMatch)) {
      return conflict(c, 'Version conflict', { expected: ifMatch, actual: existing.version })
    }
  }

  const deleted = await deleteDocumentByScopeAndPath(
    { projectId: scope.projectId, userId: scope.ownerId },
    path,
  )
  if (!deleted) {
    return notFound(c, 'Document not found')
  }

  return c.json({ deleted: true })
}
