export type AccessMode = 'public' | 'public_read_secret_write' | 'private'
export type Permission = 'read' | 'write' | 'read_write' | 'admin'

export type Doc = {
  id: string
  path: string
  access_mode: AccessMode
  content: unknown
  size_bytes: number
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

export type CreateProjectResult = Project

export type ListDocsResult = {
  prefix: string | null
  docs: Doc[]
  storage: { used_bytes: number; used: string; limit: string }
}

export type CreateDocResult = Doc & { access_secret?: string; message?: string }

export class JsonDropError extends Error {
  readonly status: number
  readonly body: unknown

  constructor(status: number, message: string, body?: unknown) {
    super(message)
    this.name = 'JsonDropError'
    this.status = status
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
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  body?: unknown
  query?: Record<string, string | number | undefined | null>
  secret?: string
  project?: string
}

export class JsonDrop {
  private readonly baseUrl: string
  private readonly token?: string
  private readonly defaultProject?: string
  private readonly defaultSecret?: string
  private readonly fetchImpl: typeof fetch

  readonly projects: {
    create: (input: { name: string }) => Promise<CreateProjectResult>
    list: () => Promise<Project[]>
    delete: (id: string) => Promise<{ deleted: true }>
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
  }

  me(): Promise<Me> {
    return this.request<Me>('/api/me', { method: 'GET' })
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

  async request<T>(path: string, opts: RequestOptions): Promise<T> {
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
      const message =
        body && typeof body === 'object' && 'error' in body
          ? String((body as { error: unknown }).error)
          : res.statusText || `HTTP ${res.status}`
      throw new JsonDropError(res.status, message, body)
    }

    return body as T
  }
}

type WriteOptions = {
  accessMode?: AccessMode
  secret?: string
}

export class CollectionRef {
  constructor(
    private readonly db: JsonDrop,
    private readonly name: string,
  ) {}

  async add(content: unknown, opts: WriteOptions = {}): Promise<CreateDocResult> {
    return this.db.request<CreateDocResult>(`/api/docs/${this.name}`, {
      method: 'POST',
      body: {
        content,
        access_mode: opts.accessMode ?? 'public',
      },
      secret: opts.secret,
    })
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
    return this.db.request<CreateDocResult>(`/api/docs/${this.path}`, {
      method: 'PUT',
      body: {
        content,
        access_mode: opts.accessMode ?? 'public',
      },
      secret: opts.secret,
    })
  }

  async get(opts: { secret?: string } = {}): Promise<Doc> {
    return this.db.request<Doc>('/api/docs', {
      method: 'GET',
      query: { path: this.path },
      secret: opts.secret ?? this.db.getDefaultSecret(),
    })
  }

  async delete(opts: { secret?: string } = {}): Promise<{ deleted: true }> {
    return this.db.request<{ deleted: true }>('/api/docs', {
      method: 'DELETE',
      query: { path: this.path },
      secret: opts.secret ?? this.db.getDefaultSecret(),
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

  async delete(): Promise<{ deleted: true }> {
    return this.db.request<{ deleted: true }>(`/api/docs/${this.id}`, { method: 'DELETE' })
  }
}
