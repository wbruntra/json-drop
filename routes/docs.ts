import { jsonResponse } from '../middleware'
import {
  upsertDocument,
  getDocument,
  getDocumentByPath,
  getDocumentByPathAndSecret,
  listDocuments,
  deleteDocument,
  getUserTotalSize,
} from '../services'
import type { AuthContext } from '../services/auth'
import { LIMITS } from '../limits'

const PATH_SEGMENT_REGEX = /^[a-zA-Z0-9_-]+$/

function validatePath(path: string): { valid: boolean; error?: string } {
  if (!path) {
    return { valid: false, error: 'Path is required' }
  }
  if (path.startsWith('/') || path.endsWith('/')) {
    return { valid: false, error: 'Path must not start or end with /' }
  }
  if (path.includes('//')) {
    return { valid: false, error: 'Path must not contain empty segments' }
  }
  const segments = path.split('/')
  for (const segment of segments) {
    if (!PATH_SEGMENT_REGEX.test(segment)) {
      return {
        valid: false,
        error: `Invalid path segment "${segment}". Only alphanumeric, hyphens, and underscores allowed.`,
      }
    }
  }
  return { valid: true }
}

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
    if (auth.user?.id === doc.user_id) return true
    if (auth.tokenPermissions && ['read', 'read_write', 'admin'].includes(auth.tokenPermissions))
      return true
    if (secret && doc.access_secret && secret === doc.access_secret) return true
  }
  return false
}

function canWrite(
  auth: AuthContext,
  doc: { user_id: number; access_mode: string; access_secret: string | null },
  secret: string | null,
): boolean {
  if (auth.user?.id === doc.user_id) return true
  if (auth.tokenPermissions && ['write', 'read_write', 'admin'].includes(auth.tokenPermissions))
    return true
  if (['public_read_secret_write', 'private'].includes(doc.access_mode)) {
    if (secret && doc.access_secret && secret === doc.access_secret) return true
  }
  return false
}

function formatMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// Unauthenticated write using an access secret. Only updates content on an
// existing document — the owner, access mode, and secret stay unchanged.
async function handleSecretUpsert(
  auth: AuthContext,
  path: string,
  secret: string,
  content: string,
  size: number,
): Promise<Response> {
  const doc = await getDocumentByPathAndSecret(path, secret)
  if (!doc) {
    return jsonResponse({ error: 'Document not found' }, 404)
  }

  if (!canWrite(auth, doc, secret)) {
    return jsonResponse({ error: 'Forbidden' }, 403)
  }

  const currentTotal = await getUserTotalSize(doc.user_id)
  if (currentTotal - doc.size_bytes + size > LIMITS.maxTotalSize) {
    return jsonResponse(
      {
        error: `Total storage would exceed ${formatMb(LIMITS.maxTotalSize)} (using ${formatMb(currentTotal)})`,
      },
      413,
    )
  }

  const updated = await upsertDocument(
    doc.path,
    doc.user_id,
    content,
    doc.access_mode,
    doc.access_secret,
    size,
  )

  return jsonResponse({
    id: updated.id,
    path: updated.path,
    access_mode: updated.access_mode,
    size_bytes: updated.size_bytes,
    created_at: updated.created_at,
    updated_at: updated.updated_at,
  })
}

export async function handleUpsertDoc(
  req: Request,
  auth: AuthContext,
  path: string,
): Promise<Response> {
  const pathCheck = validatePath(path)
  if (!pathCheck.valid) {
    return jsonResponse({ error: pathCheck.error }, 400)
  }

  const secret = new URL(req.url).searchParams.get('secret')
  if (!auth.user && !secret) {
    return jsonResponse({ error: 'Not authenticated' }, 401)
  }

  const body = (await req.json()) as { content?: unknown; access_mode?: string }
  const content = body.content !== undefined ? JSON.stringify(body.content) : '{}'

  const size = contentSize(content)
  if (size > LIMITS.maxDocSize) {
    return jsonResponse(
      {
        error: `Document exceeds max size of ${formatMb(LIMITS.maxDocSize)}`,
      },
      413,
    )
  }

  if (!auth.user) {
    return handleSecretUpsert(auth, path, secret!, content, size)
  }

  const accessMode = body.access_mode || 'public'

  if (!['public', 'public_read_secret_write', 'private'].includes(accessMode)) {
    return jsonResponse({ error: 'Invalid access_mode' }, 400)
  }

  const existingDoc = await getDocumentByPath(path, auth.user.id)
  const currentTotal = await getUserTotalSize(auth.user.id)
  const sizeDiff = existingDoc ? size - existingDoc.size_bytes : size
  if (currentTotal + sizeDiff > LIMITS.maxTotalSize) {
    return jsonResponse(
      {
        error: `Total storage would exceed ${formatMb(LIMITS.maxTotalSize)} (using ${formatMb(currentTotal)})`,
      },
      413,
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

  const doc = await upsertDocument(path, auth.user.id, content, accessMode, accessSecret, size)

  return jsonResponse(
    {
      id: doc.id,
      path: doc.path,
      access_mode: doc.access_mode,
      access_secret: doc.access_secret,
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

export async function handleListDocs(req: Request, auth: AuthContext): Promise<Response> {
  if (!auth.user) {
    return jsonResponse({ error: 'Not authenticated' }, 401)
  }

  const url = new URL(req.url)
  const prefix = url.searchParams.get('prefix') || undefined

  const docs = await listDocuments(auth.user.id, prefix)
  const total = await getUserTotalSize(auth.user.id)

  return jsonResponse({
    prefix: prefix || null,
    docs: docs.map((d) => ({
      id: d.id,
      path: d.path,
      access_mode: d.access_mode,
      content: JSON.parse(d.content),
      size_bytes: d.size_bytes,
      created_at: d.created_at,
      updated_at: d.updated_at,
    })),
    storage: {
      used_bytes: total,
      used: formatMb(total),
      limit: formatMb(LIMITS.maxTotalSize),
    },
  })
}

export async function handleGetDoc(
  req: Request,
  auth: AuthContext,
  id: string,
): Promise<Response> {
  const doc = await getDocument(id)
  if (!doc) {
    return jsonResponse({ error: 'Document not found' }, 404)
  }

  const url = new URL(req.url)
  const secret = url.searchParams.get('secret')

  if (!canRead(auth, doc, secret)) {
    return jsonResponse({ error: 'Forbidden' }, 403)
  }

  return jsonResponse({
    id: doc.id,
    path: doc.path,
    access_mode: doc.access_mode,
    content: JSON.parse(doc.content),
    size_bytes: doc.size_bytes,
    created_at: doc.created_at,
    updated_at: doc.updated_at,
  })
}

export async function handleDeleteDoc(
  req: Request,
  auth: AuthContext,
  id: string,
): Promise<Response> {
  if (!auth.user) {
    return jsonResponse({ error: 'Not authenticated' }, 401)
  }

  const doc = await getDocument(id)
  if (!doc) {
    return jsonResponse({ error: 'Document not found' }, 404)
  }

  if (auth.user.id !== doc.user_id && auth.tokenPermissions !== 'admin') {
    return jsonResponse({ error: 'Forbidden' }, 403)
  }

  const deleted = await deleteDocument(id, auth.user.id)
  if (!deleted) {
    return jsonResponse({ error: 'Delete failed' }, 500)
  }

  return jsonResponse({ deleted: true })
}
