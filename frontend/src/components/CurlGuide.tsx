import { useState } from 'preact/hooks'
import { getExampleToken } from '../api'

export function CurlGuide() {
  const [showGuide, setShowGuide] = useState(false)
  const [lang, setLang] = useState<'curl' | 'js'>('curl')
  const [docId] = useState('abc123')
  const [secret] = useState('your-secret-here')
  const token = getExampleToken() || '${YOUR_API_TOKEN}'

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000'

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
            <button class={lang === 'curl' ? 'active' : ''} onClick={() => setLang('curl')}>
              curl
            </button>
            <button class={lang === 'js' ? 'active' : ''} onClick={() => setLang('js')}>
              JavaScript fetch
            </button>
          </div>

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
            {lang === 'curl' ? (
              <pre>
                <code>{`curl ${baseUrl}/api/me \\
  -H "Authorization: Bearer ${token}"`}</code>
              </pre>
            ) : (
              <pre>
                <code>{`const res = await fetch('${baseUrl}/api/me', {
  headers: { Authorization: \`Bearer \${token}\` }
})
const user = await res.json()`}</code>
              </pre>
            )}
          </div>

          <h4>API Token Management</h4>
          <div class="curl-block">
            <span class="curl-label">Create a token (admin required):</span>
            {lang === 'curl' ? (
              <pre>
                <code>{`curl -X POST ${baseUrl}/api/tokens \\
  -H "Authorization: Bearer ${token}" \\
  -H "Content-Type: application/json" \\
  -d '{"name": "my-token", "permissions": "read_write"}'`}</code>
              </pre>
            ) : (
              <pre>
                <code>{`const res = await fetch('${baseUrl}/api/tokens', {
  method: 'POST',
  headers: {
    Authorization: \`Bearer \${token}\`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ name: 'my-token', permissions: 'read_write' })
})
const data = await res.json()
// data.token — store this, won't be shown again`}</code>
              </pre>
            )}
            <span class="curl-note">
              Permissions: <code>read</code>, <code>write</code>, <code>read_write</code>,{' '}
              <code>admin</code>
            </span>
          </div>

          <div class="curl-block">
            <span class="curl-label">List / Revoke:</span>
            {lang === 'curl' ? (
              <pre>
                <code>{`# list tokens
curl ${baseUrl}/api/tokens \\
  -H "Authorization: Bearer ${token}"

# revoke a token
curl -X DELETE ${baseUrl}/api/tokens/123 \\
  -H "Authorization: Bearer ${token}"`}</code>
              </pre>
            ) : (
              <pre>
                <code>{`// list
const res = await fetch('${baseUrl}/api/tokens', {
  headers: { Authorization: \`Bearer \${token}\` }
})

// revoke
await fetch('${baseUrl}/api/tokens/123', {
  method: 'DELETE',
  headers: { Authorization: \`Bearer \${token}\` }
})`}</code>
              </pre>
            )}
          </div>

          <h4>Documents — Create</h4>
          <div class="curl-block">
            <span class="curl-label">Create a document:</span>
            {lang === 'curl' ? (
              <pre>
                <code>{`# public
curl -X POST ${baseUrl}/api/docs \\
  -H "Authorization: Bearer ${token}" \\
  -H "Content-Type: application/json" \\
  -d '{"name":"config","content":{"theme":"dark"},"access_mode":"public"}'

# private (returns access_secret)
curl -X POST ${baseUrl}/api/docs \\
  -H "Authorization: Bearer ${token}" \\
  -H "Content-Type: application/json" \\
  -d '{"name":"secrets","content":{"key":"val"},"access_mode":"private"}'`}</code>
              </pre>
            ) : (
              <pre>
                <code>{`const res = await fetch('${baseUrl}/api/docs', {
  method: 'POST',
  headers: {
    Authorization: \`Bearer \${token}\`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    name: 'config',
    content: { theme: 'dark' },
    access_mode: 'public'
  })
})
const { id, access_secret } = await res.json()
// save access_secret — won't be shown again`}</code>
              </pre>
            )}
            <span class="curl-note">
              Access modes: <code>public</code>, <code>public_read_secret_write</code>,{' '}
              <code>private</code>
            </span>
          </div>

          <h4>Documents — Read</h4>
          <div class="curl-block">
            <span class="curl-label">Read a document:</span>
            {lang === 'curl' ? (
              <pre>
                <code>{`# public (no auth)
curl ${baseUrl}/api/docs/${docId}

# private with secret
curl '${baseUrl}/api/docs/${docId}?secret=${secret}'

# as owner
curl ${baseUrl}/api/docs/${docId} \\
  -H "Authorization: Bearer ${token}"

# list all yours
curl ${baseUrl}/api/docs \\
  -H "Authorization: Bearer ${token}"`}</code>
              </pre>
            ) : (
              <pre>
                <code>{`// public (no auth)
const res = await fetch('${baseUrl}/api/docs/${docId}')

// private with secret
const res = await fetch('${baseUrl}/api/docs/${docId}?secret=${secret}')

// as owner
const res = await fetch('${baseUrl}/api/docs/${docId}', {
  headers: { Authorization: \`Bearer \${token}\` }
})

// list all yours (includes storage info)
const res = await fetch('${baseUrl}/api/docs', {
  headers: { Authorization: \`Bearer \${token}\` }
})
const { docs, storage } = await res.json()`}</code>
              </pre>
            )}
          </div>

          <h4>Documents — Update</h4>
          <div class="curl-block">
            <span class="curl-label">Update a document:</span>
            {lang === 'curl' ? (
              <pre>
                <code>{`# as owner
curl -X PUT ${baseUrl}/api/docs/${docId} \\
  -H "Authorization: Bearer ${token}" \\
  -H "Content-Type: application/json" \\
  -d '{"name":"new-name","content":{"updated":true}}'

# with secret (no auth needed)
curl -X PUT '${baseUrl}/api/docs/${docId}?secret=${secret}' \\
  -H "Content-Type: application/json" \\
  -d '{"content":{"updated":true}}'`}</code>
              </pre>
            ) : (
              <pre>
                <code>{`// as owner
await fetch('${baseUrl}/api/docs/${docId}', {
  method: 'PUT',
  headers: {
    Authorization: \`Bearer \${token}\`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ name: 'new-name', content: { updated: true } })
})

// with secret
await fetch('${baseUrl}/api/docs/${docId}?secret=${secret}', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ content: { updated: true } })
})`}</code>
              </pre>
            )}
          </div>

          <h4>Documents — Delete</h4>
          <div class="curl-block">
            <span class="curl-label">Delete a document:</span>
            {lang === 'curl' ? (
              <pre>
                <code>{`curl -X DELETE ${baseUrl}/api/docs/${docId} \\
  -H "Authorization: Bearer ${token}"`}</code>
              </pre>
            ) : (
              <pre>
                <code>{`await fetch('${baseUrl}/api/docs/${docId}', {
  method: 'DELETE',
  headers: { Authorization: \`Bearer \${token}\` }
})`}</code>
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
