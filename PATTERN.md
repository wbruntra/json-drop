# Backend Pattern

A Bun + Hono + Kysely + SQLite backend pattern for API servers.

## Stack

| Layer          | Choice                                        |
| -------------- | --------------------------------------------- |
| Runtime        | Bun                                           |
| HTTP framework | Hono                                          |
| Database       | SQLite via `bun:sqlite`                       |
| Query builder  | Kysely + `kysely-bun-dialects`                |
| Validation     | Zod                                           |
| Rate limiting  | `hono-rate-limiter` (MemoryStore)             |
| Auth           | Bearer token (stored raw, looked up directly) |
| Migrations     | Raw SQL files, run at startup                 |
| Type gen       | Custom `codegen.ts` from pragmas              |
| Testing        | `bun test`, real server, in-memory DB         |

## Project Structure

```
├── index.ts              # Entry point: init DB, start server
├── server.ts             # Hono app + Bun.serve wrapper
├── schemas.ts            # Zod validation schemas
├── middleware.ts          # generateToken() utility only
├── middleware/
│   └── customLogger.ts   # Hono middleware: colored request logging
├── kysely-db.ts           # DB lifecycle: init, getDb(), getRawDb(), types
├── kysely-types.ts        # Auto-generated table types (don't edit)
├── codegen.ts             # Generates kysely-types.ts from SQLite schema
├── migrate.ts             # Runs .sql migration files in order
├── migrations/            # Ordered .sql migration files
│   └── 001_initial.sql
├── services/              # Data access layer — Kysely queries only
│   ├── index.ts           # Barrel export
│   ├── users.ts           # createUser, getUser, getUserByGithubId
│   ├── tokens.ts          # createApiToken, listApiTokens, getApiToken, revokeApiToken
│   ├── documents.ts       # upsertDocument, listDocuments, deleteDocument, etc.
│   └── auth.ts            # extractAuth (bearer token → user + permissions)
├── routes/                # HTTP handlers — call services, never DB directly
│   ├── auth.ts            # OAuth login, callback, logout
│   ├── me.ts              # GET /api/me
│   ├── tokens.ts          # CRUD /api/tokens
│   ├── docs.ts            # CRUD /api/docs
│   └── dev.ts             # Dev-only login shortcuts
├── auth.ts                # JWT session + GitHub OAuth helpers
├── limits.ts              # Storage limit constants
└── api.test.ts            # Integration tests (real server, in-memory DB)
```

## Database Layer

### Migrations (`migrate.ts`)

TypeScript migration files in `migrations/` implementing `up`/`down` functions. The migrations are executed via Kysely's built-in `Migrator` and `FileMigrationProvider`.

```typescript
// migrations/001_initial.ts
import { Kysely } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('users')
    .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
    // ...
    .execute()
}
```

```bash
bun migrate                    # standalone CLI runner
await runMigrations(db)        # programmatically called by initDatabase()
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

Single module that owns the connection:

- `initDatabase(path)` — creates `bun:sqlite` Database, runs migrations, wraps with Kysely
- `getDb()` — returns typed `Kysely<DatabaseSchema>` for service layer
- `getRawDb()` — returns `bun:sqlite` Database for migrations and legacy sync code

```ts
// index.ts
await initDatabase(process.env.DATABASE_URL || 'db.sqlite')
```

### Kysely Query Pattern

All service functions are Kysely-based and async with full type safety:

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
- Can call other services (e.g. `services/auth.ts` calls `tokens.getApiToken` and `users.getUser`)

### Auth Service (`services/auth.ts`)

Extracts user identity from `Authorization: Bearer <token>` header by looking up the raw token directly in the database:

```ts
export type AuthContext = {
  user: User | null
  tokenPermissions: string | null // 'read' | 'write' | 'read_write' | 'admin'
}

export async function extractAuth(req: Request): Promise<AuthContext>
```

This is called by Hono middleware, not by individual routes. Routes access auth via `c.get('auth')`.

### Token Handling

Tokens are stored as plain text in the `api_tokens.token_hash` column (the column name is a legacy artifact — it stores raw tokens, not hashes). Users can view their tokens at any time via `GET /api/tokens`.

```ts
// Creating a token
const rawToken = generateToken() // "jd_a1b2c3..."
await createApiToken(userId, name, rawToken, 'admin')

// Authenticating a request
const token = req.headers.get('Authorization')?.slice(7)
const apiToken = await getApiToken(token) // direct lookup, no hashing
```

## Validation Layer (`schemas.ts`)

Zod schemas for all request inputs. Route handlers use `.safeParse()` and return 400 with the first error message on failure:

```ts
import { createTokenSchema, formatZodError } from '../schemas'

