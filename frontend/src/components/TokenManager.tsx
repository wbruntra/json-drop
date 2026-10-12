import { useState, useEffect } from 'preact/hooks'
import { api } from '../api'
import { useCopy } from '../useCopy'

type Token = {
  id: number
  name: string
  token: string
  permissions: string
  project_id: string | null
  created_at: string
}

type Project = {
  id: string
  name: string
}

type Props = {
  projectId: string | null
}

const SCOPE_BADGE = {
  fontSize: '0.65rem',
  fontWeight: '700',
  letterSpacing: '0.05em',
  textTransform: 'uppercase' as const,
  padding: '0.15rem 0.4rem',
  borderRadius: '4px',
  border: '1px solid var(--border)',
  color: 'var(--text-secondary)',
  background: 'var(--bg-tertiary)',
}

export function TokenManager({ projectId }: Props) {
  const [tokens, setTokens] = useState<Token[]>([])
  const [projects, setProjects] = useState<Map<string, string>>(new Map())
  const [newName, setNewName] = useState('')
  // Account keys (admin) are never tied to a project; project keys always are.
  const permissionOptions = projectId
    ? [
        { value: 'read_write', label: 'Read/Write' },
        { value: 'read', label: 'Read only' },
      ]
    : [{ value: 'admin', label: 'Account (admin)' }]
  const [newPermissions, setNewPermissions] = useState(permissionOptions[0]!.value)
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { copiedId, copy } = useCopy()

  const fetchData = async () => {
    const [tokenRes, projRes] = await Promise.all([api('/api/tokens'), api('/api/projects')])
    if (tokenRes.ok) setTokens(await tokenRes.json())
    if (projRes.ok) {
      const list: Project[] = await projRes.json()
      setProjects(new Map(list.map((p) => [p.id, p.name])))
    }
    setLoading(false)
  }

  useEffect(() => {
    fetchData()
  }, [])

  useEffect(() => {
    setNewPermissions(permissionOptions[0]!.value)
  }, [projectId])

  const handleCreate = async () => {
    const name = newName.trim()
    if (!name) {
      setError('Give the token a name so you can recognize it later.')
      return
    }
    setCreating(true)
    setError(null)
    const res = await api('/api/tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        permissions: newPermissions,
        ...(projectId ? { project_id: projectId } : {}),
      }),
    })
    setCreating(false)
    if (res.ok) {
      setNewName('')
      fetchData()
    } else {
      const data = await res.json().catch(() => ({}))
      setError(data.message || 'Failed to create token')
    }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('Revoke this token? Apps using it will lose access immediately.')) return
    const res = await api(`/api/tokens/${id}`, { method: 'DELETE' })
    if (res.ok) fetchData()
  }

  if (loading) return <div>Loading tokens...</div>

  // Order: tokens for this project first, then the rest.
  const sorted = [...tokens].sort((a, b) => {
    const aProj = a.project_id === projectId ? 0 : 1
    const bProj = b.project_id === projectId ? 0 : 1
    if (aProj !== bProj) return aProj - bProj
    return a.id - b.id
  })

  return (
    <div class="token-manager">
      <div class="create-token">
        <input
          type="text"
          placeholder="Token name (e.g. frontend-app)"
          value={newName}
          onInput={(e) => setNewName((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleCreate()
          }}
        />
        <select
          value={newPermissions}
          onChange={(e) => setNewPermissions((e.target as HTMLSelectElement).value)}
        >
          {permissionOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <button class="create-btn" onClick={handleCreate} disabled={creating}>
          {creating ? 'Creating...' : 'Create Token'}
        </button>
      </div>
      {error && <span class="project-selector-error">{error}</span>}
      <p
        class="empty"
        style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0.25rem 0 0' }}
      >
        {projectId ? (
          <>
            New key can only access <strong>this project</strong>. Use it in your app.
          </>
        ) : (
          <>
            New key is an <strong>account key</strong>: it can manage all projects and keys. Keep
            it out of frontend code.
          </>
        )}
      </p>

      <div class="token-list">
        {sorted.length === 0 ? (
          <p class="empty">No tokens yet. Create one above.</p>
        ) : (
          sorted.map((token) => {
            const copyId = `tok-${token.id}`
            return (
              <div key={token.id} class="token-item">
                <div class="token-info">
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      flexWrap: 'wrap',
                    }}
                  >
                    <strong>{token.name}</strong>
                    <span class={`permissions ${token.permissions}`}>{token.permissions}</span>
                    {token.project_id ? (
                      <span style={SCOPE_BADGE}>
                        {projects.get(token.project_id) || token.project_id}
                      </span>
                    ) : (
                      <span style={SCOPE_BADGE}>Global</span>
                    )}
                  </div>
                  <div class="token-row" style={{ marginTop: '0.4rem' }}>
                    <code class="token-display">{token.token}</code>
                    <button onClick={() => copy(token.token, copyId)} class="copy-btn">
                      {copiedId === copyId ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                  <span class="created">
                    Created {new Date(token.created_at).toLocaleDateString()}
                  </span>
                </div>
                <button onClick={() => handleDelete(token.id)} class="delete-btn">
                  Revoke
                </button>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
