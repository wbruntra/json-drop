import type { HTMLBundle } from 'bun'
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

type BunRequest = Request & { params: Record<string, string> }

const DOCS_PREFIX = '/api/docs/'

// Bun's router does not expose wildcard matches via req.params, so the
// subpath for '/api/docs/*' has to be recovered from the URL itself.
function docPath(req: Request): string {
  const pathname = new URL(req.url).pathname
  return decodeURIComponent(pathname.slice(DOCS_PREFIX.length))
}

export type ServerOptions = {
  port?: number
  homepage?: HTMLBundle
  development?: { hmr: boolean; console: boolean } | false
}

type RouteHandler = (req: Request) => Response | Promise<Response>

export function createServer(options: ServerOptions = {}) {
  const routes: Record<string, HTMLBundle | RouteHandler> = {
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
      method('GET', async (req) => {
        const auth = await extractAuth(req)
        return handleListDocs(req, auth)
      }),
    ),
    '/api/docs/*': withMiddleware(
      method('GET', async (req) => {
        const auth = await extractAuth(req)
        return handleGetDoc(req, auth, docPath(req))
      }),
      method('PUT', async (req) => {
        const auth = await extractAuth(req)
        return handleUpsertDoc(req, auth, docPath(req))
      }),
      method('DELETE', async (req) => {
        const auth = await extractAuth(req)
        return handleDeleteDoc(req, auth, docPath(req))
      }),
    ),

    '/api/dev/login': withMiddleware(method('GET', handleDevLogin)),
    '/api/dev/token': withMiddleware(method('POST', handleDevCreateToken)),
  }

  if (options.homepage) {
    routes['/'] = options.homepage
  }

  return Bun.serve({
    port: options.port ?? 3000,
    routes,

    development: options.development ?? false,

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
}
