import type { Context } from 'hono'
import { getGitHubAuthUrl, exchangeGitHubCode, getGitHubUser, generateState } from '../auth'
import { createUser } from '../services'
import { createSessionForUser, revokeSessionByToken } from '../services/sessions'

const pendingStates = new Map<string, number>()

export function handleGitHubAuth(c: Context): Response {
  if (process.env.NODE_ENV === 'development') {
    return new Response(null, {
      status: 302,
      headers: { Location: '/api/dev/login' },
    })
  }

  const state = generateState()
  pendingStates.set(state, Date.now())

  setTimeout(() => pendingStates.delete(state), 10 * 60 * 1000)

  const url = getGitHubAuthUrl(state)
  return new Response(null, {
    status: 302,
    headers: { Location: url },
  })
}

export async function handleGitHubCallback(c: Context): Promise<Response> {
  const code = c.req.query('code')
  const state = c.req.query('state')
  const error = c.req.query('error')

  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173'

  if (error) {
    return new Response(null, {
      status: 302,
      headers: { Location: `${frontendUrl}/?error=${encodeURIComponent(error)}` },
    })
  }

  if (!code || !state || !pendingStates.has(state)) {
    return new Response(null, {
      status: 302,
      headers: { Location: `${frontendUrl}/?error=invalid_callback` },
    })
  }

  pendingStates.delete(state)

  try {
    const accessToken = await exchangeGitHubCode(code)
    const ghUser = await getGitHubUser(accessToken)

    const user = await createUser(ghUser.id, ghUser.email, ghUser.name || ghUser.login)

    // The dashboard authenticates with a revocable session, not an API key.
    const { token } = await createSessionForUser(user.id)

    const html = `<!doctype html>
<html><body><script>
localStorage.setItem('token', '${token}')
window.location.href = '${frontendUrl}'
</script></body></html>`

    return new Response(html, {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
    })
  } catch (e) {
    console.error('GitHub OAuth error:', e)
    return new Response(null, {
      status: 302,
      headers: { Location: `${frontendUrl}/?error=auth_failed` },
    })
  }
}

export async function handleLogout(c: Context): Promise<Response> {
  const auth = c.get('auth')
  const header = c.req.header('Authorization')
  if (auth.kind === 'session' && header?.startsWith('Bearer ')) {
    await revokeSessionByToken(header.slice(7))
  }
  return c.json({ logged_out: true })
}
