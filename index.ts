import './database'
import {
  extractAuth,
  checkRateLimit,
  getRateLimitKey,
  jsonResponse,
  corsHeaders,
  withMiddleware,
  method,
} from './middleware'
import { handleGitHubAuth, handleGitHubCallback, handleLogout } from './routes/auth'
import { handleMe } from './routes/me'
import { handleCreateToken, handleListTokens, handleDeleteToken } from './routes/tokens'
import { handleUpsertDoc, handleListDocs, handleGetDoc, handleDeleteDoc } from './routes/docs'
import { handleDevLogin, handleDevCreateToken } from './routes/dev'
import homepage from './frontend/index.html'

type BunRequest = Request & { params: Record<string, string> }

const isDev = process.env.NODE_ENV === 'development'

const server = Bun.serve({
  port: process.env.PORT || 3000,

  routes: {
    '/': homepage,

    '/api/auth/github': withMiddleware(method('GET', handleGitHubAuth)),
    '/gh/callback': withMiddleware(method('GET', handleGitHubCallback)),
    '/api/auth/logout': withMiddleware(method('POST', handleLogout)),

    '/api/me': withMiddleware(
      method('GET', (req) => {
        const auth = extractAuth(req)
        return handleMe(auth)
      }),
    ),

    '/api/tokens': withMiddleware(
      method('POST', async (req) => {
        const auth = extractAuth(req)
        return handleCreateToken(req, auth)
      }),
      method('GET', (req) => {
        const auth = extractAuth(req)
        return handleListTokens(auth)
      }),
    ),
    '/api/tokens/:id': withMiddleware(
      method('DELETE', (req) => {
        const auth = extractAuth(req)
        const bunReq = req as BunRequest
        const id = bunReq.params.id
        if (!id) return jsonResponse({ error: 'Invalid token ID' }, 400)
        return handleDeleteToken(req, auth, id)
      }),
    ),

    '/api/docs': withMiddleware(
      method('PUT', async (req) => {
        const auth = extractAuth(req)
        const url = new URL(req.url)
        const path = url.searchParams.get('path') || ''
        return handleUpsertDoc(req, auth, path)
      }),
      method('GET', (req) => {
        const auth = extractAuth(req)
        return handleListDocs(req, auth)
      }),
    ),
    '/api/docs/*': withMiddleware(
      method('GET', (req) => {
        const auth = extractAuth(req)
        const bunReq = req as BunRequest
        const path = bunReq.params['*'] || ''
        return handleGetDoc(req, auth, path)
      }),
      method('PUT', async (req) => {
        const auth = extractAuth(req)
        const bunReq = req as BunRequest
        const path = bunReq.params['*'] || ''
        return handleUpsertDoc(req, auth, path)
      }),
      method('DELETE', (req) => {
        const auth = extractAuth(req)
        const bunReq = req as BunRequest
        const path = bunReq.params['*'] || ''
        return handleDeleteDoc(req, auth, path)
      }),
    ),

    '/api/dev/login': withMiddleware(method('GET', handleDevLogin)),
    '/api/dev/token': withMiddleware(method('POST', handleDevCreateToken)),
  },

  development: isDev
    ? {
        hmr: true,
        console: true,
      }
    : false,

  fetch(req) {
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() })
    }

    const rateLimitKey = getRateLimitKey(req)
    if (!checkRateLimit(rateLimitKey)) {
      return jsonResponse({ error: 'Too many requests' }, 429, {
        'Retry-After': '60',
      })
    }

    return jsonResponse({ error: 'Not found' }, 404)
  },
})

console.log(`Listening on http://localhost:${server.port}`)
if (isDev) {
  console.log('Dev mode enabled')
  console.log('Dev endpoints: /api/dev/login, /api/dev/token')
}
