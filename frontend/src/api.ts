export function api(path: string, init?: RequestInit): Promise<Response> {
  const token = getToken()
  const headers: Record<string, string> = {
    ...(init?.headers as Record<string, string>),
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }
  return fetch(path, { ...init, headers })
}

export function getToken(): string | null {
  return localStorage.getItem('token')
}

export function storeCreatedToken(raw: string): void {
  const tokens = getCreatedTokens()
  if (!tokens.includes(raw)) {
    tokens.unshift(raw)
    localStorage.setItem('created_tokens', JSON.stringify(tokens.slice(0, 5)))
  }
}

export function getCreatedTokens(): string[] {
  try {
    return JSON.parse(localStorage.getItem('created_tokens') || '[]')
  } catch {
    return []
  }
}

export function getExampleToken(): string | null {
  const created = getCreatedTokens()
  if (created.length > 0) return created[0]!
  return getToken()
}
