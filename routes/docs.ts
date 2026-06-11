import short from 'short-uuid'
import { jsonResponse } from '../middleware'
import {
  createDocument,
  getDocument,
  listDocuments,
  updateDocument,
  deleteDocument,
  getUserTotalSize,
} from '../database'
import type { AuthContext } from '../middleware'
import { LIMITS } from '../limits'

const translator = short.createTranslator()

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

export async function handleCreateDoc(req: Request, auth: AuthContext): Promise<Response> {
  if (!auth.user) {
    return jsonResponse({ error: 'Not authenticated' }, 401)
  }

  const body = (await req.json()) as { name?: string; content?: unknown; access_mode?: string }
  const name = body.name || 'Untitled'
  const content = body.content !== undefined ? JSON.stringify(body.content) : '{}'
  const accessMode = body.access_mode || 'public'

  if (!['public', 'public_read_secret_write', 'private'].includes(accessMode)) {
    return jsonResponse({ error: 'Invalid access_mode' }, 400)
  }

  const size = contentSize(content)
  if (size > LIMITS.maxDocSize) {
    return jsonResponse(
      {
        error: `Document exceeds max size of ${formatMb(LIMITS.maxDocSize)}`,
      },
      413,
    )
  }

  const currentTotal = getUserTotalSize(auth.user.id)
  if (currentTotal + size > LIMITS.maxTotalSize) {
    return jsonResponse(
      {
        error: `Total storage would exceed ${formatMb(LIMITS.maxTotalSize)} (using ${formatMb(currentTotal)})`,
      },
      413,
    )
  }

  const accessSecret = accessMode !== 'public' ? crypto.randomUUID() : null
  const id = translator.generate()

  const doc = createDocument(id, auth.user.id, name, content, accessMode, accessSecret, size)

  return jsonResponse(
    {
      id: doc.id,
      name: doc.name,
      access_mode: doc.access_mode,
      access_secret: doc.access_secret,
      size_bytes: doc.size_bytes,
      created_at: doc.created_at,
      message: accessSecret
        ? 'Store the access_secret now. It will not be shown again.'
        : undefined,
    },
    201,
  )
}

export function handleListDocs(auth: AuthContext): Response {
  if (!auth.user) {
    return jsonResponse({ error: 'Not authenticated' }, 401)
  }

  const docs = listDocuments(auth.user.id)
  const total = getUserTotalSize(auth.user.id)

  return jsonResponse({
    docs: docs.map((d) => ({
      id: d.id,
      name: d.name,
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
  docId: string,
): Promise<Response> {
  const doc = getDocument(docId)
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
    name: doc.name,
    access_mode: doc.access_mode,
    content: JSON.parse(doc.content),
    size_bytes: doc.size_bytes,
    created_at: doc.created_at,
    updated_at: doc.updated_at,
  })
}

export async function handleUpdateDoc(
  req: Request,
  auth: AuthContext,
  docId: string,
): Promise<Response> {
  const doc = getDocument(docId)
  if (!doc) {
    return jsonResponse({ error: 'Document not found' }, 404)
  }

  const url = new URL(req.url)
  const secret = url.searchParams.get('secret')

  if (!canWrite(auth, doc, secret)) {
    return jsonResponse({ error: 'Forbidden' }, 403)
  }

  const body = (await req.json()) as { name?: string; content?: unknown; access_mode?: string }
  const name = body.name ?? doc.name
  const content = body.content !== undefined ? JSON.stringify(body.content) : doc.content
  const accessMode = body.access_mode ?? doc.access_mode

  if (!['public', 'public_read_secret_write', 'private'].includes(accessMode)) {
    return jsonResponse({ error: 'Invalid access_mode' }, 400)
  }

  const size = contentSize(content)
  if (size > LIMITS.maxDocSize) {
    return jsonResponse(
      {
        error: `Document exceeds max size of ${formatMb(LIMITS.maxDocSize)}`,
      },
      413,
    )
  }

  const currentTotal = getUserTotalSize(doc.user_id)
  const sizeDiff = size - doc.size_bytes
  if (currentTotal + sizeDiff > LIMITS.maxTotalSize) {
    return jsonResponse(
      {
        error: `Total storage would exceed ${formatMb(LIMITS.maxTotalSize)} (using ${formatMb(currentTotal)})`,
      },
      413,
    )
  }

  let accessSecret = doc.access_secret
  if (accessMode !== doc.access_mode) {
    accessSecret = accessMode !== 'public' ? doc.access_secret || crypto.randomUUID() : null
  }

  const updated = updateDocument(docId, doc.user_id, name, content, accessMode, accessSecret, size)
  if (!updated) {
    return jsonResponse({ error: 'Update failed' }, 500)
  }

  return jsonResponse({
    id: updated.id,
    name: updated.name,
    access_mode: updated.access_mode,
    access_secret: updated.access_secret,
    content: JSON.parse(updated.content),
    size_bytes: updated.size_bytes,
    updated_at: updated.updated_at,
  })
}

export async function handleDeleteDoc(
  req: Request,
  auth: AuthContext,
  docId: string,
): Promise<Response> {
  if (!auth.user) {
    return jsonResponse({ error: 'Not authenticated' }, 401)
  }

  const doc = getDocument(docId)
  if (!doc) {
    return jsonResponse({ error: 'Document not found' }, 404)
  }

  if (auth.user.id !== doc.user_id && auth.tokenPermissions !== 'admin') {
    return jsonResponse({ error: 'Forbidden' }, 403)
  }

  const deleted = deleteDocument(docId, auth.user.id)
  if (!deleted) {
    return jsonResponse({ error: 'Delete failed' }, 500)
  }

  return jsonResponse({ deleted: true })
}
