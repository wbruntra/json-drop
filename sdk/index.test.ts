import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'bun:test'
import { JsonDrop, JsonDropError } from './src/index'
import { createServer } from '../server'
import { generateToken } from '../middleware'
import { initDatabase } from '../kysely-db'
import { createUser, createApiToken, createProject } from '../services'

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
  const user = await createUser('github-sdk', 'sdk@example.com', 'SDK User')
  userId = user.id
  adminToken = generateToken()
  await createApiToken(userId, 'Admin', adminToken, 'admin')
})

describe('JsonDrop SDK', () => {
  test('me() returns the authenticated user', async () => {
    const db = new JsonDrop({ baseUrl, token: adminToken })
    const me = await db.me()
    expect(me.id).toBe(userId)
    expect(me.email).toBe('sdk@example.com')
  })

  test('projects.create / list / delete', async () => {
    const db = new JsonDrop({ baseUrl, token: adminToken })
    const p = await db.projects.create({ name: 'Demo' })
    expect(p.name).toBe('Demo')
    expect(p.id).toBeDefined()

    const list = await db.projects.list()
    expect(list.length).toBe(1)

    const res = await db.projects.delete(p.id)
    expect(res.deleted).toBe(true)

    const after = await db.projects.list()
    expect(after.length).toBe(0)
  })

  test('collection.add + list', async () => {
    const db = new JsonDrop({ baseUrl, token: adminToken })
    const notes = db.collection('notes')
    const a = await notes.add({ title: 'A' })
    const b = await notes.add({ title: 'B' })
    expect(a.path).toStartWith('notes/')
    expect(b.path).toStartWith('notes/')

    const list = await notes.list()
    expect(list.docs.length).toBe(2)
    expect(list.docs.map((d) => d.path).sort()).toEqual([a.path, b.path].sort())
  })

  test('doc.set / get / delete by path', async () => {
    const db = new JsonDrop({ baseUrl, token: adminToken })
    const alice = db.doc('users/alice')
    const created = await alice.set({ name: 'Alice' })
    expect(created.path).toBe('users/alice')

    const got = await alice.get()
    expect(got.path).toBe('users/alice')
    expect((got.content as { name: string }).name).toBe('Alice')

    const del = await alice.delete()
    expect(del.deleted).toBe(true)

    await expect(alice.get()).rejects.toThrow(JsonDropError)
  })

  test('id-based get / delete via db.get / db.delete', async () => {
    const db = new JsonDrop({ baseUrl, token: adminToken })
    const created = await db.doc('short/path').set({ v: 1 })
    const got = await db.get(created.id)
    expect(got.id).toBe(created.id)
    const del = await db.delete(created.id)
    expect(del.deleted).toBe(true)
  })

  test('project-scoped token isolates docs by project', async () => {
    // Create two projects and one token each
    const projA = await createProject(userId, 'A')
    const projB = await createProject(userId, 'B')

    const tokA = generateToken()
    await createApiToken(userId, 'A tok', tokA, 'read_write', projA.id)
    const tokB = generateToken()
    await createApiToken(userId, 'B tok', tokB, 'read_write', projB.id)

    const dbA = new JsonDrop({ baseUrl, token: tokA })
    const dbB = new JsonDrop({ baseUrl, token: tokB })

    await dbA.doc('shared/x').set({ from: 'A' })
    await dbB.doc('shared/x').set({ from: 'B' })

    const aRead = await dbA.doc('shared/x').get()
    const bRead = await dbB.doc('shared/x').get()
    expect((aRead.content as { from: string }).from).toBe('A')
    expect((bRead.content as { from: string }).from).toBe('B')
  })

  test('anonymous public read via ?project=', async () => {
    const p = await createProject(userId, 'Public')
    const tok = generateToken()
    await createApiToken(userId, 'Tok', tok, 'read_write', p.id)
    const owner = new JsonDrop({ baseUrl, token: tok })
    await owner.doc('landing').set({ hero: 'hi' })

    const anon = new JsonDrop({ baseUrl, project: p.id })
    const doc = await anon.doc('landing').get()
    expect((doc.content as { hero: string }).hero).toBe('hi')
  })

  test('JsonDropError carries status and message on 4xx', async () => {
    const db = new JsonDrop({ baseUrl, token: adminToken })
    try {
      await db.doc('nonexistent').get()
      throw new Error('expected to throw')
    } catch (e) {
      expect(e).toBeInstanceOf(JsonDropError)
      expect((e as JsonDropError).status).toBe(404)
      expect((e as JsonDropError).code).toBe('not_found')
    }
  })

  test('doc payloads include a version field that bumps on set', async () => {
    const db = new JsonDrop({ baseUrl, token: adminToken })
    const ref = db.doc('ver/doc')
    const created = await ref.set({ n: 1 })
    expect(created.version).toBe(1)
    const got = await ref.get()
    expect(got.version).toBe(1)

    await new Promise((r) => setTimeout(r, 10))
    const updated = await ref.set({ n: 2 }, { ifMatch: 1 })
    expect(updated.version).toBe(2)
    const got2 = await ref.get()
    expect(got2.version).toBe(2)
  })

  test('set() with stale ifMatch throws a conflict error', async () => {
    const db = new JsonDrop({ baseUrl, token: adminToken })
    const ref = db.doc('ver/conflict')
    await ref.set({ v: 1 })
    await ref.set({ v: 2 }) // bumps to version 2

    try {
      await ref.set({ v: 3 }, { ifMatch: 1 })
      throw new Error('expected to throw')
    } catch (e) {
      expect(e).toBeInstanceOf(JsonDropError)
      expect((e as JsonDropError).status).toBe(409)
      expect((e as JsonDropError).code).toBe('conflict')
    }
  })

  test('delete() with stale ifMatch throws a conflict error', async () => {
    const db = new JsonDrop({ baseUrl, token: adminToken })
    const ref = db.doc('ver/delconflict')
    await ref.set({ v: 1 })
    await ref.set({ v: 2 }) // version 2

    try {
      await ref.delete({ ifMatch: 1 })
      throw new Error('expected to throw')
    } catch (e) {
      expect(e).toBeInstanceOf(JsonDropError)
      expect((e as JsonDropError).code).toBe('conflict')
    }
  })

  test('add() and set() return a bound ref that can read and delete', async () => {
    const db = new JsonDrop({ baseUrl, token: adminToken })
    const notes = db.collection('notes')
    const created = await notes.add({ title: 'hello' })
    expect(created.ref).toBeDefined()
    const got = await created.ref!.get()
    expect((got.content as { title: string }).title).toBe('hello')
    const del = await created.ref!.delete()
    expect(del.deleted).toBe(true)
  })

  test('me() returns null in guest mode (no token)', async () => {
    const db = new JsonDrop({ baseUrl })
    const me = await db.me()
    expect(me).toBeNull()
  })

  test('list() echoes the effective prefix', async () => {
    const db = new JsonDrop({ baseUrl, token: adminToken })
    const notes = db.collection('expenses')
    await notes.add({ name: 'Spain trip' })
    const list = await notes.list()
    expect(list.prefix).toBe('expenses')
    expect(list.order).toBe('path_asc')
    expect(list.docs.length).toBeGreaterThan(0)
  })
})
