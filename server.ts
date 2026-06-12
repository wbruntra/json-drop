import type { HTMLBundle } from 'bun'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { rateLimiter, MemoryStore } from 'hono-rate-limiter'
import type { Context, Next } from 'hono'
import { extractAuth } from './services/auth'
import type { AuthContext } from './services/auth'
import customLogger from './middleware/customLogger'
import { handleGitHubAuth, handleGitHubCallback, handleLogout } from './routes/auth'
import { handleMe } from './routes/me'
import { handleCreateToken, handleListTokens, handleDeleteToken } from './routes/tokens'
import { handleUpsertDoc, handleListDocs, handleGetDoc, handleDeleteDoc } from './routes/docs'
import { handleDevLogin, handleDevCreateToken } from './routes/dev'

type Bindings = {
  Variables: {
    auth: AuthContext
    user_id: number | null
  }
}

export type ServerOptions = {
  port?: number
  homepage?: HTMLBundle
  development?: { hmr: boolean; console: boolean } | false
}

async function authMiddleware(c: Context, next: Next) {
  const auth = await extractAuth(c.req.raw)
  c.set('auth', auth)
  if (auth.user) c.set('user_id', auth.user.id)
  await next()
}

export function createApp(options: ServerOptions = {}) {
  const app = new Hono<Bindings>()

  app.use('*', cors())
  app.use('*', customLogger)
  app.use(
    '/api/*',
    rateLimiter({
      windowMs: 60_000,
      limit: 100,
      store: new MemoryStore(),
      keyGenerator: (c) => {
        const authHeader = c.req.header('Authorization')
        if (authHeader?.startsWith('Bearer ')) {
          return `token:${authHeader.slice(7)}`
        }
        return `ip:${c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown'}`
      },
      message: { error: 'Too many requests' },
    }),
  )
  app.use('/api/*', authMiddleware)

  // Auth
  app.get('/api/auth/github', (c) => handleGitHubAuth(c.req.raw))
  app.get('/gh/callback', (c) => handleGitHubCallback(c.req.raw))
  app.post('/api/auth/logout', (c) => handleLogout())

  // Me
  app.get('/api/me', (c) => handleMe(c.get('auth')))

  // Tokens
  app.post('/api/tokens', (c) => handleCreateToken(c.req.raw, c.get('auth')))
  app.get('/api/tokens', (c) => handleListTokens(c.get('auth')))
  app.delete('/api/tokens/:id', (c) => {
    const id = c.req.param('id')
    if (!id) return new Response(JSON.stringify({ error: 'Invalid token ID' }), { status: 400 })
    return handleDeleteToken(c.req.raw, c.get('auth'), id)
  })

  // Docs — collection
  app.get('/api/docs', (c) => handleListDocs(c.req.raw, c.get('auth')))

  // Docs — wildcard (catch-all for nested paths)
  app.get('/api/docs/:path{.+}', (c) => {
    const path = c.req.param('path')
    return handleGetDoc(c.req.raw, c.get('auth'), path)
  })
  app.put('/api/docs/:path{.+}', (c) => {
    const path = c.req.param('path')
    return handleUpsertDoc(c.req.raw, c.get('auth'), path)
  })
  app.delete('/api/docs/:path{.+}', (c) => {
    const path = c.req.param('path')
    return handleDeleteDoc(c.req.raw, c.get('auth'), path)
  })

  // Dev
  app.get('/api/dev/login', (c) => handleDevLogin())
  app.post('/api/dev/token', (c) => handleDevCreateToken())

  // Homepage
  if (options.homepage) {
    app.get('/', () => new Response(options.homepage as unknown as BodyInit))
  }

  return app
}

export function createServer(options: ServerOptions = {}) {
  const app = createApp(options)

  return Bun.serve({
    port: options.port ?? 3000,
    development: options.development ?? false,
    async fetch(req, server) {
      if (options.homepage && new URL(req.url).pathname === '/') {
        return options.homepage as unknown as Response
      }
      return app.fetch(req, server)
    },
  })
}
