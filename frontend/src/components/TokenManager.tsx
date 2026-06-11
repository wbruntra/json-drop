import { useState, useEffect } from 'preact/hooks'
import { api, storeCreatedToken, getCreatedTokens } from '../api'

type Token = {
  id: number
  name: string
  permissions: string
  created_at: string
}

export function TokenManager() {
  const [tokens, setTokens] = useState<Token[]>([])
  const [newToken, setNewToken] = useState('')
  const [newPermissions, setNewPermissions] = useState('read_write')
  const [createdToken, setCreatedToken] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchTokens = async () => {
    const res = await api('/api/tokens')
    if (res.ok) {
      const data = await res.json()
      setTokens(data)
    }
    setLoading(false)
  }

  useEffect(() => {
    fetchTokens()
  }, [])

  const handleCreate = async () => {
    if (!newToken.trim()) return

    const res = await api('/api/tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newToken, permissions: newPermissions }),
    })

    if (res.ok) {
      const data = await res.json()
      storeCreatedToken(data.token)
      setCreatedToken(data.token)
      setNewToken('')
      fetchTokens()
    }
  }

  const handleDelete = async (id: number) => {
    const res = await api(`/api/tokens/${id}`, { method: 'DELETE' })

    if (res.ok) {
      fetchTokens()
    }
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
  }

  if (loading) return <div>Loading tokens...</div>

  const storedTokens = getCreatedTokens()

  return (
    <div class="token-manager">
      {storedTokens.length > 0 && (
        <div class="alert">
          <p>
            <strong>Your tokens</strong> — use these in API calls or the examples below.
          </p>
          {storedTokens.map((t, i) => (
            <div key={i} class="token-row">
              <code class="token-display">{t}</code>
              <button onClick={() => copyToClipboard(t)} class="copy-btn">
                Copy
              </button>
            </div>
          ))}
        </div>
      )}
      {createdToken && !storedTokens.includes(createdToken) && (
        <div class="alert">
          <p>
            <strong>New token created!</strong>
          </p>
          <div class="token-row">
            <code class="token-display">{createdToken}</code>
            <button onClick={() => copyToClipboard(createdToken)} class="copy-btn">
              Copy
            </button>
          </div>
        </div>
      )}

      <div class="create-token">
        <input
          type="text"
          placeholder="Token name"
          value={newToken}
          onInput={(e) => setNewToken((e.target as HTMLInputElement).value)}
        />
        <select
          value={newPermissions}
          onChange={(e) => setNewPermissions((e.target as HTMLSelectElement).value)}
        >
          <option value="read">Read</option>
          <option value="write">Write</option>
          <option value="read_write">Read/Write</option>
          <option value="admin">Admin</option>
        </select>
        <button onClick={handleCreate} class="create-btn">
          Create Token
        </button>
      </div>

      <div class="token-list">
        {tokens.length === 0 ? (
          <p class="empty">No tokens yet. Create one above.</p>
        ) : (
          tokens.map((token) => (
            <div key={token.id} class="token-item">
              <div class="token-info">
                <strong>{token.name}</strong>
                <span class="permissions">{token.permissions}</span>
                <span class="created">
                  Created: {new Date(token.created_at).toLocaleDateString()}
                </span>
              </div>
              <button onClick={() => handleDelete(token.id)} class="delete-btn">
                Revoke
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
