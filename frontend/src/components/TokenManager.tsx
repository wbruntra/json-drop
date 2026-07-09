import { useState, useEffect } from 'preact/hooks'
import { api, getToken } from '../api'
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

const SESSION_BADGE = {
  ...SCOPE_BADGE,
  color: 'var(--success-text)',
  background: 'var(--success-bg)',
  borderColor: 'var(--success-border)',
}

export function TokenManager({ projectId }: Props) {
  const [tokens, setTokens] = useState<Token[]>([])
  const [projects, setProjects] = useState<Map<string, string>>(new Map())
  const [newName, setNewName] = useState('')
  const [newPermissions, setNewPermissions] = useState('read_write')
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { copiedId, copy } = useCopy()

  const sessionToken = getToken()

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
      setError(data.error || 'Failed to create token')
    }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('Revoke this token? Apps using it will lose access immediately.')) return
    const res = await api(`/api/tokens/${id}`, { method: 'DELETE' })
    if (res.ok) fetchData()
  }

  if (loading) return <div>Loading tokens...</div>

  // Order: current session first, then tokens for this project, then the rest.
  const sorted = [...tokens].sort((a, b) => {
    const aSession = a.token === sessionToken ? 0 : 1
    const bSession = b.token === sessionToken ? 0 : 1
    if (aSession !== bSession) return aSession - bSession
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
          <option value="read">Read</option>
          <option value="write">Write</option>
          <option value="read_write">Read/Write</option>
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
        New token will be scoped to{' '}
        <strong>{projectId ? 'this project' : 'your global scope'}</strong>. Copy it from the list
        below — it is stored on the server, not in your browser.
      </p>

      <div class="token-list">
        {sorted.length === 0 ? (
          <p class="empty">No tokens yet. Create one above.</p>
        ) : (
          sorted.map((token) => {
            const isSession = token.token === sessionToken
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
                    {isSession && <span style={SESSION_BADGE}>Current session</span>}
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
                {!isSession && (
                  <button onClick={() => handleDelete(token.id)} class="delete-btn">
                    Revoke
                  </button>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
