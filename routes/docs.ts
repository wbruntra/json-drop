import type { Context } from 'hono'
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
import { pathSchema, upsertDocSchema, formatZodError } from '../schemas'

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

async function handleSecretUpsert(
  c: Context,
  auth: AuthContext,
  path: string,
  secret: string,
  content: string,
  size: number,
): Promise<Response> {
  const doc = await getDocumentByPathAndSecret(path, secret)
  if (!doc) {
    return c.json({ error: 'Document not found' }, 404)
  }

  if (!canWrite(auth, doc, secret)) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const currentTotal = await getUserTotalSize(doc.user_id)
  if (currentTotal - doc.size_bytes + size > LIMITS.maxTotalSize) {
    return c.json(
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

  return c.json({
    id: updated.id,
    path: updated.path,
    access_mode: updated.access_mode,
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
    return c.json({ error: formatZodError(pathResult.error) }, 400)
  }

  const secret = c.req.query('secret') ?? null
  if (!auth.user && !secret) {
    return c.json({ error: 'Not authenticated' }, 401)
  }

  if (
    auth.user &&
    auth.tokenPermissions &&
    !['write', 'read_write', 'admin'].includes(auth.tokenPermissions)
  ) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const rawBody = await c.req.json()
  const parsed = upsertDocSchema.safeParse(rawBody)
  if (!parsed.success) {
    return c.json({ error: formatZodError(parsed.error) }, 400)
  }

  const content = JSON.stringify(parsed.data.content)

  const size = contentSize(content)
  if (size > LIMITS.maxDocSize) {
    return c.json({ error: `Document exceeds max size of ${formatMb(LIMITS.maxDocSize)}` }, 413)
  }

  if (!auth.user) {
    return handleSecretUpsert(c, auth, path, secret!, content, size)
  }

  const accessMode = parsed.data.access_mode

  const existingDoc = await getDocumentByPath(path, auth.user.id)
  const currentTotal = await getUserTotalSize(auth.user.id)
  const sizeDiff = existingDoc ? size - existingDoc.size_bytes : size
  if (currentTotal + sizeDiff > LIMITS.maxTotalSize) {
    return c.json(
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

  return c.json(
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

export async function handleListDocs(c: Context): Promise<Response> {
  const auth = c.get('auth')
  if (!auth.user) {
    return c.json({ error: 'Not authenticated' }, 401)
  }

  if (auth.tokenPermissions && !['read', 'read_write', 'admin'].includes(auth.tokenPermissions)) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const prefix = c.req.query('prefix') || undefined

  const docs = await listDocuments(auth.user.id, prefix)
  const total = await getUserTotalSize(auth.user.id)

  return c.json({
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

export async function handleGetDoc(c: Context): Promise<Response> {
  const auth = c.get('auth')
  const id = c.req.param('path')!

  const doc = await getDocument(id)
  if (!doc) {
    return c.json({ error: 'Document not found' }, 404)
  }

  const secret = c.req.query('secret') ?? null

  if (!canRead(auth, doc, secret)) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  return c.json({
    id: doc.id,
    path: doc.path,
    access_mode: doc.access_mode,
    content: JSON.parse(doc.content),
    size_bytes: doc.size_bytes,
    created_at: doc.created_at,
    updated_at: doc.updated_at,
  })
}

export async function handleDeleteDoc(c: Context): Promise<Response> {
  const auth = c.get('auth')
  if (!auth.user) {
    return c.json({ error: 'Not authenticated' }, 401)
  }

  if (auth.tokenPermissions && !['write', 'read_write', 'admin'].includes(auth.tokenPermissions)) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const id = c.req.param('path')!

  const doc = await getDocument(id)
  if (!doc) {
    return c.json({ error: 'Document not found' }, 404)
  }

  if (auth.user.id !== doc.user_id) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const deleted = await deleteDocument(id, auth.user.id)
  if (!deleted) {
    return c.json({ error: 'Delete failed' }, 500)
  }

  return c.json({ deleted: true })
}
