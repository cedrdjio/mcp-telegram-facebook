#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  oauthProtectedResourceMetadata,
  oauthAuthorizationServerMetadata,
  createAuthorizationCode,
  exchangeAuthorizationCode,
  loginPage,
  isValidLogin,
  bearerToken,
  verifyAccessToken,
  oauthChallenge,
  oauthConfigPresent,
} from "./oauth.js";

import { listVideos as listTelegramVideos, downloadVideo } from "./telegram.js";
import {
  listPages,
  getPageInsights,
  postVideoToPage,
  postToPageFeed,
  listVideos, updateVideo, listComments, postComment, pinComment, checkVideoVisibility,
  graphApiRequest, getObject, createObject, updateObject, deleteObject, listEdge, adsInsights,
  universalGraphRequest, analyzeGraphRequest, diagnoseFacebook,
} from "./facebook.js";

function createServer() {
const server = new McpServer({
  name: "mcp-telegram-facebook",
  version: "0.1.0",
});

/** Enveloppe une valeur en réponse MCP JSON lisible + gère les erreurs. */
function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}
function fail(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: "text" as const, text: `❌ ${message}` }], isError: true };
}

/* ============================ Telegram ============================ */

server.tool(
  "telegram_list_videos",
  "Liste les vidéos récentes d'un chat, canal ou groupe Telegram. " +
    "Retourne pour chacune : messageId, légende, nom de fichier, taille et durée. " +
    "Utilisez ensuite telegram_download_video avec le messageId choisi.",
  {
    chat: z
      .string()
      .describe("Chat cible : @username, ID numérique, ou lien t.me/... du canal/groupe."),
    limit: z.number().int().min(1).max(100).default(20).describe("Nombre de messages à examiner."),
  },
  async ({ chat, limit }) => {
    try {
      return ok(await listTelegramVideos(chat, limit));
    } catch (e) {
      return fail(e);
    }
  }
);

server.tool(
  "telegram_download_video",
  "Télécharge une vidéo Telegram sur le disque local et retourne son chemin. " +
    "Ce chemin sera passé à facebook_post_video pour la republier.",
  {
    chat: z.string().describe("Chat/canal source (identique à telegram_list_videos)."),
    messageId: z.number().int().describe("ID du message contenant la vidéo."),
  },
  async ({ chat, messageId }) => {
    try {
      return ok(await downloadVideo(chat, messageId));
    } catch (e) {
      return fail(e);
    }
  }
);

/* ======================== Facebook — Pages ======================== */

server.tool(
  "facebook_list_pages",
  "Liste les Pages Facebook gérées par le compte, avec leur ID, nom et Page Access Token.",
  {},
  async () => {
    try {
      return ok(await listPages());
    } catch (e) {
      return fail(e);
    }
  }
);

server.tool(
  "facebook_post_video",
  "Publie une vidéo locale (téléchargée depuis Telegram) sur une Page Facebook, " +
    "avec un titre et une description personnalisés.",
  {
    filePath: z.string().describe("Chemin local de la vidéo (résultat de telegram_download_video)."),
    description: z.string().optional().describe("Description/légende personnalisée du post."),
    title: z.string().optional().describe("Titre de la vidéo (optionnel)."),
    pageId: z.string().optional().describe("ID de la Page cible (sinon FACEBOOK_PAGE_ID)."),
    pageAccessToken: z
      .string()
      .optional()
      .describe("Page Access Token spécifique (obtenu via facebook_list_pages)."),
  },
  async (args) => {
    try {
      return ok(await postVideoToPage(args));
    } catch (e) {
      return fail(e);
    }
  }
);

server.tool(
  "facebook_post_feed",
  "Publie un post texte (avec lien optionnel) sur le fil d'une Page Facebook.",
  {
    message: z.string().describe("Texte du post."),
    link: z.string().url().optional().describe("Lien à joindre au post."),
    pageId: z.string().optional().describe("ID de la Page cible (sinon FACEBOOK_PAGE_ID)."),
    pageAccessToken: z.string().optional().describe("Page Access Token spécifique."),
  },
  async (args) => {
    try {
      return ok(await postToPageFeed(args));
    } catch (e) {
      return fail(e);
    }
  }
);

