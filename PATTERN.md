# Backend Pattern

A Bun + Hono + Kysely + SQLite backend pattern for API servers. Built for `json-drop` and designed to be reused.

## Stack

| Layer          | Choice                                |
| -------------- | ------------------------------------- |
| Runtime        | Bun                                   |
| HTTP framework | Hono                                  |
| Database       | SQLite via `bun:sqlite`               |
| Query builder  | Kysely + `kysely-bun-dialects`        |
| Auth           | Bearer token (SHA-256 hashed)         |
| Migrations     | Raw SQL files, run at startup         |
| Type gen       | Custom `codegen.ts` from pragmas      |
| Testing        | `bun test`, real server, in-memory DB |

## Project Structure

```
├── index.ts              # Entry point: init DB, start server
├── server.ts             # Hono app + Bun.serve wrapper
├── middleware.ts          # Utility functions (hash, rate-limit, jsonResponse)
├── kysely-db.ts           # DB lifecycle: init, getDb(), getRawDb(), types
├── kysely-types.ts        # Auto-generated table types (don't edit)
├── codegen.ts             # Generates kysely-types.ts from SQLite schema
├── migrate.ts             # Runs .sql migration files in order
├── database.ts            # Legacy sync bun:sqlite wrapper (for tests/transition)
├── migrations/            # Ordered .sql migration files
│   └── 001_initial.sql
├── services/              # Data access layer — Kysely queries only
│   ├── index.ts           # Barrel export
│   ├── users.ts           # createUser, getUser, getUserByGithubId
│   ├── tokens.ts          # createApiToken, listApiTokens, revokeApiToken, etc.
│   ├── documents.ts       # upsertDocument, listDocuments, deleteDocument, etc.
│   └── auth.ts            # extractAuth (bearer token → user + permissions)
├── routes/                # HTTP handlers — call services, never DB directly
│   ├── auth.ts            # OAuth login, callback, logout
│   ├── me.ts              # GET /api/me
│   ├── tokens.ts          # CRUD /api/tokens
│   ├── docs.ts            # CRUD /api/docs
│   └── dev.ts             # Dev-only login shortcuts
├── auth.ts                # JWT session + GitHub OAuth helpers
├── limits.ts              # Rate/storage limit constants
└── api.test.ts            # Integration tests (real server, in-memory DB)
```

## Database Layer

### Migrations (`migrate.ts`)

Plain SQL files in `migrations/`, sorted alphabetically. Each file is run inside a transaction and recorded in `_migrations`.

```sql
-- migrations/001_initial.sql
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  github_id TEXT UNIQUE NOT NULL,
  ...
);
```

Run manually or at startup:

```
bun migrate                    # standalone
await runMigrations(db)        # called by initDatabase()
```

The migrator sets `PRAGMA journal_mode = WAL` and `PRAGMA foreign_keys = ON`.

### Type Generation (`codegen.ts`)

Introspects the SQLite database via `PRAGMA table_info` and `PRAGMA foreign_key_list`, then generates `kysely-types.ts`:

- `INTEGER PRIMARY KEY` → `Generated<number>` (auto-increment)
- `DEFAULT CURRENT_TIMESTAMP` → `Generated<string>`
- Foreign key columns are treated as NOT NULL even when SQLite pragma omits it
- Output: per-table interfaces (`UsersTable`, ...) + `DatabaseSchema`

```bash
bun run codegen                # regenerate after schema changes
```

### Database Lifecycle (`kysely-db.ts`)

Single module that owns the connection. Two exports:

- `initDatabase(path)` — creates `bun:sqlite` Database, runs migrations, wraps with Kysely
- `getDb()` — returns typed `Kysely<DatabaseSchema>` for service layer
- `getRawDb()` — returns `bun:sqlite` Database for migrations and legacy sync code

```ts
// index.ts
await initDatabase(process.env.DATABASE_URL || 'db.sqlite')
```

### Kysely Query Pattern

All service functions are Kysely-based and async. The generated types provide full type safety:

```ts
// services/users.ts
export async function getUser(id: number): Promise<User | null> {
  const result = await getDb()
    .selectFrom('users')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst()
  return result ?? null
}

export async function createUser(githubId, email, displayName) {
  return getDb()
    .insertInto('users')
    .values({ github_id: githubId, email, display_name: displayName })
    .onConflict((oc) => oc.column('github_id').doUpdateSet({ email, display_name: displayName }))
    .returningAll()
    .executeTakeFirstOrThrow()
}
```

## Service Layer (`services/`)

The **only** place that touches the database. Routes never import `kysely-db` directly.

Rules:

- Every function is `async` and uses Kysely
- Accepts plain values, returns typed records
- No HTTP concerns (no Request, no Response, no status codes)
- Can call other services (e.g. `services/auth.ts` calls `tokens.getApiTokenByHash` and `users.getUser`)

### Auth Service (`services/auth.ts`)

Extracts user identity from `Authorization: Bearer <token>` header:

```ts
export type AuthContext = {
  user: User | null // null = unauthenticated
  tokenPermissions: string | null // 'read' | 'write' | 'read_write' | 'admin'
}

export async function extractAuth(req: Request): Promise<AuthContext>
```

This is called by Hono middleware (not by individual routes). Routes receive auth via `c.get('auth')`.

## HTTP Layer

### Hono App (`server.ts`)

Middleware chain, applied in order:

```
cors('*')        →  CORS headers on all responses
logger()         →  Colored request logging to console
rateLimiter()    →  100 req/min per key (token or IP), on /api/*
authMiddleware   →  Sets c.get('auth') from bearer token, on /api/*
```

