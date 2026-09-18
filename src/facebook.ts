import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
import { config, requireFacebook } from "./config.js";

const GRAPH_BASE = () => `https://graph.facebook.com/${config.facebook.graphVersion}`;

interface GraphError {
  error?: { message?: string; type?: string; code?: number; error_subcode?: number };
}

type GraphPaginationResponse<T = unknown> = {
  data?: T[];
  paging?: { next?: string; previous?: string };
  error?: { message?: string; type?: string; code?: number; error_subcode?: number };
};

async function graphRequest<T = unknown>(
  path: string,
  options: {
    method?: UniversalMethod;
    params?: Record<string, string | number | boolean | undefined>;
  } = {}
): Promise<T> {
  requireFacebook();
  const method = options.method ?? "GET";
  const url = new URL(`${GRAPH_BASE()}/${path.replace(/^\//, "")}`);
  const params = Object.entries(options.params ?? {}).filter(([, value]) => value !== undefined);
  const headers: Record<string, string> = { Accept: "application/json" };
  let body: URLSearchParams | undefined;

  if (method === "GET") {
    for (const [key, value] of params) url.searchParams.set(key, String(value));
  } else {
    body = new URLSearchParams();
    for (const [key, value] of params) body.set(key, String(value));
    headers["Content-Type"] = "application/x-www-form-urlencoded";
  }
  headers.Authorization = `Bearer ${config.facebook.accessToken}`;

  const res = await fetch(url, { method, headers, body });

  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    const err = (data as GraphError).error;
    throw new Error(
      `Erreur Graph API (${res.status})${err?.code ? ` [code ${err.code}]` : ""}: ` +
        `${err?.message ?? text}`
    );
  }
  return data as T;
}

/* ----------------------------- Pages ----------------------------- */

export async function listPages(): Promise<unknown> {
  return graphRequest("me/accounts", {
    params: { fields: "id,name,category,tasks" },
  });
}

export async function getPageInsights(pageId: string, metrics: string, period = "day"): Promise<unknown> {
  return graphRequest(`${pageId}/insights`, {
    params: { metric: metrics, period },
  });
}

/**
 * Publie une vidéo locale sur une Page Facebook, avec description personnalisée.
 * Utilise l'upload multipart standard (adapté aux vidéos jusqu'à ~1 Go).
 */
export async function postVideoToPage(args: {
  pageId?: string;
  filePath: string;
  description?: string;
  title?: string;
  pageAccessToken?: string;
}): Promise<unknown> {
  requireFacebook();
  const pageId = args.pageId || config.facebook.pageId;
  if (!pageId) {
    throw new Error(
      "Aucune Page cible : passez `pageId` ou définissez FACEBOOK_PAGE_ID dans le .env."
    );
  }

  await stat(args.filePath); // vérifie l'existence, lève une erreur claire sinon
  const fileBuffer = await readFile(args.filePath);
  const blob = new Blob([fileBuffer], { type: "video/mp4" });

  const form = new FormData();
  form.append("source", blob, basename(args.filePath));
  if (args.description) form.append("description", args.description);
  if (args.title) form.append("title", args.title);

  // Une Page doit utiliser son propre Page Access Token pour publier.
  const token = args.pageAccessToken || config.facebook.accessToken;

  const url = new URL(`${GRAPH_BASE()}/${pageId}/videos`);
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const err = (data as GraphError).error;
    throw new Error(`Échec de la publication vidéo (${res.status}): ${err?.message ?? text}`);
  }
  return data;
}

/** Publie un simple post texte (avec lien optionnel) sur une Page. */
export async function postToPageFeed(args: {
  pageId?: string;
  message: string;
  link?: string;
  pageAccessToken?: string;
}): Promise<unknown> {
  const pageId = args.pageId || config.facebook.pageId;
  if (!pageId) throw new Error("Aucune Page cible : passez `pageId` ou définissez FACEBOOK_PAGE_ID.");
  const token = args.pageAccessToken || config.facebook.accessToken;

  const url = new URL(`${GRAPH_BASE()}/${pageId}/feed`);
  const body = new URLSearchParams({ message: args.message });
  if (args.link) body.set("link", args.link);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Échec du post (${res.status}): ${(data as GraphError).error?.message ?? ""}`);
  }
  return data;
}


/* ------------------------- Vidéos / commentaires ------------------------- */
export async function listVideos(pageId?: string, limit = 25): Promise<unknown> {
  const id = pageId || config.facebook.pageId;
  if (!id) throw new Error("Aucune Page cible.");
  return graphRequest(`${id}/videos`, { params: { fields: "id,title,description,created_time,permalink_url,length,post_id,is_published,status", limit } });
}

export async function updateVideo(videoId: string, description: string, title?: string): Promise<unknown> {
  const params: Record<string, string> = { description };
  if (title !== undefined) params.title = title;
  try {
    return await graphRequest(videoId, { method: "POST", params });
  } catch (error) {
    // Certains Reels exposent un post_id différent de l'ID vidéo.
    throw new Error(`Impossible de modifier le Reel ${videoId}. Vérifiez l'ID vidéo/post_id et les droits Page. ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function listComments(postId: string, limit = 25): Promise<unknown> {
  return graphRequest(`${postId}/comments`, { params: { fields: "id,message,from,created_time,is_hidden", limit } });
}

