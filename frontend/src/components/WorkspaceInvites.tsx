import { useState, useEffect } from 'preact/hooks'
import { api } from '../api'
import { useCopy } from '../useCopy'

type InvitableRole = 'admin' | 'editor' | 'viewer'

type Invite = {
  id: string
  role: InvitableRole
  expires_at: string | null
  max_uses: number | null
  use_count: number
  created_at: string
}

type Props = {
  workspaceId: string
}

export function WorkspaceInvites({ workspaceId }: Props) {
  const [invites, setInvites] = useState<Invite[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [newRole, setNewRole] = useState<InvitableRole>('editor')
  const [maxUses, setMaxUses] = useState('')
  const [creating, setCreating] = useState(false)
  const [createdSecret, setCreatedSecret] = useState<string | null>(null)
  const { copiedId, copy } = useCopy()

  const fetchInvites = async () => {
    setLoading(true)
    const res = await api(`/api/workspaces/${workspaceId}/invites`)
    if (res.ok) setInvites(await res.json())
    setLoading(false)
  }

  useEffect(() => {
    fetchInvites()
    setCreatedSecret(null)
  }, [workspaceId])

  const handleCreate = async () => {
    setCreating(true)
    setError(null)
    const res = await api(`/api/workspaces/${workspaceId}/invites`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        role: newRole,
        ...(maxUses.trim() ? { max_uses: parseInt(maxUses, 10) } : {}),
      }),
    })
    setCreating(false)
    if (res.ok) {
      const data = await res.json()
      setCreatedSecret(data.secret)
      setMaxUses('')
      fetchInvites()
    } else {
      const data = await res.json().catch(() => ({}))
      setError(data.message || 'Failed to create invite')
    }
  }

  const handleRevoke = async (id: string) => {
    if (!confirm('Revoke this invite? The link will stop working immediately.')) return
    const res = await api(`/api/workspaces/${workspaceId}/invites/${id}`, { method: 'DELETE' })
    if (res.ok) fetchInvites()
  }

  if (loading) return <div>Loading invites...</div>

  return (
    <div class="workspace-invites">
      {createdSecret && (
        <div class="alert">
          <p>
            <strong>Invite created!</strong> Copy the secret now — it will not be shown again.
          </p>
          <code class="secret-display">{createdSecret}</code>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
            <button class="copy-btn" onClick={() => copy(createdSecret, 'invite-secret')}>
              {copiedId === 'invite-secret' ? 'Copied!' : 'Copy'}
            </button>
            <button class="dismiss-btn" onClick={() => setCreatedSecret(null)}>
              Dismiss
            </button>
          </div>
        </div>
      )}

      <div class="create-token">
        <select
          value={newRole}
          onChange={(e) => setNewRole((e.target as HTMLSelectElement).value as InvitableRole)}
        >
          <option value="admin">Admin</option>
          <option value="editor">Editor</option>
          <option value="viewer">Viewer</option>
        </select>
        <input
          type="text"
          placeholder="Max uses (optional)"
          value={maxUses}
          onInput={(e) => setMaxUses((e.target as HTMLInputElement).value)}
        />
        <button class="create-btn" onClick={handleCreate} disabled={creating}>
          {creating ? 'Creating...' : 'Create Invite'}
        </button>
      </div>
      {error && <span class="project-selector-error">{error}</span>}

      <div class="token-list">
        {invites.length === 0 ? (
          <p class="empty">No active invites. Create one above.</p>
        ) : (
          invites.map((inv) => (
            <div key={inv.id} class="token-item">
              <div class="token-info">
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    flexWrap: 'wrap',
                  }}
                >
                  <span class={`role-badge role-${inv.role}`}>{inv.role}</span>
                  <span class="permissions">
                    {inv.use_count} used{inv.max_uses ? ` / ${inv.max_uses} max` : ''}
                  </span>
                </div>
                <span class="created">
                  Created {new Date(inv.created_at).toLocaleDateString()}
                  {inv.expires_at
                    ? ` · expires ${new Date(inv.expires_at).toLocaleDateString()}`
                    : ''}
                </span>
              </div>
              <button class="delete-btn" onClick={() => handleRevoke(inv.id)}>
                Revoke
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
