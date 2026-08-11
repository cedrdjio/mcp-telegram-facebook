#!/usr/bin/env node
/**
 * Point d'entrée HTTP — pour Claude.ai (web) via un connecteur personnalisé.
 * Implémente le transport « Streamable HTTP » du protocole MCP, protégé par un
 * jeton Bearer (variable d'environnement MCP_AUTH_TOKEN).
 *
 * L'interface « Ajouter un connecteur personnalisé » de Claude.ai n'accepte que
 * de l'OAuth (ID client / Secret client) — ni en-tête Authorization personnalisé,
 * ni paramètre d'URL. Claude effectue le flux standard « Authorization Code »
 * (+ PKCE) : redirection navigateur vers /authorize, puis échange du code
 * contre un jeton sur /oauth/token. Le client (ID/secret) est pré-enregistré
 * via les variables d'environnement — pas de Dynamic Client Registration.
 * Une fois le code validé, le jeton délivré est simplement MCP_AUTH_TOKEN,
 * déjà accepté par isAuthorized() sur /mcp.
 *
 * Déployé typiquement sur Railway : la plateforme fournit la variable PORT.
 * URL à coller dans Claude : https://<votre-domaine>.up.railway.app/mcp
 */
import { createServer as createHttpServer, IncomingMessage, ServerResponse } from "node:http";
import { randomUUID, randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createServer } from "./server.js";

const PORT = Number(process.env.PORT ?? 3000);
// .trim() : tolère un espace ou un retour à la ligne parasite copié-collé dans
// les variables d'environnement (Railway, etc.), sinon la comparaison stricte échoue.
const AUTH_TOKEN = (process.env.MCP_AUTH_TOKEN ?? "").trim();
const OAUTH_CLIENT_ID = (process.env.MCP_OAUTH_CLIENT_ID ?? "").trim();
const OAUTH_CLIENT_SECRET = (process.env.MCP_OAUTH_CLIENT_SECRET ?? "").trim();
const MCP_PATH = "/mcp";

// Une session (= un transport) par client connecté, indexée par session-id.
const transports: Record<string, StreamableHTTPServerTransport> = {};

interface AuthCodeEntry {
  clientId: string;
  redirectUri: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
  expiresAt: number;
}
// Codes d'autorisation à usage unique, en mémoire (durée de vie : 5 minutes).
const authCodes = new Map<string, AuthCodeEntry>();
const AUTH_CODE_TTL_MS = 5 * 60 * 1000;

/** Compare deux chaînes en temps constant (évite les attaques par timing sur le jeton). */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Vérifie le jeton d'accès. Deux méthodes acceptées :
 *  - en-tête  `Authorization: Bearer <token>`  (clients qui gèrent les headers)
 *  - paramètre d'URL  `?key=<token>`  (Claude.ai, qui n'accepte qu'une URL)
 */
function isAuthorized(req: IncomingMessage, url: URL): boolean {
  if (!AUTH_TOKEN) return true; // pas de token configuré => ouvert (déconseillé en prod)
  const header = req.headers["authorization"] ?? "";
  if (typeof header === "string" && safeEqual(header, `Bearer ${AUTH_TOKEN}`)) return true;
  const key = url.searchParams.get("key");
  if (key && safeEqual(key, AUTH_TOKEN)) return true;
  return false;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

/** Lit le corps brut d'une requête (texte). */
async function readRawBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/** Lit et parse le corps JSON d'une requête. */
async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const raw = await readRawBody(req);
  return raw ? JSON.parse(raw) : undefined;
}

/**
 * Extrait client_id/client_secret d'une requête de token OAuth : soit via
 * l'en-tête `Authorization: Basic ...` (client_secret_basic), soit via le
 * corps de la requête (client_secret_post, en JSON ou x-www-form-urlencoded).
 */
function extractClientCredentials(
  req: IncomingMessage,
  bodyParams: URLSearchParams
): { clientId?: string; clientSecret?: string } {
  const authHeader = req.headers["authorization"];
  if (typeof authHeader === "string" && authHeader.startsWith("Basic ")) {
    const decoded = Buffer.from(authHeader.slice("Basic ".length), "base64").toString("utf8");
    const sep = decoded.indexOf(":");
    if (sep !== -1) {
      return { clientId: decoded.slice(0, sep).trim(), clientSecret: decoded.slice(sep + 1).trim() };
    }
  }
  return {
    clientId: bodyParams.get("client_id")?.trim(),
    clientSecret: bodyParams.get("client_secret")?.trim(),
  };
}

/**
 * Endpoint `GET /authorize` : première étape du flux « Authorization Code ».
 * Usage strictement personnel (un seul utilisateur, vous) : le client_id est
 * vérifié, mais il n'y a pas d'écran de consentement — on redirige
 * directement vers redirect_uri avec un code à usage unique.
 */
