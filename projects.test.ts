import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'bun:test'
import { createApp } from './app'
import { generateToken } from './middleware'
import { initDatabase } from './kysely-db'
import { createUser, createApiToken, createProject, getProject } from './services'
import { createSessionForUser, createAnonymousSession } from './services/sessions'

let server: ReturnType<typeof Bun.serve>
let baseUrl: string
let adminToken: string
let userId: number

beforeAll(() => {
  server = Bun.serve({ port: 0, fetch: createApp().fetch })
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
    const p = await createProject(userId, 'P')
    const res = await fetch(`${baseUrl}/api/docs?path=nope&project=${p.id}`, {
      headers: authHeader(adminToken),
    })
    expect(res.status).toBe(404)
  })

  test('DELETE /api/docs?path=… deletes a doc at that path', async () => {
    const p = await createProject(userId, 'P')
    const q = `project=${p.id}`
    await fetch(`${baseUrl}/api/docs/by-path?${q}`, {
      method: 'PUT',
      headers: { ...authHeader(adminToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: { x: 1 } }),
    })

    const res = await fetch(`${baseUrl}/api/docs?path=by-path&${q}`, {
      method: 'DELETE',
      headers: authHeader(adminToken),
    })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.deleted).toBe(true)

    const after = await fetch(`${baseUrl}/api/docs?path=by-path&${q}`, {
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

describe('Account vs project keys', () => {
  async function postJson(path: string, token: string, body: unknown) {
    return fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { ...authHeader(token), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  test('a project-scoped admin key cannot manage keys or projects', async () => {
    const p = await createProject(userId, 'P')
    const other = await createProject(userId, 'Other')
    const scopedAdmin = generateToken()
    await createApiToken(userId, 'legacy scoped admin', scopedAdmin, 'admin', p.id)

    expect((await postJson('/api/tokens', scopedAdmin, { permissions: 'admin' })).status).toBe(403)
    expect(
      (await postJson('/api/tokens', scopedAdmin, { permissions: 'read', project_id: other.id }))
        .status,
    ).toBe(403)
    expect((await postJson('/api/projects', scopedAdmin, { name: 'X' })).status).toBe(403)
    const del = await fetch(`${baseUrl}/api/projects/${other.id}`, {
      method: 'DELETE',
      headers: authHeader(scopedAdmin),
    })
    expect(del.status).toBe(403)
  })

  test('a project key cannot list or revoke keys', async () => {
    const p = await createProject(userId, 'P')
    const key = generateToken()
    const record = await createApiToken(userId, 'k', key, 'read_write', p.id)

    const list = await fetch(`${baseUrl}/api/tokens`, { headers: authHeader(key) })
    expect(list.status).toBe(403)
    const revoke = await fetch(`${baseUrl}/api/tokens/${record.id}`, {
      method: 'DELETE',
      headers: authHeader(key),
    })
    expect(revoke.status).toBe(403)
  })

  test('a project key lists only its own project', async () => {
    const p = await createProject(userId, 'Mine')
    await createProject(userId, 'Someone else')
    const key = generateToken()
    await createApiToken(userId, 'k', key, 'read', p.id)

    const res = await fetch(`${baseUrl}/api/projects`, { headers: authHeader(key) })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.map((x: { id: string }) => x.id)).toEqual([p.id])
  })

  test('admin keys cannot be scoped; project keys must be', async () => {
    const p = await createProject(userId, 'P')
    const cases: [unknown, number][] = [
      [{ permissions: 'admin', project_id: p.id }, 400],
      [{ permissions: 'read' }, 400],
      [{ permissions: 'read_write' }, 400],
      [{ permissions: 'write', project_id: p.id }, 400],
      [{ permissions: 'admin' }, 201],
      [{ permissions: 'read', project_id: p.id }, 201],
    ]
    for (const [body, status] of cases) {
      expect((await postJson('/api/tokens', adminToken, body)).status).toBe(status)
    }
  })

  test('GET /api/tokens?project= filters to that project', async () => {
    const a = await createProject(userId, 'A')
    const b = await createProject(userId, 'B')
    await createApiToken(userId, 'a-key', generateToken(), 'read', a.id)
    await createApiToken(userId, 'b-key', generateToken(), 'read', b.id)

    const res = await fetch(`${baseUrl}/api/tokens?project=${a.id}`, {
      headers: authHeader(adminToken),
    })
    const names = (await res.json()).map((t: { name: string }) => t.name)
    expect(names).toEqual(['a-key'])
  })
})

describe('Dashboard sessions', () => {
  test('a GitHub user session can manage projects and keys', async () => {
    const { token } = await createSessionForUser(userId)
    const projRes = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { ...authHeader(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'From dashboard' }),
    })
    expect(projRes.status).toBe(201)
    const project = await projRes.json()

    const keyRes = await fetch(`${baseUrl}/api/tokens`, {
      method: 'POST',
      headers: { ...authHeader(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ permissions: 'read', project_id: project.id }),
    })
    expect(keyRes.status).toBe(201)

    const docRes = await fetch(`${baseUrl}/api/docs/notes/a?project=${project.id}`, {
      method: 'PUT',
      headers: { ...authHeader(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: { ok: true } }),
    })
    expect(docRes.status).toBe(201)
  })

  test('an anonymous session cannot manage projects or keys', async () => {
    const { token } = await createAnonymousSession()
    const projRes = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { ...authHeader(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Nope' }),
    })
    expect(projRes.status).toBe(403)
    const keys = await fetch(`${baseUrl}/api/tokens`, { headers: authHeader(token) })
    expect(keys.status).toBe(403)
  })

  test('logout revokes the session', async () => {
    const { token } = await createSessionForUser(userId)
    expect((await fetch(`${baseUrl}/api/me`, { headers: authHeader(token) })).status).toBe(200)

    const out = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: authHeader(token),
    })
    expect(out.status).toBe(200)
    expect((await fetch(`${baseUrl}/api/me`, { headers: authHeader(token) })).status).toBe(401)
  })

  test('logout with an API key does not revoke the key', async () => {
    await fetch(`${baseUrl}/api/auth/logout`, { method: 'POST', headers: authHeader(adminToken) })
    expect((await fetch(`${baseUrl}/api/me`, { headers: authHeader(adminToken) })).status).toBe(
      200,
    )
  })
})

