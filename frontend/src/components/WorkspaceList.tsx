import { useState, useEffect } from 'preact/hooks'
import { api } from '../api'

export type Workspace = {
  id: string
  name: string
  project_id: string | null
  created_at: string
}

type Props = {
  projectId: string
  selectedId: string | null
  onSelect: (id: string) => void
}

export function WorkspaceList({ projectId, selectedId, onSelect }: Props) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [isCreating, setIsCreating] = useState(false)
  const [newName, setNewName] = useState('')

  const fetchWorkspaces = async () => {
    setLoading(true)
    setError(null)
    const res = await api('/api/workspaces')
    if (res.ok) {
      const all: Workspace[] = await res.json()
      const data = all.filter((w) => w.project_id === projectId)
      setWorkspaces(data)
      if (!selectedId && data[0]) onSelect(data[0].id)
    } else {
      setError('Failed to load workspaces')
    }
    setLoading(false)
  }

  useEffect(() => {
    fetchWorkspaces()
  }, [projectId])

  const handleCreate = async () => {
    const name = newName.trim()
    if (!name) return

    const res = await api('/api/workspaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, project_id: projectId }),
    })

    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.message || 'Failed to create workspace')
      return
    }

    const created: Workspace = await res.json()
    setWorkspaces((prev) => [...prev, created])
    setNewName('')
    setIsCreating(false)
    setError(null)
    onSelect(created.id)
  }

  return (
    <div class="workspace-list-panel">
      <div class="section-header" style={{ marginBottom: '1rem' }}>
        <h2>Workspaces</h2>
      </div>

      {loading ? (
        <p class="empty">Loading...</p>
      ) : workspaces.length === 0 ? (
        <p class="empty">No workspaces yet. Create one below.</p>
      ) : (
        <ul class="workspace-list">
          {workspaces.map((w) => (
            <li
              key={w.id}
              class={`workspace-item ${w.id === selectedId ? 'active' : ''}`}
              onClick={() => onSelect(w.id)}
            >
              <span class="workspace-item-name">{w.name}</span>
              <span class="workspace-item-id">{w.id}</span>
            </li>
          ))}
        </ul>
      )}

      {error && <span class="project-selector-error">{error}</span>}

      {isCreating ? (
        <div class="project-create-row" style={{ marginTop: '0.75rem' }}>
          <input
            type="text"
            placeholder="Workspace name"
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
            }}
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          class="create-btn"
          style={{ width: '100%', marginTop: '0.75rem' }}
          onClick={() => setIsCreating(true)}
        >
          + New Workspace
        </button>
      )}
    </div>
  )
}
