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

/** Résout la Page cible : argument explicite, sinon FACEBOOK_PAGE_ID. */
function requirePageId(pageId?: string): string {
  const resolved = pageId || config.facebook.pageId;
  if (!resolved) {
    throw new Error(
      "Aucune Page cible : passez `pageId` ou définissez FACEBOOK_PAGE_ID dans le .env."
    );
  }
  return resolved;
}

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

/**
 * Récupère le `post_id` et le permalien d'une vidéo publiée.
 *
 * L'upload sur `/videos` ne renvoie que l'ID de la vidéo ; le `post_id` est
 * l'identifiant de la publication telle qu'elle apparaît dans le fil.
 */
export async function getVideoPostInfo(args: {
  videoId: string;
  pageAccessToken?: string;
}): Promise<{ id: string; post_id?: string; permalink_url?: string }> {
  return graphRequest(`${args.videoId}`, {
    params: { fields: "id,post_id,permalink_url" },
    accessToken: args.pageAccessToken,
  });
}

/* --------------------- Lecture des publications --------------------- */

/**
 * Liste les publications d'une Page (y compris les vidéos), avec leur message,
 * leur date et un lien permanent. Sert à savoir ce qui est déjà en ligne avant
 * de republier, et à récupérer les `postId` nécessaires aux commentaires.
 */
export async function listPagePosts(args: {
  pageId?: string;
  limit?: number;
  pageAccessToken?: string;
}): Promise<unknown> {
  const pageId = requirePageId(args.pageId);
  return graphRequest(`${pageId}/posts`, {
    params: {
      fields:
        "id,created_time,message,permalink_url,status_type,is_published," +
        "attachments{media_type,title,description},comments.summary(true).limit(0)",
      limit: args.limit ?? 25,
    },
    accessToken: args.pageAccessToken,
  });
}

/** Liste les vidéos publiées sur une Page (titre, description, permalien). */
export async function listPageVideos(args: {
  pageId?: string;
  limit?: number;
  pageAccessToken?: string;
}): Promise<unknown> {
  const pageId = requirePageId(args.pageId);
  return graphRequest(`${pageId}/videos`, {
    params: {
      fields: "id,title,description,created_time,permalink_url,length,post_id",
      limit: args.limit ?? 25,
    },
    accessToken: args.pageAccessToken,
  });
}

/** Récupère les commentaires d'une publication. */
export async function listPostComments(args: {
  postId: string;
  limit?: number;
  pageAccessToken?: string;
}): Promise<unknown> {
  return graphRequest(`${args.postId}/comments`, {
    params: {
      fields: "id,message,created_time,from,like_count,comment_count",
      order: "chronological",
      limit: args.limit ?? 25,
    },
    accessToken: args.pageAccessToken,
  });
}

/* ------------------------- Écriture / édition ------------------------- */

/**
 * Publie un commentaire sous une publication (ou en réponse à un commentaire,
 * en passant l'ID du commentaire parent comme `postId`).
 */
export async function postComment(args: {
  postId: string;
  message: string;
  pageAccessToken?: string;
}): Promise<unknown> {
  return graphRequest(`${args.postId}/comments`, {
    method: "POST",
    params: { message: args.message },
    accessToken: args.pageAccessToken,
  });
}

/**
 * Épingle (ou désépingle) un commentaire en haut du fil d'une publication.
 *
 * Note : l'épinglage de commentaire n'est pas disponible sur toutes les Pages ni
 * sur tous les types de publication. Si la Graph API refuse l'opération, l'erreur
 * renvoyée est celle de Facebook — le commentaire reste publié, seul l'épinglage
 * échoue, et il peut alors être épinglé à la main depuis la Page.
 */
export async function pinComment(args: {
  commentId: string;
  pinned?: boolean;
  pageAccessToken?: string;
}): Promise<unknown> {
  return graphRequest(`${args.commentId}`, {
    method: "POST",
    params: { is_pinned: args.pinned ?? true },
    accessToken: args.pageAccessToken,
  });
}

/** Modifie le texte d'un commentaire déjà publié. */
export async function updateComment(args: {
  commentId: string;
  message: string;
  pageAccessToken?: string;
}): Promise<unknown> {
  return graphRequest(`${args.commentId}`, {
    method: "POST",
    params: { message: args.message },
    accessToken: args.pageAccessToken,
  });
}

/** Supprime un commentaire. */
export async function deleteComment(args: {
  commentId: string;
  pageAccessToken?: string;
}): Promise<unknown> {
  return graphRequest(`${args.commentId}`, {
    method: "DELETE",
    accessToken: args.pageAccessToken,
  });
}

/**
 * Réécrit la description d'une vidéo déjà publiée.
 *
 * Permet de corriger une légende sans supprimer la publication : les vues,
 * commentaires et partages déjà accumulés sont conservés.
 */
export async function updateVideoDescription(args: {
  videoId: string;
  description: string;
  title?: string;
  pageAccessToken?: string;
}): Promise<unknown> {
  return graphRequest(`${args.videoId}`, {
    method: "POST",
    params: { description: args.description, title: args.title },
    accessToken: args.pageAccessToken,
  });
}

/** Supprime une publication (ou une vidéo) d'une Page. */
export async function deletePost(args: {
  postId: string;
  pageAccessToken?: string;
}): Promise<unknown> {
  return graphRequest(`${args.postId}`, {
    method: "DELETE",
    accessToken: args.pageAccessToken,
  });
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
