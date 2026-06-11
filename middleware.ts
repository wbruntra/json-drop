import { verifySession, getApiTokenByHash } from "./auth";
import { getUser } from "./database";
import { createHash } from "crypto";

export type AuthContext = {
  user: { id: number; github_id: string; email: string | null; display_name: string | null } | null;
  tokenPermissions: string | null;
};

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateToken(): string {
  return `jd_${crypto.randomUUID().replace(/-/g, "")}${crypto.randomUUID().replace(/-/g, "")}`;
}

export function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

export function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(key);

  if (!entry || now >= entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + 60_000 });
    return true;
  }

  if (entry.count >= 100) {
    return false;
  }

  entry.count++;
  return true;
}

export async function extractAuth(req: Request): Promise<AuthContext> {
  const ctx: AuthContext = { user: null, tokenPermissions: null };

  const authHeader = req.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const rawToken = authHeader.slice(7);
    const tokenHash = hashToken(rawToken);
    const token = getApiTokenByHash(tokenHash);
    if (token) {
      const user = getUser(token.user_id);
      if (user) {
        ctx.user = user;
        ctx.tokenPermissions = token.permissions;
        return ctx;
      }
    }
  }

  const cookie = req.headers.get("Cookie");
  if (cookie) {
    const match = cookie.match(/session=([^;]+)/);
    if (match) {
      const session = await verifySession(match[1]);
      if (session) {
        const user = getUser(session.sub);
        if (user) {
          ctx.user = user;
          ctx.tokenPermissions = "admin";
          return ctx;
        }
      }
    }
  }

  return ctx;
}

export function getRateLimitKey(req: Request): string {
  const authHeader = req.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return `token:${hashToken(authHeader.slice(7))}`;
  }
  return `ip:${req.headers.get("CF-Connecting-IP") || req.headers.get("X-Forwarded-For") || "unknown"}`;
}

export function jsonResponse(data: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(),
      ...extraHeaders,
    },
  });
}
