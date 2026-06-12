# json-drop

A simple backend for the backendless. Store arbitrary JSON documents with flexible access control. Sign in with GitHub, get an API token, and start storing data.

## Quick Start

```bash
bun install
cp .env.example .env        # edit with your GitHub OAuth credentials
bun run migrate             # create database tables
bun run dev                 # start dev server on :3000
```

Open `http://localhost:3000` — click "Sign in with GitHub" (dev mode auto-creates a user) and copy the API token.

## How It Works

**Authentication** is token-based. When you sign in with GitHub (or the dev login), the server creates a user record and an admin API token. The token is stored in your browser's `localStorage` and sent as `Authorization: Bearer <token>` on every request. No cookies, no sessions — just tokens.

**Documents** are arbitrary JSON blobs with one of three access modes:

| Mode                       | Who can read                    | Who can write                   |
| -------------------------- | ------------------------------- | ------------------------------- |
| `public`                   | Anyone (no auth)                | Owner or API token              |
| `public_read_secret_write` | Anyone (no auth)                | Owner, API token, or secret key |
| `private`                  | Owner, API token, or secret key | Owner, API token, or secret key |

**API tokens** can have different permissions (`read`, `write`, `read_write`, `admin`) and are revocable. The token you get on sign-in has `admin` permissions.

## Usage Guide

json-drop organizes data as **documents** stored at **paths**. A document is any JSON value. Collections are just path prefixes — there is no separate collection type to create or manage. Documents are addressed by their full path, which uses slashes to express hierarchy.

### Paths and Collections

A path like `notes/xK92mP` means: the document `xK92mP` inside the collection `notes`. Deeper nesting works the same way:

```
notes/xK92mP                       → a note
notes/xK92mP/comments/yL83nQ       → a comment on that note
users/alice                         → a singleton document for a known key
```

### Creating a Document

**Server-generated ID** — `POST /api/docs/:collection` — recommended when adding a new record to a collection and you don't care what the ID is:

```
POST /api/docs/notes
→ 201 { path: "notes/xK92mP", ... }
```

**Known path** — `PUT /api/docs/:path` — use when you want a specific, stable address (user profiles, settings, etc.):

```
PUT /api/docs/users/alice
→ 200/201 { path: "users/alice", ... }
```

### Example: Notes App

Here's a minimal JavaScript client using the fetch API:

```js
const BASE = 'https://your-jsondrop-server.com'
const TOKEN = 'your-api-token'

const headers = {
  Authorization: `Bearer ${TOKEN}`,
  'Content-Type': 'application/json',
}

// Create a note (server assigns an ID)
async function createNote(title, body) {
  const res = await fetch(`${BASE}/api/docs/notes`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ content: { title, body } }),
  })
  const doc = await res.json()
  console.log('Created:', doc.path) // e.g. "notes/xK92mP"
  return doc
}

// List all notes
async function listNotes() {
  const res = await fetch(`${BASE}/api/docs?prefix=notes`, { headers })
  const { docs } = await res.json()
  return docs // array of { id, path, content, ... }
}

// Read a specific note by its path
async function getNote(path) {
  const res = await fetch(`${BASE}/api/docs/${path}`, { headers })
  return res.json() // { id, path, content, ... }
}

// Update a note
async function updateNote(path, title, body) {
  const res = await fetch(`${BASE}/api/docs/${path}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ content: { title, body } }),
  })
  return res.json()
}

