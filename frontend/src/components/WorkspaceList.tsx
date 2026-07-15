import { useState, useEffect } from 'preact/hooks'
import { api } from '../api'

export type Workspace = {
  id: string
  name: string
  project_id: string | null
  created_at: string
}

type Props = {
  selectedId: string | null
  onSelect: (id: string) => void
}

export function WorkspaceList({ selectedId, onSelect }: Props) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [isCreating, setIsCreating] = useState(false)
  const [newName, setNewName] = useState('')

  const [joinSecret, setJoinSecret] = useState('')
  const [joining, setJoining] = useState(false)
  const [joinError, setJoinError] = useState<string | null>(null)

  const fetchWorkspaces = async () => {
    setLoading(true)
    setError(null)
    const res = await api('/api/workspaces')
    if (res.ok) {
      const data: Workspace[] = await res.json()
      setWorkspaces(data)
      if (!selectedId && data.length > 0) onSelect(data[0].id)
    } else {
      setError('Failed to load workspaces')
    }
    setLoading(false)
  }

  useEffect(() => {
    fetchWorkspaces()
  }, [])

  const handleCreate = async () => {
    const name = newName.trim()
    if (!name) return

    const res = await api('/api/workspaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
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

  const handleJoin = async () => {
    const secret = joinSecret.trim()
    if (!secret) return

    setJoining(true)
    setJoinError(null)
    const res = await api('/api/invites/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret }),
    })
    setJoining(false)

    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setJoinError(data.message || 'Failed to redeem invite')
      return
    }

    const { workspace_id } = await res.json()
    setJoinSecret('')
    await fetchWorkspaces()
    onSelect(workspace_id)
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

      <div class="workspace-join-row">
        <label class="project-selector-label">Join a workspace</label>
        <div class="project-selector-row">
          <input
            type="text"
            placeholder="Paste invite secret"
            value={joinSecret}
            onInput={(e) => setJoinSecret((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleJoin()
            }}
          />
          <button class="create-btn" onClick={handleJoin} disabled={joining}>
            {joining ? 'Joining...' : 'Join'}
          </button>
        </div>
        {joinError && <span class="project-selector-error">{joinError}</span>}
      </div>
    </div>
  )
}
