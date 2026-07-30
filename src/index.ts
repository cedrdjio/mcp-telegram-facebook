#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { listVideos, downloadVideo } from "./telegram.js";
import {
  listPages,
  getPageInsights,
  postVideoToPage,
  postToPageFeed,
} from "./facebook.js";

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
      return ok(await listVideos(chat, limit));
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

/* ============================ Démarrage ============================ */

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Les logs vont sur stderr pour ne pas polluer le canal stdio (protocole MCP).
  console.error("Serveur MCP telegram-facebook démarré (stdio).");
}

main().catch((err) => {
  console.error("Erreur fatale au démarrage:", err);
  process.exit(1);
});
