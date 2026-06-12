import { getGitHubAuthUrl, exchangeGitHubCode, getGitHubUser, generateState } from '../auth'
import { createUser, createApiToken } from '../services'
import { corsHeaders, generateToken, hashToken } from '../middleware'

const pendingStates = new Map<string, number>()

export function handleGitHubAuth(_req: Request): Response {
  if (process.env.NODE_ENV === 'development') {
    return new Response(null, {
      status: 302,
      headers: { Location: '/api/dev/login', ...corsHeaders() },
    })
  }

  const state = generateState()
  pendingStates.set(state, Date.now())

  setTimeout(() => pendingStates.delete(state), 10 * 60 * 1000)

  const url = getGitHubAuthUrl(state)
  return new Response(null, {
    status: 302,
    headers: { Location: url, ...corsHeaders() },
  })
}

export async function handleGitHubCallback(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const error = url.searchParams.get('error')

  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173'

  if (error) {
    return new Response(null, {
      status: 302,
      headers: {
        Location: `${frontendUrl}/?error=${encodeURIComponent(error)}`,
        ...corsHeaders(),
      },
    })
  }

  if (!code || !state || !pendingStates.has(state)) {
    return new Response(null, {
      status: 302,
      headers: { Location: `${frontendUrl}/?error=invalid_callback`, ...corsHeaders() },
    })
  }

  pendingStates.delete(state)

  try {
    const accessToken = await exchangeGitHubCode(code)
    const ghUser = await getGitHubUser(accessToken)

    const user = await createUser(ghUser.id, ghUser.email, ghUser.name || ghUser.login)

    const rawToken = generateToken()
    const tokenHash = hashToken(rawToken)
    await createApiToken(user.id, 'Default Token', tokenHash, 'admin')

    const html = `<!doctype html>
<html><body><script>
localStorage.setItem('token', '${rawToken}')
window.location.href = '${frontendUrl}'
</script></body></html>`

    return new Response(html, {
      status: 200,
      headers: { 'Content-Type': 'text/html', ...corsHeaders() },
    })
  } catch (e) {
    console.error('GitHub OAuth error:', e)
    return new Response(null, {
      status: 302,
      headers: { Location: `${frontendUrl}/?error=auth_failed`, ...corsHeaders() },
    })
  }
}

export function handleLogout(): Response {
  const html = `<!doctype html>
<html><body><script>
localStorage.removeItem('token')
window.location.href = '/'
</script></body></html>`

  return new Response(html, {
    headers: { 'Content-Type': 'text/html', ...corsHeaders() },
  })
}
