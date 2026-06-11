import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import { runMigrations } from './migrate'

const TEST_DB_PATH = 'test.sqlite'

process.env.DATABASE_URL = TEST_DB_PATH
process.env.SESSION_SECRET = 'test-secret-key'
process.env.GITHUB_CLIENT_ID = 'test-client-id'
process.env.GITHUB_CLIENT_SECRET = 'test-client-secret'
process.env.FRONTEND_URL = 'http://localhost:5173'

import { hashToken, generateToken } from './middleware'
import { createUser, createApiToken, createDocument, getDb } from './database'
import { LIMITS } from './limits'

let server: ReturnType<typeof Bun.serve>
let baseUrl: string
let adminToken: string
let userRecord: { id: number }
let readToken: string

beforeAll(async () => {
  const testDb = new Database(TEST_DB_PATH, { create: true })
  await runMigrations(testDb)
  testDb.close()

  const user = createUser('github-123', 'test@example.com', 'Test User')
  userRecord = user

  adminToken = generateToken()
  createApiToken(user.id, 'Admin Token', hashToken(adminToken), 'admin')

  readToken = generateToken()
  createApiToken(user.id, 'Read Token', hashToken(readToken), 'read')

  server = Bun.serve({
    port: 0,
    routes: {
      '/api/me': (req) => {
        const { extractAuth } = require('./middleware')
        const auth = extractAuth(req)
        if (!auth.user) {
          return new Response(JSON.stringify({ error: 'Not authenticated' }), { status: 401 })
        }
        return new Response(
          JSON.stringify({
            id: auth.user.id,
            github_id: auth.user.github_id,
            email: auth.user.email,
            display_name: auth.user.display_name,
          }),
          { status: 200 },
        )
      },
      '/api/tokens': async (req) => {
        const { extractAuth } = require('./middleware')
        const { handleCreateToken, handleListTokens } = require('./routes/tokens')
        const auth = extractAuth(req)
        if (req.method === 'POST') return handleCreateToken(req, auth)
        if (req.method === 'GET') return handleListTokens(auth)
        return new Response('Method not allowed', { status: 405 })
      },
      '/api/tokens/:id': async (req) => {
        const { extractAuth } = require('./middleware')
        const { handleDeleteToken } = require('./routes/tokens')
        const auth = extractAuth(req)
        if (req.method === 'DELETE') return handleDeleteToken(req, auth, req.params.id)
        return new Response('Method not allowed', { status: 405 })
      },
      '/api/docs': async (req) => {
        const { extractAuth } = require('./middleware')
        const { handleCreateDoc, handleListDocs } = require('./routes/docs')
        const auth = extractAuth(req)
        if (req.method === 'POST') return handleCreateDoc(req, auth)
        if (req.method === 'GET') return handleListDocs(auth)
        return new Response('Method not allowed', { status: 405 })
      },
      '/api/docs/:id': async (req) => {
        const { extractAuth } = require('./middleware')
        const { handleGetDoc, handleUpdateDoc, handleDeleteDoc } = require('./routes/docs')
        const auth = extractAuth(req)
        if (req.method === 'GET') return handleGetDoc(req, auth, req.params.id)
        if (req.method === 'PUT') return handleUpdateDoc(req, auth, req.params.id)
        if (req.method === 'DELETE') return handleDeleteDoc(req, auth, req.params.id)
        return new Response('Method not allowed', { status: 405 })
      },
    },
  })

  baseUrl = `http://localhost:${server.port}`
})

afterAll(() => {
  server.stop()
  try {
    Bun.file(TEST_DB_PATH).delete()
    Bun.file(`${TEST_DB_PATH}-wal`).delete()
    Bun.file(`${TEST_DB_PATH}-shm`).delete()
  } catch {}
})

beforeEach(() => {
  const db = getDb()
  db.run('DELETE FROM documents')
  db.run('DELETE FROM api_tokens')
  adminToken = generateToken()
  createApiToken(userRecord.id, 'Admin Token', hashToken(adminToken), 'admin')
  readToken = generateToken()
  createApiToken(userRecord.id, 'Read Token', hashToken(readToken), 'read')
})

