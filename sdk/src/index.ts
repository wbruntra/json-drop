export type AccessMode = 'public' | 'public_read_secret_write' | 'private'
export type Permission = 'read' | 'write' | 'read_write' | 'admin'

export type Doc = {
  id: string
  path: string
  access_mode: AccessMode
  content: unknown
  size_bytes: number
  version: number
  created_at: string
  updated_at: string
}

export type Project = {
  id: string
  name: string
  created_at: string
}

export type Me = {
  id: number
  github_id: string
  email: string | null
  display_name: string | null
}

export type WorkspaceRole = 'owner' | 'admin' | 'editor' | 'viewer'

export type Workspace = {
  id: string
  name: string
  project_id: string | null
  created_at: string
}

export type WorkspaceMemberInfo = {
  user_id: number
  role: WorkspaceRole
  display_name: string | null
  kind: string
  joined_at: string
}

export type WorkspaceInviteInfo = {
  id: string
  role: WorkspaceRole
  expires_at: string | null
  max_uses: number | null
  use_count: number
  created_at: string
}

export type CreateInviteResult = WorkspaceInviteInfo & { secret: string; message: string }

export type AnonymousSession = { token: string; user: { id: number; kind: string } }

export type CreateProjectResult = Project

export type ListDocsResult = {
  prefix: string | null
  order: string
  docs: Doc[]
  storage: { used_bytes: number; used: string; limit: string }
}

export type CreateDocResult = Doc & { access_secret?: string; message?: string; ref?: DocRef }

export type ErrorCode =
  | 'bad_request'
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'storage_limit'
  | 'rate_limited'
  | 'server'

const STATUS_TO_CODE: Record<number, ErrorCode> = {
  400: 'bad_request',
  401: 'unauthenticated',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  413: 'storage_limit',
  429: 'rate_limited',
  500: 'server',
}

export class JsonDropError extends Error {
  readonly status: number
  readonly code: ErrorCode
  readonly body: unknown

  constructor(status: number, message: string, code: ErrorCode, body?: unknown) {
    super(message)
    this.name = 'JsonDropError'
    this.status = status
    this.code = code
    this.body = body
  }
}

export type JsonDropConfig = {
  baseUrl: string
  token?: string
  project?: string
  secret?: string
  fetch?: typeof fetch
}

type RequestOptions = {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  query?: Record<string, string | number | undefined | null>
  secret?: string
  project?: string
}

export class JsonDrop {
  private readonly baseUrl: string
  private token?: string
  private readonly defaultProject?: string
  private readonly defaultSecret?: string
  private readonly fetchImpl: typeof fetch

  readonly projects: {
    create: (input: { name: string }) => Promise<CreateProjectResult>
    list: () => Promise<Project[]>
    delete: (id: string) => Promise<{ deleted: true }>
  }

  /**
   * Anonymous, low-friction identity — no GitHub account required. Creating a
   * session sets this client's token, so subsequent calls (e.g. redeeming an
   * invite, creating a workspace) authenticate as the new principal.
   */
  readonly sessions: {
    createAnonymous: () => Promise<AnonymousSession>
    recover: (secret: string) => Promise<{ token: string }>
  }

  readonly invites: {
    redeem: (secret: string) => Promise<{ workspace_id: string; role: WorkspaceRole }>
  }

  readonly workspaces: {
    create: (input: { name: string; projectId?: string }) => Promise<Workspace>
    list: () => Promise<Workspace[]>
  }

