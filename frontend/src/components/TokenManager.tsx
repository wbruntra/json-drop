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

type Props = {
  // A project's keys, or null for account keys.
  projectId: string | null
  onChange?: () => void
}

const PROJECT_OPTIONS = [
  {
    value: 'read_write',
    label: 'Read/write',
    help: 'For trusted code: servers, scripts, your own app.',
  },
  { value: 'read', label: 'Read only', help: 'Safe to ship in a public frontend.' },
]
const ACCOUNT_OPTIONS = [
  { value: 'admin', label: 'Account', help: 'Manages all projects and keys.' },
]

const PERMISSION_LABELS: Record<string, string> = {
  read: 'read only',
  read_write: 'read/write',
  write: 'write (legacy)',
  admin: 'account',
}

export function TokenManager({ projectId, onChange }: Props) {
  const options = projectId ? PROJECT_OPTIONS : ACCOUNT_OPTIONS
  const [tokens, setTokens] = useState<Token[]>([])
  const [newName, setNewName] = useState('')
  const [newPermissions, setNewPermissions] = useState(options[0]!.value)
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [justCreated, setJustCreated] = useState<string | null>(null)
  const { copiedId, copy } = useCopy()

  const fetchData = async () => {
    const query = projectId ? `?project=${encodeURIComponent(projectId)}` : ''
    const res = await api(`/api/tokens${query}`)
    if (res.ok) {
      const all: Token[] = await res.json()
      setTokens(projectId ? all : all.filter((t) => t.project_id === null))
    } else {
      setError('Failed to load keys')
    }
    setLoading(false)
  }

  useEffect(() => {
    fetchData()
  }, [projectId])

  const handleCreate = async (e: Event) => {
    e.preventDefault()
    const name = newName.trim()
    if (!name) {
      setError('Give the key a name so you can recognize it later.')
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
      const data = await res.json()
      setJustCreated(data.token)
      setNewName('')
      await fetchData()
      onChange?.()
    } else {
      const data = await res.json().catch(() => ({}))
      setError(data.message || 'Failed to create key')
    }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('Revoke this key? Anything using it will lose access immediately.')) return
    const res = await api(`/api/tokens/${id}`, { method: 'DELETE' })
    if (res.ok) {
      await fetchData()
      onChange?.()
    }
  }

  if (loading) return <p class="empty">Loading keys…</p>

  const selected = options.find((o) => o.value === newPermissions) ?? options[0]!

  return (
    <div class="token-manager">
      <form class="create-token" onSubmit={handleCreate}>
        <input
          type="text"
          aria-label="Key name"
          placeholder={projectId ? 'Key name (e.g. web-app)' : 'Key name (e.g. backup-script)'}
          value={newName}
          onInput={(e) => setNewName((e.target as HTMLInputElement).value)}
        />
        {options.length > 1 && (
          <select
            aria-label="Permissions"
            value={newPermissions}
            onChange={(e) => setNewPermissions((e.target as HTMLSelectElement).value)}
          >
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        )}
        <button class="create-btn" type="submit" disabled={creating}>
          {creating ? 'Creating…' : 'Create key'}
        </button>
      </form>
      <p class="form-help">{selected.help}</p>
      {error && <span class="project-selector-error">{error}</span>}

      {justCreated && (
        <div class="new-key">
          <strong>New key created.</strong> Copy it into your app's config now.
          <div class="token-row">
            <code class="token-display">{justCreated}</code>
            <button class="copy-btn" onClick={() => copy(justCreated, 'new-key')}>
              {copiedId === 'new-key' ? 'Copied!' : 'Copy'}
            </button>
            <button class="dismiss-btn" onClick={() => setJustCreated(null)}>
              Done
            </button>
          </div>
        </div>
      )}

      <div class="token-list">
        {tokens.length === 0 ? (
          <p class="empty">
            {projectId
              ? 'No keys for this project yet.'
              : 'No account keys. The dashboard does not need one.'}
          </p>
        ) : (
          tokens.map((token) => {
            const copyId = `tok-${token.id}`
            return (
              <div key={token.id} class="token-item">
                <div class="token-info">
                  <div class="token-title">
                    <strong>{token.name}</strong>
                    <span class={`permissions ${token.permissions}`}>
                      {PERMISSION_LABELS[token.permissions] ?? token.permissions}
                    </span>
                  </div>
                  <div class="token-row">
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