export async function postComment(postId: string, message: string): Promise<unknown> {
  return graphRequest(`${postId}/comments`, { method: "POST", params: { message } });
}

export async function pinComment(commentId: string, pinned = true): Promise<unknown> {
  return graphRequest(commentId, { method: "POST", params: { is_pinned: pinned } });
}

export async function checkVideoVisibility(videoId: string): Promise<unknown> {
  return graphRequest(videoId, { params: { fields: "id,title,description,permalink_url,is_published,status,privacy,created_time,post_id" } });
}


/* ------------------------- Generic Graph + Marketing API ------------------------- */
export async function graphApiRequest(args: {
  path: string;
  method?: UniversalMethod;
  params?: Record<string, string | number | boolean | object | null | undefined>;
  accessToken?: string;
}): Promise<unknown> {
  requireFacebook();
  const method = args.method ?? "GET";
  const url = new URL(`${GRAPH_BASE()}/${args.path.replace(/^\//, "")}`);
  const token = args.accessToken || config.facebook.accessToken;
  const params = Object.entries(args.params ?? {}).filter(([, v]) => v !== undefined && v !== null);
  const headers: Record<string, string> = { Accept: "application/json", Authorization: `Bearer ${token}` };
  let body: URLSearchParams | undefined;
  if (method === "GET") {
    for (const [key, value] of params) url.searchParams.set(key, typeof value === "object" ? JSON.stringify(value) : String(value));
  } else {
    body = new URLSearchParams();
    for (const [key, value] of params) body.set(key, typeof value === "object" ? JSON.stringify(value) : String(value));
    headers["Content-Type"] = "application/x-www-form-urlencoded";
  }
  const res = await fetch(url, { method, headers, body });
  const text = await res.text();
  let data: unknown;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) {
    const err = (data as GraphError).error;
    throw new Error(`Graph API ${res.status}${err?.code ? ` [${err.code}]` : ""}: ${err?.message ?? text}`);
  }
  return data;
}

export async function getObject(objectId: string, fields?: string): Promise<unknown> {
  return graphApiRequest({ path: objectId, params: { fields } });
}
export async function createObject(path: string, params: Record<string, string | number | boolean | object | null | undefined>): Promise<unknown> {
  return graphApiRequest({ path, method: "POST", params });
}
export async function updateObject(objectId: string, params: Record<string, string | number | boolean | object | null | undefined>): Promise<unknown> {
  return graphApiRequest({ path: objectId, method: "POST", params });
}
export async function deleteObject(objectId: string): Promise<unknown> {
  return graphApiRequest({ path: objectId, method: "DELETE" });
}
export async function listEdge(objectId: string, edge: string, params: Record<string, string | number | boolean | object | null | undefined> = {}): Promise<unknown> {
  return graphApiRequest({ path: `${objectId}/${edge.replace(/^\//, "")}`, params });
}

export async function adsInsights(objectId: string, params: Record<string, string | number | boolean | object | null | undefined> = {}): Promise<unknown> {
  return listEdge(objectId, "insights", params);
}

/* ------------------------- Universal Graph Engine ------------------------- */
export type UniversalMethod = "GET" | "POST" | "DELETE" | "PUT" | "PATCH";
export type UniversalValue = string | number | boolean | object | null;

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const DANGEROUS_KEYS = new Set([
  "budget", "daily_budget", "lifetime_budget", "bid_amount", "status",
  "is_published", "delete", "access_token", "spend_cap", "billing_event"
]);

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k.toLowerCase().includes("token") || k.toLowerCase().includes("secret") ? "[REDACTED]" : k] = redact(v);
    }
    return out;
  }
  return value;
}