  constructor(config: JsonDropConfig) {
    if (!config.baseUrl) {
      throw new Error('JsonDrop: baseUrl is required')
    }
    this.baseUrl = config.baseUrl.replace(/\/+$/, '')
    this.token = config.token
    this.defaultProject = config.project
    this.defaultSecret = config.secret
    this.fetchImpl = config.fetch ?? globalThis.fetch.bind(globalThis)

    this.projects = {
      create: (input) =>
        this.request<CreateProjectResult>('/api/projects', { method: 'POST', body: input }),
      list: () => this.request<Project[]>('/api/projects', { method: 'GET' }),
      delete: (id) => this.request<{ deleted: true }>(`/api/projects/${id}`, { method: 'DELETE' }),
    }

    this.sessions = {
      createAnonymous: async () => {
        const result = await this.request<AnonymousSession>('/api/sessions/anonymous', {
          method: 'POST',
        })
        this.token = result.token
        return result
      },
      recover: async (secret) => {
        const result = await this.request<{ token: string }>('/api/sessions/recover', {
          method: 'POST',
          body: { secret },
        })
        this.token = result.token
        return result
      },
    }

    this.invites = {
      redeem: (secret) =>
        this.request<{ workspace_id: string; role: WorkspaceRole }>('/api/invites/redeem', {
          method: 'POST',
          body: { secret },
        }),
    }

    this.workspaces = {
      create: (input) =>
        this.request<Workspace>('/api/workspaces', {
          method: 'POST',
          body: { name: input.name, project_id: input.projectId },
        }),
      list: () => this.request<Workspace[]>('/api/workspaces', { method: 'GET' }),
    }
  }

  workspace(id: string): WorkspaceRef {
    return new WorkspaceRef(this, id)
  }

  /**
   * Returns the authenticated user, or `null` when no token / an invalid
   * token is configured. Other errors (network, server, rate limit) still
   * throw. Use this in guest-capable frontends so a page load doesn't
   * require a try/catch just to know "am I logged in?".
   */
  async me(): Promise<Me | null> {
    try {
      return await this.request<Me>('/api/me', { method: 'GET' })
    } catch (e) {
      if (e instanceof JsonDropError && e.code === 'unauthenticated') return null
      throw e
    }
  }

  collection(name: string): CollectionRef {
    return new CollectionRef(this, name)
  }

  doc(path: string): DocRef {
    return new DocRef(this, path)
  }

  get(id: string): Promise<Doc> {
    return new IdRef(this, id).get()
  }

  delete(id: string): Promise<{ deleted: true }> {
    return new IdRef(this, id).delete()
  }

  getDefaultProject(): string | undefined {
    return this.defaultProject
  }

  getDefaultSecret(): string | undefined {
    return this.defaultSecret
  }

  async request<T>(path: string, opts: RequestOptions & { ifMatch?: number }): Promise<T> {
    const url = new URL(this.baseUrl + path)
    const query: Record<string, string | number | undefined | null> = { ...(opts.query ?? {}) }

    // If a token is set, it already carries its scope (owner or project-scoped).
    // Only inject ?project= when the SDK config provides one and no token is in use.
    if (!this.token) {
      const project = opts.project ?? this.defaultProject
      if (project) query.project = project
    }
    const secret = opts.secret ?? this.defaultSecret
    if (secret) query.secret = secret

    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue
      url.searchParams.set(k, String(v))
    }

    const headers: Record<string, string> = {}
    if (this.token) headers.Authorization = `Bearer ${this.token}`
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
    if (opts.ifMatch !== undefined) headers['If-Match'] = String(opts.ifMatch)

    const res = await this.fetchImpl(url.toString(), {
      method: opts.method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    })

    let body: unknown = null
    const text = await res.text()
    if (text) {
      try {
        body = JSON.parse(text)
      } catch {
        body = text
      }
    }

    if (!res.ok) {
      const bodyObj = body && typeof body === 'object' ? (body as Record<string, unknown>) : null
      const message =
        (bodyObj && typeof bodyObj.message === 'string' && bodyObj.message) ||
        (bodyObj && typeof bodyObj.error === 'string' && bodyObj.error) ||
        res.statusText ||
        `HTTP ${res.status}`
      const code: ErrorCode =
        (bodyObj && typeof bodyObj.code === 'string'
          ? (bodyObj.code as ErrorCode)
          : STATUS_TO_CODE[res.status]) ?? 'server'
      throw new JsonDropError(res.status, message, code, body)
    }

