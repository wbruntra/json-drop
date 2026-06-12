import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'bun:test'
import { createServer } from './server'
import { generateToken } from './middleware'
import { initDatabase } from './kysely-db'
import { createUser, createApiToken, createProject, getProject } from './services'

let server: ReturnType<typeof createServer>
let baseUrl: string
let adminToken: string
let userId: number

beforeAll(() => {
  server = createServer({ port: 0 })
  baseUrl = `http://localhost:${server.port}`
})

afterAll(() => {
  server.stop()
})

beforeEach(async () => {
  await initDatabase(':memory:', { silent: true })
  const user = await createUser('github-1', 'test@example.com', 'Test User')
  userId = user.id
  adminToken = generateToken()
  await createApiToken(userId, 'Admin', adminToken, 'admin')
})

function authHeader(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` }
}

describe('Projects', () => {
  test('POST /api/projects creates a project', async () => {
    const res = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { ...authHeader(adminToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'My Project' }),
    })
    expect(res.status).toBe(201)
    const data = await res.json()
    expect(data.id).toBeDefined()
    expect(data.name).toBe('My Project')
    expect(data.created_at).toBeDefined()
  })

  test('POST /api/projects rejects empty name', async () => {
    const res = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { ...authHeader(adminToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '' }),
    })
    expect(res.status).toBe(400)
  })

  test("GET /api/projects lists the user's projects", async () => {
    await createProject(userId, 'Project 1')
    await createProject(userId, 'Project 2')

    const res = await fetch(`${baseUrl}/api/projects`, { headers: authHeader(adminToken) })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.length).toBe(2)
    expect(data[0].name).toBe('Project 1')
    expect(data[1].name).toBe('Project 2')
  })

  test('DELETE /api/projects/:id removes the project', async () => {
    const p = await createProject(userId, 'To Delete')

    const res = await fetch(`${baseUrl}/api/projects/${p.id}`, {
      method: 'DELETE',
      headers: authHeader(adminToken),
    })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.deleted).toBe(true)
    expect(await getProject(p.id)).toBeNull()
  })

  test("DELETE /api/projects/:id returns 403 for another user's project", async () => {
    const other = await createUser('github-2', 'other@example.com', 'Other')
    const otherToken = generateToken()
    await createApiToken(other.id, 'Other Admin', otherToken, 'admin')

    const p = await createProject(userId, 'Mine')
    const res = await fetch(`${baseUrl}/api/projects/${p.id}`, {
      method: 'DELETE',
      headers: authHeader(otherToken),
    })
    expect(res.status).toBe(403)
  })
})

describe('Project-scoped tokens', () => {
  test('POST /api/tokens with project_id creates a project-scoped token', async () => {
    const p = await createProject(userId, 'P1')
    const res = await fetch(`${baseUrl}/api/tokens`, {
      method: 'POST',
      headers: { ...authHeader(adminToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Project Token', permissions: 'read_write', project_id: p.id }),
    })
    expect(res.status).toBe(201)
    const data = await res.json()
    expect(data.project_id).toBe(p.id)
  })

  test('POST /api/tokens rejects project_id for a project the caller does not own', async () => {
    const other = await createUser('github-3', 'o@e.com', 'O')
    const p = await createProject(other.id, 'P')

    const res = await fetch(`${baseUrl}/api/tokens`, {
      method: 'POST',
      headers: { ...authHeader(adminToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'T', permissions: 'read', project_id: p.id }),
    })
    expect(res.status).toBe(403)
  })

  test('Project-scoped tokens cannot read docs from another project of the same owner', async () => {
    const projA = await createProject(userId, 'A')
    const projB = await createProject(userId, 'B')

    const tokA = generateToken()
    await createApiToken(userId, 'A token', tokA, 'read_write', projA.id)
    const tokB = generateToken()
    await createApiToken(userId, 'B token', tokB, 'read_write', projB.id)

    // Write to project A
    const putA = await fetch(`${baseUrl}/api/docs/shared/path`, {
      method: 'PUT',
      headers: { ...authHeader(tokA), 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: { from: 'A' } }),
    })
    expect(putA.status).toBe(201)

    // Write to project B at the same path
    const putB = await fetch(`${baseUrl}/api/docs/shared/path`, {
      method: 'PUT',
      headers: { ...authHeader(tokB), 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: { from: 'B' } }),
    })
    expect(putB.status).toBe(201)

    // Token A reads by path; should get the A doc, not B's
    const readA = await fetch(`${baseUrl}/api/docs?path=shared/path`, {
      headers: authHeader(tokA),
    })
    expect(readA.status).toBe(200)
    const aData = await readA.json()
    expect(aData.content.from).toBe('A')

    // Token B reads by path; should get the B doc
    const readB = await fetch(`${baseUrl}/api/docs?path=shared/path`, {
      headers: authHeader(tokB),
    })
    expect(readB.status).toBe(200)
    const bData = await readB.json()
    expect(bData.content.from).toBe('B')
  })
})

describe('Path addressing on /api/docs', () => {
  test('GET /api/docs?path=… returns the doc at that path within the project scope', async () => {
    const p = await createProject(userId, 'P')
    const tok = generateToken()
    await createApiToken(userId, 'Tok', tok, 'read_write', p.id)

    await fetch(`${baseUrl}/api/docs/users/alice`, {
      method: 'PUT',
      headers: { ...authHeader(tok), 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: { name: 'Alice' } }),
    })

    const res = await fetch(`${baseUrl}/api/docs?path=users/alice`, { headers: authHeader(tok) })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.path).toBe('users/alice')
    expect(data.content.name).toBe('Alice')
  })

  test('GET /api/docs?path=… returns 404 for missing path', async () => {
    const res = await fetch(`${baseUrl}/api/docs?path=nope`, { headers: authHeader(adminToken) })
    expect(res.status).toBe(404)
  })

  test('DELETE /api/docs?path=… deletes a doc at that path', async () => {
    await fetch(`${baseUrl}/api/docs/by-path`, {
      method: 'PUT',
      headers: { ...authHeader(adminToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: { x: 1 } }),
    })

    const res = await fetch(`${baseUrl}/api/docs?path=by-path`, {
      method: 'DELETE',
      headers: authHeader(adminToken),
    })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.deleted).toBe(true)

    const after = await fetch(`${baseUrl}/api/docs?path=by-path`, {
      headers: authHeader(adminToken),
    })
    expect(after.status).toBe(404)
  })
})

describe('Anonymous project access', () => {
  test('Anonymous GET with ?project= reads a public doc', async () => {
    const p = await createProject(userId, 'Public Project')

    // Owner writes a public doc to that project
    const tok = generateToken()
    await createApiToken(userId, 'Tok', tok, 'read_write', p.id)
    await fetch(`${baseUrl}/api/docs/landing`, {
      method: 'PUT',
      headers: { ...authHeader(tok), 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: { hero: 'hi' } }),
    })

    // Anonymous client reads it via ?project=
    const res = await fetch(`${baseUrl}/api/docs?path=landing&project=${p.id}`)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.content.hero).toBe('hi')
  })

  test('Anonymous GET with ?project= cannot read a private doc', async () => {
    const p = await createProject(userId, 'Private Project')
    const tok = generateToken()
    await createApiToken(userId, 'Tok', tok, 'read_write', p.id)

    await fetch(`${baseUrl}/api/docs/secret`, {
      method: 'PUT',
      headers: { ...authHeader(tok), 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: { v: 1 }, access_mode: 'private' }),
    })

    const res = await fetch(`${baseUrl}/api/docs?path=secret&project=${p.id}`)
    expect(res.status).toBe(403)
  })
})
