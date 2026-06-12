import { useState, useEffect, useRef } from 'preact/hooks'
import { api } from '../api'

const MAX_TOTAL = 10 * 1024 * 1024

type Doc = {
  id: string
  path: string
  access_mode: string
  content: unknown
  created_at: string
  updated_at: string
  size_bytes: number
}

type StorageInfo = {
  used_bytes: number
  used: string
  limit: string
}

export function DocManager() {
  const [docs, setDocs] = useState<Doc[]>([])
  const [storage, setStorage] = useState<StorageInfo | null>(null)
  const [loading, setLoading] = useState(true)

  // Collections & search state
  const [selectedCollection, setSelectedCollection] = useState<string>('_all')
  const [searchQuery, setSearchQuery] = useState('')

  // Modal form state
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('create')
  const [formPath, setFormPath] = useState('')
  const [formContent, setFormContent] = useState('{\n  \n}')
  const [formAccessMode, setFormAccessMode] = useState<
    'public' | 'public_read_secret_write' | 'private'
  >('public')

  // Validation/Errors
  const [jsonError, setJsonError] = useState<string | null>(null)
  const [pathError, setPathError] = useState<string | null>(null)

  // Document details states
  const [expandedDocIds, setExpandedDocIds] = useState<Record<string, boolean>>({})
  const [createdSecret, setCreatedSecret] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const dialogRef = useRef<HTMLDialogElement | null>(null)

  const fetchDocs = async () => {
    const res = await api('/api/docs')
    if (res.ok) {
      const data = await res.json()
      setDocs(data.docs)
      setStorage(data.storage)
    }
    setLoading(false)
  }

  useEffect(() => {
    fetchDocs()
  }, [])

  // Setup click outside fallback for the <dialog>
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog || !isModalOpen) return

    if (!('closedBy' in HTMLDialogElement.prototype)) {
      const handleClick = (event: MouseEvent) => {
        if (event.target !== dialog) return
        const rect = dialog.getBoundingClientRect()
        const isInsideContent =
          rect.top <= event.clientY &&
          event.clientY <= rect.top + rect.height &&
          rect.left <= event.clientX &&
          event.clientX <= rect.left + rect.width
        if (!isInsideContent) {
          closeModal()
        }
      }
      dialog.addEventListener('click', handleClick)
      return () => dialog.removeEventListener('click', handleClick)
    }
  }, [isModalOpen])

  // Path Segment Validation
  const PATH_SEGMENT = /^[a-zA-Z0-9_-]+$/
  const validatePath = (path: string): string | null => {
    const trimmed = path.trim()
    if (!trimmed) return 'Path is required'
    if (trimmed.startsWith('/')) return 'Path must not start with /'
    if (trimmed.endsWith('/')) return 'Path must not end with /'
    if (trimmed.includes('//')) return 'Path must not contain empty segments'

    const segments = trimmed.split('/')
    for (const segment of segments) {
      if (!PATH_SEGMENT.test(segment)) {
        return 'Segments can only contain alphanumeric characters, hyphens, and underscores'
      }
    }
    return null
  }

  const handlePathChange = (val: string) => {
    setFormPath(val)
    setPathError(validatePath(val))
  }

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
    if (selectedCollection !== '_all' && selectedCollection !== '_general') {
      setFormPath(`${selectedCollection}/`)
    } else {
      setFormPath('')
    }
    setFormContent('{\n  \n}')
    setFormAccessMode('public')
    setJsonError(null)
    setPathError(null)
    setIsModalOpen(true)
    dialogRef.current?.showModal()
  }

  const openEditModal = (doc: Doc) => {
    setModalMode('edit')
    setFormPath(doc.path)
    setFormContent(JSON.stringify(doc.content, null, 2))
    setFormAccessMode(doc.access_mode as any)
    setJsonError(null)
    setPathError(null)
    setIsModalOpen(true)
    dialogRef.current?.showModal()
  }

  const closeModal = () => {
    setIsModalOpen(false)
    dialogRef.current?.close()
  }

  const handleSave = async () => {
    const pErr = validatePath(formPath)
    if (pErr) {
      setPathError(pErr)
      return
    }

    let parsedContent
    try {
      parsedContent = JSON.parse(formContent)
      setJsonError(null)
    } catch (e: any) {
      setJsonError(e.message || 'Invalid JSON')
      return
    }

    const res = await api(`/api/docs/${encodeURIComponent(formPath)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: parsedContent,
        access_mode: formAccessMode,
      }),
    })

    if (res.ok) {
      const data = await res.json()
      if (data.access_secret) {
        setCreatedSecret(data.access_secret)
      }
      closeModal()
      fetchDocs()
    } else {
      const errData = await res.json().catch(() => ({}))
      alert(errData.error || 'Failed to save document')
    }
  }

  const handleDelete = async (doc: Doc) => {
    if (!confirm(`Delete document at "${doc.path}"?`)) return
    const res = await api(`/api/docs/${doc.id}`, { method: 'DELETE' })
    if (res.ok) {
      fetchDocs()
    } else {
      const errData = await res.json().catch(() => ({}))
      alert(errData.error || 'Failed to delete document')
    }
  }

  const copyText = (text: string, id: string) => {
    navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const toggleExpand = (id: string) => {
    setExpandedDocIds((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  // Helper to parse paths
  const parseDocPath = (path: string) => {
    const idx = path.indexOf('/')
    if (idx === -1) {
      return { collection: 'General', name: path }
    }
    return {
      collection: path.substring(0, idx),
      name: path.substring(idx + 1),
    }
  }

  // Compute collections lists
  const collectionsMap = new Map<string, number>()
  let generalCount = 0

  docs.forEach((d) => {
    const { collection } = parseDocPath(d.path)
    if (collection === 'General') {
      generalCount++
    } else {
      collectionsMap.set(collection, (collectionsMap.get(collection) || 0) + 1)
    }
  })

  const customCollections = Array.from(collectionsMap.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name))

  // Filter docs
  const filteredDocs = docs.filter((doc) => {
    const { collection } = parseDocPath(doc.path)

    // Collection filter
    if (selectedCollection === '_general') {
      if (collection !== 'General') return false
    } else if (selectedCollection !== '_all') {
      if (collection !== selectedCollection) return false
    }

    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      const pathMatch = doc.path.toLowerCase().includes(q)
      const contentMatch = JSON.stringify(doc.content).toLowerCase().includes(q)
      const idMatch = doc.id.toLowerCase().includes(q)
      return pathMatch || contentMatch || idMatch
    }

    return true
  })

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
  }

  const formatDate = (dateStr: string): string => {
    try {
      const date = new Date(dateStr)
      if (isNaN(date.getTime())) return dateStr
      return date.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    } catch {
      return dateStr
    }
  }

  if (loading) return <div class="loading">Loading documents...</div>

  return (
    <div class="doc-manager">
      {createdSecret && (
        <div
          class="alert"
          style={{
            background: 'rgba(245, 158, 11, 0.08)',
            borderColor: 'rgba(245, 158, 11, 0.25)',
          }}
        >
          <p style={{ color: '#fbbf24' }}>
            <strong>Document created/updated with secret!</strong> Copy the access secret now — it
            will not be shown again.
          </p>
          <code class="secret-display">{createdSecret}</code>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
            <button onClick={() => copyText(createdSecret, 'secret')} class="copy-btn">
              {copiedId === 'secret' ? 'Copied!' : 'Copy'}
            </button>
            <button onClick={() => setCreatedSecret(null)} class="dismiss-btn">
              Dismiss
            </button>
          </div>
        </div>
      )}

      <div class="doc-manager-layout">
        <div class="collections-sidebar">
          <div class="collections-title">Collections</div>
          <ul class="collections-list">
            <li
              class={`collection-item ${selectedCollection === '_all' ? 'active' : ''}`}
              onClick={() => setSelectedCollection('_all')}
            >
              <span class="collection-label">
                <svg
                  class="collection-icon-svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                  <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                </svg>
                All Documents
              </span>
              <span class="collection-count">{docs.length}</span>
            </li>
            <li
              class={`collection-item ${selectedCollection === '_general' ? 'active' : ''}`}
              onClick={() => setSelectedCollection('_general')}
            >
              <span class="collection-label">
                <svg
                  class="collection-icon-svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <polygon points="12 2 2 7 12 12 22 7 12 2" />
                  <polyline points="2 17 12 22 22 17" />
                  <polyline points="2 12 12 17 22 12" />
                </svg>
                General (Root)
              </span>
              <span class="collection-count">{generalCount}</span>
            </li>

            {customCollections.length > 0 && (
              <>
                <div class="collections-title" style={{ marginTop: '1rem' }}>
                  User Collections
                </div>
                {customCollections.map((col) => (
                  <li
                    key={col.name}
                    class={`collection-item ${selectedCollection === col.name ? 'active' : ''}`}
                    onClick={() => setSelectedCollection(col.name)}
                  >
                    <span class="collection-label">
                      <svg
                        class="collection-icon-svg"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                      >
                        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                      </svg>
                      {col.name}
                    </span>
                    <span class="collection-count">{col.count}</span>
                  </li>
                ))}
              </>
            )}
          </ul>
        </div>

        <div class="documents-content">
          <div class="documents-header">
            <div class="documents-header-left">
              <h3>
                {selectedCollection === '_all'
                  ? 'All Documents'
                  : selectedCollection === '_general'
                    ? 'General (Root)'
                    : `Collection: ${selectedCollection}`}
              </h3>
            </div>
            <div class="documents-controls">
              <div class="search-box">
                <svg
                  class="search-icon"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input
                  type="text"
                  placeholder="Search path/content/id..."
                  class="search-input"
                  value={searchQuery}
                  onInput={(e) => setSearchQuery((e.target as HTMLInputElement).value)}
                />
              </div>
              <button onClick={openCreateModal} class="create-btn new-doc-btn">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                New Document
              </button>
            </div>
          </div>

          {storage && (
            <div class="storage-bar" style={{ margin: '0' }}>
              <div class="storage-info">
                <span>
                  Storage used: {storage.used} / {storage.limit}
                </span>
                <span>{Math.round((storage.used_bytes / MAX_TOTAL) * 100)}%</span>
              </div>
              <div class="storage-meter">
                <div
                  class="storage-fill"
                  style={{
                    width: `${Math.min(100, (storage.used_bytes / MAX_TOTAL) * 100)}%`,
                  }}
                />
              </div>
            </div>
          )}

          <div class="doc-list" style={{ gap: '1rem' }}>
            {filteredDocs.length === 0 ? (
              <p class="empty">No documents found. Create one above!</p>
            ) : (
              filteredDocs.map((doc) => {
                const { collection, name } = parseDocPath(doc.path)
                const isExpanded = !!expandedDocIds[doc.id]
                return (
                  <div key={doc.id} class="doc-card">
                    <div class="doc-card-header">
                      <div class="doc-card-title-row">
                        <svg
                          class="doc-card-icon"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"
                        >
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                          <polyline points="14 2 14 8 20 8" />
                          <line x1="16" y1="13" x2="8" y2="13" />
                          <line x1="16" y1="17" x2="8" y2="17" />
                          <polyline points="10 9 9 9 8 9" />
                        </svg>
                        <span class="doc-card-path">
                          {collection !== 'General' && (
                            <span class="doc-card-collection">{collection}/</span>
                          )}
                          {name}
                        </span>
                      </div>
                      <span
                        class={`access-mode ${doc.access_mode === 'private' ? 'private' : ''}`}
                      >
                        {doc.access_mode.replace(/_/g, ' ')}
                      </span>
                    </div>

                    <div class="doc-card-meta">
                      <div class="doc-card-id-container">
                        <span>ID:</span>
                        <code class="doc-card-id">{doc.id}</code>
                        <button
                          onClick={() => copyText(doc.id, `id-${doc.id}`)}
                          class="copy-id-btn"
                          title="Copy Document ID"
                        >
                          {copiedId === `id-${doc.id}` ? (
                            <svg
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="var(--success)"
                              stroke-width="2.5"
                              style={{ width: 11, height: 11 }}
                            >
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          ) : (
                            <svg
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              stroke-width="2.5"
                            >
                              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                            </svg>
                          )}
                        </button>
                      </div>
                      <span>•</span>
                      <span>{formatBytes(doc.size_bytes)}</span>
                      <span>•</span>
                      <span>Updated {formatDate(doc.updated_at)}</span>
                    </div>

                    <div class="doc-card-preview-container">
                      <div
                        class={`doc-card-preview-header ${isExpanded ? 'expanded' : ''}`}
                        onClick={() => toggleExpand(doc.id)}
                      >
                        <span class="preview-toggle-text">
                          <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2.5"
                            style={{
                              transform: isExpanded ? 'rotate(90deg)' : 'none',
                              transition: 'transform 0.2s ease',
                              width: 10,
                              height: 10,
                            }}
                          >
                            <polyline points="9 18 15 12 9 6" />
                          </svg>
                          {isExpanded ? 'Hide JSON' : 'Show JSON'}
                        </span>
                        {isExpanded && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              copyText(JSON.stringify(doc.content, null, 2), `content-${doc.id}`)
                            }}
                            class="copy-json-btn"
                          >
                            {copiedId === `content-${doc.id}` ? 'Copied!' : 'Copy JSON'}
                          </button>
                        )}
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

                    <div class="doc-card-actions">
                      <button onClick={() => openEditModal(doc)} class="doc-card-action-btn">
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"
                        >
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                          <path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                        Edit
                      </button>
                      <button
                        onClick={() => copyText(doc.path, `path-${doc.id}`)}
                        class="doc-card-action-btn"
                      >
                        {copiedId === `path-${doc.id}` ? (
                          <>
                            <svg
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="var(--success)"
                              stroke-width="2"
                              style={{ width: 12, height: 12 }}
                            >
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                            Copied
                          </>
                        ) : (
                          <>
                            <svg
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              stroke-width="2"
                            >
                              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                            </svg>
                            Copy Path
                          </>
                        )}
                      </button>
                      <button
                        onClick={() => handleDelete(doc)}
                        class="doc-card-action-btn delete-action"
                      >
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"
                        >
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          <line x1="10" y1="11" x2="10" y2="17" />
                          <line x1="14" y1="11" x2="14" y2="17" />
                        </svg>
                        Delete
                      </button>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      </div>

      <dialog ref={dialogRef} class="premium-modal" closedby="any" aria-labelledby="modalTitle">
        <div class="modal-header">
          <h3 id="modalTitle">{modalMode === 'create' ? 'Create Document' : 'Edit Document'}</h3>
          <button onClick={closeModal} class="modal-close-btn" aria-label="Close modal">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div class="modal-body">
          <div class="form-group">
            <label>Document Path</label>
            <input
              type="text"
              placeholder="e.g. notes/todo"
              value={formPath}
              disabled={modalMode === 'edit'}
              onInput={(e) => handlePathChange((e.target as HTMLInputElement).value)}
            />
            {pathError ? (
              <span class="form-error">{pathError}</span>
            ) : (
              <span class="form-help">
                Use slashes to create collections. Only alphanumeric, hyphens, and underscores
                allowed in segments.
              </span>
            )}
          </div>

          <div class="form-group">
            <label>Access Mode</label>
            <div class="access-mode-picker">
              <div
                class={`access-mode-option ${formAccessMode === 'public' ? 'selected' : ''}`}
                onClick={() => setFormAccessMode('public')}
              >
                <span class="access-mode-title">Public</span>
                <span class="access-mode-desc">Anyone can read. Write requires owner.</span>
              </div>
              <div
                class={`access-mode-option ${formAccessMode === 'public_read_secret_write' ? 'selected' : ''}`}
                onClick={() => setFormAccessMode('public_read_secret_write')}
              >
                <span class="access-mode-title">Secret Write</span>
                <span class="access-mode-desc">Anyone can read. Write requires secret.</span>
              </div>
              <div
                class={`access-mode-option ${formAccessMode === 'private' ? 'selected' : ''}`}
                onClick={() => setFormAccessMode('private')}
              >
                <span class="access-mode-title">Private</span>
                <span class="access-mode-desc">Read/Write require owner or secret.</span>
              </div>
            </div>
          </div>

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
          </div>
        </div>

        <div class="modal-footer">
          <button onClick={closeModal} class="dismiss-btn" style={{ padding: '0.65rem 1.25rem' }}>
            Cancel
          </button>
          <button
            onClick={handleSave}
            class="create-btn"
            disabled={!!jsonError || !!pathError || !formPath.trim()}
            style={{
              opacity: jsonError || pathError || !formPath.trim() ? 0.5 : 1,
              cursor: jsonError || pathError || !formPath.trim() ? 'not-allowed' : 'pointer',
            }}
          >
            {modalMode === 'create' ? 'Create Document' : 'Save Changes'}
          </button>
        </div>
      </dialog>
    </div>
  )
}
