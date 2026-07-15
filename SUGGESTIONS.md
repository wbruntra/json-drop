# json-drop Access Architecture

## Purpose

This proposal adds secure, revocable sharing to json-drop without making it specific to Shared Expenses. It preserves json-drop's useful core: JSON documents in collections, optimistic concurrency through document versions, and a small client API. The new layer gives the service identities, access-controlled containers, memberships, invitations, and scoped credentials.

Shared Expenses is a representative client. A group trip is an access-controlled container, and its ledger is a document within that container. The same primitives also support a shared checklist, a small team dashboard, or a collaborative configuration store.

## Goals

- Share a collection of documents with people through revocable invite links.
- Allow read-only and collaborative access without sharing a project-wide secret.
- Support anonymous, low-friction use first, with account linking later.
- Make every list, read, create, update, and delete operation authorization-aware.
- Keep conditional writes (`ifMatch`) so offline-first clients detect concurrent edits.
- Retain a simple public-read option when it is explicitly requested.
- Make authorization decisions and audit events server-side and queryable.

## Non-Goals

- End-to-end encrypted documents in the first release. Server-side authorization means the service can inspect document content.
- Fine-grained JSON-path permissions. A container/document permission boundary is easier to reason about and adequate for the intended applications.
- A full organization billing product. The access model should leave room for organizations later, but must not require them now.

## Core Concepts

### Principal

A principal is the authenticated actor making a request. Initially it can be an anonymous device identity. Later it can be linked to an email, passkey, OAuth account, or service account without changing resource ownership or membership records.

### Workspace

A workspace is the generic, access-controlled namespace. It owns documents and memberships. "Group" is an appropriate UI label for Shared Expenses, but the json-drop API should call this a workspace so it remains useful outside that application.

### Project

Projects remain a top-level ownership, billing, and operational boundary. A project can contain many workspaces and can have project administrators. A workspace has its own membership and is the normal boundary for end-user sharing.

### Role and Permission

A role is a named set of permissions within one workspace. Start with a fixed, server-owned role set:

| Role     | Permissions                                                                                  |
| -------- | -------------------------------------------------------------------------------------------- |
| `owner`  | All workspace, member, invite, and document operations; transfer ownership; delete workspace |
| `admin`  | Manage metadata, members, and invites; all document operations                               |
| `editor` | List, read, create, and update documents                                                     |
| `viewer` | List and read documents                                                                      |

Internally, authorize named permissions such as `documents.read`, `documents.write`, `members.manage`, and `invites.manage`. This makes a future custom-role feature possible without changing endpoint code.

## Data Model

Store authorization data in transactional relational tables, separate from the JSON document store. A relational database makes membership uniqueness, invite redemption limits, revocation, and audit queries reliable.

```text
principals
  id, kind, created_at, disabled_at

principal_identities
  id, principal_id, provider, provider_subject, created_at

sessions
  id, principal_id, token_hash, expires_at, revoked_at, created_at

projects
  id, name, owner_principal_id, created_at

workspaces
  id, project_id, name, created_by, created_at, deleted_at

workspace_members
  workspace_id, principal_id, role, joined_at, removed_at
  unique active membership: (workspace_id, principal_id)

workspace_invites
  id, workspace_id, role, secret_hash, expires_at, max_uses, use_count,
  created_by, revoked_at, created_at

documents
  id, project_id, workspace_id nullable, collection, content, version,
  created_at, updated_at, deleted_at

api_tokens
  id, project_id nullable, principal_id nullable, token_prefix, token_hash,
  scopes, expires_at, revoked_at, created_at

audit_events
  id, project_id, workspace_id nullable, principal_id nullable, action,
  target_type, target_id, ip_hash, metadata, created_at
```

`workspace_id` is nullable only for legacy and explicitly public project documents. New collaborative documents should always belong to a workspace. Document storage indexes should include `(workspace_id, collection, updated_at)` and `(workspace_id, collection, id)`.

## Authentication and Credentials

### Browser sessions

On first use, `POST /v1/sessions/anonymous` creates a principal and session. Issue the session as a `Secure`, `HttpOnly`, `SameSite=Lax` cookie. This avoids storing a bearer write credential in browser `localStorage`.

If cross-origin API use requires bearer sessions, issue short-lived access tokens plus rotating refresh tokens. Do not use a permanent project token as a browser session.

### API tokens

