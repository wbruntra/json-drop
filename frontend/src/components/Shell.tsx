import { useEffect, useState } from 'preact/hooks'
import { api } from '../api'
import { href, useRoute } from '../router'
import { ProjectsHome } from './ProjectsHome'
import { ProjectDetail } from './ProjectDetail'
import { Account } from './Account'

export type User = {
  id: number
  github_id: string
  email: string | null
  display_name: string | null
}

type Props = {
  user: User
  onLogout: () => void
}

export function Shell({ user, onLogout }: Props) {
  const route = useRoute()
  const [projectName, setProjectName] = useState<string | null>(null)

  const handleLogout = async () => {
    // Revoke the session server-side; log out locally even if that fails.
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {})
    localStorage.removeItem('token')
    onLogout()
  }

  const [section, id, tab] = route
  const inProject = section === 'projects' && !!id

  useEffect(() => {
    if (!inProject) setProjectName(null)
  }, [inProject])

  return (
    <div class="app">
      <header class="header">
        <div class="header-container shell-header">
          <nav class="crumbs" aria-label="Breadcrumb">
            <a class="logo" href={href()}>
              <svg
                class="logo-icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.5"
                aria-hidden="true"
              >
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                <line x1="12" y1="22.08" x2="12" y2="12" />
              </svg>
              <h1>json-drop</h1>
            </a>
            {inProject && (
              <>
                <span class="crumb-sep">/</span>
                <a class="crumb" href={href()}>
                  Projects
                </a>
                <span class="crumb-sep">/</span>
                <span class="crumb crumb-current">{projectName ?? '…'}</span>
              </>
            )}
            {section === 'account' && (
              <>
                <span class="crumb-sep">/</span>
                <span class="crumb crumb-current">Account</span>
              </>
            )}
          </nav>

          <div class="user-info">
            <a
              class={`crumb ${section === 'account' ? 'crumb-current' : ''}`}
              href={href('account')}
            >
              Account
            </a>
            <span class="user-name">{user.display_name || user.github_id}</span>
            <button onClick={handleLogout} class="logout-btn">
              Logout
            </button>
          </div>
        </div>
      </header>

      <main class="dashboard-container">
        {inProject ? (
          <ProjectDetail key={id} projectId={id!} tab={tab} user={user} onName={setProjectName} />
        ) : section === 'account' ? (
          <Account user={user} />
        ) : (
          <ProjectsHome />
        )}
      </main>
    </div>
  )
}
