import { useCopy } from '../useCopy'

type Block =
  | { kind: 'h2' | 'h3' | 'p'; text: string }
  | { kind: 'code'; lang: string; text: string }
  | { kind: 'table'; rows: string[][] }

function buildDocs(baseUrl: string): Block[] {
  return [
    {
      kind: 'p',
      text: `json-drop is a small JSON document store for apps with no backend. Your app reads and writes documents at paths inside a project, using an API key. Server: ${baseUrl}`,
    },

    { kind: 'h2', text: '1. Create a project and a key' },
    {
      kind: 'p',
      text: 'In the dashboard, create a project, open its Keys tab and create a project key. Use read_write to let the app save data, or read for read-only. Project keys only reach their own project. A key shipped in frontend code can be read by anyone, so prefer a read key for public data and keep read_write keys on trusted clients.',
    },
    {
      kind: 'p',
      text: 'Account keys (admin) manage projects and keys. Use them only in scripts you control, never in frontend code.',
    },

    { kind: 'h2', text: '2. Install the SDK' },
    {
      kind: 'p',
      text: 'The SDK is published to GitHub Packages. Add an .npmrc at your project root, with GITHUB_TOKEN set to a personal access token that has read:packages:',
    },
    {
      kind: 'code',
      lang: 'ini',
      text: `@wbruntra:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=\${GITHUB_TOKEN}`,
    },
    {
      kind: 'code',
      lang: 'bash',
      text: `bun add @wbruntra/json-drop
# or
npm install @wbruntra/json-drop`,
    },

    { kind: 'h2', text: '3. Initialize the client' },
    {
      kind: 'code',
      lang: 'ts',
      text: `import { JsonDrop } from '@wbruntra/json-drop'

const db = new JsonDrop({
  baseUrl: '${baseUrl}',
  token: 'YOUR_PROJECT_KEY',
  project: 'YOUR_PROJECT_ID', // optional when the key is project-scoped
})`,
    },

    { kind: 'h2', text: '4. Read and write documents' },
    {
      kind: 'p',
      text: 'A document is any JSON value stored at a path like users/alice. A collection is just a path prefix (notes/…); there is nothing to create first.',
    },
    {
      kind: 'code',
      lang: 'ts',
      text: `// write at a known path (create or replace)
await db.doc('users/alice').set({ name: 'Alice' })

// read it back
const doc = await db.doc('users/alice').get()
console.log(doc.content, doc.version)

// add to a collection with a server-generated id
const note = await db.collection('notes').add({ title: 'Hello' })
console.log(note.path) // e.g. notes/xK92mP

// list a collection
const { docs } = await db.collection('notes').list()

// delete
await db.doc('users/alice').delete()`,
    },
    {
      kind: 'p',
      text: 'Every document has a version that increases on each write. Pass ifMatch to make a write conditional; a stale version fails with 409 instead of overwriting.',
    },
    {
      kind: 'code',
      lang: 'ts',
      text: `const doc = await db.doc('settings').get()
await db.doc('settings').set(
  { ...doc.content, theme: 'dark' },
  { ifMatch: doc.version },
)`,
    },

    { kind: 'h2', text: '5. Access modes' },
    {
      kind: 'p',
      text: 'Set accessMode when writing (default is public). Non-public documents return an access_secret when created; save it, it is shown once. Pass it as secret to read or write without an owner key.',
    },
    {
      kind: 'table',
      rows: [
        ['Mode', 'Read', 'Write'],
        ['public', 'Anyone', 'Owner or key'],
        ['public_read_secret_write', 'Anyone', 'Owner, key, or secret'],
        ['private', 'Owner, key, or secret', 'Owner, key, or secret'],
      ],
    },
    {
      kind: 'code',
      lang: 'ts',
      text: `const { access_secret } = await db
  .doc('notes/todo')
  .set({ task: 'buy milk' }, { accessMode: 'private' })

// later, with only the secret
await db.doc('notes/todo').get({ secret: access_secret })`,
    },

    { kind: 'h2', text: 'Without the SDK (HTTP)' },
    {
      kind: 'p',
      text: 'Send the key as a Bearer token. Add ?project=<id> if the key is not project-scoped.',
    },
    {
      kind: 'code',
      lang: 'bash',
      text: `# write
curl -X PUT ${baseUrl}/api/docs/users/alice \\
  -H "Authorization: Bearer YOUR_PROJECT_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"content":{"name":"Alice"},"access_mode":"public"}'

# read (public docs need no auth, but need the project)
curl '${baseUrl}/api/docs/users/alice?project=YOUR_PROJECT_ID'

# add to a collection
curl -X POST ${baseUrl}/api/docs/notes \\
  -H "Authorization: Bearer YOUR_PROJECT_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"content":{"title":"Hello"}}'

# list a collection
curl '${baseUrl}/api/docs?prefix=notes' \\
  -H "Authorization: Bearer YOUR_PROJECT_KEY"

# delete
curl -X DELETE ${baseUrl}/api/docs/users/alice \\
  -H "Authorization: Bearer YOUR_PROJECT_KEY"`,
    },

    { kind: 'h2', text: 'Limits and errors' },
    {
      kind: 'p',
      text: '1 MB max per document, 10 MB total per user, 100 requests/min per IP or key. Exceeding these returns 413 Payload Too Large or 429 Too Many Requests. A request with no project returns 400. SDK failures throw JsonDropError with status, message and code.',
    },
  ]
}

