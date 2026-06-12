# Napkin

## Corrections

| Date       | Source | What Went Wrong                                          | What To Do Instead                                                                        |
| ---------- | ------ | -------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 2026-06-11 | user   | JS code examples showed literal `\${token}` string in UI | Interpolated actual token value using `${token}` at render time, similar to curl examples |

## User Preferences

- Prefers high-end developer-focused dark theme styling with zinc/indigo accents, smooth transitions, custom scrollbars, and modern typography (Plus Jakarta Sans, JetBrains Mono).
- Dashboard sections structured into a clear two-column layout on desktop to separate documents, credentials, and API docs.

## Patterns That Work

- DB lifecycle: `initDatabase(path)` in database.ts (explicit init + migrations), `createServer()` in server.ts; index.ts is a thin entry. Tests call `initDatabase(':memory:', { silent: true })` in beforeEach against the real server — no duplicated route tables in tests.

## Patterns That Don't Work

- Bun `Bun.serve()` wildcard routes (`/api/docs/*`) do NOT populate `req.params['*']` — params is empty for wildcards (verified empirically + bun-types docs). Recover the subpath from `new URL(req.url).pathname` instead. Only `:named` params populate `req.params`.
- Module-level `new Database(process.env.X)` at import time forces tests into env-var-before-import ordering hacks. Use explicit init instead.

## Domain Notes

- Access modes: public / public_read_secret_write / private. Secret-based unauthenticated writes go through `handleSecretUpsert` in routes/docs.ts (content-only update; owner/mode/secret unchanged).
- Possible security gap (flagged 2026-06-12, not fixed): `canRead` in routes/docs.ts grants private-doc reads to ANY valid token with read perms, regardless of whether the token's user owns the doc.
