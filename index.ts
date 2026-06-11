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
import {
  handleCreateDoc,
  handleListDocs,
  handleGetDoc,
  handleUpdateDoc,
  handleDeleteDoc,
} from './routes/docs'
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
      method('GET', async (req) => {
        const auth = await extractAuth(req)
        return handleMe(auth)
      }),
    ),

    '/api/tokens': withMiddleware(
      method('POST', async (req) => {
        const auth = await extractAuth(req)
        return handleCreateToken(req, auth)
      }),
      method('GET', async (req) => {
        const auth = await extractAuth(req)
        return handleListTokens(auth)
      }),
    ),
    '/api/tokens/:id': withMiddleware(
      method('DELETE', async (req) => {
        const auth = await extractAuth(req)
        const bunReq = req as BunRequest
        const id = bunReq.params.id
        if (!id) return jsonResponse({ error: 'Invalid token ID' }, 400)
        return handleDeleteToken(req, auth, id)
      }),
    ),

    '/api/docs': withMiddleware(
      method('POST', async (req) => {
        const auth = await extractAuth(req)
        return handleCreateDoc(req, auth)
      }),
      method('GET', async (req) => {
        const auth = await extractAuth(req)
        return handleListDocs(auth)
      }),
    ),
    '/api/docs/:id': withMiddleware(
      method('GET', async (req) => {
        const auth = await extractAuth(req)
        const bunReq = req as BunRequest
        const id = bunReq.params.id
        if (!id) return jsonResponse({ error: 'Invalid document ID' }, 400)
        return handleGetDoc(req, auth, id)
      }),
      method('PUT', async (req) => {
        const auth = await extractAuth(req)
        const bunReq = req as BunRequest
        const id = bunReq.params.id
        if (!id) return jsonResponse({ error: 'Invalid document ID' }, 400)
        return handleUpdateDoc(req, auth, id)
      }),
      method('DELETE', async (req) => {
        const auth = await extractAuth(req)
        const bunReq = req as BunRequest
        const id = bunReq.params.id
        if (!id) return jsonResponse({ error: 'Invalid document ID' }, 400)
        return handleDeleteDoc(req, auth, id)
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

  async fetch(req) {
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
