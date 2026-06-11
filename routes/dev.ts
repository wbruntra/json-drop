import { createSession, setSessionCookie } from '../auth'
import { createUser, createApiToken, getDb } from '../database'
import { jsonResponse, corsHeaders, generateToken, hashToken } from '../middleware'

export async function handleDevLogin(): Promise<Response> {
  if (process.env.NODE_ENV !== 'development') {
    return jsonResponse({ error: 'Not available in production' }, 404)
  }

  const mockGithubId = `dev-${Date.now()}`
  const mockEmail = `${mockGithubId}@dev.local`
  const mockDisplayName = `Dev User ${mockGithubId.split('-')[1]}`

  const user = createUser(mockGithubId, mockEmail, mockDisplayName)

  console.log('\n=== DEV LOGIN ===')
  console.log(`Created user: ${mockDisplayName}`)
  console.log(`GitHub ID: ${mockGithubId}`)
  console.log(`Email: ${mockEmail}`)
  console.log(`User ID: ${user.id}`)
  console.log('=================\n')

  const token = await createSession(user)
  console.log(`Session token: ${token}\n`)

  return new Response(null, {
    status: 302,
    headers: {
      Location: '/',
      'Set-Cookie': setSessionCookie(token),
      ...corsHeaders(),
    },
  })
}

export function handleDevCreateToken(): Response {
  if (process.env.NODE_ENV !== 'development') {
    return jsonResponse({ error: 'Not available in production' }, 404)
  }

  const db = getDb()
  const user = db.prepare('SELECT * FROM users ORDER BY id DESC LIMIT 1').get() as {
    id: number
  } | null

  if (!user) {
    return jsonResponse({ error: 'No users found. Create one first with /api/dev/login' }, 400)
  }

  const rawToken = generateToken()
  const tokenHash = hashToken(rawToken)
  createApiToken(user.id, 'Dev Token', tokenHash, 'admin')

  console.log('\n=== DEV TOKEN ===')
  console.log(`Created API token for user ID: ${user.id}`)
  console.log(`Token: ${rawToken}`)
  console.log('Permissions: admin')
  console.log('=================\n')

  return jsonResponse({
    token: rawToken,
    user_id: user.id,
    permissions: 'admin',
    message: 'Dev token created. Use this in Authorization header.',
  })
}