    return body as T
  }
}

type WriteOptions = {
  accessMode?: AccessMode
  secret?: string
  ifMatch?: number
}

export class CollectionRef {
  constructor(
    private readonly db: JsonDrop,
    private readonly name: string,
  ) {}

  async add(content: unknown, opts: WriteOptions = {}): Promise<CreateDocResult> {
    const result = await this.db.request<CreateDocResult>(`/api/docs/${this.name}`, {
      method: 'POST',
      body: {
        content,
        access_mode: opts.accessMode ?? 'public',
      },
      secret: opts.secret,
    })
    return { ...result, ref: this.db.doc(result.path) }
  }

  async list(opts: { prefix?: string } = {}): Promise<ListDocsResult> {
    return this.db.request<ListDocsResult>('/api/docs', {
      method: 'GET',
      query: { prefix: opts.prefix ?? this.name },
    })
  }

  doc(id: string): IdRef {
    return new IdRef(this.db, id)
  }
}

export class DocRef {
  constructor(
    private readonly db: JsonDrop,
    public readonly path: string,
  ) {}

  async set(content: unknown, opts: WriteOptions = {}): Promise<CreateDocResult> {
    const result = await this.db.request<CreateDocResult>(`/api/docs/${this.path}`, {
      method: 'PUT',
      body: {
        content,
        access_mode: opts.accessMode ?? 'public',
      },
      secret: opts.secret,
      ifMatch: opts.ifMatch,
    })
    return { ...result, ref: this.db.doc(result.path) }
  }

  async get(opts: { secret?: string } = {}): Promise<Doc> {
    return this.db.request<Doc>('/api/docs', {
      method: 'GET',
      query: { path: this.path },
      secret: opts.secret ?? this.db.getDefaultSecret(),
    })
  }

  async delete(opts: { secret?: string; ifMatch?: number } = {}): Promise<{ deleted: true }> {
    return this.db.request<{ deleted: true }>('/api/docs', {
      method: 'DELETE',
      query: { path: this.path },
      secret: opts.secret ?? this.db.getDefaultSecret(),
      ifMatch: opts.ifMatch,
    })
  }
}

export class IdRef {
  constructor(
    private readonly db: JsonDrop,
    private readonly id: string,
  ) {}

  async get(): Promise<Doc> {
    return this.db.request<Doc>(`/api/docs/${this.id}`, { method: 'GET' })
  }

  async delete(opts: { ifMatch?: number } = {}): Promise<{ deleted: true }> {
    return this.db.request<{ deleted: true }>(`/api/docs/${this.id}`, {
      method: 'DELETE',
      ifMatch: opts.ifMatch,
    })
  }
}

export type WorkspaceDoc = {
  id: string
  path: string
  content: unknown
  size_bytes: number
  version: number
  created_at: string
  updated_at: string
}

export type WorkspaceListDocsResult = {
  prefix: string | null
  order: string
  docs: WorkspaceDoc[]
  storage: { used_bytes: number; used: string; limit: string }
}

// Workspace-scoped documents are authorized by membership role, not by
// access_mode/secret — there's nothing to configure per write, unlike the
// legacy CollectionRef/DocRef above.
export class WorkspaceCollectionRef {
  constructor(
    private readonly db: JsonDrop,
    private readonly workspaceId: string,
    private readonly name: string,
  ) {}

  async add(content: unknown): Promise<WorkspaceDoc> {
    return this.db.request<WorkspaceDoc>(
      `/api/workspaces/${this.workspaceId}/collections/${this.name}/documents`,
      { method: 'POST', body: { content } },
    )
  }

  async list(opts: { prefix?: string } = {}): Promise<WorkspaceListDocsResult> {
    return this.db.request<WorkspaceListDocsResult>(
      `/api/workspaces/${this.workspaceId}/documents`,
      { method: 'GET', query: { prefix: opts.prefix ?? this.name } },
    )
  }
}

