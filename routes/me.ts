import { jsonResponse } from '../middleware'
import type { AuthContext } from '../middleware'

export function handleMe(auth: AuthContext): Response {
  if (!auth.user) {
    return jsonResponse({ error: 'Not authenticated' }, 401)
  }

  return jsonResponse({
    id: auth.user.id,
    github_id: auth.user.github_id,
    email: auth.user.email,
    display_name: auth.user.display_name,
  })
}
