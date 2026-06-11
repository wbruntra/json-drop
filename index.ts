import "./database";
import { extractAuth, checkRateLimit, getRateLimitKey, jsonResponse, corsHeaders } from "./middleware";
import { handleGitHubAuth, handleGitHubCallback, handleLogout } from "./routes/auth";
import { handleMe } from "./routes/me";
import { handleCreateToken, handleListTokens, handleDeleteToken } from "./routes/tokens";
import { handleCreateDoc, handleListDocs, handleGetDoc, handleUpdateDoc, handleDeleteDoc } from "./routes/docs";

const server = Bun.serve({
  port: process.env.PORT || 3000,

  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    const rateLimitKey = getRateLimitKey(req);
    if (!checkRateLimit(rateLimitKey)) {
      return jsonResponse({ error: "Too many requests" }, 429, { "Retry-After": "60" });
    }

    const auth = await extractAuth(req);

    if (path === "/api/auth/github" && req.method === "GET") {
      return handleGitHubAuth(req);
    }

    if (path === "/gh/callback" && req.method === "GET") {
      return handleGitHubCallback(req);
    }

    if (path === "/api/auth/logout" && req.method === "POST") {
      return handleLogout();
    }

    if (path === "/api/me" && req.method === "GET") {
      return handleMe(auth);
    }

    if (path === "/api/tokens") {
      if (req.method === "POST") return handleCreateToken(req, auth);
      if (req.method === "GET") return handleListTokens(auth);
    }

    if (path.startsWith("/api/tokens/") && req.method === "DELETE") {
      const tokenId = path.split("/").pop()!;
      return handleDeleteToken(req, auth, tokenId);
    }

    if (path === "/api/docs") {
      if (req.method === "POST") return handleCreateDoc(req, auth);
      if (req.method === "GET") return handleListDocs(auth);
    }

    if (path.startsWith("/api/docs/")) {
      const docId = path.split("/").pop()!;
      if (req.method === "GET") return handleGetDoc(req, auth, docId);
      if (req.method === "PUT") return handleUpdateDoc(req, auth, docId);
      if (req.method === "DELETE") return handleDeleteDoc(req, auth, docId);
    }

    return jsonResponse({ error: "Not found" }, 404);
  },
});

console.log(`Listening on http://localhost:${server.port}`);
