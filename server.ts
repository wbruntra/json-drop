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
  app.get('/api/auth/github', handleGitHubAuth)
  app.get('/gh/callback', handleGitHubCallback)
  app.post('/api/auth/logout', handleLogout)

  // Me
  app.get('/api/me', handleMe)

  // Tokens
  app.post('/api/tokens', handleCreateToken)
  app.get('/api/tokens', handleListTokens)
  app.delete('/api/tokens/:id', handleDeleteToken)

  // Docs — collection
  app.get('/api/docs', handleListDocs)

  // Docs — wildcard
  app.get('/api/docs/:path{.+}', handleGetDoc)
  app.put('/api/docs/:path{.+}', handleUpsertDoc)
  app.delete('/api/docs/:path{.+}', handleDeleteDoc)

  // Dev
  app.get('/api/dev/login', handleDevLogin)
  app.post('/api/dev/token', handleDevCreateToken)

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
