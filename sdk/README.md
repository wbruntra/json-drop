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

## Optimistic concurrency

Every doc carries a `version` integer that the server bumps on each write.
Pass `ifMatch` to `set()` / `delete()` to make a write conditional on the
version you last read — the server returns a `409 conflict` (surfaced as a
`JsonDropError` with `code: 'conflict'`) when your view is stale. This is the
load-modify-write safe path for shared files edited from multiple devices:

```ts
const ref = db.doc('shared/expenses-spain')
const doc = await ref.get() // doc.version === 7
// …modify doc.content in memory…
try {
  await ref.set(newContent, { ifMatch: doc.version })
} catch (e) {
  if (e instanceof JsonDropError && e.code === 'conflict') {
    // re-read, merge, and retry
  } else {
    throw e
  }
}
```

Without `ifMatch`, `set()` is a blind overwrite (last-write-wins) — fine for a
single editor, unsafe for concurrent editors. `Doc` always exposes `version`.

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

## Workspaces (shared, role-based access)

Everything above (`db.projects`, `db.collection()`, `db.doc()`) is the **legacy, single-owner
API** — documents belong to one account, and sharing means handing out a per-document secret.
For anything with more than one person collaborating on the same data (a shared expense
group, a team checklist, ...), use the **workspace API** instead: a workspace is a named,
access-controlled container with per-member roles (`owner` / `admin` / `editor` / `viewer`),
invite links, and its own collections/documents. Workspace documents ignore `accessMode` and
`secret` entirely — membership is the access control.

### Getting an identity

Use a token from a GitHub-authenticated `JsonDrop` instance (`token: 'jd_…'`) if the person
already has a json-drop account. For frictionless onboarding — e.g. a friend clicking an
invite link who has never used json-drop — create an anonymous session instead:

```ts
const db = new JsonDrop({ baseUrl: 'https://your-jsondrop-server.com' })
const { token, user } = await db.sessions.createAnonymous()
// db is now authenticated as this new principal; store `token` (e.g. localStorage)
// to reuse the same identity on the next page load.
```

If that anonymous device's storage is ever lost, an owner/admin of a workspace the principal
belongs to can issue a recovery link (`ws.members.createRecoveryLink(userId)`, below) that
re-authenticates the _same_ principal via `db.sessions.recover(secret)` — as opposed to
rejoining as a brand-new member with no history.

### Creating a workspace and inviting people

```ts
const workspace = await db.workspaces.create({ name: 'Italy 2026' }) // caller becomes owner
const ws = db.workspace(workspace.id)

const invite = await ws.invites.create({ role: 'editor' })
// invite.secret is shown once — build a URL for it yourself and send it out of band,
// e.g. `https://your-app.com/join?invite=${invite.secret}`
```

Someone redeeming that link (on their own `JsonDrop` instance, with their own token or a fresh
anonymous session):

```ts
const friend = new JsonDrop({ baseUrl: 'https://your-jsondrop-server.com' })
await friend.sessions.createAnonymous()
const { workspace_id, role } = await friend.invites.redeem(invite.secret)
```

Redeeming the same invite again as the same principal is idempotent — it won't consume another
use or change their role.

### Members

```ts
await ws.members.list() // [{ user_id, role, display_name, kind, joined_at }, ...]
await ws.members.updateRole(userId, 'admin')
await ws.members.remove(userId)

// Owner/admin-only: re-authenticate a member who lost their anonymous session.
const { secret } = await ws.members.createRecoveryLink(userId)
// send `secret` to that member out of band; they call:
await friend.sessions.recover(secret)
```

The last remaining `owner` of a workspace can't be demoted or removed — the server rejects it
(`400`) to prevent an unowned workspace.

### Workspace documents

Same collection/doc shape as the legacy API, minus `accessMode`/`secret`:

```ts
const expenses = ws.collection('expenses')
const expense = await expenses.add({ amount: 42, paidBy: userId })
const { docs } = await expenses.list()

