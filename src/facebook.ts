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

/** Liste les vidéos/Reels publiés sur une Page. */
export async function listPageVideos(args: {
  pageId?: string;
  limit?: number;
  pageAccessToken?: string;
} = {}): Promise<unknown> {
  const pageId = args.pageId || config.facebook.pageId;
  if (!pageId) throw new Error("Aucune Page cible : passez `pageId` ou définissez FACEBOOK_PAGE_ID dans le .env.");
  const token = args.pageAccessToken || config.facebook.accessToken;
  return graphRequest(`${pageId}/videos`, {
    accessToken: token,
    params: {
      fields: "id,title,description,created_time,permalink_url,length,post_id",
      limit: args.limit ?? 25,
    },
  });
}

/** Modifie la description d’une vidéo/Reel existant.
 *
 * Facebook expose parfois le Reel via son videoId et parfois via le post_id.
 * On tente d’abord l’objet vidéo. Si Facebook refuse cet objet avec une erreur
 * de permission et qu’un postId est fourni, on tente alors la publication liée.
 */
export async function updateVideo(args: {
  videoId: string;
  description: string;
  title?: string;
  postId?: string;
  pageAccessToken?: string;
}): Promise<unknown> {
  const token = args.pageAccessToken || config.facebook.accessToken;

  async function updateObject(objectId: string, params: Record<string, string>) {
    return graphRequest(objectId, {
      method: "POST",
      accessToken: token,
      params,
    });
  }

  try {
    return await updateObject(args.videoId, {
      description: args.description,
      ...(args.title !== undefined ? { title: args.title } : {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const permissionError = /\b403\b|code 200|permission/i.test(message);

    if (!args.postId || !permissionError || args.postId === args.videoId) {
      throw error;
    }

    // Pour certains Reels, la légende est modifiable sur le post associé.
    return updateObject(args.postId, { message: args.description });
  }
}

/** Publie un commentaire sur une publication ou un Reel. */
export async function postComment(args: {
  postId: string;
  message: string;
  pin?: boolean;
  pageAccessToken?: string;
}): Promise<unknown> {
  const token = args.pageAccessToken || config.facebook.accessToken;
  const result = await graphRequest<{ id?: string }>(`${args.postId}/comments`, {
    method: "POST",
    accessToken: token,
    params: { message: args.message },
  });
  if (args.pin && result && typeof result === "object" && "id" in result && result.id) {
    try {
      await pinComment({ commentId: result.id, pinned: true, pageAccessToken: token });
    } catch (error) {
      return { comment: result, pinError: error instanceof Error ? error.message : String(error) };
    }
  }
  return result;
}

/** Épingle ou désépingle un commentaire. */
export async function pinComment(args: {
  commentId: string;
  pinned?: boolean;
  pageAccessToken?: string;
}): Promise<unknown> {
  const token = args.pageAccessToken || config.facebook.accessToken;
  const url = new URL(`${GRAPH_BASE()}/${args.commentId}`);
  url.searchParams.set("access_token", token);
  url.searchParams.set("is_pinned", String(args.pinned ?? true));
  const res = await fetch(url, { method: "POST" });
  const text = await res.text();
  let data: unknown;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) {
    const err = (data as GraphError).error;
    throw new Error(`Échec de l'épinglage du commentaire (${res.status})${err?.code ? ` [code ${err.code}]` : ""}: ${err?.message ?? text}`);
  }
  return data;
}

/** Liste les commentaires d'une publication ou d'un Reel. */
export async function listComments(args: {
  postId: string;
  limit?: number;
  pageAccessToken?: string;
}): Promise<unknown> {
  return graphRequest(`${args.postId}/comments`, {
    accessToken: args.pageAccessToken || config.facebook.accessToken,
    params: { fields: "id,message,from,created_time,is_hidden", limit: args.limit ?? 25 },
  });
}
