import { useEffect, useState } from 'preact/hooks'
import { api } from '../api'
import { href, navigate } from '../router'
import { useCopy } from '../useCopy'
import type { ProjectSummary } from './ProjectsHome'
import { timeAgo } from './ProjectsHome'
import type { User } from './Shell'
import { DocManager } from './DocManager'
import { TokenManager } from './TokenManager'
import { WorkspacesView } from './WorkspacesView'
import { CurlGuide } from './CurlGuide'

const TABS = [
  { id: 'connect', label: 'Connect' },
  { id: 'data', label: 'Data' },
  { id: 'keys', label: 'Keys' },
  { id: 'workspaces', label: 'Workspaces' },
  { id: 'settings', label: 'Settings' },
] as const

type TabId = (typeof TABS)[number]['id']

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

type Props = {
  projectId: string
  tab: string | undefined
  user: User
  onName: (name: string | null) => void
}

export function ProjectDetail({ projectId, tab, user, onName }: Props) {
  const [project, setProject] = useState<ProjectSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { copiedId, copy } = useCopy()

  const load = async () => {
    const res = await api(`/api/projects/${encodeURIComponent(projectId)}`)
    if (res.ok) {
      const data: ProjectSummary = await res.json()
      setProject(data)
      onName(data.name)
    } else {
      setError(res.status === 404 ? 'Project not found.' : 'Failed to load project.')
      onName(null)
    }
  }

  // Refetch on tab switches so the header stats reflect edits made in a tab.
  useEffect(() => {
    load()
  }, [projectId, tab])

  if (error) {
    return (
      <div class="section empty-state">
        <h3>{error}</h3>
        <a class="create-btn" href={href()}>
          Back to projects
        </a>
      </div>
    )
  }
  if (!project) return <p class="empty">Loading project…</p>

  const active: TabId = TABS.some((t) => t.id === tab) ? (tab as TabId) : 'data'

  return (
    <div class="page">
      <div class="page-header">
        <div>
          <h2 class="page-title">{project.name}</h2>
          <div class="project-meta">
            <code>{project.id}</code>
            <button class="copy-btn" onClick={() => copy(project.id, 'project-id')}>
              {copiedId === 'project-id' ? 'Copied!' : 'Copy ID'}
            </button>
            <span>
              {plural(project.doc_count, 'doc')} · {plural(project.key_count, 'key')} · last write{' '}
              {timeAgo(project.last_write_at)}
            </span>
          </div>
        </div>
      </div>

      <nav class="project-tabs" aria-label="Project sections">
        {TABS.map((t) => (
          <a
            key={t.id}
            class={`project-tab ${active === t.id ? 'active' : ''}`}
            href={href('projects', projectId, t.id)}
            aria-current={active === t.id ? 'page' : undefined}
          >
            {t.label}
          </a>
        ))}
      </nav>

      {active === 'connect' && <ConnectTab project={project} />}
      {active === 'data' && (
        <section class="section">
          <DocManager projectId={projectId} />
        </section>
      )}
      {active === 'keys' && (
        <section class="section">
          <div class="section-header">
            <h2>Keys</h2>
          </div>
          <TokenManager projectId={projectId} onChange={load} />
        </section>
      )}
      {active === 'workspaces' && <WorkspacesView user={user} projectId={projectId} />}
      {active === 'settings' && <SettingsTab project={project} onRenamed={load} />}
    </div>
  )
}

