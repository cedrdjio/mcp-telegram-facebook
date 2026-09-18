import { createHmac, createHash, timingSafeEqual, randomBytes } from "node:crypto";

const BASE_URL = (process.env.MCP_PUBLIC_URL || "https://mcp-telegram-facebook-production.up.railway.app").replace(/\/$/, "");
const ISSUER = BASE_URL;
const RESOURCE = BASE_URL;
const JWT_SECRET = process.env.OAUTH_JWT_SECRET || process.env.MCP_AUTH_SECRET || "";
const USERNAME = process.env.MCP_AUTH_USERNAME || "";
const PASSWORD = process.env.MCP_AUTH_PASSWORD || "";
const ACCESS_TTL = 60 * 60;
const CODE_TTL = 5 * 60;
const ALLOWED_SCOPES = new Set(["mcp", "facebook.read", "facebook.write"]);

function requireSecret(): string {
  if (!JWT_SECRET || JWT_SECRET.length < 32) {
    throw new Error("OAUTH_JWT_SECRET/MCP_AUTH_SECRET doit contenir au moins 32 caractères.");
  }
  return JWT_SECRET;
}

function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function fromB64url(input: string): Buffer {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized + "=".repeat((4 - (normalized.length % 4)) % 4), "base64");
}

function signJwt(payload: Record<string, unknown>): string {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const signature = b64url(createHmac("sha256", requireSecret()).update(`${header}.${body}`).digest());
  return `${header}.${body}.${signature}`;
}

function verifyJwt(token: string, expectedAudience = RESOURCE): Record<string, unknown> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("invalid_token");
  const [header, body, signature] = parts;
  const expected = createHmac("sha256", requireSecret()).update(`${header}.${body}`).digest();
  const received = fromB64url(signature);
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) throw new Error("invalid_token");
  const parsedHeader = JSON.parse(fromB64url(header).toString("utf8")) as { alg?: string; typ?: string };
  if (parsedHeader.alg !== "HS256") throw new Error("invalid_token");
  const payload = JSON.parse(fromB64url(body).toString("utf8")) as Record<string, unknown>;
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || payload.exp <= now) throw new Error("invalid_token");
  if (payload.iss !== ISSUER || payload.aud !== expectedAudience) throw new Error("invalid_token");
  return payload;
}

function validChatGptClient(clientId: string): boolean {
  try {
    const u = new URL(clientId);
    if (u.protocol !== "https:" || u.hostname !== "chatgpt.com") return false;
    return /^\/oauth\/client\.json$/.test(u.pathname) || /^\/oauth\/[^/]+\/client\.json$/.test(u.pathname);
  } catch {
    return false;
  }
}

function validRedirectUri(redirectUri: string): boolean {
  try {
    const u = new URL(redirectUri);
    if (u.protocol !== "https:" || u.hostname !== "chatgpt.com") return false;
    return /^\/connector\/oauth(?:\/[^/]+)?$/.test(u.pathname) || u.pathname === "/connector_platform_oauth_redirect";
  } catch {
    return false;
  }
}

export function oauthProtectedResourceMetadata() {
  return {
    resource: RESOURCE,
    authorization_servers: [ISSUER],
    scopes_supported: ["mcp", "facebook.read", "facebook.write"],
    resource_documentation: `${BASE_URL}/health`,
  };
}

export function oauthAuthorizationServerMetadata() {
  return {
    issuer: ISSUER,
    authorization_endpoint: `${BASE_URL}/oauth/authorize`,
    token_endpoint: `${BASE_URL}/oauth/token`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["mcp", "facebook.read", "facebook.write"],
    client_id_metadata_document_supported: true,
  };
}

export function createAuthorizationCode(args: {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  scope: string;
  resource: string;
}): string {
  if (!validChatGptClient(args.clientId)) throw new Error("invalid_client");
  if (!validRedirectUri(args.redirectUri)) throw new Error("invalid_redirect_uri");
  if (args.resource !== RESOURCE) throw new Error("invalid_target");
  const scopes = (args.scope || "mcp").split(/\s+/).filter(Boolean);
  if (scopes.length === 0 || scopes.some((scope) => !ALLOWED_SCOPES.has(scope))) throw new Error("invalid_scope");
  const now = Math.floor(Date.now() / 1000);
  const nonce = randomBytes(18).toString("base64url");
  return signJwt({
    typ: "oauth_code",
    iss: ISSUER,
    aud: "oauth-token",
    sub: args.clientId,
    client_id: args.clientId,
    redirect_uri: args.redirectUri,
    code_challenge: args.codeChallenge,
    scope: scopes.join(" "),
    resource: args.resource,
    nonce,
    iat: now,
    exp: now + CODE_TTL,
  });
}