// Delete a note
async function deleteNote(path) {
  await fetch(`${BASE}/api/docs/${path}`, { method: 'DELETE', headers })
}
```

### Access Control

By default, documents are `public` — anyone can read them without a token. Set `access_mode` in your request body to control this:

| `access_mode`              | Who can read           | Who can write          |
| -------------------------- | ---------------------- | ---------------------- |
| `public` (default)         | Anyone                 | Owner / token          |
| `public_read_secret_write` | Anyone                 | Owner / token / secret |
| `private`                  | Owner / token / secret | Owner / token / secret |

When you create a non-public document, the response includes an `access_secret`. Store it — it won't be shown again. Pass it as `?secret=<value>` for reads and writes by non-owners.

---

## API Reference

All endpoints except sign-in and public reads require an `Authorization` header:

```
Authorization: Bearer <your-api-token>
```

### Authentication

| Method | Endpoint           | Auth  | Description                                  |
| ------ | ------------------ | ----- | -------------------------------------------- |
| `GET`  | `/api/auth/github` | —     | Redirect to GitHub OAuth (dev: skips GitHub) |
| `GET`  | `/gh/callback`     | —     | GitHub OAuth callback                        |
| `GET`  | `/api/me`          | token | Get current user info                        |

### API Tokens

| Method   | Endpoint          | Auth  | Description        |
| -------- | ----------------- | ----- | ------------------ |
| `POST`   | `/api/tokens`     | admin | Create a new token |
| `GET`    | `/api/tokens`     | token | List your tokens   |
| `DELETE` | `/api/tokens/:id` | admin | Revoke a token     |

### Documents

| Method   | Endpoint                | Auth          | Description                               |
| -------- | ----------------------- | ------------- | ----------------------------------------- |
| `GET`    | `/api/docs`             | token         | List your documents (optional `?prefix=`) |
| `POST`   | `/api/docs/:collection` | token         | Create document with server-generated ID  |
| `GET`    | `/api/docs/:path`       | varies        | Read a document (see access modes)        |
| `PUT`    | `/api/docs/:path`       | token/secret  | Upsert a document at a specific path      |
| `DELETE` | `/api/docs/:path`       | token (owner) | Delete a document                         |

## Curl Examples

Replace `<base>` with your server URL and `<token>` with your API token.

### Get your user info

```bash
curl <base>/api/me -H "Authorization: Bearer <token>"
```

### Create a document (server-generated ID)

```bash
curl -X POST <base>/api/docs/notes \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"content": {"title": "My note", "body": "Hello world"}}'
```

Response includes the generated `path` (e.g. `notes/xK92mP`).

### Upsert a document at a known path

```bash
curl -X PUT <base>/api/docs/users/alice \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"content": {"display_name": "Alice"}, "access_mode": "private"}'
```

Response includes an `access_secret` when creating a non-public document — copy it now, it won't be shown again.

### Read a public document (no auth needed)

```bash
curl <base>/api/docs/<doc-id>
```

### Read a private document with secret

```bash
curl "<base>/api/docs/<doc-id>?secret=<access-secret>"
```

### Read a document as owner

```bash
curl <base>/api/docs/<doc-id> -H "Authorization: Bearer <token>"
```

### List all your documents

```bash
curl <base>/api/docs -H "Authorization: Bearer <token>"
```

### List documents in a collection

```bash
curl "<base>/api/docs?prefix=notes" -H "Authorization: Bearer <token>"
```

### Update a document

```bash
curl -X PUT <base>/api/docs/<path> \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"content": {"updated": true}}'
```

### Update with secret key

```bash
curl -X PUT "<base>/api/docs/<path>?secret=<access-secret>" \
  -H "Content-Type: application/json" \
  -d '{"content": {"updated": true}}'
```

### Delete a document

```bash
curl -X DELETE <base>/api/docs/<path> -H "Authorization: Bearer <token>"
```

### Create an API token

```bash
curl -X POST <base>/api/tokens \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"name": "readonly-token", "permissions": "read"}'
```

### Revoke a token

```bash
curl -X DELETE <base>/api/tokens/<token-id> -H "Authorization: Bearer <token>"
```

## Frontend

Build the frontend for production (served by nginx):

```bash
bun run build:frontend    # outputs to frontend/dist/
```

In development, the Bun server serves the frontend directly with HMR — no build step needed.

## Project Structure

```
├── index.ts               # Bun server entry
├── database.ts            # SQLite queries
├── middleware.ts          # CORS, rate limiting, auth extraction, logging
├── auth.ts               # GitHub OAuth helpers
├── migrate.ts             # Migration runner
├── migrations/
│   └── 001_initial.sql    # Initial schema
├── routes/
│   ├── auth.ts            # GitHub OAuth & logout
│   ├── dev.ts             # Dev-only login & token creation
│   ├── me.ts              # Current user endpoint
│   ├── tokens.ts          # API token CRUD
│   └── docs.ts            # Document CRUD + access control
├── frontend/
│   ├── index.html         # HTML entry (bundled by Bun)
│   └── src/
│       ├── api.ts         # API fetch helper
│       ├── app.tsx        # App root
│       ├── main.tsx       # Entry point
│       └── components/    # UI components
└── api.test.ts            # API tests
```

## Environment Variables

```env
GITHUB_CLIENT_ID=       # GitHub OAuth app client ID
GITHUB_CLIENT_SECRET=   # GitHub OAuth app client secret
FRONTEND_URL=http://localhost:5173  # Redirect after sign-in (production)
PORT=3000               # Server port
DATABASE_URL=db.sqlite  # Database path
NODE_ENV=development    # Set by dev script, enables dev mode
```

## Rate Limiting

100 requests per minute per IP or token. Exceeding returns `429 Too Many Requests`.
