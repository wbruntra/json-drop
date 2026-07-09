import type { Context } from 'hono'
import { unauthenticated } from './errors'

export function handleMe(c: Context): Response {
  const auth = c.get('auth')
  if (!auth.user) {
    return unauthenticated(c)
  }

  return c.json({
    id: auth.user.id,
    github_id: auth.user.github_id,
    email: auth.user.email,
    display_name: auth.user.display_name,
  })
}