const ref = ws.doc(expense.id)
await ref.set({ amount: 45, paidBy: userId }, { ifMatch: expense.version }) // optimistic concurrency, same as db.doc()
await ref.delete()
```

## API

### `new JsonDrop(config)`

- `baseUrl` — server URL (required).
- `token` — bearer token (optional). If set, the SDK uses it for `Authorization`.
- `project` — project id to scope anonymous requests to (optional).
- `secret` — default access secret for unauthenticated reads/writes (optional).
- `fetch` — custom `fetch` implementation (optional, defaults to global).

### `db.me()`

Returns the authenticated user, or `null` when no token (or an invalid token)
is configured. In guest mode this lets a page render without a try/catch just
to detect "am I logged in?". Network/server errors still throw.

### `db.projects`

- `db.projects.create({ name })` — create a new project.
- `db.projects.list()` — list the current user's projects.
- `db.projects.delete(id)` — delete a project.

### `db.collection(name)`

- `.add(content, { accessMode, secret })` — `POST /api/docs/{name}` with a server-generated id. Returns `{ ...doc, ref }` where `ref` is a bound `DocRef` you can `.get()` / `.set()` / `.delete()` without re-passing the path.
- `.list({ prefix })` — `GET /api/docs?prefix=…` returning `{ prefix, order, docs, storage }`. `order` is `'path_asc'` (the documented server-side guarantee); `prefix` is the effective prefix echoed back, useful for grouping UIs.
- `.doc(id)` — id-based ref to a child of this collection (uses `/api/docs/{id}`).

### `db.doc(path)`

Path-addressed ref. **Path is the full document path, e.g. `'users/alice'`.**

- `.set(content, { accessMode, secret, ifMatch })` — `PUT /api/docs/{path}`. Returns `{ ...doc, ref }` (a bound `DocRef` to the same path). `ifMatch` enables optimistic concurrency (see above).
- `.get({ secret })` — `GET /api/docs?path=…`.
- `.delete({ secret, ifMatch })` — `DELETE /api/docs?path=…`. Accepts `ifMatch` for conditional delete.

### `db.get(id)` / `db.delete(id)`

Shortcuts for id-addressed reads and deletes.

### `db.sessions`

- `db.sessions.createAnonymous()` — creates a new anonymous principal and session; sets this
  client's token and returns `{ token, user: { id, kind } }`.
- `db.sessions.recover(secret)` — redeems an owner-issued member recovery link (see
  `ws.members.createRecoveryLink`); sets this client's token and returns `{ token }` for the
  original principal.

### `db.invites`

- `db.invites.redeem(secret)` — redeems a workspace invite as the current principal. Returns
  `{ workspace_id, role }`. Idempotent for an existing member.

### `db.workspaces`

- `db.workspaces.create({ name, projectId? })` — creates a workspace; caller becomes `owner`.
- `db.workspaces.list()` — lists workspaces the caller is an active member of.

### `db.workspace(id)`

Returns a `WorkspaceRef`:

- `.get()` — workspace metadata plus the caller's `role`.
- `.update({ name })` — requires `workspace.manage` (owner/admin).
- `.delete()` — requires `workspace.delete` (owner only).
- `.collection(name)` / `.doc(id)` — see "Workspace documents" above.
- `.members.list()` / `.members.updateRole(userId, role)` / `.members.remove(userId)` /
  `.members.createRecoveryLink(userId)` — all require `members.manage` except `list`, which any
  member can call.
- `.invites.create({ role, expiresAt?, maxUses? })` / `.invites.list()` /
  `.invites.revoke(inviteId)` — require `invites.manage` (owner/admin). `role` excludes
  `'owner'` — invites can only grant `admin`/`editor`/`viewer`.

### Types

`WorkspaceRole` (`'owner' | 'admin' | 'editor' | 'viewer'`), `Workspace`,
`WorkspaceMemberInfo`, `WorkspaceInviteInfo`, `CreateInviteResult`, `WorkspaceDoc`,
`WorkspaceListDocsResult`, `AnonymousSession` are all exported from the package.

## Access modes

| Mode                       | Read               | Write              |
| -------------------------- | ------------------ | ------------------ |
| `public` (default)         | Anyone             | Owner or token     |
| `public_read_secret_write` | Anyone             | Owner/token/secret |
| `private`                  | Owner/token/secret | Owner/token/secret |

## Errors

All non-2xx responses throw a `JsonDropError` carrying a stable `code` (for
`switch`), a human `message`, and the HTTP `status`:

```ts
import { JsonDropError } from '@wbruntra/json-drop'

try {
  await db.doc('private/x').get()
} catch (e) {
  if (e instanceof JsonDropError) {
    switch (e.code) {
      case 'unauthenticated': // 401
      case 'forbidden': // 403
      case 'not_found': // 404
      case 'conflict': // 409 — stale version, re-read & retry
      case 'storage_limit': // 413
      case 'rate_limited': // 429
      case 'bad_request': // 400
      case 'server': // 500
    }
  }
}
```

`code` is derived server-side and is the recommended switch key; `message` is
for humans only and may change between releases.
