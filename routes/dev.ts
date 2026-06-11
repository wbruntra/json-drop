import { createUser, createApiToken } from '../database'
import { jsonResponse, corsHeaders, generateToken, hashToken } from '../middleware'

function createUserWithToken(): { token: string } {
  const mockGithubId = `dev-${Date.now()}`
  const mockEmail = `${mockGithubId}@dev.local`
  const mockDisplayName = `Dev User ${mockGithubId.split('-')[1]}`

  const user = createUser(mockGithubId, mockEmail, mockDisplayName)

  const rawToken = generateToken()
  const tokenHash = hashToken(rawToken)
  createApiToken(user.id, 'Dev Admin Token', tokenHash, 'admin')

  console.log('\n=== DEV LOGIN ===')
  console.log(`Created user: ${mockDisplayName} (ID: ${user.id})`)
  console.log(`Token: ${rawToken}`)
  console.log('=================\n')

  return { token: rawToken }
}

export function handleDevLogin(): Response {
  if (process.env.NODE_ENV !== 'development') {
    return jsonResponse({ error: 'Not available in production' }, 404)
  }

  const { token } = createUserWithToken()

  const html = `<!doctype html>
<html><body><script>
localStorage.setItem('token', '${token}')
window.location.href = '/'
</script></body></html>`

  return new Response(html, {
    headers: { 'Content-Type': 'text/html', ...corsHeaders() },
  })
}

export function handleDevCreateToken(): Response {
  if (process.env.NODE_ENV !== 'development') {
    return jsonResponse({ error: 'Not available in production' }, 404)
  }

  const { token } = createUserWithToken()
  return jsonResponse({
    token,
    permissions: 'admin',
    message: 'Dev token created. Use this in Authorization header.',
  })
}
