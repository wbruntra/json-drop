import { useEffect, useRef, useState } from 'preact/hooks'
import { api } from '../api'
import { href, navigate } from '../router'

export type ProjectSummary = {
  id: string
  name: string
  created_at: string
  doc_count: number
  last_write_at: string | null
  key_count: number
}

export function timeAgo(iso: string | null): string {
  if (!iso) return 'never'
  // SQLite CURRENT_TIMESTAMP is UTC without a zone marker.
  const then = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z').getTime()
  const s = Math.max(0, (Date.now() - then) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`
  return new Date(then).toLocaleDateString()
}

export function ProjectsHome() {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const nameInput = useRef<HTMLInputElement>(null)

  // The autofocus attribute only applies on page load, so focus on open.
  useEffect(() => {
    if (creating) nameInput.current?.focus()
  }, [creating])

  useEffect(() => {
    api('/api/projects').then(async (res) => {
      if (res.ok) setProjects(await res.json())
      else setError('Failed to load projects')
    })
  }, [])

  const handleCreate = async (e: Event) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    const res = await api('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: trimmed }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.message || 'Failed to create project')
      return
    }
    const created = await res.json()
    // A new project's first job is connecting an app, so land on Connect.
    navigate('projects', created.id, 'connect')
  }

  return (
    <div class="page">
      <div class="page-header">
        <div>
          <h2 class="page-title">Projects</h2>
          <p class="page-subtitle">
            One project per app. Each has its own documents, keys and workspaces.
          </p>
        </div>
        {!creating && (
          <button class="create-btn" onClick={() => setCreating(true)}>
            + New project
          </button>
        )}
      </div>

      {creating && (
        <form class="section new-project-form" onSubmit={handleCreate}>
          <label class="project-selector-label" for="new-project-name">
            Project name
          </label>
          <div class="project-create-row">
            <input
              id="new-project-name"
              type="text"
              placeholder="e.g. Shared Expenses"
              ref={nameInput}
              value={name}
              onInput={(e) => setName((e.target as HTMLInputElement).value)}
            />
            <button class="create-btn" type="submit">
              Create
            </button>
            <button
              class="dismiss-btn"
              type="button"
              onClick={() => {
                setCreating(false)
                setName('')
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {error && <p class="project-selector-error">{error}</p>}

      {projects === null ? (
        <p class="empty">Loading projects…</p>
      ) : projects.length === 0 ? (
        <div class="section empty-state">
          <h3>No projects yet</h3>
          <p>Create a project for your first app, then add a key and start writing documents.</p>
          {!creating && (
            <button class="create-btn" onClick={() => setCreating(true)}>
              Create your first project
            </button>
          )}
        </div>
      ) : (
        <ul class="project-grid">
          {projects.map((p) => (
            <li key={p.id}>
              <a class="project-card" href={href('projects', p.id)}>
                <span class="project-card-name">{p.name}</span>
                <code class="project-card-id">{p.id}</code>
                <dl class="project-card-stats">
                  <div>
                    <dt>Docs</dt>
                    <dd>{p.doc_count}</dd>
                  </div>
                  <div>
                    <dt>Keys</dt>
                    <dd>{p.key_count}</dd>
                  </div>
                  <div>
                    <dt>Last write</dt>
                    <dd>{timeAgo(p.last_write_at)}</dd>
                  </div>
                </dl>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
