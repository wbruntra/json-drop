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
import { handleCreateProject, handleListProjects, handleDeleteProject } from './routes/projects'
import {
  handleUpsertDoc,
  handleListDocs,
  handleGetDoc,
  handleDeleteDoc,
  handleCreateDoc,
  handleDeleteByPath,
} from './routes/docs'
import { handleDevLogin, handleDevCreateToken } from './routes/dev'

type Bindings = {
  Variables: {
    auth: AuthContext
    user_id: number | null
  }
}

export type ServerOptions = {
  port?: number
}

async function authMiddleware(c: Context, next: Next) {
  const auth = await extractAuth(c.req.raw)
  c.set('auth', auth)
  if (auth.user) c.set('user_id', auth.user.id)
  await next()
}

export function createApp() {
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
      message: { code: 'rate_limited', message: 'Too many requests' },
    }),
  )
  app.use('/api/*', authMiddleware)

  // Auth
  app.get('/api/auth/github', handleGitHubAuth)
  app.get('/gh/callback', handleGitHubCallback)
  app.post('/api/auth/logout', handleLogout)

  // Me
  app.get('/api/me', handleMe)

  // Projects
  app.post('/api/projects', handleCreateProject)
  app.get('/api/projects', handleListProjects)
  app.delete('/api/projects/:id', handleDeleteProject)

  // Tokens
  app.post('/api/tokens', handleCreateToken)
  app.get('/api/tokens', handleListTokens)
  app.delete('/api/tokens/:id', handleDeleteToken)

  // Docs — collection
  app.get('/api/docs', handleListDocs)
  app.delete('/api/docs', handleDeleteByPath)

  // Docs — wildcard
  app.get('/api/docs/:path{.+}', handleGetDoc)
  app.post('/api/docs/:path{.+}', handleCreateDoc)
  app.put('/api/docs/:path{.+}', handleUpsertDoc)
  app.delete('/api/docs/:path{.+}', handleDeleteDoc)

  // Dev
  app.get('/api/dev/login', handleDevLogin)
  app.post('/api/dev/token', handleDevCreateToken)

  return app
}

export function createServer(options: ServerOptions = {}) {
  const app = createApp()

  return Bun.serve({
    port: options.port ?? 3000,
    fetch(req, server) {
      return app.fetch(req, server)
    },
  })
}