function toMarkdown(title: string, blocks: Block[]): string {
  const out = [`# ${title}`]
  for (const b of blocks) {
    if (b.kind === 'h2') out.push(`## ${b.text}`)
    else if (b.kind === 'h3') out.push(`### ${b.text}`)
    else if (b.kind === 'p') out.push(b.text)
    else if (b.kind === 'code') out.push('```' + b.lang + '\n' + b.text + '\n```')
    else {
      const [head, ...body] = b.rows
      const line = (r: string[], code = false) =>
        '| ' + r.map((c, i) => (code && i === 0 ? `\`${c}\`` : c)).join(' | ') + ' |'
      out.push(
        [
          line(head),
          '| ' + head.map(() => '---').join(' | ') + ' |',
          ...body.map((r) => line(r, true)),
        ].join('\n'),
      )
    }
  }
  return out.join('\n\n') + '\n'
}

export function Docs() {
  const { copiedId, copy } = useCopy()
  const baseUrl = window.location.origin
  const title = 'Using json-drop'
  const blocks = buildDocs(baseUrl)

  return (
    <div class="page">
      <div class="page-header">
        <div>
          <h2 class="page-title">Docs</h2>
          <p class="page-subtitle">How to add json-drop to a project.</p>
        </div>
        <button class="copy-btn" onClick={() => copy(toMarkdown(title, blocks), 'docs-md')}>
          {copiedId === 'docs-md' ? 'Copied!' : 'Copy as Markdown'}
        </button>
      </div>

      <div class="curl-guide">
        <div class="guide-content docs-content">
          {blocks.map((b) => {
            if (b.kind === 'h2') return <h4>{b.text}</h4>
            if (b.kind === 'h3') return <h5>{b.text}</h5>
            if (b.kind === 'p') return <p class="guide-intro">{b.text}</p>
            if (b.kind === 'code')
              return (
                <div class="curl-block">
                  <pre>
                    <code>{b.text}</code>
                  </pre>
                </div>
              )
            return (
              <div class="guide-table">
                {b.rows.map((r, i) => (
                  <div class={`guide-row ${i === 0 ? 'guide-row-header' : ''}`}>
                    {r.map((c, j) => (
                      <span>{i > 0 && j === 0 ? <code>{c}</code> : c}</span>
                    ))}
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
