import { useState } from 'preact/hooks'
import { ProjectSelector } from './ProjectSelector'
import { TokenManager } from './TokenManager'
import { DocManager } from './DocManager'
import { CurlGuide } from './CurlGuide'

type User = {
  id: number
  github_id: string
  email: string | null
  display_name: string | null
}

type Props = {
  user: User
  onLogout: () => void
}

export function Dashboard({ user, onLogout }: Props) {
  const [projectId, setProjectId] = useState<string | null>(null)

  const handleLogout = () => {
    localStorage.removeItem('token')
    onLogout()
  }

  return (
    <div class="app">
      <header class="header">
        <div class="header-container">
          <div class="logo">
            <svg
              class="logo-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
            >
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
              <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
              <line x1="12" y1="22.08" x2="12" y2="12" />
            </svg>
            <h1>json-drop</h1>
          </div>

          <div class="header-center">
            <ProjectSelector projectId={projectId} onChange={setProjectId} />
          </div>

          <div class="user-info">
            <span class="user-name">{user.display_name || user.github_id}</span>
            <button onClick={handleLogout} class="logout-btn">
              Logout
            </button>
          </div>
        </div>
      </header>

      <main class="dashboard-container">
        <div class="project-context">
          <div
            class="project-context-title"
            style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}
          >
            <span>{projectId ? 'Project Database' : 'Global Database'}</span>
            {projectId && (
              <span
                class="badge"
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.75rem',
                  textTransform: 'none',
                  background: 'var(--accent-light)',
                  color: 'var(--accent)',
                  border: '1px solid rgba(99, 102, 241, 0.2)',
                }}
              >
                ID: {projectId}
              </span>
            )}
          </div>
          <p class="project-context-help">
            {projectId
              ? 'Documents and tokens below are scoped to this project.'
              : 'Documents and tokens below are stored in your global scope.'}
          </p>
        </div>

        <div class="dashboard-grid">
          <div class="dashboard-left">
            <section class="section">
              <div class="section-header">
                <h2>Documents</h2>
                <span class="badge">{projectId ? 'project' : 'global'}</span>
              </div>
              <DocManager projectId={projectId} />
            </section>
          </div>

          <div class="dashboard-right">
            <section class="section">
              <div class="section-header">
                <h2>API Tokens</h2>
                <span class="badge">{projectId ? 'project' : 'global'}</span>
              </div>
              <TokenManager projectId={projectId} />
            </section>
          </div>
        </div>

        <section class="section guide-section">
          <CurlGuide projectId={projectId} />
        </section>
      </main>
    </div>
  )
}