API tokens are intended for trusted servers, CLIs, and automations. Store only a strong hash and a non-secret display prefix. Tokens need:

- Expiry and explicit revocation.
- Optional project or workspace restriction.
- Explicit scopes, for example `documents:read`, `documents:write`, or `workspaces:admin`.
- A `last_used_at` timestamp and audit trail.

The authorization decision is the intersection of token scope and the principal's resource permissions. A workspace-restricted token must never access another workspace, even if the principal is an administrator there.

### Public access

If public documents remain a feature, model them as an explicit server policy: `public_read = true` on a workspace or document. Public read never implies write. An unguessable URL or project ID is not authorization.

## Authorization Flow

Every document operation follows the same server-side sequence:

1. Authenticate the session or API token into a principal and token scopes.
2. Resolve the target workspace from a server-owned document record or URL parameter.
3. Load the active membership and role for that principal.
4. Map the requested operation to a permission.
5. Permit only when the role grants that permission and the token permits it.
6. Execute the storage operation, including `ifMatch` comparison, in the same transaction where practical.
7. Record a non-sensitive audit event for privileged and mutating operations.

For creates, the server derives `workspace_id` from the route. The client must not be allowed to select an arbitrary workspace in document JSON or request body.

List operations are authorization-sensitive. `GET /documents` must filter in the database by workspaces the caller can read; it must not list a project and filter results only in the client.

## Invitations

An invitation is a bearer secret for one-time enrollment, not an API credential.

```text
POST /v1/workspaces/:workspaceId/invites
  body: { role: "editor", expiresAt, maxUses }
  response: { inviteId, url, expiresAt, maxUses }

POST /v1/invites/redeem
  body: { secret }
  response: { workspace, membership }
```

Implementation requirements:

- Generate at least 256 bits using a cryptographically secure random source.
- Put only the invite identifier and secret in the URL; store only a salted hash of the secret.
- Redeem atomically: validate hash, expiry, revocation, and available uses; increment use count; insert membership if absent.
- Make redemption idempotent for an existing member. Reopening the same link should not consume another use or downgrade a role.
- Remove the secret from the browser URL immediately after redemption with `history.replaceState`.
- Allow owners and admins to list invite metadata and revoke an invite. Never return its secret after creation.
- Rate-limit creation and redemption, and redact invite values from logs, tracing, and analytics.

An invite should have an assigned role. Start with `viewer` and `editor`; reserve `admin` and `owner` assignment for existing owners to reduce accidental privilege escalation.

## API Shape

These endpoints can coexist with json-drop's current project and document APIs.

```text
POST   /v1/sessions/anonymous
GET    /v1/me

POST   /v1/projects/:projectId/workspaces
GET    /v1/projects/:projectId/workspaces
GET    /v1/workspaces/:workspaceId
PATCH  /v1/workspaces/:workspaceId
DELETE /v1/workspaces/:workspaceId

GET    /v1/workspaces/:workspaceId/members
PATCH  /v1/workspaces/:workspaceId/members/:principalId
DELETE /v1/workspaces/:workspaceId/members/:principalId

POST   /v1/workspaces/:workspaceId/invites
GET    /v1/workspaces/:workspaceId/invites
DELETE /v1/workspaces/:workspaceId/invites/:inviteId
POST   /v1/invites/redeem

POST   /v1/workspaces/:workspaceId/collections/:collection/documents
GET    /v1/workspaces/:workspaceId/collections/:collection/documents
GET    /v1/workspaces/:workspaceId/documents/:documentId
PUT    /v1/workspaces/:workspaceId/documents/:documentId
DELETE /v1/workspaces/:workspaceId/documents/:documentId
```

Document response shape should retain the existing ergonomics:

```json
{
  "id": "doc_123",
  "path": "workspaces/ws_123/shared-expenses/doc_123",
  "content": { "name": "Spain 2026", "people": [] },
  "version": "v17",
  "created_at": "2026-07-15T12:00:00Z",
  "updated_at": "2026-07-15T12:05:00Z"
}
```

`PUT` and `DELETE` accept `If-Match: <version>` and return `409 conflict` if the stored version differs. A conflict response may include the current version and `updated_at`, but should not expose the document body unless the caller has read permission.

## Client SDK Direction

Add a workspace-scoped API while retaining the current API for legacy projects:

