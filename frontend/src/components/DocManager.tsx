import { useState, useEffect } from 'preact/hooks'
import { api } from '../api'

const MAX_TOTAL = 10 * 1024 * 1024

type Doc = {
  id: string
  name: string
  access_mode: string
  content: unknown
  created_at: string
  updated_at: string
}

type StorageInfo = {
  used_bytes: number
  used: string
  limit: string
}

export function DocManager() {
  const [docs, setDocs] = useState<Doc[]>([])
  const [storage, setStorage] = useState<StorageInfo | null>(null)
  const [newName, setNewName] = useState('')
  const [newContent, setNewContent] = useState('{}')
  const [newAccessMode, setNewAccessMode] = useState('public')
  const [createdSecret, setCreatedSecret] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

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

  const handleCreate = async () => {
    if (!newName.trim()) return

    let parsedContent
    try {
      parsedContent = JSON.parse(newContent)
    } catch {
      alert('Invalid JSON content')
      return
    }

    const res = await api('/api/docs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: newName,
        content: parsedContent,
        access_mode: newAccessMode,
      }),
    })

    if (res.ok) {
      const data = await res.json()
      setCreatedSecret(data.access_secret)
      setNewName('')
      setNewContent('{}')
      fetchDocs()
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this document?')) return

    const res = await api(`/api/docs/${id}`, { method: 'DELETE' })

    if (res.ok) {
      fetchDocs()
    }
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
  }

  if (loading) return <div>Loading documents...</div>

  return (
    <div class="doc-manager">
      {createdSecret && (
        <div class="alert">
          <p>
            <strong>Document created!</strong> Copy the access secret now — it won't be shown
            again.
          </p>
          <code class="secret-display">{createdSecret}</code>
          <button onClick={() => copyToClipboard(createdSecret)} class="copy-btn">
            Copy
          </button>
          <button onClick={() => setCreatedSecret(null)} class="dismiss-btn">
            Dismiss
          </button>
        </div>
      )}

      <div class="create-doc">
        <input
          type="text"
          placeholder="Document name"
          value={newName}
          onInput={(e) => setNewName((e.target as HTMLInputElement).value)}
        />
        <textarea
          placeholder="JSON content"
          value={newContent}
          onInput={(e) => setNewContent((e.target as HTMLTextAreaElement).value)}
          rows={4}
        />
        <select
          value={newAccessMode}
          onChange={(e) => setNewAccessMode((e.target as HTMLSelectElement).value)}
        >
          <option value="public">Public</option>
          <option value="public_read_secret_write">Public Read / Secret Write</option>
          <option value="private">Private</option>
        </select>
        <button onClick={handleCreate} class="create-btn">
          Create Document
        </button>
      </div>

      <div class="doc-list">
        {docs.length === 0 ? (
          <p class="empty">No documents yet. Create one above.</p>
        ) : (
          <>
            {storage && (
              <div class="storage-bar">
                <div class="storage-info">
                  Storage: {storage.used}
                  {' / '}
                  {storage.limit}
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
            {docs.map((doc) => (
              <div key={doc.id} class="doc-item">
                <div class="doc-info">
                  <strong>{doc.name}</strong>
                  <span class="doc-id">ID: {doc.id}</span>
                  <span class="access-mode">{doc.access_mode}</span>
                  <pre class="doc-content">{JSON.stringify(doc.content, null, 2)}</pre>
                </div>
                <button onClick={() => handleDelete(doc.id)} class="delete-btn">
                  Delete
                </button>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