server.tool(
  "facebook_page_insights",
  "Récupère les statistiques d'une Page Facebook (vues, portée, engagement...).",
  {
    pageId: z.string().describe("ID de la Page."),
    metrics: z
      .string()
      .default("page_impressions,page_post_engagements,page_fans")
      .describe("Métriques séparées par des virgules."),
    period: z.enum(["day", "week", "days_28"]).default("day").describe("Période d'agrégation."),
  },
  async ({ pageId, metrics, period }) => {
    try {
      return ok(await getPageInsights(pageId, metrics, period));
    } catch (e) {
      return fail(e);
    }
  }
);



server.tool("facebook_list_videos", "Liste les vidéos/Reels publiés avec leur videoId et post_id.", {
  pageId: z.string().optional(), limit: z.number().int().min(1).max(100).default(25)
}, async ({ pageId, limit }) => { try { return ok(await listVideos(pageId, limit)); } catch (e) { return fail(e); } });

server.tool("facebook_update_video", "Modifie la description et éventuellement le titre d'un Reel existant.", {
  videoId: z.string(), description: z.string(), title: z.string().optional()
}, async ({ videoId, description, title }) => { try { return ok(await updateVideo(videoId, description, title)); } catch (e) { return fail(e); } });

server.tool("facebook_list_comments", "Liste les commentaires d'une publication ou d'un Reel.", {
  postId: z.string(), limit: z.number().int().min(1).max(100).default(25)
}, async ({ postId, limit }) => { try { return ok(await listComments(postId, limit)); } catch (e) { return fail(e); } });

server.tool("facebook_post_comment", "Publie un commentaire sous une publication.", {
  postId: z.string(), message: z.string()
}, async ({ postId, message }) => { try { return ok(await postComment(postId, message)); } catch (e) { return fail(e); } });

server.tool("facebook_pin_comment", "Épingle ou désépingle un commentaire.", {
  commentId: z.string(), pinned: z.boolean().default(true)
}, async ({ commentId, pinned }) => { try { return ok(await pinComment(commentId, pinned)); } catch (e) { return fail(e); } });

server.tool("facebook_check_video_visibility", "Vérifie les champs de visibilité disponibles pour un Reel.", {
  videoId: z.string()
}, async ({ videoId }) => { try { return ok(await checkVideoVisibility(videoId)); } catch (e) { return fail(e); } });


/* ======================== Graph API avancée ======================== */
server.tool("facebook_graph_request", "Appel Graph API générique pour les endpoints autorisés. Utiliser avec prudence.", {
  path: z.string(), method: z.enum(["GET", "POST", "DELETE"]).default("GET"), params: z.record(z.union([z.string(), z.number(), z.boolean(), z.record(z.any()), z.null()])).optional()
}, async ({ path, method, params }) => { try { return ok(await graphApiRequest({ path, method, params })); } catch (e) { return fail(e); } });

server.tool("facebook_universal_request", "Moteur universel Graph API: paramètres dynamiques, simulation, confirmation des actions sensibles et pagination.", {
  path: z.string(),
  method: z.enum(["GET", "POST", "DELETE", "PUT", "PATCH"]).default("GET"),
  params: z.record(z.any()).optional(),
  confirm: z.boolean().default(false),
  dryRun: z.boolean().default(false),
  paginate: z.boolean().default(false),
  maxPages: z.number().int().min(1).max(50).default(10),
}, async ({ path, method, params, confirm, dryRun, paginate, maxPages }) => { try { return ok(await universalGraphRequest({ path, method, params, confirm, dryRun, paginate, maxPages })); } catch (e) { return fail(e); } });

server.tool("facebook_analyze_request", "Analyse une requête sans l'exécuter et indique si une confirmation est nécessaire.", {
  path: z.string(), method: z.enum(["GET", "POST", "DELETE", "PUT", "PATCH"]).default("GET"), params: z.record(z.any()).optional(), confirm: z.boolean().default(false), dryRun: z.boolean().default(true)
}, async ({ path, method, params, confirm, dryRun }) => ok(analyzeGraphRequest({ path, method, params, confirm, dryRun })));

