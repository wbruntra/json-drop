import { createHash } from 'crypto'
import { extractAuth as extractAuthService } from './services/auth'
import type { AuthContext as AuthContextService } from './services/auth'

export type AuthContext = AuthContextService

export { type AuthContextService as AuthContextTyped }

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

export function extractAuth(req: Request): Promise<AuthContext> {
  return extractAuthService(req)
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

type RouteHandler = (req: Request) => Response | Promise<Response>

type MethodHandler = {
  method: string
  handler: RouteHandler
}

export function method(m: string, handler: RouteHandler): MethodHandler {
  return { method: m.toUpperCase(), handler }
}

export function withMiddleware(...handlers: MethodHandler[]): RouteHandler {
  return async (req) => {
    const start = Date.now()
    const url = new URL(req.url)
    let res: Response

    if (req.method === 'OPTIONS') {
      res = new Response(null, { status: 204, headers: corsHeaders() })
    } else {
      const rateLimitKey = getRateLimitKey(req)
      if (!checkRateLimit(rateLimitKey)) {
        res = jsonResponse({ error: 'Too many requests' }, 429, { 'Retry-After': '60' })
      } else {
        const handler = handlers.find((h) => h.method === req.method)
        if (!handler) {
          res = jsonResponse({ error: 'Method not allowed' }, 405)
        } else {
          res = await handler.handler(req)
        }
      }
    }

    console.log(
      `${dim(req.method)} ${url.pathname} ${colorStatus(res.status)} ${dim(`${Date.now() - start}ms`)}`,
    )
    return res
  }
}