Hono typed context:

```ts
type Bindings = {
  Variables: {
    auth: AuthContext
  }
}
const app = new Hono<Bindings>()
```

Routes use `c.get('auth')` for auth, `c.req.param()` for URL params, `c.req.raw` for the native `Request`:

```ts
app.get('/api/me', (c) => handleMe(c.get('auth')))
app.delete('/api/tokens/:id', (c) => {
  const id = c.req.param('id')
  return handleDeleteToken(c.req.raw, c.get('auth'), id)
})
```

Multi-segment wildcard (Hono `*` does NOT populate params — use regex):

```ts
app.get('/api/docs/:path{.+}', (c) => {
  const path = c.req.param('path') // 'notes/2024/january/todo'
  return handleGetDoc(c.req.raw, c.get('auth'), path)
})
```

### Route Handlers (`routes/`)

Routes are pure functions: take `Request` + params, return `Response`. They call services for data, never the database directly:

```ts
// routes/me.ts
export function handleMe(auth: AuthContext): Response {
  if (!auth.user) return jsonResponse({ error: 'Not authenticated' }, 401)
  return jsonResponse({ id: auth.user.id, email: auth.user.email })
}
```

Async handlers call `await` on services:

```ts
// routes/docs.ts
export async function handleGetDoc(req, auth, id) {
  const doc = await getDocument(id) // service call
  if (!doc) return jsonResponse({ error: 'Not found' }, 404)
  if (!canRead(auth, doc, secret)) return jsonResponse({ error: 'Forbidden' }, 403)
  return jsonResponse(doc)
}
```

### Utilities (`middleware.ts`)

Framework-agnostic helpers:

- `generateToken()` / `hashToken(token)` — bearer token generation and SHA-256 hashing
- `checkRateLimit(key)` / `getRateLimitKey(req)` — in-memory sliding window rate limiter
- `jsonResponse(data, status?, headers?)` — JSON response with CORS headers

## Entry Point (`index.ts`)

Thin orchestration:

```ts
await initDatabase(process.env.DATABASE_URL || 'db.sqlite')

const server = createServer({
  port: Number(process.env.PORT) || 3000,
  homepage, // Bun HTMLBundle for frontend
  development: isDev ? { hmr: true, console: true } : false,
})

console.log(`Listening on http://localhost:${server.port}`)
```

## Testing Pattern

Uses `bun test`. Each test gets a fresh in-memory database:

```ts
import { createServer } from './server'
import { initDatabase, createUser, createApiToken } from './database'

let server: ReturnType<typeof createServer>
let baseUrl: string

beforeAll(() => {
  server = createServer({ port: 0 }) // random port
  baseUrl = `http://localhost:${server.port}`
})

afterAll(() => server.stop())

beforeEach(async () => {
  await initDatabase(':memory:', { silent: true })
  const user = createUser('github-123', 'test@example.com', 'Test User')
  const token = generateToken()
  createApiToken(user.id, 'Admin Token', hashToken(token), 'admin')
})

test('GET /api/me returns user', async () => {
  const res = await fetch(`${baseUrl}/api/me`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  expect(res.status).toBe(200)
})
```

Key points:

- Real server, real HTTP requests via `fetch`
- `initDatabase(':memory:')` gives each test a clean DB
- `createServer({ port: 0 })` uses a random available port
- `{ silent: true }` suppresses migration logging in test output

## Conventions & Gotchas

- **Hono wildcard routes**: Use `:param{.+}` for multi-segment paths, not `*`. Hono's `*` wildcard does not populate `c.req.param('*')`.
- **Bun HTMLBundle**: Bun's HTML import bundles (HMR, CSS, TSX) only work when returned directly from `Bun.serve()`'s `fetch` — Hono's `c.body()` can't handle them. Intercept the homepage route in the `Bun.serve()` wrapper instead.
- **Module-level DB init**: Never call `new Database(...)` at module top level. Always use `initDatabase()` explicitly. Module-level init causes test-ordering hacks.
- **Sync vs async**: `database.ts` provides sync `bun:sqlite` wrappers for transitional/test use. New code should use the async Kysely services in `services/`.
- **FK nullability**: SQLite's `PRAGMA table_info.notnull` is `0` for foreign key columns even when they're effectively NOT NULL. The codegen queries `PRAGMA foreign_key_list` to correct this.
- **ON CONFLICT RETURNING**: SQLite's `INSERT ... ON CONFLICT DO UPDATE ... RETURNING *` is supported. Kysely maps this to `.onConflict(...).doUpdateSet(...).returningAll()`.

## Dependencies

```json
{
  "dependencies": {
    "hono": "^4",
    "kysely": "^0.29",
    "kysely-bun-dialects": "^1"
  },
  "devDependencies": {
    "@types/bun": "latest"
  }
}
```

## Bootstrapping a New Project

```bash
# 1. Create project
mkdir my-api && cd my-api && bun init

# 2. Install deps
bun add hono kysely kysely-bun-dialects
bun add -d @types/bun

# 3. Copy these files from the template:
#    - codegen.ts, migrate.ts
#    - kysely-db.ts, middleware.ts, limits.ts
#    - migrations/ (your .sql files)
#    - server.ts (adjust routes)
#    - services/ (adjust for your domain)
#    - routes/ (adjust for your domain)
#    - api.test.ts (adjust for your routes)

# 4. Run codegen, then migrate, then start
bun run codegen
bun run migrate
bun --hot index.ts
```