server.tool("facebook_diagnose", "Diagnostic complet du token, de la Page, de la version Graph API et de la lecture des vidéos.", {}, async () => { try { return ok(await diagnoseFacebook()); } catch (e) { return fail(e); } });

server.tool("facebook_get_object", "Lit un objet Facebook par ID avec les champs demandés.", { objectId: z.string(), fields: z.string().optional() }, async ({ objectId, fields }) => { try { return ok(await getObject(objectId, fields)); } catch (e) { return fail(e); } });
server.tool("facebook_create_object", "Crée un objet Graph API sur un chemin autorisé (ex: act_ID/campaigns, act_ID/adsets, act_ID/ads).", { path: z.string(), params: z.record(z.union([z.string(), z.number(), z.boolean(), z.record(z.any()), z.null()])) }, async ({ path, params }) => { try { return ok(await createObject(path, params)); } catch (e) { return fail(e); } });
server.tool("facebook_update_object", "Met à jour un objet Facebook/Marketing API par ID.", { objectId: z.string(), params: z.record(z.union([z.string(), z.number(), z.boolean(), z.record(z.any()), z.null()])) }, async ({ objectId, params }) => { try { return ok(await updateObject(objectId, params)); } catch (e) { return fail(e); } });
server.tool("facebook_delete_object", "Supprime un objet Facebook/Marketing API. Action irréversible.", { objectId: z.string() }, async ({ objectId }) => { try { return ok(await deleteObject(objectId)); } catch (e) { return fail(e); } });
server.tool("facebook_list_edge", "Liste une relation/edge d'un objet: campaigns, adsets, ads, creatives, insights, comments, etc.", { objectId: z.string(), edge: z.string(), params: z.record(z.union([z.string(), z.number(), z.boolean(), z.record(z.any()), z.null()])).optional() }, async ({ objectId, edge, params }) => { try { return ok(await listEdge(objectId, edge, params)); } catch (e) { return fail(e); } });
server.tool("facebook_ads_insights", "Récupère les statistiques publicitaires d'un compte, campagne, ensemble ou annonce.", { objectId: z.string(), fields: z.string().optional(), datePreset: z.string().optional(), timeRange: z.record(z.string()).optional(), breakdowns: z.string().optional(), level: z.string().optional(), limit: z.number().int().optional() }, async ({ objectId, fields, datePreset, timeRange, breakdowns, level, limit }) => { try { return ok(await adsInsights(objectId, { fields, date_preset: datePreset, time_range: timeRange, breakdowns, level, limit })); } catch (e) { return fail(e); } });

