import { useState } from 'preact/hooks'
import { getExampleToken } from '../api'

type Props = {
  projectId: string | null
}

export function CurlGuide({ projectId }: Props) {
  const [showGuide, setShowGuide] = useState(false)
  const [lang, setLang] = useState<'sdk' | 'curl' | 'axios'>('sdk')
  const [docId] = useState('abc123')
  const [secret] = useState('your-secret-here')
  const [exampleProjectId] = useState('proj_abc')
  const token = getExampleToken() || '${YOUR_API_TOKEN}'

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000'

  const projectQ = projectId ? `?project=${projectId}` : ''
  const projectField = projectId ? `, "project_id": "${projectId}"` : ''

  return (
    <div class="curl-guide">
      <div
        class="guide-header"
        onClick={() => setShowGuide(!showGuide)}
        style={{ cursor: 'pointer' }}
      >
        <h3>{showGuide ? '▼' : '▶'} API Reference &amp; Examples</h3>
      </div>

      {showGuide && (
        <div class="guide-content">
          <p class="guide-intro">
            All examples assume <code>{baseUrl}</code> is the server URL.
          </p>

          <div class="lang-toggle">
            <button class={lang === 'sdk' ? 'active' : ''} onClick={() => setLang('sdk')}>
              JavaScript SDK
            </button>
            <button class={lang === 'curl' ? 'active' : ''} onClick={() => setLang('curl')}>
              curl
            </button>
            <button class={lang === 'axios' ? 'active' : ''} onClick={() => setLang('axios')}>
              axios
            </button>
          </div>

          {lang === 'axios' && (
            <p class="guide-intro">
              Install: <code>bun add axios</code> or <code>npm install axios</code>
            </p>
          )}

          {lang === 'sdk' && (
            <div class="sdk-setup-guide">
              <p class="guide-intro">
                Install: <code>bun add json-drop</code> or <code>npm install json-drop</code>
              </p>

              <div class="curl-block" style={{ borderLeft: '3px solid var(--accent)' }}>
                <span class="curl-label" style={{ fontWeight: 'bold', color: 'var(--accent)' }}>
                  SDK Setup &amp; Initialization
                </span>
                <p class="guide-intro" style={{ marginBottom: '0.75rem' }}>
                  To set up your application, initialize the <code>JsonDrop</code> client. Pass
                  your <strong>Project ID</strong> (<code>{projectId || 'your-project-id'}</code>)
                  to scope anonymous operations, and your <strong>API Token</strong> to
                  authenticate.
                </p>
                <pre>
                  <code>{`import { JsonDrop } from 'json-drop'

const db = new JsonDrop({
  baseUrl: '${baseUrl}',
  token: ${token !== '${YOUR_API_TOKEN}' ? `'${token}'` : `'YOUR_API_TOKEN'`}, // authenticate requests
  ${projectId ? `project: '${projectId}', // scope anonymous operations to this project` : `project: 'YOUR_PROJECT_ID', // scope anonymous operations to this project`}
  // secret: 'your-optional-access-secret' // default access secret for private docs
})`}</code>
                </pre>
                <span class="curl-note">
                  💡 <strong>Tip:</strong> If your API Token is already scoped to a project, the
                  SDK will automatically scope operations to that project even without a{' '}
                  <code>project</code> option.
                </span>
              </div>
            </div>
          )}

          <h4>Authentication</h4>
          <div class="curl-block">
            <span class="curl-label">Sign in (browser only):</span>
            <code>GET /api/auth/github</code>
            <span class="curl-note">
              Redirects to GitHub OAuth, stores API token in localStorage. Dev mode skips GitHub.
            </span>
          </div>

          <div class="curl-block">
            <span class="curl-label">Get current user:</span>
            {lang === 'curl' && (
              <pre>
                <code>{`curl ${baseUrl}/api/me \\
  -H "Authorization: Bearer ${token}"`}</code>
              </pre>
            )}
            {lang === 'axios' && (
              <pre>
                <code>{`const { data: user } = await axios.get('${baseUrl}/api/me', {
  headers: { Authorization: \`Bearer ${token}\` }
})`}</code>
              </pre>
            )}
            {lang === 'sdk' && (
              <pre>
                <code>{`const user = await db.me()`}</code>
              </pre>
            )}
          </div>

          <h4>Projects</h4>
          <div class="curl-block">
            <span class="curl-label">Create / List / Delete a project:</span>
            {lang === 'curl' && (
              <pre>
                <code>{`# create a project
curl -X POST ${baseUrl}/api/projects \\
  -H "Authorization: Bearer ${token}" \\
  -H "Content-Type: application/json" \\
  -d '{"name": "My App"}'

# list your projects
curl ${baseUrl}/api/projects \\
  -H "Authorization: Bearer ${token}"

# delete a project (admin required)
curl -X DELETE ${baseUrl}/api/projects/${exampleProjectId} \\
  -H "Authorization: Bearer ${token}"`}</code>
              </pre>
            )}
            {lang === 'axios' && (
              <pre>
                <code>{`// create a project
const { data: project } = await axios.post(
  '${baseUrl}/api/projects',
  { name: 'My App' },
  { headers: { Authorization: \`Bearer ${token}\` } }
)

// list your projects
const { data: projects } = await axios.get('${baseUrl}/api/projects', {
  headers: { Authorization: \`Bearer ${token}\` }
})

// delete a project (admin required)
await axios.delete('${baseUrl}/api/projects/${exampleProjectId}', {
  headers: { Authorization: \`Bearer ${token}\` }
})`}</code>
              </pre>
            )}
            {lang === 'sdk' && (
              <pre>
                <code>{`// create a project
const project = await db.projects.create({ name: 'My App' })

// list your projects
const projects = await db.projects.list()

// delete a project (admin required)
await db.projects.delete('${exampleProjectId}')`}</code>
              </pre>
            )}
          </div>

          <h4>API Token Management</h4>
          <div class="curl-block">
            <span class="curl-label">Create a token (admin required):</span>
            {lang === 'curl' && (
              <pre>
                <code>{`curl -X POST ${baseUrl}/api/tokens \\
  -H "Authorization: Bearer ${token}" \\
  -H "Content-Type: application/json" \\
  -d '{"permissions": "read_write"${projectField}}'`}</code>
              </pre>
            )}
            {lang === 'axios' && (
              <pre>
                <code>{`const { data } = await axios.post(
  '${baseUrl}/api/tokens',
  { permissions: 'read_write'${projectField} },
  { headers: { Authorization: \`Bearer ${token}\` } }
)
// data.token — your new API token`}</code>
              </pre>
            )}
            {lang === 'sdk' && (
              <pre>
                <code>{`const data = await db.request('/api/tokens', {
  method: 'POST',
  body: { permissions: 'read_write'${projectId ? `, project_id: '${projectId}'` : ''} }
})
// data.token — your new API token`}</code>
              </pre>
            )}
            <span class="curl-note">
              Permissions: <code>read</code>, <code>write</code>, <code>read_write</code>,{' '}
              <code>admin</code>. Add <code>project_id</code> to scope a token to a single project.
            </span>
          </div>

          <div class="curl-block">
            <span class="curl-label">List / Revoke:</span>
            {lang === 'curl' && (
              <pre>
                <code>{`# list tokens
curl ${baseUrl}/api/tokens \\
  -H "Authorization: Bearer ${token}"

# revoke a token
curl -X DELETE ${baseUrl}/api/tokens/123 \\
  -H "Authorization: Bearer ${token}"`}</code>
              </pre>
            )}
            {lang === 'axios' && (
              <pre>
                <code>{`// list
const { data: tokens } = await axios.get('${baseUrl}/api/tokens', {
  headers: { Authorization: \`Bearer ${token}\` }
})

// revoke
await axios.delete('${baseUrl}/api/tokens/123', {
  headers: { Authorization: \`Bearer ${token}\` }
})`}</code>
              </pre>
            )}
            {lang === 'sdk' && (
              <pre>
                <code>{`// list tokens
const tokens = await db.request('/api/tokens', { method: 'GET' })

// revoke
await db.request('/api/tokens/123', { method: 'DELETE' })`}</code>
              </pre>
            )}
          </div>

          <h4>Documents — Create / Update</h4>
          <div class="curl-block">
            <span class="curl-label">Create or Update a document (by path):</span>
            {lang === 'curl' && (
              <pre>
                <code>{`# public (create/update a document at path "config")
curl -X PUT ${baseUrl}/api/docs/config${projectQ} \\
  -H "Authorization: Bearer ${token}" \\
  -H "Content-Type: application/json" \\
  -d '{"content":{"theme":"dark"},"access_mode":"public"}'

# private (create/update a document at path "notes/todo")
curl -X PUT ${baseUrl}/api/docs/notes/todo${projectQ} \\
  -H "Authorization: Bearer ${token}" \\
  -H "Content-Type: application/json" \\
  -d '{"content":{"task":"buy milk"},"access_mode":"private"}'`}</code>
              </pre>
            )}
            {lang === 'axios' && (
              <pre>
                <code>{`const { data } = await axios.put(
  '${baseUrl}/api/docs/notes/todo${projectQ}',
  {
    content: { task: 'buy milk' },
    access_mode: 'private'
  },
  { headers: { Authorization: \`Bearer ${token}\` } }
)
const { id, access_secret } = data
// save access_secret — won't be shown again if newly created`}</code>
              </pre>
            )}
            {lang === 'sdk' && (
              <pre>
                <code>{`// public (create/update a document at path "config")
await db.doc('config').set(
  { theme: 'dark' },
  { accessMode: 'public' }
)

// private (create/update a document at path "notes/todo")
const { id, access_secret } = await db.doc('notes/todo').set(
  { task: 'buy milk' },
  { accessMode: 'private' }
)
// save access_secret — won't be shown again if newly created`}</code>
              </pre>
            )}
            <span class="curl-note">
              Access modes: <code>public</code>, <code>public_read_secret_write</code>,{' '}
              <code>private</code>. Add <code>?project=&lt;id&gt;</code> (or configure{' '}
              <code>project</code> in SDK) to scope to a project.
            </span>
          </div>

          <div class="curl-block">
            <span class="curl-label">Update with secret (no owner authentication needed):</span>
            {lang === 'curl' && (
              <pre>
                <code>{`curl -X PUT '${baseUrl}/api/docs/notes/todo?secret=${secret}${projectId ? `&project=${projectId}` : ''}' \\
  -H "Content-Type: application/json" \\
  -d '{"content":{"task":"buy milk and bread"},"access_mode":"private"}'`}</code>
              </pre>
            )}
            {lang === 'axios' && (
              <pre>
                <code>{`const { data } = await axios.put(
  '${baseUrl}/api/docs/notes/todo',
  {
    content: { task: 'buy milk and bread' },
    access_mode: 'private'
  },
  { params: { secret: '${secret}'${projectId ? `, project: '${projectId}'` : ''} } }
)`}</code>
              </pre>
            )}
            {lang === 'sdk' && (
              <pre>
                <code>{`await db.doc('notes/todo').set(
  { task: 'buy milk and bread' },
  { accessMode: 'private', secret: '${secret}' }
)`}</code>
              </pre>
            )}
          </div>

          <h4>Documents — Read</h4>
          <div class="curl-block">
            <span class="curl-label">Read a document (by path):</span>
            {lang === 'curl' && (
              <pre>
                <code>{`# public (no auth)
curl '${baseUrl}/api/docs?path=notes/todo${projectId ? `&project=${projectId}` : ''}'

# private with secret
curl '${baseUrl}/api/docs?path=notes/todo&secret=${secret}${projectId ? `&project=${projectId}` : ''}'

# as owner
curl '${baseUrl}/api/docs?path=notes/todo${projectId ? `&project=${projectId}` : ''}' \\
  -H "Authorization: Bearer ${token}"`}</code>
              </pre>
            )}
            {lang === 'axios' && (
              <pre>
                <code>{`// public (no auth)
const { data } = await axios.get('${baseUrl}/api/docs', {
  params: { path: 'notes/todo'${projectId ? `, project: '${projectId}'` : ''} }
})

// private with secret
const { data } = await axios.get('${baseUrl}/api/docs', {
  params: { path: 'notes/todo', secret: '${secret}'${projectId ? `, project: '${projectId}'` : ''} }
})

// as owner
const { data } = await axios.get('${baseUrl}/api/docs', {
  params: { path: 'notes/todo'${projectId ? `, project: '${projectId}'` : ''} },
  headers: { Authorization: \`Bearer ${token}\` }
})`}</code>
              </pre>
            )}
            {lang === 'sdk' && (
              <pre>
                <code>{`// public (no auth) or as owner (using initialized token)
const doc = await db.doc('notes/todo').get()

// private with secret
const doc = await db.doc('notes/todo').get({ secret: '${secret}' })`}</code>
              </pre>
            )}
          </div>

          <div class="curl-block">
            <span class="curl-label">List all your documents (supports path filtering):</span>
            {lang === 'curl' && (
              <pre>
                <code>{`# list all in scope
curl '${baseUrl}/api/docs${projectQ}' \\
  -H "Authorization: Bearer ${token}"

# list only under "notes" collection
curl '${baseUrl}/api/docs?prefix=notes${projectId ? `&project=${projectId}` : ''}' \\
  -H "Authorization: Bearer ${token}"`}</code>
              </pre>
            )}
            {lang === 'axios' && (
              <pre>
                <code>{`// list all in scope (includes storage info)
const { data: { docs, storage } } = await axios.get('${baseUrl}/api/docs${projectQ}', {
  headers: { Authorization: \`Bearer ${token}\` }
})

// list only under "notes" prefix
const { data: { docs } } = await axios.get('${baseUrl}/api/docs', {
  params: { prefix: 'notes'${projectId ? `, project: '${projectId}'` : ''} },
  headers: { Authorization: \`Bearer ${token}\` }
})`}</code>
              </pre>
            )}
            {lang === 'sdk' && (
              <pre>
                <code>{`// list all in scope (includes storage info)
const { docs, storage } = await db.request('/api/docs', { method: 'GET' })

// list only under "notes" collection prefix
const { docs } = await db.collection('notes').list()`}</code>
              </pre>
            )}
          </div>

          <h4>Documents — Delete</h4>
          <div class="curl-block">
            <span class="curl-label">Delete a document (by path):</span>
            {lang === 'curl' && (
              <pre>
                <code>{`curl -X DELETE '${baseUrl}/api/docs?path=notes/todo${projectId ? `&project=${projectId}` : ''}' \\
  -H "Authorization: Bearer ${token}"`}</code>
              </pre>
            )}
            {lang === 'axios' && (
              <pre>
                <code>{`await axios.delete('${baseUrl}/api/docs', {
  params: { path: 'notes/todo'${projectId ? `, project: '${projectId}'` : ''} },
  headers: { Authorization: \`Bearer ${token}\` }
})`}</code>
              </pre>
            )}
            {lang === 'sdk' && (
              <pre>
                <code>{`await db.doc('notes/todo').delete()`}</code>
              </pre>
            )}
          </div>

          <h4>Access Modes Summary</h4>
          <div class="guide-table">
            <div class="guide-row guide-row-header">
              <span>Mode</span>
              <span>Read</span>
              <span>Write</span>
            </div>
            <div class="guide-row">
              <span>
                <code>public</code>
              </span>
              <span>Anyone</span>
              <span>Owner or token</span>
            </div>
            <div class="guide-row">
              <span>
                <code>public_read_secret_write</code>
              </span>
              <span>Anyone</span>
              <span>Owner, token, or secret</span>
            </div>
            <div class="guide-row">
              <span>
                <code>private</code>
              </span>
              <span>Owner, token, or secret</span>
              <span>Owner, token, or secret</span>
            </div>
          </div>

          <h4>Limits</h4>
          <p>
            1MB max per document. 10MB total per user. 100 req/min per IP or token. Exceeding
            returns <code>413 Payload Too Large</code> or <code>429 Too Many Requests</code>.
          </p>
        </div>
      )}
    </div>
  )
}
