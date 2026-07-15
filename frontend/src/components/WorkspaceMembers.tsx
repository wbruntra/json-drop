import { useState, useEffect } from 'preact/hooks'
import { api } from '../api'
import { useCopy } from '../useCopy'

type Role = 'owner' | 'admin' | 'editor' | 'viewer'

type Member = {
  user_id: number
  role: Role
  display_name: string | null
  kind: string
  joined_at: string
}

type Props = {
  workspaceId: string
  canManage: boolean
  currentUserId: number
}

const ROLES: Role[] = ['owner', 'admin', 'editor', 'viewer']

export function WorkspaceMembers({ workspaceId, canManage, currentUserId }: Props) {
  const [members, setMembers] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [recoveryLinks, setRecoveryLinks] = useState<Record<number, string>>({})
  const { copiedId, copy } = useCopy()

  const fetchMembers = async () => {
    setLoading(true)
    const res = await api(`/api/workspaces/${workspaceId}/members`)
    if (res.ok) setMembers(await res.json())
    setLoading(false)
  }

  useEffect(() => {
    fetchMembers()
    setRecoveryLinks({})
  }, [workspaceId])

  const handleRoleChange = async (userId: number, role: Role) => {
    setError(null)
    const res = await api(`/api/workspaces/${workspaceId}/members/${userId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    })
    if (res.ok) {
      fetchMembers()
    } else {
      const data = await res.json().catch(() => ({}))
      setError(data.message || 'Failed to change role')
    }
  }

  const handleRemove = async (userId: number) => {
    if (!confirm('Remove this member from the workspace?')) return
    setError(null)
    const res = await api(`/api/workspaces/${workspaceId}/members/${userId}`, {
      method: 'DELETE',
    })
    if (res.ok) {
      fetchMembers()
    } else {
      const data = await res.json().catch(() => ({}))
      setError(data.message || 'Failed to remove member')
    }
  }

  const handleRecoveryLink = async (userId: number) => {
    const res = await api(`/api/workspaces/${workspaceId}/members/${userId}/recovery-link`, {
      method: 'POST',
    })
    if (res.ok) {
      const data = await res.json()
      setRecoveryLinks((prev) => ({ ...prev, [userId]: data.secret }))
    } else {
      const data = await res.json().catch(() => ({}))
      setError(data.message || 'Failed to create recovery link')
    }
  }

  if (loading) return <div>Loading members...</div>

  return (
    <div class="workspace-members">
      {error && <span class="project-selector-error">{error}</span>}

      <div class="token-list">
        {members.map((m) => (
          <div key={m.user_id} class="token-item">
            <div class="token-info">
              <div
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}
              >
                <strong>{m.display_name || `User #${m.user_id}`}</strong>
                <span class={`role-badge role-${m.role}`}>{m.role}</span>
                <span class="permissions">{m.kind}</span>
                {m.user_id === currentUserId && <span class="permissions">You</span>}
              </div>
              <span class="created">Joined {new Date(m.joined_at).toLocaleDateString()}</span>

              {recoveryLinks[m.user_id] && (
                <div class="alert" style={{ marginTop: '0.5rem' }}>
                  <p>Recovery secret — store it now, it won't be shown again:</p>
                  <code class="secret-display">{recoveryLinks[m.user_id]}</code>
                  <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                    <button
                      class="copy-btn"
                      onClick={() => copy(recoveryLinks[m.user_id], `rec-${m.user_id}`)}
                    >
                      {copiedId === `rec-${m.user_id}` ? 'Copied!' : 'Copy'}
                    </button>
                    <button
                      class="dismiss-btn"
                      onClick={() =>
                        setRecoveryLinks((prev) => {
                          const next = { ...prev }
                          delete next[m.user_id]
                          return next
                        })
                      }
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              )}
            </div>

            {canManage && (
              <div
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}
              >
                <select
                  value={m.role}
                  onChange={(e) =>
                    handleRoleChange(m.user_id, (e.target as HTMLSelectElement).value as Role)
                  }
                  style={{ width: 'auto' }}
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
                {m.kind === 'anonymous' && (
                  <button class="copy-btn" onClick={() => handleRecoveryLink(m.user_id)}>
                    Recovery link
                  </button>
                )}
                <button class="delete-btn" onClick={() => handleRemove(m.user_id)}>
                  Remove
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
