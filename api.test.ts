import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'bun:test'
import { createServer } from './server'
import { generateToken } from './middleware'
import { initDatabase, createUser, createApiToken, upsertDocument } from './database'
import { LIMITS } from './limits'

let server: ReturnType<typeof createServer>
let baseUrl: string
let adminToken: string
let readToken: string
let userRecord: { id: number }

beforeAll(() => {
  server = createServer({ port: 0 })
  baseUrl = `http://localhost:${server.port}`
})

afterAll(() => {
  server.stop()
})

beforeEach(async () => {
  await initDatabase(':memory:', { silent: true })

  userRecord = createUser('github-123', 'test@example.com', 'Test User')

  adminToken = generateToken()
  createApiToken(userRecord.id, 'Admin Token', adminToken, 'admin')

  readToken = generateToken()
  createApiToken(userRecord.id, 'Read Token', readToken, 'read')
})

function authHeader(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` }
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
    const record = createApiToken(userRecord.id, 'To Delete', tok, 'read')

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
  test('PUT /api/docs/{path} creates a public document', async () => {
    const res = await fetch(`${baseUrl}/api/docs/test-doc`, {
      method: 'PUT',
      headers: { ...authHeader(adminToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: { foo: 'bar' } }),
    })

    expect(res.status).toBe(201)
    const data = await res.json()
    expect(data.id).toBeDefined()
    expect(data.path).toBe('test-doc')
    expect(data.access_mode).toBe('public')
    expect(data.size_bytes).toBeGreaterThan(0)
  })

  test('PUT /api/docs/{path} creates a private document with secret', async () => {
    const res = await fetch(`${baseUrl}/api/docs/private-doc`, {
      method: 'PUT',
      headers: { ...authHeader(adminToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: { secret: 'data' },
        access_mode: 'private',
      }),
    })

    expect(res.status).toBe(201)
    const data = await res.json()
    expect(data.path).toBe('private-doc')
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

  test('GET /api/docs?prefix=notes lists documents under collection', async () => {
    upsertDocument('notes/todo', userRecord.id, '{"task":"buy milk"}', 'public', null, 20)
    upsertDocument('notes/shopping', userRecord.id, '{"items":["bread"]}', 'public', null, 22)
    upsertDocument('projects/alpha', userRecord.id, '{"name":"alpha"}', 'public', null, 17)

    const res = await fetch(`${baseUrl}/api/docs?prefix=notes`, {
      headers: authHeader(adminToken),
    })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.docs.length).toBe(2)
    expect(data.docs[0].path).toBe('notes/shopping')
    expect(data.docs[1].path).toBe('notes/todo')
  })

  test('GET /api/docs/{id} returns public document without auth', async () => {
    const doc = upsertDocument('public-doc', userRecord.id, '{"x":1}', 'public', null, 6)

    const res = await fetch(`${baseUrl}/api/docs/${doc.id}`)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.id).toBe(doc.id)
    expect(data.path).toBe('public-doc')
    expect(data.content.x).toBe(1)
  })

  test('GET /api/docs/{id} returns 403 for private doc without secret', async () => {
    const doc = upsertDocument('private-doc', userRecord.id, '{"y":1}', 'private', 'sec123', 6)

    const res = await fetch(`${baseUrl}/api/docs/${doc.id}`)
    expect(res.status).toBe(403)
  })

  test('GET /api/docs/{id} returns private doc with correct secret', async () => {
    const doc = upsertDocument('private-doc', userRecord.id, '{"z":1}', 'private', 'sec456', 6)

    const res = await fetch(`${baseUrl}/api/docs/${doc.id}?secret=sec456`)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.content.z).toBe(1)
  })

  test('PUT /api/docs/{path} updates document as owner', async () => {
    upsertDocument('update-doc', userRecord.id, '{"v":1}', 'public', null, 6)

    const res = await fetch(`${baseUrl}/api/docs/update-doc`, {
      method: 'PUT',
      headers: { ...authHeader(adminToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: { v: 2 } }),
    })

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.path).toBe('update-doc')
  })

  test('PUT /api/docs/{path} supports nested paths', async () => {
    const res = await fetch(`${baseUrl}/api/docs/notes/2024/january/todo`, {
      method: 'PUT',
      headers: { ...authHeader(adminToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: { task: 'nested doc' } }),
    })

    expect(res.status).toBe(201)
    const data = await res.json()
    expect(data.path).toBe('notes/2024/january/todo')
  })

  test('PUT /api/docs/{path} rejects invalid path characters', async () => {
    const res = await fetch(`${baseUrl}/api/docs/invalid%20path!`, {
      method: 'PUT',
      headers: { ...authHeader(adminToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: {} }),
    })

    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toContain('Invalid path segment')
  })

  test('DELETE /api/docs/{id} deletes document as owner', async () => {
    const doc = upsertDocument('delete-me', userRecord.id, '{}', 'public', null, 2)

    const res = await fetch(`${baseUrl}/api/docs/${doc.id}`, {
      method: 'DELETE',
      headers: authHeader(adminToken),
    })

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.deleted).toBe(true)

    const getRes = await fetch(`${baseUrl}/api/docs/${doc.id}`)
    expect(getRes.status).toBe(404)
  })

  test('Document access modes work correctly', async () => {
    const pubDoc = upsertDocument('am-public', userRecord.id, '{"mode":"pub"}', 'public', null, 12)
    const prsDoc = upsertDocument(
      'am-prs',
      userRecord.id,
      '{"mode":"prs"}',
      'public_read_secret_write',
      'prs-sec',
      12,
    )
    const privDoc = upsertDocument(
      'am-private',
      userRecord.id,
      '{"mode":"priv"}',
      'private',
      'priv-sec',
      13,
    )

    const pubRes = await fetch(`${baseUrl}/api/docs/${pubDoc.id}`)
    expect(pubRes.status).toBe(200)

    const prsRead = await fetch(`${baseUrl}/api/docs/${prsDoc.id}`)
    expect(prsRead.status).toBe(200)

    const prsWrite = await fetch(`${baseUrl}/api/docs/am-prs?secret=prs-sec`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: { updated: true } }),
    })
    expect(prsWrite.status).toBe(200)

    const privRead = await fetch(`${baseUrl}/api/docs/${privDoc.id}`)
    expect(privRead.status).toBe(403)

    const privReadSecret = await fetch(`${baseUrl}/api/docs/${privDoc.id}?secret=priv-sec`)
    expect(privReadSecret.status).toBe(200)
  })

  test('Rejects document larger than 1MB', async () => {
    const big = 'x'.repeat(LIMITS.maxDocSize)

    const res = await fetch(`${baseUrl}/api/docs/too-big`, {
      method: 'PUT',
      headers: { ...authHeader(adminToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: { data: big } }),
    })

    expect(res.status).toBe(413)
    const data = await res.json()
    expect(data.error).toContain('max size')
  })

  test('Rejects when total storage would exceed 10MB', async () => {
    const docBody = { data: 'x'.repeat(LIMITS.maxDocSize - 30) }
    const docSize = new TextEncoder().encode(JSON.stringify(docBody)).byteLength

    const docsNeeded = Math.ceil(LIMITS.maxTotalSize / docSize) + 1
    for (let i = 0; i < docsNeeded; i++) {
      upsertDocument(`fill-${i}`, userRecord.id, JSON.stringify(docBody), 'public', null, docSize)
    }

    const res = await fetch(`${baseUrl}/api/docs/overflow`, {
      method: 'PUT',
      headers: { ...authHeader(adminToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: { x: 'y' } }),
    })

    expect(res.status).toBe(413)
    const data = await res.json()
    expect(data.error).toContain('Total storage')
  })
})
