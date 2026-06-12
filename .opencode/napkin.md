# Napkin

## Corrections

| Date       | Source | What Went Wrong                                          | What To Do Instead                                                                        |
| ---------- | ------ | -------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 2026-06-11 | user   | JS code examples showed literal `\${token}` string in UI | Interpolated actual token value using `${token}` at render time, similar to curl examples |

## User Preferences

- Prefers high-end developer-focused dark theme styling with zinc/indigo accents, smooth transitions, custom scrollbars, and modern typography (Plus Jakarta Sans, JetBrains Mono).
- Dashboard sections structured into a clear two-column layout on desktop to separate documents, credentials, and API docs.

## Patterns That Work

- `services/` is the data-access layer. All DB queries use Kysely (async). Routes only call services — never database.ts directly. `services/auth.ts` handles token-based auth (`extractAuth`).
- `kysely-db.ts` is the database lifecycle module (init, getDb, getRawDb, types). `kysely-types.ts` is auto-generated via `bun run codegen` (`codegen.ts` introspects the SQLite schema with pragmas including FK info for correct nullability).
- `database.ts` delegates to `kysely-db.ts` for the connection (same underlying `bun:sqlite` Database). Its sync functions still work for tests and incremental migration. Eventually `database.ts` will be removed.
- Run `bun run codegen` after schema changes to regenerate `kysely-types.ts`.

## Patterns That Don't Work

- Hono `*` wildcard does NOT populate `c.req.param('*')` (returns undefined). Use `:param{.+}` regex pattern for multi-segment catch-all routes instead. `c.req.param('param')` returns the full sub-path.
- Module-level `new Database(process.env.X)` at import time forces tests into env-var-before-import ordering hacks. Use explicit init instead.

## Domain Notes

- Access modes: public / public_read_secret_write / private. Secret-based unauthenticated writes go through `handleSecretUpsert` in routes/docs.ts (content-only update; owner/mode/secret unchanged).
- Possible security gap (flagged 2026-06-12, not fixed): `canRead` in routes/docs.ts grants private-doc reads to ANY valid token with read perms, regardless of whether the token's user owns the doc.