function handleAuthorize(req: IncomingMessage, res: ServerResponse, url: URL): void {
  const responseType = url.searchParams.get("response_type");
  const clientId = (url.searchParams.get("client_id") ?? "").trim();
  const redirectUri = url.searchParams.get("redirect_uri");
  const state = url.searchParams.get("state");
  const codeChallenge = url.searchParams.get("code_challenge") ?? undefined;
  const codeChallengeMethod = url.searchParams.get("code_challenge_method") ?? undefined;

  if (!redirectUri) {
    return sendJson(res, 400, { error: "invalid_request", error_description: "redirect_uri manquant." });
  }

  let redirectUrl: URL;
  try {
    redirectUrl = new URL(redirectUri);
  } catch {
    return sendJson(res, 400, { error: "invalid_request", error_description: "redirect_uri invalide." });
  }
  if (state) redirectUrl.searchParams.set("state", state);

  if (!OAUTH_CLIENT_ID || !safeEqual(clientId, OAUTH_CLIENT_ID)) {
    console.warn(
      `/authorize: client_id refusé (reçu ${clientId.length} car., attendu ${OAUTH_CLIENT_ID.length} car.)`
    );
    redirectUrl.searchParams.set("error", "unauthorized_client");
    res.writeHead(302, { Location: redirectUrl.toString() });
    res.end();
    return;
  }
  if (responseType !== "code") {
    redirectUrl.searchParams.set("error", "unsupported_response_type");
    res.writeHead(302, { Location: redirectUrl.toString() });
    res.end();
    return;
  }

  const code = randomBytes(24).toString("base64url");
  authCodes.set(code, {
    clientId,
    redirectUri,
    codeChallenge,
    codeChallengeMethod,
    expiresAt: Date.now() + AUTH_CODE_TTL_MS,
  });

  redirectUrl.searchParams.set("code", code);
  if (state) redirectUrl.searchParams.set("state", state);
  res.writeHead(302, { Location: redirectUrl.toString() });
  res.end();
}

/**
 * Endpoint `POST /oauth/token`, requis par le connecteur personnalisé de
 * Claude.ai. Gère `authorization_code` (flux réel utilisé par Claude.ai, avec
 * vérification PKCE si présente) et `client_credentials` (pour d'autres
 * clients machine-à-machine). Dans les deux cas, une fois le client/code
 * validé, délivre le jeton MCP_AUTH_TOKEN existant, déjà accepté par
 * isAuthorized() sur /mcp.
 */
async function handleOAuthToken(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!OAUTH_CLIENT_ID || !OAUTH_CLIENT_SECRET || !AUTH_TOKEN) {
    return sendJson(res, 500, {
      error: "server_error",
      error_description: "OAuth non configuré : définissez MCP_OAUTH_CLIENT_ID, MCP_OAUTH_CLIENT_SECRET et MCP_AUTH_TOKEN.",
    });
  }

  const raw = await readRawBody(req);
  const contentType = String(req.headers["content-type"] ?? "");
  let bodyParams: URLSearchParams;
  if (contentType.includes("application/json")) {
    try {
      const json = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      bodyParams = new URLSearchParams(
        Object.fromEntries(Object.entries(json).map(([k, v]) => [k, String(v)]))
      );
    } catch {
      bodyParams = new URLSearchParams();
    }
  } else {
    bodyParams = new URLSearchParams(raw);
  }

  const grantType = bodyParams.get("grant_type");
  const { clientId, clientSecret } = extractClientCredentials(req, bodyParams);
  if (!clientId || !clientSecret || !safeEqual(clientId, OAUTH_CLIENT_ID) || !safeEqual(clientSecret, OAUTH_CLIENT_SECRET)) {
    return sendJson(res, 401, { error: "invalid_client" });
  }

  if (grantType === "authorization_code") {
    const code = bodyParams.get("code") ?? "";
    const redirectUri = bodyParams.get("redirect_uri") ?? "";
    const codeVerifier = bodyParams.get("code_verifier");

    const entry = authCodes.get(code);
    authCodes.delete(code); // usage unique, qu'il soit valide ou non

    if (!entry || entry.expiresAt < Date.now()) {
      return sendJson(res, 400, { error: "invalid_grant", error_description: "Code expiré ou inconnu." });
    }
    if (entry.redirectUri !== redirectUri) {
      return sendJson(res, 400, { error: "invalid_grant", error_description: "redirect_uri ne correspond pas." });
    }
    if (entry.codeChallenge) {
      const expected =
        entry.codeChallengeMethod === "plain"
          ? codeVerifier ?? ""
          : createHash("sha256").update(codeVerifier ?? "").digest("base64url");
      if (!codeVerifier || !safeEqual(expected, entry.codeChallenge)) {
        return sendJson(res, 400, { error: "invalid_grant", error_description: "code_verifier invalide (PKCE)." });
      }
    }

    return sendJson(res, 200, {
      access_token: AUTH_TOKEN,
      token_type: "Bearer",
      expires_in: 31536000, // 1 an (jeton statique, pas de rotation réelle)
    });
  }

  if (grantType === "client_credentials") {
    return sendJson(res, 200, {
      access_token: AUTH_TOKEN,
      token_type: "Bearer",
      expires_in: 31536000,
    });
  }

  return sendJson(res, 400, { error: "unsupported_grant_type" });
}

