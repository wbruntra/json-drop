import type { Context } from 'hono'
import { createUser, createApiToken } from '../services'
import { generateToken } from '../middleware'

async function createUserWithToken(): Promise<{ token: string }> {
  const mockGithubId = `dev-${Date.now()}`
  const mockEmail = `${mockGithubId}@dev.local`
  const mockDisplayName = `Dev User ${mockGithubId.split('-')[1]}`

  const user = await createUser(mockGithubId, mockEmail, mockDisplayName)

  const rawToken = generateToken()
  await createApiToken(user.id, 'Dev Admin Token', rawToken, 'admin')

  console.log('\n=== DEV LOGIN ===')
  console.log(`Created user: ${mockDisplayName} (ID: ${user.id})`)
  console.log(`Token: ${rawToken}`)
  console.log('=================\n')

  return { token: rawToken }
}

export async function handleDevLogin(c: Context): Promise<Response> {
  if (process.env.NODE_ENV !== 'development') {
    return c.json({ error: 'Not available in production' }, 404)
  }

  const { token } = await createUserWithToken()

  const html = `<!doctype html>
<html><body><script>
localStorage.setItem('token', '${token}')
window.location.href = '/'
</script></body></html>`

  return new Response(html, {
    headers: { 'Content-Type': 'text/html' },
  })
}

export async function handleDevCreateToken(c: Context): Promise<Response> {
  if (process.env.NODE_ENV !== 'development') {
    return c.json({ error: 'Not available in production' }, 404)
  }

  const { token } = await createUserWithToken()
  return c.json({
    token,
    permissions: 'admin',
    message: 'Dev token created. Use this in Authorization header.',
  })
}
