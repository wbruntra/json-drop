export function generateToken(): string {
  return `jd_${crypto.randomUUID().replace(/-/g, '')}${crypto.randomUUID().replace(/-/g, '')}`
}

export function generateSessionToken(): string {
  return `jds_${crypto.randomUUID().replace(/-/g, '')}${crypto.randomUUID().replace(/-/g, '')}`
}

// Session tokens, invite secrets, and recovery secrets are hashed before storage
// (unlike legacy api_tokens.token_hash, which stores the raw token). Comparison
// is by hash lookup, never a raw string compare.
export function hashToken(token: string): string {
  return new Bun.CryptoHasher('sha256').update(token).digest('hex')
}