export class WorkspaceDocRef {
  constructor(
    private readonly db: JsonDrop,
    private readonly workspaceId: string,
    public readonly id: string,
  ) {}

  async get(): Promise<WorkspaceDoc> {
    return this.db.request<WorkspaceDoc>(
      `/api/workspaces/${this.workspaceId}/documents/${this.id}`,
      { method: 'GET' },
    )
  }

  async set(content: unknown, opts: { ifMatch?: number } = {}): Promise<WorkspaceDoc> {
    return this.db.request<WorkspaceDoc>(
      `/api/workspaces/${this.workspaceId}/documents/${this.id}`,
      { method: 'PUT', body: { content }, ifMatch: opts.ifMatch },
    )
  }

  async delete(opts: { ifMatch?: number } = {}): Promise<{ deleted: true }> {
    return this.db.request<{ deleted: true }>(
      `/api/workspaces/${this.workspaceId}/documents/${this.id}`,
      { method: 'DELETE', ifMatch: opts.ifMatch },
    )
  }
}

export class WorkspaceRef {
  readonly members: {
    list: () => Promise<WorkspaceMemberInfo[]>
    updateRole: (
      userId: number,
      role: WorkspaceRole,
    ) => Promise<{ user_id: number; role: WorkspaceRole }>
    remove: (userId: number) => Promise<{ removed: true }>
    createRecoveryLink: (userId: number) => Promise<{ secret: string; expires_at: string }>
  }

  readonly invites: {
    create: (input: {
      role: Exclude<WorkspaceRole, 'owner'>
      expiresAt?: string
      maxUses?: number
    }) => Promise<CreateInviteResult>
    list: () => Promise<WorkspaceInviteInfo[]>
    revoke: (inviteId: string) => Promise<{ revoked: true }>
  }

  constructor(
    private readonly db: JsonDrop,
    public readonly id: string,
  ) {
    const base = `/api/workspaces/${id}`

    this.members = {
      list: () => this.db.request<WorkspaceMemberInfo[]>(`${base}/members`, { method: 'GET' }),
      updateRole: (userId, role) =>
        this.db.request<{ user_id: number; role: WorkspaceRole }>(`${base}/members/${userId}`, {
          method: 'PATCH',
          body: { role },
        }),
      remove: (userId) =>
        this.db.request<{ removed: true }>(`${base}/members/${userId}`, { method: 'DELETE' }),
      createRecoveryLink: (userId) =>
        this.db.request<{ secret: string; expires_at: string }>(
          `${base}/members/${userId}/recovery-link`,
          { method: 'POST' },
        ),
    }

    this.invites = {
      create: (input) =>
        this.db.request<CreateInviteResult>(`${base}/invites`, {
          method: 'POST',
          body: { role: input.role, expires_at: input.expiresAt, max_uses: input.maxUses },
        }),
      list: () => this.db.request<WorkspaceInviteInfo[]>(`${base}/invites`, { method: 'GET' }),
      revoke: (inviteId) =>
        this.db.request<{ revoked: true }>(`${base}/invites/${inviteId}`, { method: 'DELETE' }),
    }
  }

  get(): Promise<Workspace & { role: WorkspaceRole }> {
    return this.db.request(`/api/workspaces/${this.id}`, { method: 'GET' })
  }

  update(input: { name: string }): Promise<Workspace> {
    return this.db.request(`/api/workspaces/${this.id}`, { method: 'PATCH', body: input })
  }

  delete(): Promise<{ deleted: true }> {
    return this.db.request(`/api/workspaces/${this.id}`, { method: 'DELETE' })
  }

  collection(name: string): WorkspaceCollectionRef {
    return new WorkspaceCollectionRef(this.db, this.id, name)
  }

  doc(id: string): WorkspaceDocRef {
    return new WorkspaceDocRef(this.db, this.id, id)
  }
}