/* Raccourcis Marketing API */
server.tool("facebook_list_ad_accounts", "Liste les comptes publicitaires accessibles.", {}, async () => { try { return ok(await graphApiRequest({ path: "me/adaccounts", params: { fields: "id,account_id,name,account_status,currency,timezone_name,business" } })); } catch (e) { return fail(e); } });
server.tool("facebook_list_campaigns", "Liste les campagnes d'un compte publicitaire.", { adAccountId: z.string(), fields: z.string().optional(), limit: z.number().int().optional() }, async ({ adAccountId, fields, limit }) => { try { return ok(await listEdge(`act_${adAccountId.replace(/^act_/, "")}`, "campaigns", { fields: fields ?? "id,name,objective,status,effective_status,daily_budget,lifetime_budget,created_time,updated_time", limit })); } catch (e) { return fail(e); } });
server.tool("facebook_list_adsets", "Liste les ensembles de publicités.", { adAccountId: z.string(), fields: z.string().optional(), limit: z.number().int().optional() }, async ({ adAccountId, fields, limit }) => { try { return ok(await listEdge(`act_${adAccountId.replace(/^act_/, "")}`, "adsets", { fields: fields ?? "id,name,campaign_id,status,effective_status,daily_budget,lifetime_budget,targeting,optimization_goal,billing_event", limit })); } catch (e) { return fail(e); } });
server.tool("facebook_list_ads", "Liste les annonces publicitaires.", { adAccountId: z.string(), fields: z.string().optional(), limit: z.number().int().optional() }, async ({ adAccountId, fields, limit }) => { try { return ok(await listEdge(`act_${adAccountId.replace(/^act_/, "")}`, "ads", { fields: fields ?? "id,name,adset_id,campaign_id,status,effective_status,creative", limit })); } catch (e) { return fail(e); } });
server.tool("facebook_list_adcreatives", "Liste les créations publicitaires.", { adAccountId: z.string(), fields: z.string().optional(), limit: z.number().int().optional() }, async ({ adAccountId, fields, limit }) => { try { return ok(await listEdge(`act_${adAccountId.replace(/^act_/, "")}`, "adcreatives", { fields: fields ?? "id,name,object_story_spec,asset_feed_spec,status", limit })); } catch (e) { return fail(e); } });
server.tool("facebook_list_custom_audiences", "Liste les audiences personnalisées.", { adAccountId: z.string(), fields: z.string().optional(), limit: z.number().int().optional() }, async ({ adAccountId, fields, limit }) => { try { return ok(await listEdge(`act_${adAccountId.replace(/^act_/, "")}`, "customaudiences", { fields: fields ?? "id,name,subtype,approximate_count,delivery_status", limit })); } catch (e) { return fail(e); } });
server.tool("facebook_list_pixels", "Liste les pixels/datasets accessibles.", { adAccountId: z.string(), fields: z.string().optional(), limit: z.number().int().optional() }, async ({ adAccountId, fields, limit }) => { try { return ok(await listEdge(`act_${adAccountId.replace(/^act_/, "")}`, "adspixels", { fields: fields ?? "id,name,creation_time,last_fired_time", limit })); } catch (e) { return fail(e); } });
server.tool("facebook_validate_token", "Vérifie le token et retourne les informations disponibles.", {}, async () => { try { return ok(await graphApiRequest({ path: "me", params: { fields: "id,name" } })); } catch (e) { return fail(e); } });

/* ==================== Workflow combiné ==================== */

server.tool(
  "repost_telegram_to_facebook",
  "Workflow complet : télécharge une vidéo Telegram puis la republie directement sur " +
    "une Page Facebook avec une description personnalisée. Combine download + post.",
  {
    chat: z.string().describe("Chat/canal Telegram source."),
    messageId: z.number().int().describe("ID du message vidéo à reposter."),
    description: z.string().optional().describe("Description personnalisée pour Facebook."),
    title: z.string().optional().describe("Titre de la vidéo sur Facebook."),
    pageId: z.string().optional().describe("Page Facebook cible (sinon FACEBOOK_PAGE_ID)."),
    pageAccessToken: z.string().optional().describe("Page Access Token spécifique."),
  },
  async ({ chat, messageId, description, title, pageId, pageAccessToken }) => {
    try {
      const { path, video } = await downloadVideo(chat, messageId);
      const result = await postVideoToPage({
        filePath: path,
        description: description ?? video.caption,
        title,
        pageId,
        pageAccessToken,
      });
      return ok({ downloaded: path, telegramCaption: video.caption, facebook: result });
    } catch (e) {
      return fail(e);
    }
  }
);

return server;
}

/* ============================ Démarrage ============================ */

import { createServer as createHttpServer, IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

type HttpSession = {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
};

// IMPORTANT: the MCP SDK Protocol allows only one transport per Protocol/McpServer
// instance. HTTP therefore uses one McpServer + one transport PER MCP SESSION.
// Never reuse the same McpServer across sessions.
const sessions = new Map<string, HttpSession>();

async function readBody(req: IncomingMessage): Promise<Record<string, unknown> | undefined> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return undefined;
  const contentType = String(req.headers["content-type"] ?? "");
  if (contentType.includes("application/x-www-form-urlencoded")) {
    return Object.fromEntries(new URLSearchParams(raw));
  }
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error("JSON MCP invalide");
  }
}

