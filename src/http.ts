#!/usr/bin/env node
/**
 * Point d'entrée HTTP — pour Claude.ai (web) via un connecteur personnalisé.
 * Implémente le transport « Streamable HTTP » du protocole MCP, protégé par un
 * jeton Bearer (variable d'environnement MCP_AUTH_TOKEN).
 *
 * Déployé typiquement sur Railway : la plateforme fournit la variable PORT.
 * URL à coller dans Claude : https://<votre-domaine>.up.railway.app/mcp
 */
import { createServer as createHttpServer, IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createServer } from "./server.js";

const PORT = Number(process.env.PORT ?? 3000);
const AUTH_TOKEN = process.env.MCP_AUTH_TOKEN ?? "";
const MCP_PATH = "/mcp";

// Une session (= un transport) par client connecté, indexée par session-id.
const transports: Record<string, StreamableHTTPServerTransport> = {};

/**
 * Vérifie le jeton d'accès. Deux méthodes acceptées :
 *  - en-tête  `Authorization: Bearer <token>`  (clients qui gèrent les headers)
 *  - paramètre d'URL  `?key=<token>`  (Claude.ai, qui n'accepte qu'une URL)
 */
function isAuthorized(req: IncomingMessage, url: URL): boolean {
  if (!AUTH_TOKEN) return true; // pas de token configuré => ouvert (déconseillé en prod)
  const header = req.headers["authorization"] ?? "";
  if (header === `Bearer ${AUTH_TOKEN}`) return true;
  if (url.searchParams.get("key") === AUTH_TOKEN) return true;
  return false;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

/** Lit et parse le corps JSON d'une requête. */
async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : undefined;
}

const httpServer = createHttpServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

  // Health check public (utile pour Railway).
  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
    return sendJson(res, 200, { status: "ok", service: "mcp-telegram-facebook" });
  }

  if (url.pathname !== MCP_PATH) {
    return sendJson(res, 404, { error: "Not found" });
  }

  if (!isAuthorized(req, url)) {
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
});