```js
const workspace = db.workspace('ws_123')

await workspace.collection('shared-expenses').list()
await workspace.collection('shared-expenses').add(content)
await workspace.doc('doc_123').get()
await workspace.doc('doc_123').set(content, { ifMatch: version })
```

The SDK should automatically attach browser session credentials and should expose structured errors: `unauthenticated`, `forbidden`, `not_found`, `conflict`, `invite_expired`, and `rate_limited`.

Do not expose an SDK method that force-overwrites a shared document without an explicit privileged server policy. A client-side "overwrite" control should still send a version or use a purpose-built, audited endpoint restricted to owners/admins.

## Shared Expenses Mapping

For Shared Expenses, create one workspace per expense group. Store the ledger as a single document initially:

```text
workspace: "Spain 2026"
collection: "shared-expenses"
document: "ledger"
```

The UI's group-management modal maps to workspace metadata, member listing, role changes, and invite creation. The invite URL opens the same application, redeems access, then opens the workspace's ledger.

The current client behavior should change as follows:

- Replace the browser-entered project API token with a session-based sign-in or anonymous session.
- Replace the global `shared-expenses/` listing with `workspace.collection('shared-expenses').list()`.
- Keep local cache, debounce, offline operation, and `ifMatch` writes.
- On a `403`, keep the local snapshot but mark access as revoked and stop retries.
- On a `409`, retain the current reload/merge UX. Do not silently force an overwrite.

## Migration Plan

### Phase 1: Identity and workspace metadata

Implement principals, anonymous sessions, workspaces, memberships, and authorization middleware. Existing project tokens continue to work for project owners and service-side management.

### Phase 2: Workspace-scoped document routes

Add workspace document CRUD and conditional writes. Implement authorization-filtered document listing. Add audit events for document writes/deletes and membership/invite changes.

### Phase 3: Invitations and client adoption

Implement secure invite creation, redemption, expiry, use limits, and revocation. Update Shared Expenses to use a workspace and browser session. Existing local files can be uploaded into a workspace.

### Phase 4: Legacy project migration

Offer a project-owner-only migration endpoint that creates an owner workspace and assigns selected existing documents to it. Keep legacy paths read-only or supported for a published deprecation period. Do not automatically make legacy documents shared or public.

### Phase 5: Accounts and operational hardening

Allow identity linking, recovery, and cross-device sign-in. Add token-management UI, session revocation, retention policies, monitoring, backup/restore, and documented rate limits.

## Security and Operational Requirements

- Hash session tokens, API tokens, and invite secrets at rest; never log raw values.
- Enforce TLS, secure cookies, request size limits, and JSON depth/size limits.
- Use database transactions or equivalent compare-and-swap behavior for invite redemption, membership mutation, and versioned document updates.
- Protect against owner lockout: prevent removing or downgrading the final owner, and make ownership transfer explicit.
- Use soft deletion plus retention for workspaces/documents; audit who deleted data.
- Return `404` rather than `403` for unauthorized direct document lookups if avoiding resource-existence disclosure is important. Use `403` when a caller is a known member lacking a specific action.
- Include authorization policy tests for every endpoint and role, especially list filtering and cross-workspace access.
- Export metrics for authorization failures, invite redemption, token use, conflict rate, and latency.

## Open Decisions

- Should one workspace be allowed to span projects? Recommendation: no. Keep workspaces inside one project for clear ownership, billing, and isolation.
- Should anonymous memberships expire? Recommendation: no by default for a small-group product, but allow project-level session and membership expiry policies later.
- Should editors be able to create invites? Recommendation: no initially. Invite creation is an `admin`/`owner` action.
- Should public links support write access? Recommendation: no. Anonymous editing should be modeled as an explicit low-privilege workspace role and remain revocable, not as an unrestricted public URL.
- Should the service add real-time subscriptions? Recommendation: add them after conditional write and permission checks are correct. Subscriptions must enforce the same workspace read policy at connect time and during permission changes.

## Acceptance Criteria

- A project owner can create a workspace and becomes its owner.
- An editor invite grants access only to its workspace and can be revoked.
- A viewer can list and read workspace documents but receives `403` on create, update, and delete.
- An editor cannot list or read documents in an unrelated workspace within the same project.
- An owner can safely transfer ownership, but the service cannot leave a workspace without an owner.
- A stale `If-Match` update returns `409` without changing the document.
- No invite secret, project-wide browser write token, or long-lived bearer session is written to application logs or browser localStorage.
