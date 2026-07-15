import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'bun:test'
import { createServer } from './server'
import { initDatabase } from './kysely-db'

let server: ReturnType<typeof createServer>
let baseUrl: string

beforeAll(() => {
  server = createServer({ port: 0 })
  baseUrl = `http://localhost:${server.port}`
})

afterAll(() => {
  server.stop()
})

beforeEach(async () => {
  await initDatabase(':memory:', { silent: true })
})

function authHeader(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` }
}

async function anonSession(): Promise<{ token: string; userId: number }> {
  const res = await fetch(`${baseUrl}/api/sessions/anonymous`, { method: 'POST' })
  const data = await res.json()
  return { token: data.token, userId: data.user.id }
}

async function createWorkspace(token: string, name = 'Italy 2026'): Promise<string> {
  const res = await fetch(`${baseUrl}/api/workspaces`, {
    method: 'POST',
    headers: { ...authHeader(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  const data = await res.json()
  return data.id
}

async function createInvite(
  token: string,
  workspaceId: string,
  role = 'editor',
  opts: { maxUses?: number } = {},
): Promise<string> {
  const res = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/invites`, {
    method: 'POST',
    headers: { ...authHeader(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ role, ...opts }),
  })
  const data = await res.json()
  return data.secret
}

async function redeemInvite(token: string, secret: string) {
  return fetch(`${baseUrl}/api/invites/redeem`, {
    method: 'POST',
    headers: { ...authHeader(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret }),
  })
}

