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

let server: ReturnType<typeof Bun.serve>
let baseUrl: string

beforeAll(async () => {
  const testDb = new Database(TEST_DB_PATH, { create: true })
  await runMigrations(testDb)
  testDb.close()

  server = Bun.serve({
    port: 0,
    routes: {
      '/api/me': async (req) => {
        const { extractAuth } = await import('./middleware')
        const auth = await extractAuth(req)
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
        const { extractAuth } = await import('./middleware')
        const { handleCreateToken, handleListTokens } = await import('./routes/tokens')
        const auth = await extractAuth(req)
        if (req.method === 'POST') return handleCreateToken(req, auth)
        if (req.method === 'GET') return handleListTokens(auth)
        return new Response('Method not allowed', { status: 405 })
      },
      '/api/tokens/:id': async (req) => {
        const { extractAuth } = await import('./middleware')
        const { handleDeleteToken } = await import('./routes/tokens')
        const auth = await extractAuth(req)
        if (req.method === 'DELETE') return handleDeleteToken(req, auth, req.params.id)
        return new Response('Method not allowed', { status: 405 })
      },
      '/api/docs': async (req) => {
        const { extractAuth } = await import('./middleware')
        const { handleCreateDoc, handleListDocs } = await import('./routes/docs')
        const auth = await extractAuth(req)
        if (req.method === 'POST') return handleCreateDoc(req, auth)
        if (req.method === 'GET') return handleListDocs(auth)
        return new Response('Method not allowed', { status: 405 })
      },
      '/api/docs/:id': async (req) => {
        const { extractAuth } = await import('./middleware')
        const { handleGetDoc, handleUpdateDoc, handleDeleteDoc } = await import('./routes/docs')
        const auth = await extractAuth(req)
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
  db.run('DELETE FROM users')
})

describe('Authentication', () => {
  test('GET /api/me returns 401 without auth', async () => {
    const res = await fetch(`${baseUrl}/api/me`)
    expect(res.status).toBe(401)
    const data = await res.json()
    expect(data.error).toBe('Not authenticated')
  })

  test('GET /api/me returns user with valid session', async () => {
    const user = createUser('github-123', 'test@example.com', 'Test User')
    const { createSession } = await import('./auth')
    const token = await createSession(user)

    const res = await fetch(`${baseUrl}/api/me`, {
      headers: { Cookie: `session=${token}` },
    })

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.id).toBe(user.id)
    expect(data.github_id).toBe('github-123')
    expect(data.email).toBe('test@example.com')
    expect(data.display_name).toBe('Test User')
  })

  test('GET /api/me returns user with valid API token', async () => {
    const user = createUser('github-456', 'api@example.com', 'API User')
    const rawToken = generateToken()
    const tokenHash = hashToken(rawToken)
    createApiToken(user.id, 'Test Token', tokenHash, 'read_write')

    const res = await fetch(`${baseUrl}/api/me`, {
      headers: { Authorization: `Bearer ${rawToken}` },
    })

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.id).toBe(user.id)
    expect(data.github_id).toBe('github-456')
  })
})

describe('API Tokens', () => {
  test('POST /api/tokens creates a new token with admin session', async () => {
    const user = createUser('github-token-1', 'token@example.com', 'Token User')
    const { createSession } = await import('./auth')
    const token = await createSession(user)

    const res = await fetch(`${baseUrl}/api/tokens`, {
      method: 'POST',
      headers: {
        Cookie: `session=${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'My Token', permissions: 'read_write' }),
    })

    expect(res.status).toBe(201)
    const data = await res.json()
    expect(data.token).toBeDefined()
    expect(data.token).toMatch(/^jd_/)
    expect(data.name).toBe('My Token')
    expect(data.permissions).toBe('read_write')
    expect(data.message).toContain('will not be shown again')
  })

  test('POST /api/tokens rejects with non-admin token', async () => {
    const user = createUser('github-token-2', 'token2@example.com', 'Token User 2')
    const rawToken = generateToken()
    const tokenHash = hashToken(rawToken)
    createApiToken(user.id, 'Non-Admin Token', tokenHash, 'read_write')

    const res = await fetch(`${baseUrl}/api/tokens`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${rawToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'New Token', permissions: 'read' }),
    })

    expect(res.status).toBe(401)
  })

  test('GET /api/tokens lists user tokens', async () => {
    const user = createUser('github-token-3', 'token3@example.com', 'Token User 3')
    const { createSession } = await import('./auth')
    const token = await createSession(user)

    const rawToken1 = generateToken()
    createApiToken(user.id, 'Token 1', hashToken(rawToken1), 'read')
    const rawToken2 = generateToken()
    createApiToken(user.id, 'Token 2', hashToken(rawToken2), 'write')

    const res = await fetch(`${baseUrl}/api/tokens`, {
      headers: { Cookie: `session=${token}` },
    })

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toHaveLength(2)
    const names = data.map((t: { name: string }) => t.name)
    expect(names).toContain('Token 1')
    expect(names).toContain('Token 2')
  })

  test('DELETE /api/tokens/:id revokes a token', async () => {
    const user = createUser('github-token-4', 'token4@example.com', 'Token User 4')
    const { createSession } = await import('./auth')
    const token = await createSession(user)

    const rawToken = generateToken()
    const tokenRecord = createApiToken(user.id, 'To Delete', hashToken(rawToken), 'read')

    const res = await fetch(`${baseUrl}/api/tokens/${tokenRecord.id}`, {
      method: 'DELETE',
      headers: { Cookie: `session=${token}` },
    })

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.deleted).toBe(true)

    const listRes = await fetch(`${baseUrl}/api/tokens`, {
      headers: { Cookie: `session=${token}` },
    })
    const tokens = await listRes.json()
    expect(tokens).toHaveLength(0)
  })
})

describe('Documents', () => {
  test('POST /api/docs creates a public document', async () => {
    const user = createUser('github-doc-1', 'doc@example.com', 'Doc User')
    const { createSession } = await import('./auth')
    const token = await createSession(user)

    const res = await fetch(`${baseUrl}/api/docs`, {
      method: 'POST',
      headers: {
        Cookie: `session=${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Test Doc',
        content: { foo: 'bar' },
        access_mode: 'public',
      }),
    })

    expect(res.status).toBe(201)
    const data = await res.json()
    expect(data.id).toBeDefined()
    expect(data.name).toBe('Test Doc')
    expect(data.access_mode).toBe('public')
    expect(data.access_secret).toBeNull()
  })

  test('POST /api/docs creates a private document with secret', async () => {
    const user = createUser('github-doc-2', 'doc2@example.com', 'Doc User 2')
    const { createSession } = await import('./auth')
    const token = await createSession(user)

    const res = await fetch(`${baseUrl}/api/docs`, {
      method: 'POST',
      headers: {
        Cookie: `session=${token}`,
        'Content-Type': 'application/json',
      },
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
    expect(data.message).toContain('will not be shown again')
  })

  test('GET /api/docs lists user documents', async () => {
    const user = createUser('github-doc-3', 'doc3@example.com', 'Doc User 3')
    const { createSession } = await import('./auth')
    const token = await createSession(user)

    createDocument('doc1', user.id, 'Doc 1', '{"a":1}', 'public', null)
    createDocument('doc2', user.id, 'Doc 2', '{"b":2}', 'private', 'secret123')

    const res = await fetch(`${baseUrl}/api/docs`, {
      headers: { Cookie: `session=${token}` },
    })

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toHaveLength(2)
  })

  test('GET /api/docs/:id returns public document without auth', async () => {
    const user = createUser('github-doc-4', 'doc4@example.com', 'Doc User 4')
    createDocument('public-doc', user.id, 'Public Doc', '{"public":true}', 'public', null)

    const res = await fetch(`${baseUrl}/api/docs/public-doc`)

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.id).toBe('public-doc')
    expect(data.content.public).toBe(true)
  })

  test('GET /api/docs/:id returns 403 for private doc without secret', async () => {
    const user = createUser('github-doc-5', 'doc5@example.com', 'Doc User 5')
    createDocument(
      'private-doc',
      user.id,
      'Private Doc',
      '{"private":true}',
      'private',
      'secret123',
    )

    const res = await fetch(`${baseUrl}/api/docs/private-doc`)

    expect(res.status).toBe(403)
  })

  test('GET /api/docs/:id returns private doc with correct secret', async () => {
    const user = createUser('github-doc-6', 'doc6@example.com', 'Doc User 6')
    createDocument(
      'private-doc-2',
      user.id,
      'Private Doc 2',
      '{"private":true}',
      'private',
      'secret456',
    )

    const res = await fetch(`${baseUrl}/api/docs/private-doc-2?secret=secret456`)

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.content.private).toBe(true)
  })

  test('PUT /api/docs/:id updates document as owner', async () => {
    const user = createUser('github-doc-7', 'doc7@example.com', 'Doc User 7')
    const { createSession } = await import('./auth')
    const token = await createSession(user)

    createDocument('update-doc', user.id, 'Original', '{"v":1}', 'public', null)

    const res = await fetch(`${baseUrl}/api/docs/update-doc`, {
      method: 'PUT',
      headers: {
        Cookie: `session=${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'Updated', content: { v: 2 } }),
    })

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.name).toBe('Updated')
    expect(data.content.v).toBe(2)
  })

  test('PUT /api/docs/:id updates with secret for private doc', async () => {
    const user = createUser('github-doc-8', 'doc8@example.com', 'Doc User 8')
    createDocument('secret-update', user.id, 'Secret Doc', '{"v":1}', 'private', 'update-secret')

    const res = await fetch(`${baseUrl}/api/docs/secret-update?secret=update-secret`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: { v: 2 } }),
    })

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.content.v).toBe(2)
  })

  test('DELETE /api/docs/:id deletes document as owner', async () => {
    const user = createUser('github-doc-9', 'doc9@example.com', 'Doc User 9')
    const { createSession } = await import('./auth')
    const token = await createSession(user)

    createDocument('delete-doc', user.id, 'Delete Me', '{}', 'public', null)

    const res = await fetch(`${baseUrl}/api/docs/delete-doc`, {
      method: 'DELETE',
      headers: { Cookie: `session=${token}` },
    })

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.deleted).toBe(true)

    const getRes = await fetch(`${baseUrl}/api/docs/delete-doc`)
    expect(getRes.status).toBe(404)
  })

  test('Document access modes work correctly', async () => {
    const user = createUser('github-doc-10', 'doc10@example.com', 'Doc User 10')

    createDocument('public-doc', user.id, 'Public', '{"mode":"public"}', 'public', null)
    createDocument(
      'prs-doc',
      user.id,
      'Public Read Secret Write',
      '{"mode":"prs"}',
      'public_read_secret_write',
      'prs-secret',
    )
    createDocument(
      'private-doc',
      user.id,
      'Private',
      '{"mode":"private"}',
      'private',
      'private-secret',
    )

    const publicRes = await fetch(`${baseUrl}/api/docs/public-doc`)
    expect(publicRes.status).toBe(200)

    const prsReadRes = await fetch(`${baseUrl}/api/docs/prs-doc`)
    expect(prsReadRes.status).toBe(200)

    const prsWriteRes = await fetch(`${baseUrl}/api/docs/prs-doc?secret=prs-secret`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: { updated: true } }),
    })
    expect(prsWriteRes.status).toBe(200)

    const privateReadRes = await fetch(`${baseUrl}/api/docs/private-doc`)
    expect(privateReadRes.status).toBe(403)

    const privateReadWithSecretRes = await fetch(
      `${baseUrl}/api/docs/private-doc?secret=private-secret`,
    )
    expect(privateReadWithSecretRes.status).toBe(200)
  })
})
