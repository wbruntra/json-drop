import { SignJWT, jwtVerify } from "jose";
import type { User } from "./database";

const SESSION_SECRET = new TextEncoder().encode(process.env.SESSION_SECRET || "change-me-to-a-random-string");
const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID || "";
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || "";
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";

export async function createSession(user: User): Promise<string> {
  return new SignJWT({ sub: user.id, github_id: user.github_id })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(SESSION_SECRET);
}

export async function verifySession(token: string): Promise<{ sub: number; github_id: string } | null> {
  try {
    const { payload } = await jwtVerify(token, SESSION_SECRET);
    return { sub: payload.sub as number, github_id: payload.github_id as string };
  } catch {
    return null;
  }
}

export function getGitHubAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: GITHUB_CLIENT_ID,
    redirect_uri: `${FRONTEND_URL}/gh/callback`,
    scope: "read:user user:email",
    state,
  });
  return `https://github.com/login/oauth/authorize?${params}`;
}

export async function exchangeGitHubCode(code: string): Promise<string> {
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      client_id: GITHUB_CLIENT_ID,
      client_secret: GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: `${FRONTEND_URL}/gh/callback`,
    }),
  });
  const data = await res.json() as { access_token: string };
  return data.access_token;
}

export async function getGitHubUser(accessToken: string): Promise<{ id: string; login: string; email: string | null; name: string | null }> {
  const res = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });
  return res.json() as Promise<{ id: string; login: string; email: string | null; name: string | null }>;
}

export function generateState(): string {
  return crypto.randomUUID();
}

export function setSessionCookie(token: string): string {
  const maxAge = 7 * 24 * 60 * 60;
  return `session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

export function clearSessionCookie(): string {
  return `session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}