function authFailure(res: ServerResponse, error: string, description: string, status = 401): void {
  if (res.headersSent) return;
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "access-control-expose-headers": "Mcp-Session-Id, WWW-Authenticate",
    "www-authenticate": oauthChallenge(error, description),
  });
  res.end(JSON.stringify({ error, error_description: description }));
}

function writeJson(res: ServerResponse, status: number, payload: unknown): void {
  if (res.headersSent) return;
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "access-control-expose-headers": "Mcp-Session-Id",
  });
  res.end(JSON.stringify(payload));
}

async function closeSession(id: string, session: HttpSession): Promise<void> {
  if (sessions.get(id) === session) sessions.delete(id);
  try {
    await session.transport.close();
  } catch (error) {
    console.error("MCP transport close error:", error);
  }
  try {
    await session.server.close();
  } catch (error) {
    console.error("MCP server close error:", error);
  }
}

async function handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
      "access-control-allow-headers": "Content-Type, Accept, Mcp-Session-Id, Last-Event-ID",
      "access-control-expose-headers": "Mcp-Session-Id",
    });
    res.end();
    return;
  }

  // OAuth discovery is intentionally public so ChatGPT can discover the authorization server.
  if (req.method === "GET" && url.pathname === "/.well-known/oauth-protected-resource") {
    writeJson(res, 200, oauthProtectedResourceMetadata());
    return;
  }

  if (req.method === "GET" && url.pathname === "/.well-known/oauth-authorization-server") {
    writeJson(res, 200, oauthAuthorizationServerMetadata());
    return;
  }

  if (req.method === "GET" && url.pathname === "/oauth/authorize") {
    if (!oauthConfigPresent()) {
      writeJson(res, 503, { error: "server_error", error_description: "OAuth is not configured on this server." });
      return;
    }
    const clientId = url.searchParams.get("client_id") ?? "";
    const redirectUri = url.searchParams.get("redirect_uri") ?? "";
    const responseType = url.searchParams.get("response_type") ?? "";
    const codeChallenge = url.searchParams.get("code_challenge") ?? "";
    const scope = url.searchParams.get("scope") ?? "mcp";
    const resource = url.searchParams.get("resource") ?? "";
    const state = url.searchParams.get("state") ?? "";
    if (responseType !== "code" || !clientId || !redirectUri || !codeChallenge || resource !== (process.env.MCP_PUBLIC_URL || `https://${req.headers.host ?? ""}`).replace(/\/$/, "")) {
      writeJson(res, 400, { error: "invalid_request", error_description: "Paramètres OAuth invalides ou resource manquant." });
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(loginPage({ clientId, redirectUri, codeChallenge, scope, resource, state }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/oauth/authorize") {
    const body = await readBody(req) ?? {};
    const username = String(body.username ?? "");
    const password = String(body.password ?? "");
    const clientId = String(body.client_id ?? "");
    const redirectUri = String(body.redirect_uri ?? "");
    const codeChallenge = String(body.code_challenge ?? "");
    const scope = String(body.scope ?? "mcp");
    const resource = String(body.resource ?? "");
    const state = String(body.state ?? "");
    if (!isValidLogin(username, password)) {
      writeJson(res, 401, { error: "access_denied", error_description: "Identifiants invalides." });
      return;
    }
    try {
      const code = createAuthorizationCode({ clientId, redirectUri, codeChallenge, scope, resource });
      const redirect = new URL(redirectUri);
      redirect.searchParams.set("code", code);
      if (state) redirect.searchParams.set("state", state);
      res.writeHead(302, { Location: redirect.toString(), "cache-control": "no-store" });
      res.end();
    } catch (error) {
      writeJson(res, 400, { error: "invalid_request", error_description: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/oauth/token") {
    const body = await readBody(req) ?? {};
    const grantType = String(body.grant_type ?? "");
    const code = String(body.code ?? "");
    const clientId = String(body.client_id ?? "");
    const redirectUri = String(body.redirect_uri ?? "");
    const codeVerifier = String(body.code_verifier ?? "");
    const resource = String(body.resource ?? "");
    if (grantType !== "authorization_code") {
      writeJson(res, 400, { error: "unsupported_grant_type" });
      return;
    }
    try {
      const token = exchangeAuthorizationCode({ code, clientId, redirectUri, codeVerifier, resource });
      writeJson(res, 200, token);
    } catch (error) {
      writeJson(res, 400, { error: "invalid_grant", error_description: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  if (url.pathname === "/health") {
    writeJson(res, 200, {
      ok: true,
      service: "mcp-telegram-facebook",
      transport: "streamable-http",
      sessions: sessions.size,
    });
    return;
  }

  if (url.pathname !== "/mcp") {
    writeJson(res, 404, { error: "Not Found" });
    return;
  }

  if (!oauthConfigPresent()) {
    authFailure(res, "invalid_token", "OAuth is not configured. Set OAUTH_JWT_SECRET, MCP_AUTH_USERNAME and MCP_AUTH_PASSWORD.");
    return;
  }

  const token = bearerToken({ headers: req.headers });
  if (!token) {
    authFailure(res, "invalid_token", "Authentication required.");
    return;
  }
  try {
    verifyAccessToken(token, ["mcp"]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "insufficient_scope") {
      authFailure(res, "insufficient_scope", "The mcp scope is required.", 403);
    } else {
      authFailure(res, "invalid_token", "The access token is invalid or expired.");
    }
    return;
  }

  const sessionIdHeader = req.headers["mcp-session-id"];
  const sessionId = Array.isArray(sessionIdHeader) ? sessionIdHeader[0] : sessionIdHeader;
  const body = req.method === "POST" ? await readBody(req) : undefined;

  // Existing session: reuse EXACTLY the transport/server pair that belongs to it.
  if (sessionId) {
    const session = sessions.get(sessionId);
    if (!session) {
      writeJson(res, 404, {
        jsonrpc: "2.0",
        error: { code: -32001, message: "MCP session not found" },
        id: null,
      });
      return;
    }

    if (req.method === "DELETE") {
      await closeSession(sessionId, session);
      res.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-expose-headers": "Mcp-Session-Id",
      });
      res.end();
      return;
    }

    await session.transport.handleRequest(req, res, body);
    return;
  }

  // A new HTTP MCP session MUST start with initialize. Build a fresh
  // McpServer/Protocol and a fresh transport for this session.
  if (req.method !== "POST" || !isInitializeRequest(body)) {
    writeJson(res, 400, {
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Bad Request: initialize is required to create an MCP session",
      },
      id: null,
    });
    return;
  }

  const server = createServer();
  let session!: HttpSession;

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    // Railway/ChatGPT works well with direct JSON responses and does not
    // require a long-lived SSE response for ordinary tool calls.
    enableJsonResponse: true,
    onsessioninitialized: (id) => {
      sessions.set(id, session);
      console.error(`MCP session initialized: ${id}`);
    },
  });

  session = { transport, server };

  transport.onclose = () => {
    const id = transport.sessionId;
    if (id) {
      const current = sessions.get(id);
      if (current === session) sessions.delete(id);
      console.error(`MCP session closed: ${id}`);
    }
  };

  transport.onerror = (error) => {
    console.error("MCP transport error:", error);
  };

  // CRITICAL: this server instance is created above solely for this transport.
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}

async function main() {
  const mode = (process.env.MCP_TRANSPORT ?? "stdio").toLowerCase();
  if (mode === "http" || mode === "streamable-http" || process.env.RAILWAY_ENVIRONMENT) {
    const port = Number(process.env.PORT ?? 3000);
    const httpServer = createHttpServer((req, res) => {
      handleHttp(req, res).catch((err) => {
        console.error("HTTP MCP error:", err);
        if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" });
        if (!res.writableEnded) res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
      });
    });
    httpServer.listen(port, "0.0.0.0", () => console.error(`MCP HTTP listening on 0.0.0.0:${port}`));
    return;
  }
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Serveur MCP telegram-facebook démarré (stdio).");
}

main().catch((err) => {
  console.error("Erreur fatale au démarrage:", err);
  process.exit(1);
});
