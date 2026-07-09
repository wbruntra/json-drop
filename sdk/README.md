# json-drop SDK

Firebase-style JavaScript SDK for [json-drop](https://github.com/wbruntra/json-drop). Store arbitrary JSON documents from any frontend using a bearer token, a project id, or a public/secret access mode.

## Install

This package is published to **GitHub Packages**, not the public npm registry.
It is scoped to `@wbruntra`, so consumers must point that scope at GitHub Packages
and authenticate with a GitHub Personal Access Token (PAT) that has at least the
`read:packages` scope.

### One-time setup (in the project that will use the SDK)

Create an `.npmrc` file in that project (or in `~/.npmrc` for global use):

```ini
@wbruntra:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
always-auth=true
```

Then export a PAT with `read:packages` scope as `GITHUB_TOKEN` in your shell
(or CI secrets):

```bash
export GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx
```

### Install

```bash
bun add @wbruntra/json-drop
# or
npm install @wbruntra/json-drop
```

Then import from the scoped name:

```ts
import { JsonDrop } from '@wbruntra/json-drop'
```

## Quick start

```ts
import { JsonDrop } from '@wbruntra/json-drop'

const db = new JsonDrop({
  baseUrl: 'https://your-jsondrop-server.com',
  token: 'jd_…', // optional: owner or project-scoped token
})

// Get the current user
const me = await db.me()

// Projects
const project = await db.projects.create({ name: 'My App' })

// Collections — server-generated IDs
const notes = db.collection('notes')
const note = await notes.add({ title: 'Hello', body: 'World' })
const list = await notes.list()

// Path-addressed documents
const alice = db.doc('users/alice')
await alice.set({ name: 'Alice' })
const got = await alice.get()
await alice.delete()
```

## Anonymous access

You can read public documents without a token by passing a project id:

```ts
const publicDb = new JsonDrop({
  baseUrl: 'https://your-jsondrop-server.com',
  project: 'proj_abc',
})

const doc = await publicDb.doc('public/landing-page').get()
```

Secret-keyed documents can be written by anyone who has the secret:

```ts
const secretDb = new JsonDrop({
  baseUrl: 'https://your-jsondrop-server.com',
  project: 'proj_abc',
  secret: 'the-access-secret',
})

await secretDb.doc('logs/2025-01').set({ entries: [] })
```

## API

### `new JsonDrop(config)`

- `baseUrl` — server URL (required).
- `token` — bearer token (optional). If set, the SDK uses it for `Authorization`.
- `project` — project id to scope anonymous requests to (optional).
- `secret` — default access secret for unauthenticated reads/writes (optional).
- `fetch` — custom `fetch` implementation (optional, defaults to global).

### `db.me()`

Returns the authenticated user.

### `db.projects`

- `db.projects.create({ name })` — create a new project.
- `db.projects.list()` — list the current user's projects.
- `db.projects.delete(id)` — delete a project.

### `db.collection(name)`

- `.add(content, { accessMode, secret })` — `POST /api/docs/{name}` with a server-generated id.
- `.list({ prefix })` — `GET /api/docs?prefix=…` returning `{ docs, storage }`.
- `.doc(id)` — id-based ref to a child of this collection (uses `/api/docs/{id}`).

### `db.doc(path)`

Path-addressed ref. **Path is the full document path, e.g. `'users/alice'`.**

- `.set(content, { accessMode, secret })` — `PUT /api/docs/{path}`.
- `.get({ secret })` — `GET /api/docs?path=…`.
- `.delete({ secret })` — `DELETE /api/docs?path=…`.

### `db.get(id)` / `db.delete(id)`

Shortcuts for id-addressed reads and deletes.

## Access modes

| Mode                       | Read               | Write              |
| -------------------------- | ------------------ | ------------------ |
| `public` (default)         | Anyone             | Owner or token     |
| `public_read_secret_write` | Anyone             | Owner/token/secret |
| `private`                  | Owner/token/secret | Owner/token/secret |

## Errors

All non-2xx responses throw a `JsonDropError`:

```ts
import { JsonDropError } from '@wbruntra/json-drop'

try {
  await db.doc('private/x').get()
} catch (e) {
  if (e instanceof JsonDropError) {
    console.error(e.status, e.message)
  }
}
```
