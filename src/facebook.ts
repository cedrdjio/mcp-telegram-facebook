import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
import { config, requireFacebook } from "./config.js";

const GRAPH_BASE = () => `https://graph.facebook.com/${config.facebook.graphVersion}`;

interface GraphError {
  error?: { message?: string; type?: string; code?: number; error_subcode?: number };
}

async function graphRequest<T = unknown>(
  path: string,
  options: {
    method?: "GET" | "POST" | "DELETE";
    params?: Record<string, string | number | boolean | undefined>;
    accessToken?: string;
  } = {}
): Promise<T> {
  requireFacebook();
  const url = new URL(`${GRAPH_BASE()}/${path.replace(/^\//, "")}`);

  // access_token toujours en query pour rester compatible GET/POST.
  url.searchParams.set("access_token", options.accessToken || config.facebook.accessToken);
  for (const [key, value] of Object.entries(options.params ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  const res = await fetch(url, {
    method: options.method ?? "GET",
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
    params: { fields: "id,name,category,access_token,tasks" },
  });
}

export async function getPageInsights(
  pageId: string,
  metrics: string,
  period = "day",
  pageAccessToken?: string
): Promise<unknown> {
  return graphRequest(`${pageId}/insights`, {
    params: { metric: metrics, period },
    accessToken: pageAccessToken,
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
  url.searchParams.set("access_token", token);

  const res = await fetch(url, { method: "POST", body: form });
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
  url.searchParams.set("access_token", token);
  url.searchParams.set("message", args.message);
  if (args.link) url.searchParams.set("link", args.link);

  const res = await fetch(url, { method: "POST" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Échec du post (${res.status}): ${(data as GraphError).error?.message ?? ""}`);
  }
  return data;
}