const httpServer = createHttpServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  const origin = `https://${req.headers.host}`;

  // Health check public (utile pour Railway).
  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
    return sendJson(res, 200, { status: "ok", service: "mcp-telegram-facebook" });
  }

  // --- Découverte OAuth (RFC 8414 / RFC 9728), lue par le connecteur Claude.ai ---
  if (
    req.method === "GET" &&
    (url.pathname === "/.well-known/oauth-protected-resource" ||
      url.pathname === "/.well-known/oauth-protected-resource/mcp")
  ) {
    return sendJson(res, 200, {
      resource: `${origin}${MCP_PATH}`,
      authorization_servers: [origin],
    });
  }
  if (
    req.method === "GET" &&
    (url.pathname === "/.well-known/oauth-authorization-server" ||
      url.pathname === "/.well-known/oauth-authorization-server/mcp")
  ) {
    return sendJson(res, 200, {
      issuer: origin,
      authorization_endpoint: `${origin}/authorize`,
      token_endpoint: `${origin}/oauth/token`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "client_credentials"],
      code_challenge_methods_supported: ["S256", "plain"],
      token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic"],
    });
  }
  if (req.method === "GET" && url.pathname === "/authorize") {
    return handleAuthorize(req, res, url);
  }
  if (req.method === "POST" && url.pathname === "/oauth/token") {
    return handleOAuthToken(req, res);
  }

  if (url.pathname !== MCP_PATH) {
    return sendJson(res, 404, { error: "Not found" });
  }

  if (!isAuthorized(req, url)) {
    res.setHeader(
      "WWW-Authenticate",
      `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`
    );
    return sendJson(res, 401, {
      jsonrpc: "2.0",
      error: { code: -32001, message: "Non autorisé : jeton Bearer manquant ou invalide." },
      id: null,
    });
  }

  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  try {
    // --- POST : messages JSON-RPC entrants ---
    if (req.method === "POST") {
      const body = await readJsonBody(req);
      let transport = sessionId ? transports[sessionId] : undefined;

      if (!transport && isInitializeRequest(body)) {
        // Nouvelle session : on crée un transport + un serveur dédiés.
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => {
            transports[id] = transport!;
          },
        });
        transport.onclose = () => {
          if (transport!.sessionId) delete transports[transport!.sessionId];
        };
        const server = createServer();
        await server.connect(transport);
      }

      if (!transport) {
        return sendJson(res, 400, {
          jsonrpc: "2.0",
          error: { code: -32000, message: "Session inconnue. Envoyez d'abord une requête initialize." },
          id: null,
        });
      }

      return transport.handleRequest(req, res, body);
    }

    // --- GET : flux SSE serveur -> client / DELETE : fin de session ---
    if (req.method === "GET" || req.method === "DELETE") {
      const transport = sessionId ? transports[sessionId] : undefined;
      if (!transport) return sendJson(res, 400, { error: "Session inconnue." });
      return transport.handleRequest(req, res);
    }

    return sendJson(res, 405, { error: "Méthode non autorisée." });
  } catch (err) {
    console.error("Erreur HTTP MCP:", err);
    if (!res.headersSent) sendJson(res, 500, { error: "Erreur interne du serveur." });
  }
});

httpServer.listen(PORT, () => {
  console.log(`Serveur MCP telegram-facebook (HTTP) à l'écoute sur le port ${PORT}${MCP_PATH}`);
  if (!AUTH_TOKEN) {
    console.warn("⚠️  MCP_AUTH_TOKEN non défini : l'endpoint est PUBLIC. Définissez-le en production !");
  }
  if (!OAUTH_CLIENT_ID || !OAUTH_CLIENT_SECRET) {
    console.warn(
      "⚠️  MCP_OAUTH_CLIENT_ID / MCP_OAUTH_CLIENT_SECRET non définis : le connecteur Claude.ai (qui exige OAuth) ne pourra pas s'authentifier."
    );
  }
});
