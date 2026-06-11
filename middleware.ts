import { verifySession } from './auth'
import { getUser, getApiTokenByHash } from './database'
import { createHash } from 'crypto'

export type AuthContext = {
  user: { id: number; github_id: string; email: string | null; display_name: string | null } | null
  tokenPermissions: string | null
}

const rateLimitMap = new Map<string, { count: number; resetAt: number }>()

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function generateToken(): string {
  return `jd_${crypto.randomUUID().replace(/-/g, '')}${crypto.randomUUID().replace(/-/g, '')}`
}

export function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
  }
}

export function checkRateLimit(key: string): boolean {
  const now = Date.now()
  const entry = rateLimitMap.get(key)

  if (!entry || now >= entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + 60_000 })
    return true
  }

  if (entry.count >= 100) {
    return false
  }

  entry.count++
  return true
}

export async function extractAuth(req: Request): Promise<AuthContext> {
  const ctx: AuthContext = { user: null, tokenPermissions: null }

  const authHeader = req.headers.get('Authorization')
  if (authHeader?.startsWith('Bearer ')) {
    const rawToken = authHeader.slice(7)
    const tokenHash = hashToken(rawToken)
    const token = getApiTokenByHash(tokenHash)
    if (token) {
      const user = getUser(token.user_id)
      if (user) {
        ctx.user = user
        ctx.tokenPermissions = token.permissions
        return ctx
      }
    }
  }

  const cookie = req.headers.get('Cookie')
  if (cookie) {
    const match = cookie.match(/session=([^;]+)/)
    if (match?.[1]) {
      const session = await verifySession(match[1])
      if (session) {
        const user = getUser(session.sub)
        if (user) {
          ctx.user = user
          ctx.tokenPermissions = 'admin'
          return ctx
        }
      }
    }
  }

  return ctx
}

export function getRateLimitKey(req: Request): string {
  const authHeader = req.headers.get('Authorization')
  if (authHeader?.startsWith('Bearer ')) {
    return `token:${hashToken(authHeader.slice(7))}`
  }
  return `ip:${req.headers.get('CF-Connecting-IP') || req.headers.get('X-Forwarded-For') || 'unknown'}`
}

export function jsonResponse(
  data: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(),
      ...extraHeaders,
    },
  })
}

type RouteHandler = (req: Request) => Response | Promise<Response>

type MethodHandler = {
  method: string
  handler: RouteHandler
}

export function method(m: string, handler: RouteHandler): MethodHandler {
  return { method: m.toUpperCase(), handler }
}

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`
const green = (s: string) => `\x1b[32m${s}\x1b[0m`
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`
const red = (s: string) => `\x1b[31m${s}\x1b[0m`

function colorStatus(status: number): string {
  if (status < 200) return dim(String(status))
  if (status < 300) return green(String(status))
  if (status < 400) return yellow(String(status))
  return red(String(status))
}

export function withMiddleware(...handlers: MethodHandler[]): RouteHandler {
  return async (req) => {
    const start = Date.now()
    const url = new URL(req.url)

    if (req.method === 'OPTIONS') {
      const res = new Response(null, { status: 204, headers: corsHeaders() })
      console.log(
        `${dim(req.method)} ${url.pathname} ${colorStatus(res.status)} ${dim(`${Date.now() - start}ms`)}`,
      )
      return res
    }

    const rateLimitKey = getRateLimitKey(req)
    if (!checkRateLimit(rateLimitKey)) {
      const res = jsonResponse({ error: 'Too many requests' }, 429, { 'Retry-After': '60' })
      console.log(
        `${dim(req.method)} ${url.pathname} ${colorStatus(res.status)} ${dim(`${Date.now() - start}ms`)}`,
      )
      return res
    }

    const handler = handlers.find((h) => h.method === req.method)
    if (!handler) {
      const res = jsonResponse({ error: 'Method not allowed' }, 405)
      console.log(
        `${dim(req.method)} ${url.pathname} ${colorStatus(res.status)} ${dim(`${Date.now() - start}ms`)}`,
      )
      return res
    }

    const res = await handler.handler(req)
    console.log(
      `${dim(req.method)} ${url.pathname} ${colorStatus(res.status)} ${dim(`${Date.now() - start}ms`)}`,
    )
    return res
  }
}
