import { useState, useEffect, useRef } from 'preact/hooks'
import { api } from '../api'

const MAX_TOTAL = 10 * 1024 * 1024

type Doc = {
  id: string
  path: string
  content: unknown
  created_at: string
  updated_at: string
  size_bytes: number
  version: number
}

type StorageInfo = {
  used_bytes: number
  used: string
  limit: string
}

type Props = {
  workspaceId: string
  readOnly: boolean
}

function parseDocPath(path: string): { collection: string; name: string } {
  const idx = path.indexOf('/')
  if (idx === -1) return { collection: 'General', name: path }
  return { collection: path.substring(0, idx), name: path.substring(idx + 1) }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

export function WorkspaceDocuments({ workspaceId, readOnly }: Props) {
  const [docs, setDocs] = useState<Doc[]>([])
  const [storage, setStorage] = useState<StorageInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedCollection, setSelectedCollection] = useState('_all')
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({})

  const [isModalOpen, setIsModalOpen] = useState(false)
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('create')
  const [formCollection, setFormCollection] = useState('')
  const [formContent, setFormContent] = useState('{\n  \n}')
  const [editingDoc, setEditingDoc] = useState<Doc | null>(null)
  const [jsonError, setJsonError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  const dialogRef = useRef<HTMLDialogElement | null>(null)

  const fetchDocs = async () => {
    const res = await api(`/api/workspaces/${workspaceId}/documents`)
    if (res.ok) {
      const data = await res.json()
      setDocs(data.docs)
      setStorage(data.storage)
    }
    setLoading(false)
  }

  useEffect(() => {
    setLoading(true)
    setSelectedCollection('_all')
    fetchDocs()
  }, [workspaceId])

  const handleContentChange = (val: string) => {
    setFormContent(val)
    if (!val.trim()) {
      setJsonError('Content is required')
      return
    }
    try {
      JSON.parse(val)
      setJsonError(null)
    } catch (e: any) {
      setJsonError(e.message || 'Invalid JSON')
    }
  }

  const openCreateModal = () => {
    setModalMode('create')
    setEditingDoc(null)
    setFormCollection(
      selectedCollection !== '_all' && selectedCollection !== 'General' ? selectedCollection : '',
    )
    setFormContent('{\n  \n}')
    setJsonError(null)
    setSaveError(null)
    setIsModalOpen(true)
    dialogRef.current?.showModal()
  }

  const openEditModal = (doc: Doc) => {
    setModalMode('edit')
    setEditingDoc(doc)
    setFormContent(JSON.stringify(doc.content, null, 2))
    setJsonError(null)
    setSaveError(null)
    setIsModalOpen(true)
    dialogRef.current?.showModal()
  }

  const closeModal = () => {
    setIsModalOpen(false)
    dialogRef.current?.close()
  }

  const handleSave = async () => {
    let parsedContent
    try {
      parsedContent = JSON.parse(formContent)
    } catch (e: any) {
      setJsonError(e.message || 'Invalid JSON')
      return
    }

    setSaveError(null)

    if (modalMode === 'create') {
      const collection = formCollection.trim() || 'general'
      const res = await api(
        `/api/workspaces/${workspaceId}/collections/${encodeURIComponent(collection)}/documents`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: parsedContent }),
        },
      )
      if (res.ok) {
        closeModal()
        fetchDocs()
      } else {
        const data = await res.json().catch(() => ({}))
        setSaveError(data.message || 'Failed to create document')
      }
    } else if (editingDoc) {
      const res = await api(`/api/workspaces/${workspaceId}/documents/${editingDoc.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'If-Match': String(editingDoc.version) },
        body: JSON.stringify({ content: parsedContent }),
      })
      if (res.ok) {
        closeModal()
        fetchDocs()
      } else if (res.status === 409) {
        setSaveError(
          'Someone else edited this document since you loaded it. Close and reopen to see the latest version.',
        )
      } else {
        const data = await res.json().catch(() => ({}))
        setSaveError(data.message || 'Failed to save document')
      }
    }
  }

  const handleDelete = async (doc: Doc) => {
    if (!confirm(`Delete document "${doc.path}"?`)) return
    const res = await api(`/api/workspaces/${workspaceId}/documents/${doc.id}`, {
      method: 'DELETE',
      headers: { 'If-Match': String(doc.version) },
    })
    if (res.ok) {
      fetchDocs()
    } else {
      const data = await res.json().catch(() => ({}))
      alert(data.message || 'Failed to delete document')
    }
  }

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  const collectionsMap = new Map<string, number>()
  docs.forEach((d) => {
    const { collection } = parseDocPath(d.path)
    collectionsMap.set(collection, (collectionsMap.get(collection) || 0) + 1)
  })
  const collections = Array.from(collectionsMap.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name))

  const filteredDocs = docs.filter((doc) => {
    const { collection } = parseDocPath(doc.path)
    if (selectedCollection !== '_all' && collection !== selectedCollection) return false
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      return (
        doc.path.toLowerCase().includes(q) ||
        JSON.stringify(doc.content).toLowerCase().includes(q) ||
        doc.id.toLowerCase().includes(q)
      )
    }
    return true
  })

  if (loading) return <div class="loading">Loading documents...</div>

  return (
    <div class="doc-manager">
      <div class="doc-manager-layout">
        <div class="collections-sidebar">
          <div class="collections-title">Collections</div>
          <ul class="collections-list">
            <li
              class={`collection-item ${selectedCollection === '_all' ? 'active' : ''}`}
              onClick={() => setSelectedCollection('_all')}
            >
              <span class="collection-label">All Documents</span>
              <span class="collection-count">{docs.length}</span>
            </li>
            {collections.map((col) => (
              <li
                key={col.name}
                class={`collection-item ${selectedCollection === col.name ? 'active' : ''}`}
                onClick={() => setSelectedCollection(col.name)}
              >
                <span class="collection-label">{col.name}</span>
                <span class="collection-count">{col.count}</span>
              </li>
            ))}
          </ul>
        </div>

        <div class="documents-content">
          <div class="documents-header">
            <div class="documents-header-left">
              <h3>{selectedCollection === '_all' ? 'All Documents' : selectedCollection}</h3>
            </div>
            <div class="documents-controls">
              <div class="search-box">
                <input
                  type="text"
                  placeholder="Search path/content/id..."
                  class="search-input"
                  value={searchQuery}
                  onInput={(e) => setSearchQuery((e.target as HTMLInputElement).value)}
                />
              </div>
              {!readOnly && (
                <button onClick={openCreateModal} class="create-btn new-doc-btn">
                  New Document
                </button>
              )}
            </div>
          </div>

          {storage && (
            <div class="storage-bar" style={{ margin: 0 }}>
              <div class="storage-info">
                <span>
                  Storage used: {storage.used} / {storage.limit}
                </span>
                <span>{Math.round((storage.used_bytes / MAX_TOTAL) * 100)}%</span>
              </div>
              <div class="storage-meter">
                <div
                  class="storage-fill"
                  style={{ width: `${Math.min(100, (storage.used_bytes / MAX_TOTAL) * 100)}%` }}
                />
              </div>
            </div>
          )}

          <div class="doc-list" style={{ gap: '1rem' }}>
            {filteredDocs.length === 0 ? (
              <p class="empty">No documents found.</p>
            ) : (
              filteredDocs.map((doc) => {
                const { collection, name } = parseDocPath(doc.path)
                const isExpanded = !!expandedIds[doc.id]
                return (
                  <div key={doc.id} class="doc-card">
                    <div class="doc-card-header">
                      <div class="doc-card-title-row">
                        <span class="doc-card-path">
                          <span class="doc-card-collection">{collection}/</span>
                          {name}
                        </span>
                      </div>
                      <span class="permissions">v{doc.version}</span>
                    </div>

                    <div class="doc-card-meta">
                      <span>{formatBytes(doc.size_bytes)}</span>
                      <span>•</span>
                      <span>Updated {new Date(doc.updated_at).toLocaleString()}</span>
                    </div>

                    <div class="doc-card-preview-container">
                      <div
                        class={`doc-card-preview-header ${isExpanded ? 'expanded' : ''}`}
                        onClick={() => toggleExpand(doc.id)}
                      >
                        <span class="preview-toggle-text">
                          {isExpanded ? 'Hide JSON' : 'Show JSON'}
                        </span>
                      </div>
                      {isExpanded && (
                        <pre
                          class="doc-content"
                          style={{ margin: 0, borderRadius: 0, border: 'none' }}
                        >
                          <code>{JSON.stringify(doc.content, null, 2)}</code>
                        </pre>
                      )}
                    </div>

                    {!readOnly && (
                      <div class="doc-card-actions">
                        <button onClick={() => openEditModal(doc)} class="doc-card-action-btn">
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(doc)}
                          class="doc-card-action-btn delete-action"
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>
        </div>
      </div>

      <dialog ref={dialogRef} class="premium-modal" closedby="any" aria-labelledby="wsModalTitle">
        <div class="modal-header">
          <h3 id="wsModalTitle">{modalMode === 'create' ? 'Create Document' : 'Edit Document'}</h3>
          <button onClick={closeModal} class="modal-close-btn" aria-label="Close modal">
            ×
          </button>
        </div>

        <div class="modal-body">
          {modalMode === 'create' && (
            <div class="form-group">
              <label>Collection</label>
              <input
                type="text"
                placeholder="e.g. expenses"
                value={formCollection}
                onInput={(e) => setFormCollection((e.target as HTMLInputElement).value)}
              />
              <span class="form-help">Documents are grouped by collection name.</span>
            </div>
          )}

          <div class="form-group">
            <label>JSON Content</label>
            <div class="json-editor-container">
              <div class="json-editor-header">
                <span>Raw JSON Editor</span>
                <div class="json-editor-status">
                  <span class={`status-dot ${jsonError ? 'invalid' : ''}`} />
                  <span>{jsonError ? 'Invalid JSON' : 'Valid JSON'}</span>
                </div>
              </div>
              <textarea
                class="json-textarea"
                value={formContent}
                onInput={(e) => handleContentChange((e.target as HTMLTextAreaElement).value)}
                rows={10}
              />
            </div>
            {jsonError && <span class="form-error">{jsonError}</span>}
            {saveError && <span class="form-error">{saveError}</span>}
          </div>
        </div>

        <div class="modal-footer">
          <button onClick={closeModal} class="dismiss-btn" style={{ padding: '0.65rem 1.25rem' }}>
            Cancel
          </button>
          <button onClick={handleSave} class="create-btn" disabled={!!jsonError}>
            {modalMode === 'create' ? 'Create Document' : 'Save Changes'}
          </button>
        </div>
      </dialog>
    </div>
  )
}
