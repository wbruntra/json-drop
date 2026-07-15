import type { Context } from 'hono'
import {
  upsertDocumentInWorkspace,
  getDocumentByWorkspaceId,
  listDocumentsByWorkspace,
  getWorkspaceTotalSize,
  deleteDocumentByWorkspaceId,
  generateDocId,
} from '../services/documents'
import { pathSchema, upsertDocSchema, formatZodError } from '../schemas'
import { badRequest, notFound, conflict, storageLimit } from './errors'
import { requireWorkspacePermission, isResponse } from './workspaceAuth'

function contentSize(content: string): number {
  return new TextEncoder().encode(content).byteLength
}

function formatMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// Reuse the legacy per-doc size cap; workspace total storage uses the same
// per-scope budget the legacy per-user limit uses (LIMITS.maxTotalSize),
// just keyed by workspace instead of by user.
const LIMITS = { maxDocSize: 1 * 1024 * 1024, maxTotalSize: 10 * 1024 * 1024 }

function docPayload(d: {
  id: string
  path: string
  content: string
  size_bytes: number
  version: number
  created_at: string
  updated_at: string
}) {
  return {
    id: d.id,
    path: d.path,
    content: JSON.parse(d.content),
    size_bytes: d.size_bytes,
    version: d.version,
    created_at: d.created_at,
    updated_at: d.updated_at,
  }
}

function parseIfMatch(c: Context): number | undefined {
  const header = c.req.header('If-Match')
  if (!header) return undefined
  const n = parseInt(header.trim(), 10)
  return isNaN(n) ? undefined : n
}

function checkIfMatch(actual: number | undefined, expected: number | undefined): boolean {
  if (expected === undefined) return true
  return actual !== undefined && actual === expected
}

export async function handleListWorkspaceDocs(c: Context): Promise<Response> {
  const auth = c.get('auth')
  const workspaceId = c.req.param('id')!

  const permCheck = await requireWorkspacePermission(c, auth, workspaceId, 'documents.read')
  if (isResponse(permCheck)) return permCheck

  const prefix = c.req.query('prefix') || undefined
  const docs = await listDocumentsByWorkspace(workspaceId, { prefix })
  const total = await getWorkspaceTotalSize(workspaceId)

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

export async function handleCreateWorkspaceDoc(c: Context): Promise<Response> {
  const auth = c.get('auth')
  const workspaceId = c.req.param('id')!
  const collectionPath = c.req.param('collection')!

  const permCheck = await requireWorkspacePermission(c, auth, workspaceId, 'documents.write')
  if (isResponse(permCheck)) return permCheck

  const pathResult = pathSchema.safeParse(collectionPath)
  if (!pathResult.success) return badRequest(c, formatZodError(pathResult.error))

  const rawBody = await c.req.json()
  const parsed = upsertDocSchema.safeParse(rawBody)
  if (!parsed.success) return badRequest(c, formatZodError(parsed.error))

  const content = JSON.stringify(parsed.data.content)
  const size = contentSize(content)
  if (size > LIMITS.maxDocSize) {
    return storageLimit(c, `Document exceeds max size of ${formatMb(LIMITS.maxDocSize)}`)
  }

  const currentTotal = await getWorkspaceTotalSize(workspaceId)
  if (currentTotal + size > LIMITS.maxTotalSize) {
    return storageLimit(
      c,
      `Workspace storage would exceed ${formatMb(LIMITS.maxTotalSize)} (using ${formatMb(currentTotal)})`,
    )
  }

  const path = `${collectionPath}/${generateDocId()}`
  const doc = await upsertDocumentInWorkspace(path, workspaceId, auth.user!.id, content, size)

  return c.json(
    {
      id: doc.id,
      path: doc.path,
      version: doc.version,
      size_bytes: doc.size_bytes,
      created_at: doc.created_at,
      updated_at: doc.updated_at,
    },
    201,
  )
}

export async function handleGetWorkspaceDoc(c: Context): Promise<Response> {
  const auth = c.get('auth')
  const workspaceId = c.req.param('id')!
  const docId = c.req.param('docId')!

  const permCheck = await requireWorkspacePermission(c, auth, workspaceId, 'documents.read')
  if (isResponse(permCheck)) return permCheck

  const doc = await getDocumentByWorkspaceId(workspaceId, docId)
  if (!doc) return notFound(c, 'Document not found')

  return c.json(docPayload(doc))
}

export async function handleSetWorkspaceDoc(c: Context): Promise<Response> {
  const auth = c.get('auth')
  const workspaceId = c.req.param('id')!
  const docId = c.req.param('docId')!

  const permCheck = await requireWorkspacePermission(c, auth, workspaceId, 'documents.write')
  if (isResponse(permCheck)) return permCheck

  const existing = await getDocumentByWorkspaceId(workspaceId, docId)
  if (!existing) return notFound(c, 'Document not found')

  const rawBody = await c.req.json()
  const parsed = upsertDocSchema.safeParse(rawBody)
  if (!parsed.success) return badRequest(c, formatZodError(parsed.error))

  const content = JSON.stringify(parsed.data.content)
  const size = contentSize(content)
  if (size > LIMITS.maxDocSize) {
    return storageLimit(c, `Document exceeds max size of ${formatMb(LIMITS.maxDocSize)}`)
  }

  const ifMatch = parseIfMatch(c)
  if (!checkIfMatch(existing.version, ifMatch)) {
    return conflict(c, 'Version conflict', { expected: ifMatch, actual: existing.version })
  }

  const currentTotal = await getWorkspaceTotalSize(workspaceId)
  if (currentTotal - existing.size_bytes + size > LIMITS.maxTotalSize) {
    return storageLimit(
      c,
      `Workspace storage would exceed ${formatMb(LIMITS.maxTotalSize)} (using ${formatMb(currentTotal)})`,
    )
  }

  const doc = await upsertDocumentInWorkspace(
    existing.path,
    workspaceId,
    auth.user!.id,
    content,
    size,
  )

  return c.json({
    id: doc.id,
    path: doc.path,
    version: doc.version,
    size_bytes: doc.size_bytes,
    created_at: doc.created_at,
    updated_at: doc.updated_at,
  })
}

export async function handleDeleteWorkspaceDoc(c: Context): Promise<Response> {
  const auth = c.get('auth')
  const workspaceId = c.req.param('id')!
  const docId = c.req.param('docId')!

  const permCheck = await requireWorkspacePermission(c, auth, workspaceId, 'documents.delete')
  if (isResponse(permCheck)) return permCheck

  const existing = await getDocumentByWorkspaceId(workspaceId, docId)
  if (!existing) return notFound(c, 'Document not found')

  const ifMatch = parseIfMatch(c)
  if (!checkIfMatch(existing.version, ifMatch)) {
    return conflict(c, 'Version conflict', { expected: ifMatch, actual: existing.version })
  }

  const deleted = await deleteDocumentByWorkspaceId(workspaceId, docId)
  if (!deleted) return notFound(c, 'Document not found')

  return c.json({ deleted: true })
}
