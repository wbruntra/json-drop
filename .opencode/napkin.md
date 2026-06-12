# Napkin

## Corrections

| Date       | Source | What Went Wrong                                          | What To Do Instead                                                                                                                                                 |
| ---------- | ------ | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-06-11 | user   | JS code examples showed literal `\${token}` string in UI | Interpolated actual token value using `${token}` at render time, similar to curl examples                                                                          |
| 2026-06-12 | agent  | Old frontend used broken POST /api/docs and named fields | Updated frontend to support new design: PUT /api/docs/{path} (create/update), GET/DELETE /api/docs/{id}, sidebar collections grouping, and updated Curl API guide. |
| 2026-06-12 | agent  | Vite build failed due to --outdir option in package.json | Fixed --outdir to --outDir in package.json to match Vite CLI expectations.                                                                                         |

## User Preferences

- Prefers high-end developer-focused dark theme styling with zinc/indigo accents, smooth transitions, custom scrollbars, and modern typography (Plus Jakarta Sans, JetBrains Mono).
- Dashboard sections structured into full-width rows on desktop to accommodate the multi-pane collections view.

## Patterns That Work

- `services/` is the data-access layer. All DB queries use Kysely (async). Routes only call services — never database.ts directly. `services/auth.ts` handles token-based auth (`extractAuth`).
- `kysely-db.ts` is the database lifecycle module (init, getDb, getRawDb, types). `kysely-types.ts` is auto-generated via `bun run codegen` (`codegen.ts` introspects the SQLite schema with pragmas including FK info for correct nullability).
- `database.ts` delegates to `kysely-db.ts` for the connection (same underlying `bun:sqlite` Database). Its sync functions still work for tests and incremental migration. Eventually `database.ts` will be removed.
- Run `bun run codegen` after schema changes to regenerate `kysely-types.ts`.

## Patterns That Don't Work

- Hono `*` wildcard does NOT populate `c.req.param('*')` (returns undefined). Use `:param{.+}` regex pattern for multi-segment catch-all routes instead. `c.req.param('param')` returns the full sub-path.
- Module-level `new Database(process.env.X)` at import time forces tests into env-var-before-import ordering hacks. Use explicit init instead.
- SQLite `ON CONFLICT ON CONSTRAINT "name"` is PostgreSQL syntax. For an expression index like `idx_documents_scope_path ON (IFNULL(project_id, 'u' || user_id), path)`, target it with `oc.expression(sql\`IFNULL(project_id, 'u' || user_id), path\`)` — the index columns form a tuple, not a constraint name. (`oc.column`/`oc.columns` don't match expression indexes.)
- SQLite `PRAGMA table_info` reports FK columns as `notnull=0`, so the codegen conservatively types every FK as NOT NULL. Widen specific FK columns (e.g. `api_tokens.project_id`, `documents.project_id`) to nullable via TypeScript `declare module` augmentation in `kysely-db.ts` rather than editing the generated `kysely-types.ts` (which gets clobbered on every `bun run codegen`).
- The legacy documents uniqueness `unique(user_id, path)` is wrong once documents can be project-scoped. Don't try to express it as a column-level unique constraint — use the expression unique index `idx_documents_scope_path ON (IFNULL(project_id, 'u' || user_id), path)` from day one (the app is a prototype; no need for a data-migrating 002).

## Domain Notes

- Access modes: public / public_read_secret_write / private. Secret-based unauthenticated writes go through `handleSecretUpsert` in routes/docs.ts (content-only update; owner/mode/secret unchanged).
- Security Gap Resolved (2026-06-12): Restricted token checks in `canRead`/`canWrite` inside `routes/docs.ts` to require that the token belongs to the document owner. Added integration tests to verify.
- Project/Path addressing (2026-06-12): Routes use id (`GET/DELETE /api/docs/:id`) and path (`PUT /api/docs/:path`, `GET/DELETE /api/docs?path=…`) addressing differently. The `:path{.+}` wildcard resolves to a document **id** on GET/DELETE and to a **path** on PUT. Use `?path=…` for new path-addressed GET/DELETE; leave the legacy id routes intact for backward compat. Path addressing is the foundation for the `sdk/` (which uses `db.doc('users/alice')` exclusively).
