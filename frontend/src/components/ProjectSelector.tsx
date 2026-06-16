import { useState, useEffect } from 'preact/hooks'
import { api } from '../api'

export type Project = {
  id: string
  name: string
  created_at: string
}

type Props = {
  projectId: string | null
  onChange: (projectId: string | null) => void
}

const CREATE_OPTION = '__create__'
const GLOBAL_OPTION = '__global__'

export function ProjectSelector({ projectId, onChange }: Props) {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [newName, setNewName] = useState('')

  const fetchProjects = async () => {
    setLoading(true)
    setError(null)
    const res = await api('/api/projects')
    if (res.ok) {
      const data = await res.json()
      setProjects(data)
    } else {
      setError('Failed to load projects')
    }
    setLoading(false)
  }

  useEffect(() => {
    fetchProjects()
  }, [])

  const handleSelect = (value: string) => {
    if (value === CREATE_OPTION) {
      setIsCreating(true)
      return
    }
    setIsCreating(false)
    onChange(value === GLOBAL_OPTION ? null : value)
  }

  const handleCreate = async () => {
    const name = newName.trim()
    if (!name) return

    const res = await api('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })

    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error || 'Failed to create project')
      return
    }

    const created: Project = await res.json()
    setProjects((prev) => [...prev, created])
    setNewName('')
    setIsCreating(false)
    setError(null)
    onChange(created.id)
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this project and all its documents? This cannot be undone.')) return

    const res = await api(`/api/projects/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error || 'Failed to delete project')
      return
    }

    setProjects((prev) => prev.filter((p) => p.id !== id))
    if (projectId === id) {
      onChange(null)
    }
  }

  const selectedValue = isCreating ? CREATE_OPTION : (projectId ?? GLOBAL_OPTION)

  return (
    <div class="project-selector">
      <label class="project-selector-label">Project</label>
      <div class="project-selector-row">
        <select
          class="project-selector-select"
          value={selectedValue}
          onChange={(e) => handleSelect((e.target as HTMLSelectElement).value)}
          disabled={loading}
        >
          <option value={GLOBAL_OPTION}>Global Project</option>
          {projects.length > 0 && (
            <optgroup label="Your projects">
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.id})
                </option>
              ))}
            </optgroup>
          )}
          <option value={CREATE_OPTION}>+ Create new project</option>
        </select>

        {!isCreating && projectId && (
          <button
            class="project-selector-delete"
            onClick={() => handleDelete(projectId)}
            title="Delete project"
            aria-label="Delete project"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              <line x1="10" y1="11" x2="10" y2="17" />
              <line x1="14" y1="11" x2="14" y2="17" />
            </svg>
          </button>
        )}
      </div>

      {!isCreating && projectId && (
        <div
          class="project-id-display"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.35rem',
            fontSize: '0.75rem',
            fontFamily: 'var(--font-mono)',
            color: 'var(--text-muted)',
            marginTop: '0.15rem',
          }}
        >
          <span>
            ID:{' '}
            <code
              style={{
                color: 'var(--accent)',
                background: 'var(--accent-light)',
                padding: '0.05rem 0.25rem',
                borderRadius: '4px',
                border: '1px solid rgba(99, 102, 241, 0.15)',
              }}
            >
              {projectId}
            </code>
          </span>
          <button
            onClick={() => navigator.clipboard.writeText(projectId)}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--accent)',
              cursor: 'pointer',
              padding: '0',
              display: 'inline-flex',
              alignItems: 'center',
            }}
            title="Copy Project ID"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              style={{ width: '12px', height: '12px' }}
            >
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          </button>
        </div>
      )}

      {isCreating && (
        <div class="project-create-row">
          <input
            type="text"
            placeholder="Project name"
            value={newName}
            onInput={(e) => setNewName((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreate()
            }}
            autoFocus
          />
          <button class="create-btn" onClick={handleCreate}>
            Create
          </button>
          <button
            class="dismiss-btn"
            onClick={() => {
              setIsCreating(false)
              setNewName('')
              setError(null)
            }}
          >
            Cancel
          </button>
        </div>
      )}

      {error && <span class="project-selector-error">{error}</span>}
    </div>
  )
}
