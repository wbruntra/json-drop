import { useState, useEffect } from 'preact/hooks'
import { api } from '../api'
import { WorkspaceList } from './WorkspaceList'
import { WorkspaceMembers } from './WorkspaceMembers'
import { WorkspaceInvites } from './WorkspaceInvites'
import { WorkspaceDocuments } from './WorkspaceDocuments'

type Role = 'owner' | 'admin' | 'editor' | 'viewer'

type WorkspaceDetail = {
  id: string
  name: string
  project_id: string | null
  created_at: string
  role: Role
}

type User = {
  id: number
}

type Props = {
  user: User
}

export function WorkspacesView({ user }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<WorkspaceDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!selectedId) {
      setDetail(null)
      return
    }
    setLoading(true)
    setError(null)
    api(`/api/workspaces/${selectedId}`)
      .then(async (res) => {
        if (res.ok) {
          setDetail(await res.json())
        } else {
          setDetail(null)
          setError('Failed to load workspace')
        }
      })
      .finally(() => setLoading(false))
  }, [selectedId])

  const canManage = detail?.role === 'owner' || detail?.role === 'admin'
  const readOnlyDocs = detail?.role === 'viewer'

  return (
    <div class="workspace-layout">
      <div class="section workspace-sidebar-section">
        <WorkspaceList selectedId={selectedId} onSelect={setSelectedId} />
      </div>

      <div class="workspace-detail">
        {!selectedId ? (
          <div class="section">
            <p class="empty">Select or create a workspace to get started.</p>
          </div>
        ) : loading ? (
          <div class="section">
            <p class="empty">Loading workspace...</p>
          </div>
        ) : error || !detail ? (
          <div class="section">
            <p class="empty">{error || 'Workspace not found'}</p>
          </div>
        ) : (
          <>
            <div class="section">
              <div class="section-header">
                <h2>{detail.name}</h2>
                <span class={`role-badge role-${detail.role}`}>{detail.role}</span>
              </div>
              <p class="project-context-help">
                Workspace ID: <code>{detail.id}</code>
              </p>
            </div>

            <section class="section">
              <div class="section-header">
                <h2>Documents</h2>
                <span class="badge">workspace</span>
              </div>
              <WorkspaceDocuments workspaceId={detail.id} readOnly={readOnlyDocs} />
            </section>

            {canManage && (
              <>
                <section class="section">
                  <div class="section-header">
                    <h2>Members</h2>
                    <span class="badge">workspace</span>
                  </div>
                  <WorkspaceMembers
                    workspaceId={detail.id}
                    canManage={canManage}
                    currentUserId={user.id}
                  />
                </section>

                <section class="section">
                  <div class="section-header">
                    <h2>Invites</h2>
                    <span class="badge">workspace</span>
                  </div>
                  <WorkspaceInvites workspaceId={detail.id} />
                </section>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