function verifyPkce(verifier: string, challenge: string): boolean {
  const calculated = createHash("sha256").update(verifier).digest().toString("base64url");
  return calculated === challenge;
}

export function exchangeAuthorizationCode(args: {
  code: string;
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
  resource: string;
}) {
  const payload = verifyJwt(args.code, "oauth-token");
  if (payload.typ !== "oauth_code" || payload.aud !== "oauth-token") throw new Error("invalid_grant");
  if (payload.client_id !== args.clientId || payload.sub !== args.clientId) throw new Error("invalid_grant");
  if (payload.redirect_uri !== args.redirectUri) throw new Error("invalid_grant");
  if (payload.resource !== args.resource || args.resource !== RESOURCE) throw new Error("invalid_grant");
  if (typeof payload.code_challenge !== "string" || !verifyPkce(args.codeVerifier, payload.code_challenge)) throw new Error("invalid_grant");
  const now = Math.floor(Date.now() / 1000);
  return {
    access_token: signJwt({
      typ: "access_token",
      iss: ISSUER,
      aud: RESOURCE,
      sub: "mcp-user",
      client_id: args.clientId,
      scope: typeof payload.scope === "string" ? payload.scope : "mcp",
      iat: now,
      exp: now + ACCESS_TTL,
    }),
    token_type: "Bearer",
    expires_in: ACCESS_TTL,
    scope: typeof payload.scope === "string" ? payload.scope : "mcp",
  };
}

export function verifyAccessToken(token: string, requiredScopes: string[] = ["mcp"]): { sub: string; scopes: string[] } {
  const payload = verifyJwt(token);
  if (payload.typ !== "access_token") throw new Error("invalid_token");
  const scopes = typeof payload.scope === "string" ? payload.scope.split(/\s+/).filter(Boolean) : [];
  for (const scope of requiredScopes) if (!scopes.includes(scope)) throw new Error("insufficient_scope");
  return { sub: String(payload.sub || ""), scopes };
}

export function isValidLogin(username: string, password: string): boolean {
  if (!USERNAME || !PASSWORD) return false;
  return username === USERNAME && password === PASSWORD;
}

export function loginPage(params: {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  scope: string;
  resource: string;
  state: string;
}) {
  const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;");
  const hidden = (n: string, v: string) => `<input type="hidden" name="${n}" value="${esc(v)}">`;
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connexion MCP Telegram–Facebook</title><style>body{font-family:system-ui,sans-serif;background:#f4f5f7;min-height:100vh;display:grid;place-items:center;margin:0}.card{background:#fff;width:min(420px,calc(100% - 40px));padding:30px;border-radius:18px;box-shadow:0 12px 40px #0002}input{width:100%;box-sizing:border-box;padding:12px;margin:7px 0 16px;border:1px solid #ddd;border-radius:9px}button{width:100%;padding:13px;border:0;border-radius:9px;background:#111;color:#fff;font-weight:700;cursor:pointer}</style></head><body><main class="card"><h1>Connexion MCP</h1><p>Autorisez ChatGPT à utiliser votre serveur Telegram–Facebook.</p><form method="post" action="/oauth/authorize">${hidden("client_id", params.clientId)}${hidden("redirect_uri", params.redirectUri)}${hidden("code_challenge", params.codeChallenge)}${hidden("scope", params.scope)}${hidden("resource", params.resource)}${hidden("state", params.state)}<label>Identifiant</label><input name="username" autocomplete="username" required><label>Mot de passe</label><input name="password" type="password" autocomplete="current-password" required><button type="submit">Autoriser</button></form></main></body></html>`;
}

export function bearerToken(request: { headers: Record<string, string | string[] | undefined> }): string | undefined {
  const raw = request.headers.authorization;
  const value = Array.isArray(raw) ? raw[0] : raw;
  const match = value?.match(/^Bearer\s+(.+)$/i);
  return match?.[1];
}

export function oauthChallenge(error: string, description: string, scope = "mcp") {
  const metadata = `${RESOURCE}/.well-known/oauth-protected-resource`;
  return `Bearer resource_metadata="${metadata}", scope="${scope}", error="${error}", error_description="${description.replace(/"/g, "'")}"`;
}

export function oauthConfigPresent() {
  return Boolean(JWT_SECRET && JWT_SECRET.length >= 32 && USERNAME && PASSWORD);
}
