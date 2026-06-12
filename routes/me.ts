import type { Context } from 'hono'

export function handleMe(c: Context): Response {
  const auth = c.get('auth')
  if (!auth.user) {
    return c.json({ error: 'Not authenticated' }, 401)
  }

  return c.json({
    id: auth.user.id,
    github_id: auth.user.github_id,
    email: auth.user.email,
    display_name: auth.user.display_name,
  })
}
