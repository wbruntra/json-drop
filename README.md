# json-drop

A simple backend for the backendless. Store arbitrary JSON with flexible access control.

## Setup

1. Install dependencies:

   ```bash
   bun install
   ```

2. Copy `.env` and fill in your GitHub OAuth credentials:

   ```bash
   cp .env.example .env
   ```

3. Run database migrations:

   ```bash
   bun run migrate
   ```

4. Start the development server:
   ```bash
   bun run dev
   ```

## Frontend

Build the frontend for production:

```bash
bun run build:frontend
```

The built files will be in `frontend/dist/` and should be served by nginx.

## API

### Authentication

- `GET /api/auth/github` - Redirect to GitHub OAuth
- `GET /gh/callback` - GitHub OAuth callback
- `POST /api/auth/logout` - Clear session
- `GET /api/me` - Get current user

### API Tokens

- `POST /api/tokens` - Create token (returns raw token once)
- `GET /api/tokens` - List tokens
- `DELETE /api/tokens/:id` - Revoke token

### Documents

- `POST /api/docs` - Create document
- `GET /api/docs` - List my documents
- `GET /api/docs/:id` - Read document
- `PUT /api/docs/:id` - Update document
- `DELETE /api/docs/:id` - Delete document

## Access Modes

- `public` - Anyone can read, owner can write
- `public_read_secret_write` - Anyone can read, owner or secret can write
- `private` - Owner or secret can read/write