const parsed = createTokenSchema.safeParse(await c.req.json())
if (!parsed.success) {
  return c.json({ error: formatZodError(parsed.error) }, 400)
}
// parsed.data.name, parsed.data.permissions — fully typed
```

Schemas define defaults so route handlers don't need fallback logic:

- `createTokenSchema`: name defaults to `'Unnamed token'`, permissions to `'read_write'`
- `upsertDocSchema`: content defaults to `{}`, access_mode to `'public'`
- `pathSchema`: validates path segments, no leading/trailing slashes, no empty segments

## HTTP Layer

### Hono App (`server.ts`)

Middleware chain, applied in order:

```
cors('*')           →  CORS headers on all responses (hono/cors)
customLogger        →  Colored request logging (middleware/customLogger.ts)
rateLimiter()       →  100 req/min sliding window per key (hono-rate-limiter)
authMiddleware      →  Sets c.get('auth') and c.get('user_id') from bearer token
```

Hono typed context:

```ts
type Bindings = {
  Variables: {
    auth: AuthContext
    user_id: number | null
  }
}
const app = new Hono<Bindings>()
```

Route handlers receive `c: Context` directly — no wrapping:

```ts
app.get('/api/me', handleMe)
app.post('/api/tokens', handleCreateToken)
app.delete('/api/tokens/:id', handleDeleteToken)
app.get('/api/docs', handleListDocs)
app.get('/api/docs/:path{.+}', handleGetDoc)
```

Handlers use `c.json()` for JSON responses, `c.req.json()` for body parsing, `c.req.query()` for query strings, `c.req.param()` for URL params:

```ts
export function handleMe(c: Context): Response {
  const auth = c.get('auth')
  if (!auth.user) return c.json({ error: 'Not authenticated' }, 401)
  return c.json({ id: auth.user.id, email: auth.user.email })
}
```

### Rate Limiting

Uses `hono-rate-limiter` with `MemoryStore` — a true sliding window algorithm. Keys are `token:<raw token>` for authenticated requests or `ip:<address>` for anonymous ones. Config: 100 requests per 60-second window per key.

### Logging (`middleware/customLogger.ts`)

Colored ANSI output showing method, full URL (pathname + query string), status code, elapsed ms, and user ID when authenticated:

```
GET /api/me 200 3ms user=1
PUT /api/docs/test-doc 201 4ms user=1
GET /api/docs/public-doc 200 0ms
```

## Entry Point (`index.ts`)

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
import { generateToken } from './middleware'
import { initDatabase, createUser, createApiToken } from './database'

beforeAll(() => {
  server = createServer({ port: 0 }) // random port
  baseUrl = `http://localhost:${server.port}`
})

afterAll(() => server.stop())

beforeEach(async () => {
  await initDatabase(':memory:', { silent: true })
  const user = createUser('github-123', 'test@example.com', 'Test User')
  adminToken = generateToken()
  createApiToken(user.id, 'Admin Token', adminToken, 'admin')
})
```

Key points:

- Real server, real HTTP requests via `fetch`
- `initDatabase(':memory:')` gives each test a clean DB
- `createServer({ port: 0 })` uses a random available port
- `{ silent: true }` suppresses migration logging in test output
- Tokens are stored raw — pass the raw token to both `createApiToken` and the `Authorization` header

## Conventions & Gotchas

- **Hono wildcard routes**: Use `:param{.+}` for multi-segment paths, not `*`. Hono's `*` wildcard does not populate `c.req.param('*')`.
- **Bun HTMLBundle**: Bun's HTML import bundles (HMR, CSS, TSX) only work when returned directly from `Bun.serve()`'s `fetch`. Intercept the homepage route in the `Bun.serve()` wrapper rather than Hono.
- **Hono middlewares**: `cors()` uses `hono/cors`, not hand-rolled headers. `c.json()` replaces `new Response(JSON.stringify(...))`. Hono's `cors()` middleware adds CORS headers to every response automatically — no need for manual `corsHeaders()`.
- **Module-level DB init**: Never call `new Database(...)` at module top level. Always use `initDatabase()` explicitly.
- **FK nullability**: SQLite's `PRAGMA table_info.notnull` is `0` for foreign key columns even when they're effectively NOT NULL. The codegen queries `PRAGMA foreign_key_list` to correct this.
- **Zod v4**: Uses `err.issues` (not `err.errors`), and `.refine()` takes `{ message: '...' }` options (not a callback returning `{ message }`).

## Dependencies

```json
{
  "dependencies": {
    "hono": "^4",
    "hono-rate-limiter": "^0",
    "kysely": "^0.29",
    "kysely-bun-dialects": "^1",
    "zod": "^4"
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
bun add hono hono-rate-limiter kysely kysely-bun-dialects zod
bun add -d @types/bun

# 3. Copy these files from the template:
#    - codegen.ts, migrate.ts, schemas.ts
#    - kysely-db.ts, middleware.ts, limits.ts
#    - middleware/customLogger.ts
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