export function analyzeGraphRequest(args: {
  method?: UniversalMethod;
  path: string;
  params?: Record<string, UniversalValue | undefined>;
  confirm?: boolean;
  dryRun?: boolean;
}) {
  const method = args.method ?? "GET";
  const params = args.params ?? {};
  const dangerousFields = Object.keys(params).filter((k) => DANGEROUS_KEYS.has(k.toLowerCase()));
  const isWrite = WRITE_METHODS.has(method);
  const dangerous = isWrite && (method === "DELETE" || dangerousFields.length > 0 || /campaign|adset|ad|billing|budget/i.test(args.path));
  return {
    method,
    path: args.path,
    graphVersion: config.facebook.graphVersion,
    isWrite,
    dangerous,
    dangerousFields,
    requiresConfirmation: dangerous && !args.confirm,
    dryRun: Boolean(args.dryRun),
    safeParams: redact(params),
  };
}

async function resolveGraphAccessToken(path: string): Promise<string | undefined> {
  if (config.facebook.accessToken && !/^\d+(?:\/|$)/.test(path)) return undefined;
  const pageId = path.match(/^(\d+)(?:\/|$)/)?.[1];
  if (!pageId || !config.facebook.accessToken) return undefined;
  try {
    const pages = await graphRequest<GraphPaginationResponse<{ id: string; access_token?: string }>>(
      "me/accounts",
      { params: { fields: "id,access_token", limit: 100 } }
    );
    return pages.data?.find((page) => page.id === pageId)?.access_token;
  } catch {
    return undefined;
  }
}

export async function universalGraphRequest(args: {
  method?: UniversalMethod;
  path: string;
  params?: Record<string, UniversalValue | undefined>;
  confirm?: boolean;
  dryRun?: boolean;
  paginate?: boolean;
  maxPages?: number;
  accessToken?: string;
}): Promise<unknown> {
  const analysis = analyzeGraphRequest(args);
  if (analysis.requiresConfirmation) {
    return {
      confirmationRequired: true,
      message: "Cette requête peut modifier, supprimer ou dépenser de l'argent. Relancez avec confirm=true après vérification.",
      analysis,
    };
  }
  if (args.dryRun) return { dryRun: true, analysis };

  const first = await graphApiRequest({
    path: args.path,
    method: args.method,
    params: args.params,
    accessToken: args.accessToken || await resolveGraphAccessToken(args.path),
  });
  if (!args.paginate || !first || typeof first !== "object" || !Array.isArray((first as any).data)) return first;

  const collected = [...(first as any).data];
  let next = (first as any).paging?.next as string | undefined;
  let pages = 1;
  const maxPages = Math.max(1, Math.min(args.maxPages ?? 10, 50));
  const paginationToken = args.accessToken || await resolveGraphAccessToken(args.path) || config.facebook.accessToken;
  while (next && pages < maxPages) {
    const nextUrl = new URL(next);
    nextUrl.searchParams.delete("access_token");
    const response = await fetch(nextUrl, { headers: { Authorization: `Bearer ${paginationToken}` } });
    const data = (await response.json()) as GraphPaginationResponse;
    if (!response.ok || data.error) throw new Error(`Pagination Graph API ${response.status}: ${data.error?.message ?? "Erreur"}`);
    collected.push(...(data.data ?? []));
    next = data.paging?.next;
    pages++;
  }
  return { ...first, data: collected, pagination: { pages, truncated: Boolean(next) } };
}

export async function diagnoseFacebook(): Promise<unknown> {
  const report: Record<string, unknown> = {
    graphVersion: config.facebook.graphVersion,
    pageIdConfigured: Boolean(config.facebook.pageId),
    tokenConfigured: Boolean(config.facebook.accessToken),
  };
  try { report.me = await graphApiRequest({ path: "me", params: { fields: "id,name" } }); }
  catch (e) { report.meError = e instanceof Error ? e.message : String(e); }
  try { report.pages = await listPages(); }
  catch (e) { report.pagesError = e instanceof Error ? e.message : String(e); }
  if (config.facebook.pageId) {
    try { report.page = await graphApiRequest({ path: config.facebook.pageId, params: { fields: "id,name,category" } }); }
    catch (e) { report.pageError = e instanceof Error ? e.message : String(e); }
    try { report.videos = await listVideos(config.facebook.pageId); }
    catch (e) { report.videosError = e instanceof Error ? e.message : String(e); }
  }
  return report;
}
