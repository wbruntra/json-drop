import type { Context } from 'hono'

export type ErrorCode =
  | 'bad_request'
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'storage_limit'
  | 'rate_limited'
  | 'server'

export function errorResponse(
  c: Context,
  code: ErrorCode,
  message: string,
  status: number,
  extra?: Record<string, unknown>,
): Response {
  const body: Record<string, unknown> = { code, message }
  if (extra) for (const [k, v] of Object.entries(extra)) body[k] = v
  return c.json(body, status)
}

export function badRequest(
  c: Context,
  message: string,
  extra?: Record<string, unknown>,
): Response {
  return errorResponse(c, 'bad_request', message, 400, extra)
}

export function unauthenticated(c: Context, message = 'Not authenticated'): Response {
  return errorResponse(c, 'unauthenticated', message, 401)
}

export function forbidden(c: Context, message = 'Forbidden'): Response {
  return errorResponse(c, 'forbidden', message, 403)
}

export function notFound(c: Context, message = 'Not found'): Response {
  return errorResponse(c, 'not_found', message, 404)
}

export function conflict(
  c: Context,
  message = 'Version conflict',
  extra?: Record<string, unknown>,
): Response {
  return errorResponse(c, 'conflict', message, 409, extra)
}

export function storageLimit(c: Context, message: string): Response {
  return errorResponse(c, 'storage_limit', message, 413)
}

export function serverError(c: Context, message = 'Internal server error'): Response {
  return errorResponse(c, 'server', message, 500)
}
