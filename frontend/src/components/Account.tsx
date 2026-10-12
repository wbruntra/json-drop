import type { User } from './Shell'
import { TokenManager } from './TokenManager'

export function Account({ user }: { user: User }) {
  return (
    <div class="page">
      <div class="page-header">
        <div>
          <h2 class="page-title">Account</h2>
          <p class="page-subtitle">
            Signed in as {user.display_name || user.github_id}
            {user.email ? ` (${user.email})` : ''} through GitHub.
          </p>
        </div>
      </div>

      <section class="section">
        <div class="section-header">
          <h2>Account keys</h2>
        </div>
        <p class="form-help" style={{ marginBottom: '1rem' }}>
          Account keys can create and delete projects and manage every key, the same as this
          dashboard. Use them only in scripts you control, never in frontend code. Apps should use
          a project key from the project's Keys tab.
        </p>
        <TokenManager projectId={null} />
      </section>
    </div>
  )
}
