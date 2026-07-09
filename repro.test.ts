import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'bun:test'
import { createServer } from './server'
import { generateToken } from './middleware'
import { initDatabase } from './kysely-db'
import { createUser, createApiToken } from './services'

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
  const user = await createUser('github-repro', 'repro@example.com', 'Repro User')
  userId = user.id
  adminToken = generateToken()
  await createApiToken(userId, 'Admin', adminToken, 'admin')
})

function authHeader(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` }
}

describe('Project-scoped token end-to-end (HTTP flow)', () => {
  test('token minted via /api/tokens authenticates on /api/me', async () => {
    // 1. Create a project via API (admin token)
    const projectRes = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { ...authHeader(adminToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'My App' }),
    })
    expect(projectRes.status).toBe(201)
    const project = await projectRes.json()

    // 2. Mint a project-scoped token via /api/tokens (admin token)
    const tokenRes = await fetch(`${baseUrl}/api/tokens`, {
      method: 'POST',
      headers: { ...authHeader(adminToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'frontend',
        permissions: 'read_write',
        project_id: project.id,
      }),
    })
    expect(tokenRes.status).toBe(201)
    const tokenData = await tokenRes.json()
    const scopedToken: string = tokenData.token
    expect(scopedToken).toMatch(/^jd_/)

    // 3. Use the minted token against /api/me — the user reports 401 here
    const meRes = await fetch(`${baseUrl}/api/me`, { headers: authHeader(scopedToken) })
    console.log('--- /api/me with scoped token =>', meRes.status)
    const meBody = await meRes.json().catch(() => ({}))
    console.log('--- meBody:', meBody)
    expect(meRes.status).toBe(200)
    expect(meBody.id).toBe(userId)
  })

  test('scoped token can list projects and write docs in its project', async () => {
    const projectRes = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { ...authHeader(adminToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'My App' }),
    })
    const project = await projectRes.json()

    const tokenRes = await fetch(`${baseUrl}/api/tokens`, {
      method: 'POST',
      headers: { ...authHeader(adminToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        permissions: 'read_write',
        project_id: project.id,
      }),
    })
    expect(tokenRes.status).toBe(201)
    const scopedToken: string = (await tokenRes.json()).token

    // List projects with scoped token
    const listRes = await fetch(`${baseUrl}/api/projects`, { headers: authHeader(scopedToken) })
    console.log('--- /api/projects with scoped token =>', listRes.status)
    expect(listRes.status).toBe(200)

    // Write a doc into the project
    const writeRes = await fetch(`${baseUrl}/api/docs/checkins`, {
      method: 'POST',
      headers: { ...authHeader(scopedToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: { time: 'now' } }),
    })
    console.log('--- POST /api/docs/checkins with scoped token =>', writeRes.status)
    expect(writeRes.status).toBe(201)

    // List docs in the project
    const docsRes = await fetch(`${baseUrl}/api/docs?prefix=checkins`, {
      headers: authHeader(scopedToken),
    })
    console.log('--- GET /api/docs?prefix=checkins with scoped token =>', docsRes.status)
    expect(docsRes.status).toBe(200)
  })
})