function authHeader(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` }
}

function makeDoc(name: string, content: unknown, mode = 'public', secret: string | null = null) {
  const json = JSON.stringify(content)
  const size = new TextEncoder().encode(json).byteLength
  return { name, content: json, access_mode: mode, size_bytes: size }
}

describe('Authentication', () => {
  test('GET /api/me returns 401 without auth', async () => {
    const res = await fetch(`${baseUrl}/api/me`)
    expect(res.status).toBe(401)
    const data = await res.json()
    expect(data.error).toBe('Not authenticated')
  })

  test('GET /api/me returns user with valid token', async () => {
    const res = await fetch(`${baseUrl}/api/me`, { headers: authHeader(adminToken) })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.id).toBe(userRecord.id)
    expect(data.github_id).toBe('github-123')
    expect(data.email).toBe('test@example.com')
  })
})

describe('API Tokens', () => {
  test('POST /api/tokens creates a new token with admin token', async () => {
    const res = await fetch(`${baseUrl}/api/tokens`, {
      method: 'POST',
      headers: { ...authHeader(adminToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'My Token', permissions: 'read_write' }),
    })

    expect(res.status).toBe(201)
    const data = await res.json()
    expect(data.token).toBeDefined()
    expect(data.token).toMatch(/^jd_/)
  })

  test('POST /api/tokens rejects with non-admin token', async () => {
    const res = await fetch(`${baseUrl}/api/tokens`, {
      method: 'POST',
      headers: { ...authHeader(readToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New Token', permissions: 'read' }),
    })
    expect(res.status).toBe(401)
  })

  test('GET /api/tokens lists user tokens', async () => {
    const res = await fetch(`${baseUrl}/api/tokens`, { headers: authHeader(adminToken) })
    expect(res.status).toBe(200)
    const data = await res.json()
    const names = data.map((t: { name: string }) => t.name)
    expect(names).toContain('Admin Token')
    expect(names).toContain('Read Token')
  })

  test('DELETE /api/tokens/:id revokes a token', async () => {
    const tok = generateToken()
    const record = createApiToken(userRecord.id, 'To Delete', hashToken(tok), 'read')

    const res = await fetch(`${baseUrl}/api/tokens/${record.id}`, {
      method: 'DELETE',
      headers: authHeader(adminToken),
    })

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.deleted).toBe(true)
  })
})

describe('Documents', () => {
  test('POST /api/docs creates a public document', async () => {
    const res = await fetch(`${baseUrl}/api/docs`, {
      method: 'POST',
      headers: { ...authHeader(adminToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test Doc', content: { foo: 'bar' } }),
    })

    expect(res.status).toBe(201)
    const data = await res.json()
    expect(data.id).toBeDefined()
    expect(data.access_mode).toBe('public')
    expect(data.size_bytes).toBeGreaterThan(0)
  })

  test('POST /api/docs creates a private document with secret', async () => {
    const res = await fetch(`${baseUrl}/api/docs`, {
      method: 'POST',
      headers: { ...authHeader(adminToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Private Doc',
        content: { secret: 'data' },
        access_mode: 'private',
      }),
    })

    expect(res.status).toBe(201)
    const data = await res.json()
    expect(data.access_mode).toBe('private')
    expect(data.access_secret).toBeDefined()
  })

  test('GET /api/docs lists user documents with storage info', async () => {
    const res = await fetch(`${baseUrl}/api/docs`, { headers: authHeader(adminToken) })

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.docs).toBeDefined()
    expect(data.storage).toBeDefined()
    expect(data.storage.used_bytes).toBe(0)
    expect(data.storage.limit).toBeDefined()
  })

  test('GET /api/docs/:id returns public document without auth', async () => {
    createDocument('pub-a', userRecord.id, 'Public', '{"x":1}', 'public', null, 9)

    const res = await fetch(`${baseUrl}/api/docs/pub-a`)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.id).toBe('pub-a')
    expect(data.content.x).toBe(1)
  })

  test('GET /api/docs/:id returns 403 for private doc without secret', async () => {
    createDocument('priv-a', userRecord.id, 'Private', '{"y":1}', 'private', 'sec123', 9)

    const res = await fetch(`${baseUrl}/api/docs/priv-a`)
    expect(res.status).toBe(403)
  })

  test('GET /api/docs/:id returns private doc with correct secret', async () => {
    createDocument('priv-b', userRecord.id, 'Private', '{"z":1}', 'private', 'sec456', 9)

    const res = await fetch(`${baseUrl}/api/docs/priv-b?secret=sec456`)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.content.z).toBe(1)
  })

  test('PUT /api/docs/:id updates document as owner', async () => {
    createDocument('upd-a', userRecord.id, 'Original', '{"v":1}', 'public', null, 9)

    const res = await fetch(`${baseUrl}/api/docs/upd-a`, {
      method: 'PUT',
      headers: { ...authHeader(adminToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Updated', content: { v: 2 } }),
    })

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.name).toBe('Updated')
    expect(data.content.v).toBe(2)
  })

  test('PUT /api/docs/:id updates with secret for private doc', async () => {
    createDocument('upd-s', userRecord.id, 'Secret', '{"v":1}', 'private', 'sec789', 9)

    const res = await fetch(`${baseUrl}/api/docs/upd-s?secret=sec789`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: { v: 2 } }),
    })

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.content.v).toBe(2)
  })

  test('DELETE /api/docs/:id deletes document as owner', async () => {
    createDocument('del-a', userRecord.id, 'Delete Me', '{}', 'public', null, 2)

    const res = await fetch(`${baseUrl}/api/docs/del-a`, {
      method: 'DELETE',
      headers: authHeader(adminToken),
    })

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.deleted).toBe(true)

    const getRes = await fetch(`${baseUrl}/api/docs/del-a`)
    expect(getRes.status).toBe(404)
  })

  test('Document access modes work correctly', async () => {
    createDocument('am-public', userRecord.id, 'Pub', '{"mode":"pub"}', 'public', null, 17)
    createDocument(
      'am-prs',
      userRecord.id,
      'PRS',
      '{"mode":"prs"}',
      'public_read_secret_write',
      'prs-sec',
      16,
    )
    createDocument(
      'am-private',
      userRecord.id,
      'Priv',
      '{"mode":"priv"}',
      'private',
      'priv-sec',
      17,
    )

    const pubRes = await fetch(`${baseUrl}/api/docs/am-public`)
    expect(pubRes.status).toBe(200)

    const prsRead = await fetch(`${baseUrl}/api/docs/am-prs`)
    expect(prsRead.status).toBe(200)

    const prsWrite = await fetch(`${baseUrl}/api/docs/am-prs?secret=prs-sec`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: { updated: true } }),
    })
    expect(prsWrite.status).toBe(200)

    const privRead = await fetch(`${baseUrl}/api/docs/am-private`)
    expect(privRead.status).toBe(403)

    const privReadSecret = await fetch(`${baseUrl}/api/docs/am-private?secret=priv-sec`)
    expect(privReadSecret.status).toBe(200)
  })

  test('Rejects document larger than 1MB', async () => {
    const big = 'x'.repeat(LIMITS.maxDocSize)
    const content = JSON.stringify({ data: big })

    const res = await fetch(`${baseUrl}/api/docs`, {
      method: 'POST',
      headers: { ...authHeader(adminToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Too Big', content: { data: big } }),
    })

    expect(res.status).toBe(413)
    const data = await res.json()
    expect(data.error).toContain('max size')
  })

  test('Rejects when total storage would exceed 10MB', async () => {
    // Fill up with 1MB docs until next one would overflow
    const docBody = { data: 'x'.repeat(LIMITS.maxDocSize - 30) }
    const docSize = new TextEncoder().encode(JSON.stringify(docBody)).byteLength

    // Create enough so that one more would exceed total
    const docsNeeded = Math.ceil(LIMITS.maxTotalSize / docSize) + 1
    for (let i = 0; i < docsNeeded; i++) {
      createDocument(
        `fill-${i}`,
        userRecord.id,
        `Fill ${i}`,
        JSON.stringify(docBody),
        'public',
        null,
        docSize,
      )
    }

    // Next document should be rejected
    const res = await fetch(`${baseUrl}/api/docs`, {
      method: 'POST',
      headers: { ...authHeader(adminToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Overflow', content: { x: 'y' } }),
    })

    expect(res.status).toBe(413)
    const data = await res.json()
    expect(data.error).toContain('Total storage')
  })
})
