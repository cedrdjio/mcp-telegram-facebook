#!/usr/bin/env node
/**
 * Point d'entrée HTTP — pour Claude.ai (web) via un connecteur personnalisé.
 * Implémente le transport « Streamable HTTP » du protocole MCP, protégé par un
 * jeton Bearer (variable d'environnement MCP_AUTH_TOKEN).
 *
 * L'interface « Ajouter un connecteur personnalisé » de Claude.ai n'accepte que
 * de l'OAuth (ID client / Secret client) — ni en-tête Authorization personnalisé,
 * ni paramètre d'URL. On expose donc un mini serveur OAuth 2.0 (grant
 * `client_credentials`) qui, une fois le client vérifié, délivre simplement le
 * jeton MCP_AUTH_TOKEN existant : Claude.ai récupère ce jeton via /oauth/token
 * puis l'envoie en `Authorization: Bearer` sur chaque requête MCP, comme avant.
 *
 * Déployé typiquement sur Railway : la plateforme fournit la variable PORT.
 * URL à coller dans Claude : https://<votre-domaine>.up.railway.app/mcp
 */
import { createServer as createHttpServer, IncomingMessage, ServerResponse } from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createServer } from "./server.js";

const PORT = Number(process.env.PORT ?? 3000);
const AUTH_TOKEN = process.env.MCP_AUTH_TOKEN ?? "";
const OAUTH_CLIENT_ID = process.env.MCP_OAUTH_CLIENT_ID ?? "";
const OAUTH_CLIENT_SECRET = process.env.MCP_OAUTH_CLIENT_SECRET ?? "";
const MCP_PATH = "/mcp";

// Une session (= un transport) par client connecté, indexée par session-id.
const transports: Record<string, StreamableHTTPServerTransport> = {};

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
      return { clientId: decoded.slice(0, sep), clientSecret: decoded.slice(sep + 1) };
    }
  }
  return {
    clientId: bodyParams.get("client_id") ?? undefined,
    clientSecret: bodyParams.get("client_secret") ?? undefined,
  };
}

/**
 * Endpoint `/oauth/token` (grant `client_credentials`) requis par le
 * connecteur personnalisé de Claude.ai. Vérifie le client_id/secret puis
 * délivre le jeton MCP_AUTH_TOKEN, déjà accepté par isAuthorized().
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
  if (grantType !== "client_credentials") {
    return sendJson(res, 400, { error: "unsupported_grant_type" });
  }

  const { clientId, clientSecret } = extractClientCredentials(req, bodyParams);
  if (!clientId || !clientSecret || !safeEqual(clientId, OAUTH_CLIENT_ID) || !safeEqual(clientSecret, OAUTH_CLIENT_SECRET)) {
    return sendJson(res, 401, { error: "invalid_client" });
  }

  return sendJson(res, 200, {
    access_token: AUTH_TOKEN,
    token_type: "Bearer",
    expires_in: 2592000, // 30 jours (jeton statique, pas de rotation réelle)
  });
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
      token_endpoint: `${origin}/oauth/token`,
      response_types_supported: ["token"],
      grant_types_supported: ["client_credentials"],
      token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic"],
    });
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