function ConnectTab({ project }: { project: ProjectSummary }) {
  const baseUrl = window.location.origin
  const hasKey = project.key_count > 0

  return (
    <div class="connect">
      <ol class="steps">
        <li class={`step ${hasKey ? 'done' : ''}`}>
          <div class="step-head">
            <h3>Create a key</h3>
            {hasKey && <span class="step-status">Done</span>}
          </div>
          <p>
            A <strong>read/write</strong> key for trusted code, or a <strong>read-only</strong> key
            for a public frontend. Keys can only reach this project.
          </p>
          <a
            class={hasKey ? 'dismiss-btn' : 'create-btn'}
            href={href('projects', project.id, 'keys')}
          >
            {hasKey ? 'Manage keys' : 'Create a key'}
          </a>
        </li>
        <li class="step">
          <div class="step-head">
            <h3>Install the SDK</h3>
          </div>
          <p>
            Published on GitHub Packages; the <code>@wbruntra</code> scope needs an{' '}
            <code>.npmrc</code> entry (see the SDK README).
          </p>
          <pre>
            <code>bun add @wbruntra/json-drop</code>
          </pre>
        </li>
        <li class="step">
          <div class="step-head">
            <h3>Read and write documents</h3>
          </div>
          <pre>
            <code>{`import { JsonDrop } from '@wbruntra/json-drop'

const db = new JsonDrop({
  baseUrl: '${baseUrl}',
  token: 'YOUR_PROJECT_KEY',
})

await db.doc('settings/theme').set({ dark: true })
const notes = db.collection('notes')
await notes.add({ title: 'Hello' })
const { docs } = await notes.list()`}</code>
          </pre>
          <p>
            Public documents can be read without any key:{' '}
            <code>{`new JsonDrop({ baseUrl, project: '${project.id}' })`}</code>
          </p>
        </li>
      </ol>

      <section class="section guide-section">
        <CurlGuide projectId={project.id} />
      </section>
    </div>
  )
}

function SettingsTab({ project, onRenamed }: { project: ProjectSummary; onRenamed: () => void }) {
  const [name, setName] = useState(project.name)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [confirmName, setConfirmName] = useState('')
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const handleRename = async (e: Event) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed || trimmed === project.name) return
    setSaving(true)
    const res = await api(`/api/projects/${encodeURIComponent(project.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: trimmed }),
    })
    setSaving(false)
    if (res.ok) {
      setMessage('Saved.')
      onRenamed()
    } else {
      const data = await res.json().catch(() => ({}))
      setMessage(data.message || 'Failed to rename')
    }
  }

  const handleDelete = async (e: Event) => {
    e.preventDefault()
    if (confirmName !== project.name) return
    const res = await api(`/api/projects/${encodeURIComponent(project.id)}`, { method: 'DELETE' })
    if (res.ok) navigate()
    else setDeleteError('Failed to delete project')
  }

  return (
    <div class="settings">
      <form class="section" onSubmit={handleRename}>
        <div class="section-header">
          <h2>Name</h2>
        </div>
        <div class="project-create-row">
          <input
            type="text"
            aria-label="Project name"
            value={name}
            onInput={(e) => {
              setName((e.target as HTMLInputElement).value)
              setMessage(null)
            }}
          />
          <button
            class="create-btn"
            type="submit"
            disabled={saving || name.trim() === project.name}
          >
            {saving ? 'Saving…' : 'Rename'}
          </button>
        </div>
        {message && <p class="form-help">{message}</p>}
      </form>

      <form class="section danger-zone" onSubmit={handleDelete}>
        <div class="section-header">
          <h2>Delete project</h2>
        </div>
        <p class="form-help">
          Deletes all {project.doc_count} documents, {project.key_count} keys and every workspace
          in this project. Apps using its keys stop working immediately. This cannot be undone.
        </p>
        <label class="confirm-label" for="confirm-delete">
          Type <strong>{project.name}</strong> to confirm
        </label>
        <div class="project-create-row">
          <input
            id="confirm-delete"
            type="text"
            value={confirmName}
            onInput={(e) => setConfirmName((e.target as HTMLInputElement).value)}
          />
          <button class="danger-btn" type="submit" disabled={confirmName !== project.name}>
            Delete project
          </button>
        </div>
        {deleteError && <p class="project-selector-error">{deleteError}</p>}
      </form>
    </div>
  )
}