describe('Workspace creation and ownership', () => {
  test('creator becomes the sole owner', async () => {
    const owner = await anonSession()
    const workspaceId = await createWorkspace(owner.token)

    const res = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/members`, {
      headers: authHeader(owner.token),
    })
    const members = await res.json()
    expect(members.length).toBe(1)
    expect(members[0].user_id).toBe(owner.userId)
    expect(members[0].role).toBe('owner')
  })
})

describe('Invitations', () => {
  test('editor invite grants access only to its workspace', async () => {
    const owner = await anonSession()
    const wsA = await createWorkspace(owner.token, 'A')
    const wsB = await createWorkspace(owner.token, 'B')
    const secret = await createInvite(owner.token, wsA, 'editor')

    const friend = await anonSession()
    const redeemRes = await redeemInvite(friend.token, secret)
    expect(redeemRes.status).toBe(200)
    const redeemBody = await redeemRes.json()
    expect(redeemBody.workspace_id).toBe(wsA)
    expect(redeemBody.role).toBe('editor')

    // Friend can read workspace A...
    const getA = await fetch(`${baseUrl}/api/workspaces/${wsA}`, {
      headers: authHeader(friend.token),
    })
    expect(getA.status).toBe(200)

    // ...but not workspace B, which they were never invited to.
    const getB = await fetch(`${baseUrl}/api/workspaces/${wsB}`, {
      headers: authHeader(friend.token),
    })
    expect(getB.status).toBe(404)
  })

  test('a revoked invite cannot be redeemed', async () => {
    const owner = await anonSession()
    const ws = await createWorkspace(owner.token)

    const inviteRes = await fetch(`${baseUrl}/api/workspaces/${ws}/invites`, {
      method: 'POST',
      headers: { ...authHeader(owner.token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'editor' }),
    })
    const invite = await inviteRes.json()

    await fetch(`${baseUrl}/api/workspaces/${ws}/invites/${invite.id}`, {
      method: 'DELETE',
      headers: authHeader(owner.token),
    })

    const friend = await anonSession()
    const redeemRes = await redeemInvite(friend.token, invite.secret)
    expect(redeemRes.status).toBe(404)
  })

  test('redeeming the same invite twice as the same principal is idempotent', async () => {
    const owner = await anonSession()
    const ws = await createWorkspace(owner.token)
    const secret = await createInvite(owner.token, ws, 'editor', { maxUses: 1 })

    const friend = await anonSession()
    const first = await redeemInvite(friend.token, secret)
    expect(first.status).toBe(200)

    const second = await redeemInvite(friend.token, secret)
    expect(second.status).toBe(200)
    const secondBody = await second.json()
    expect(secondBody.role).toBe('editor')

    const members = await (
      await fetch(`${baseUrl}/api/workspaces/${ws}/members`, { headers: authHeader(owner.token) })
    ).json()
    expect(members.length).toBe(2) // owner + friend, not duplicated
  })
})

describe('Role enforcement', () => {
  test('viewer can list and read but not write documents', async () => {
    const owner = await anonSession()
    const ws = await createWorkspace(owner.token)
    const secret = await createInvite(owner.token, ws, 'viewer')

    const viewer = await anonSession()
    await redeemInvite(viewer.token, secret)

    const listRes = await fetch(`${baseUrl}/api/workspaces/${ws}/documents`, {
      headers: authHeader(viewer.token),
    })
    expect(listRes.status).toBe(200)

    const createRes = await fetch(
      `${baseUrl}/api/workspaces/${ws}/collections/expenses/documents`,
      {
        method: 'POST',
        headers: { ...authHeader(viewer.token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: { amount: 10 } }),
      },
    )
    expect(createRes.status).toBe(403)
  })

  test('editor in one workspace gets 404 on another workspace they are not a member of', async () => {
    const owner = await anonSession()
    const wsA = await createWorkspace(owner.token, 'A')
    const wsB = await createWorkspace(owner.token, 'B')
    const secretA = await createInvite(owner.token, wsA, 'editor')

    const editor = await anonSession()
    await redeemInvite(editor.token, secretA)

    const res = await fetch(`${baseUrl}/api/workspaces/${wsB}/documents`, {
      headers: authHeader(editor.token),
    })
    expect(res.status).toBe(404)
  })
})

describe('Document conflict handling', () => {
  test('stale If-Match on a workspace document returns 409 without mutating it', async () => {
    const owner = await anonSession()
    const ws = await createWorkspace(owner.token)

    const createRes = await fetch(
      `${baseUrl}/api/workspaces/${ws}/collections/expenses/documents`,
      {
        method: 'POST',
        headers: { ...authHeader(owner.token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: { amount: 10 } }),
      },
    )
    const doc = await createRes.json()

    const staleRes = await fetch(`${baseUrl}/api/workspaces/${ws}/documents/${doc.id}`, {
      method: 'PUT',
      headers: {
        ...authHeader(owner.token),
        'Content-Type': 'application/json',
        'If-Match': '99',
      },
      body: JSON.stringify({ content: { amount: 20 } }),
    })
    expect(staleRes.status).toBe(409)

    const getRes = await fetch(`${baseUrl}/api/workspaces/${ws}/documents/${doc.id}`, {
      headers: authHeader(owner.token),
    })
    const current = await getRes.json()
    expect(current.content.amount).toBe(10)
    expect(current.version).toBe(1)
  })
})

describe('Owner lockout protection', () => {
  test('the last owner cannot be demoted', async () => {
    const owner = await anonSession()
    const ws = await createWorkspace(owner.token)

    const res = await fetch(`${baseUrl}/api/workspaces/${ws}/members/${owner.userId}`, {
      method: 'PATCH',
      headers: { ...authHeader(owner.token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'editor' }),
    })
    expect(res.status).toBe(400)
  })

  test('the last owner cannot be removed', async () => {
    const owner = await anonSession()
    const ws = await createWorkspace(owner.token)

    const res = await fetch(`${baseUrl}/api/workspaces/${ws}/members/${owner.userId}`, {
      method: 'DELETE',
      headers: authHeader(owner.token),
    })
    expect(res.status).toBe(400)
  })

  test('an owner can be demoted once a second owner exists', async () => {
    const owner = await anonSession()
    const ws = await createWorkspace(owner.token)
    const secret = await createInvite(owner.token, ws, 'editor')

    const friend = await anonSession()
    await redeemInvite(friend.token, secret)
    await fetch(`${baseUrl}/api/workspaces/${ws}/members/${friend.userId}`, {
      method: 'PATCH',
      headers: { ...authHeader(owner.token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'owner' }),
    })

    const res = await fetch(`${baseUrl}/api/workspaces/${ws}/members/${owner.userId}`, {
      method: 'PATCH',
      headers: { ...authHeader(owner.token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'editor' }),
    })
    expect(res.status).toBe(200)
  })
})

describe('Member session recovery', () => {
  test('owner-issued recovery link re-authenticates the same principal', async () => {
    const owner = await anonSession()
    const ws = await createWorkspace(owner.token)
    const secret = await createInvite(owner.token, ws, 'editor')

    const friend = await anonSession()
    await redeemInvite(friend.token, secret)

    // friend "loses" their token — simulate by generating a recovery link as owner.
    const linkRes = await fetch(
      `${baseUrl}/api/workspaces/${ws}/members/${friend.userId}/recovery-link`,
      { method: 'POST', headers: authHeader(owner.token) },
    )
    expect(linkRes.status).toBe(201)
    const link = await linkRes.json()

    const recoverRes = await fetch(`${baseUrl}/api/sessions/recover`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: link.secret }),
    })
    expect(recoverRes.status).toBe(200)
    const { token: recoveredToken } = await recoverRes.json()

    const meRes = await fetch(`${baseUrl}/api/workspaces/${ws}/members`, {
      headers: authHeader(recoveredToken),
    })
    expect(meRes.status).toBe(200)
    const members = await meRes.json()
    const recoveredMember = members.find((m: { user_id: number }) => m.user_id === friend.userId)
    expect(recoveredMember.role).toBe('editor')
  })
})

describe('Anonymous onboarding', () => {
  test('a principal never authenticated via GitHub can create a workspace and add a document', async () => {
    const session = await anonSession()
    const ws = await createWorkspace(session.token)

    const res = await fetch(`${baseUrl}/api/workspaces/${ws}/collections/expenses/documents`, {
      method: 'POST',
      headers: { ...authHeader(session.token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: { amount: 42 } }),
    })
    expect(res.status).toBe(201)
  })
})