describe('Project details', () => {
  test('GET /api/projects includes doc, key and last-write stats', async () => {
    const p = await createProject(userId, 'Stats')
    const key = generateToken()
    await createApiToken(userId, 'k', key, 'read_write', p.id)
    await fetch(`${baseUrl}/api/docs/notes/a`, {
      method: 'PUT',
      headers: { ...authHeader(key), 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: { a: 1 } }),
    })

    const [stats] = await (
      await fetch(`${baseUrl}/api/projects`, { headers: authHeader(adminToken) })
    ).json()
    expect(stats.doc_count).toBe(1)
    expect(stats.key_count).toBe(1)
    expect(stats.last_write_at).toBeTruthy()
  })

  test('GET /api/projects/:id returns one project; 404 for someone else’s', async () => {
    const mine = await createProject(userId, 'Mine')
    const other = await createUser('github-9', 'n@e.com', 'N')
    const theirs = await createProject(other.id, 'Theirs')

    const ok = await fetch(`${baseUrl}/api/projects/${mine.id}`, {
      headers: authHeader(adminToken),
    })
    expect(ok.status).toBe(200)
    expect((await ok.json()).name).toBe('Mine')

    const no = await fetch(`${baseUrl}/api/projects/${theirs.id}`, {
      headers: authHeader(adminToken),
    })
    expect(no.status).toBe(404)
  })

  test('PATCH /api/projects/:id renames; project keys cannot', async () => {
    const p = await createProject(userId, 'Old')
    const key = generateToken()
    await createApiToken(userId, 'k', key, 'read_write', p.id)
    const patch = (token: string) =>
      fetch(`${baseUrl}/api/projects/${p.id}`, {
        method: 'PATCH',
        headers: { ...authHeader(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'New' }),
      })

    expect((await patch(key)).status).toBe(403)
    const res = await patch(adminToken)
    expect(res.status).toBe(200)
    expect((await res.json()).name).toBe('New')
  })
})
