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

| Method   | Endpoint        | Auth          | Description                        |
| -------- | --------------- | ------------- | ---------------------------------- |
| `POST`   | `/api/docs`     | token         | Create a document                  |
| `GET`    | `/api/docs`     | token         | List your documents                |
| `GET`    | `/api/docs/:id` | varies        | Read a document (see access modes) |
| `PUT`    | `/api/docs/:id` | token/secret  | Update a document                  |
| `DELETE` | `/api/docs/:id` | token (owner) | Delete a document                  |

## Curl Examples

Replace `<base>` with your server URL and `<token>` with your API token.

### Get your user info

```bash
curl <base>/api/me -H "Authorization: Bearer <token>"
```

### Create a public document

```bash
curl -X POST <base>/api/docs \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"name": "config", "content": {"theme": "dark"}, "access_mode": "public"}'
```

### Create a private document

```bash
curl -X POST <base>/api/docs \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"name": "secrets", "content": {"api_key": "sk-..."}, "access_mode": "private"}'
```

Response includes an `access_secret` — copy it now, it won't be shown again.

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

### Update a document

```bash
curl -X PUT <base>/api/docs/<doc-id> \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"content": {"updated": true}}'
```

### Update with secret key

```bash
curl -X PUT "<base>/api/docs/<doc-id>?secret=<access-secret>" \
  -H "Content-Type: application/json" \
  -d '{"content": {"updated": true}}'
```

### Delete a document

```bash
curl -X DELETE <base>/api/docs/<doc-id> -H "Authorization: Bearer <token>"
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
