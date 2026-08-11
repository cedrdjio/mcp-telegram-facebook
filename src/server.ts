import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { listVideos, downloadVideo } from "./telegram.js";
import { extractFrames } from "./media.js";
import {
  listPages,
  getPageInsights,
  postVideoToPage,
  postToPageFeed,
  listPagePosts,
  listPageVideos,
  listPostComments,
  postComment,
  pinComment,
  updateComment,
  deleteComment,
  updateVideoDescription,
  deletePost,
  getVideoPostInfo,
} from "./facebook.js";

/** Enveloppe une valeur en réponse MCP JSON lisible + gère les erreurs. */
function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}
function fail(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: "text" as const, text: `❌ ${message}` }], isError: true };
}

/**
 * Construit et retourne un serveur MCP entièrement configuré (tous les outils).
 * Utilisé indifféremment par le transport stdio (Desktop) et HTTP (web).
 */
export function createServer(): McpServer {
  const server = new McpServer({ name: "mcp-telegram-facebook", version: "0.1.0" });

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

  server.tool(
    "telegram_video_frames",
    "Extrait des images réparties dans une vidéo Telegram et les retourne comme " +
      "images visibles. À utiliser AVANT d'écrire une description : permet de voir " +
      "réellement le contenu de la vidéo (texte à l'écran, sujet, scènes) au lieu de " +
      "rédiger à l'aveugle. La vidéo est mise en cache pour la publication qui suivra.",
    {
      chat: z.string().describe("Chat/canal Telegram source."),
      messageId: z.number().int().describe("ID du message contenant la vidéo."),
      count: z
        .number()
        .int()
        .min(1)
        .max(12)
        .default(6)
        .describe("Nombre d'images à extraire, réparties sur toute la durée."),
      width: z.number().int().min(160).max(960).default(420).describe("Largeur des images en pixels."),
    },
    async ({ chat, messageId, count, width }) => {
      try {
        const { path, video } = await downloadVideo(chat, messageId);
        const frames = await extractFrames({
          filePath: path,
          count,
          width,
          durationSeconds: video.durationSeconds ?? undefined,
        });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  messageId: video.messageId,
                  filePath: path,
                  durationSeconds: video.durationSeconds,
                  telegramCaption: video.caption,
                  frameCount: frames.length,
                  frameTimestamps: frames.map((f) => Number(f.atSeconds.toFixed(1))),
                },
                null,
                2
              ),
            },
            ...frames.map((frame) => ({
              type: "image" as const,
              data: frame.base64,
              mimeType: "image/jpeg",
            })),
          ],
        };
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
      filePath: z
        .string()
        .describe("Chemin local de la vidéo (résultat de telegram_download_video)."),
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
      pageAccessToken: z
        .string()
        .optional()
        .describe("Page Access Token spécifique (sinon FACEBOOK_ACCESS_TOKEN)."),
    },
    async ({ pageId, metrics, period, pageAccessToken }) => {
      try {
        return ok(await getPageInsights(pageId, metrics, period, pageAccessToken));
      } catch (e) {
        return fail(e);
      }
    }
  );

  /* ================= Facebook — publications & commentaires ================= */

  server.tool(
    "facebook_list_posts",
    "Liste les publications d'une Page (message, date, permalien, nombre de commentaires). " +
      "Utile pour voir ce qui est déjà en ligne et récupérer les postId à commenter.",
    {
      pageId: z.string().optional().describe("ID de la Page (sinon FACEBOOK_PAGE_ID)."),
      limit: z.number().int().min(1).max(100).default(25).describe("Nombre de publications."),
      pageAccessToken: z.string().optional().describe("Page Access Token spécifique."),
    },
    async (args) => {
      try {
        return ok(await listPagePosts(args));
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.tool(
    "facebook_list_videos",
    "Liste les vidéos publiées sur une Page, avec leur titre, description, permalien " +
      "et le `post_id` correspondant (nécessaire pour commenter).",
    {
      pageId: z.string().optional().describe("ID de la Page (sinon FACEBOOK_PAGE_ID)."),
      limit: z.number().int().min(1).max(100).default(25).describe("Nombre de vidéos."),
      pageAccessToken: z.string().optional().describe("Page Access Token spécifique."),
    },
    async (args) => {
      try {
        return ok(await listPageVideos(args));
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.tool(
    "facebook_list_comments",
    "Liste les commentaires d'une publication.",
    {
      postId: z.string().describe("ID de la publication (ou d'un commentaire, pour ses réponses)."),
      limit: z.number().int().min(1).max(100).default(25).describe("Nombre de commentaires."),
      pageAccessToken: z.string().optional().describe("Page Access Token spécifique."),
    },
    async (args) => {
      try {
        return ok(await listPostComments(args));
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.tool(
    "facebook_post_comment",
    "Publie un commentaire sous une publication de la Page — au nom de la Page. " +
      "Sert à placer une offre, un appel à l'action ou un lien directement visible " +
      "dans l'espace commentaire. Peut aussi répondre à un commentaire existant en " +
      "passant son ID comme `postId`.",
    {
      postId: z.string().describe("ID de la publication à commenter."),
      message: z.string().describe("Texte du commentaire."),
      pin: z
        .boolean()
        .default(false)
        .describe("Tenter d'épingler le commentaire en haut du fil après publication."),
      pageAccessToken: z.string().optional().describe("Page Access Token spécifique."),
    },
    async ({ postId, message, pin, pageAccessToken }) => {
      try {
        const comment = (await postComment({ postId, message, pageAccessToken })) as {
          id?: string;
        };
        if (!pin || !comment.id) return ok({ comment, pinned: false });

        // Le commentaire est publié : un échec d'épinglage ne doit pas faire
        // échouer l'appel, il est simplement signalé.
        try {
          await pinComment({ commentId: comment.id, pinned: true, pageAccessToken });
          return ok({ comment, pinned: true });
        } catch (e) {
          return ok({
            comment,
            pinned: false,
            pinError: e instanceof Error ? e.message : String(e),
            note: "Commentaire publié, mais l'épinglage a été refusé par Facebook. Il peut être épinglé à la main depuis la Page.",
          });
        }
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.tool(
    "facebook_pin_comment",
    "Épingle (ou désépingle) un commentaire en haut du fil d'une publication.",
    {
      commentId: z.string().describe("ID du commentaire."),
      pinned: z.boolean().default(true).describe("true pour épingler, false pour désépingler."),
      pageAccessToken: z.string().optional().describe("Page Access Token spécifique."),
    },
    async (args) => {
      try {
        return ok(await pinComment(args));
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.tool(
    "facebook_update_comment",
    "Modifie le texte d'un commentaire déjà publié.",
    {
      commentId: z.string().describe("ID du commentaire."),
      message: z.string().describe("Nouveau texte."),
      pageAccessToken: z.string().optional().describe("Page Access Token spécifique."),
    },
    async (args) => {
      try {
        return ok(await updateComment(args));
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.tool(
    "facebook_delete_comment",
    "Supprime un commentaire.",
    {
      commentId: z.string().describe("ID du commentaire."),
      pageAccessToken: z.string().optional().describe("Page Access Token spécifique."),
    },
    async (args) => {
      try {
        return ok(await deleteComment(args));
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.tool(
    "facebook_update_video",
    "Réécrit la description (et le titre) d'une vidéo déjà publiée, sans la supprimer : " +
      "les vues, commentaires et partages déjà accumulés sont conservés. " +
      "À préférer à une republication quand seule la légende est à corriger.",
    {
      videoId: z.string().describe("ID de la vidéo (via facebook_list_videos)."),
      description: z.string().describe("Nouvelle description."),
      title: z.string().optional().describe("Nouveau titre."),
      pageAccessToken: z.string().optional().describe("Page Access Token spécifique."),
    },
    async (args) => {
      try {
        return ok(await updateVideoDescription(args));
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.tool(
    "facebook_delete_post",
    "Supprime définitivement une publication ou une vidéo de la Page. Irréversible.",
    {
      postId: z.string().describe("ID de la publication ou de la vidéo à supprimer."),
      pageAccessToken: z.string().optional().describe("Page Access Token spécifique."),
    },
    async (args) => {
      try {
        return ok(await deletePost(args));
      } catch (e) {
        return fail(e);
      }
    }
  );

  /* ==================== Workflow combiné ==================== */

  server.tool(
    "repost_telegram_to_facebook",
    "Workflow complet : télécharge une vidéo Telegram, la republie sur une Page Facebook " +
      "avec une description personnalisée, et y ajoute optionnellement un commentaire " +
      "(épinglé si possible). Combine download + post + commentaire en un seul appel.",
    {
      chat: z.string().describe("Chat/canal Telegram source."),
      messageId: z.number().int().describe("ID du message vidéo à reposter."),
      description: z.string().optional().describe("Description personnalisée pour Facebook."),
      title: z.string().optional().describe("Titre de la vidéo sur Facebook."),
      comment: z
        .string()
        .optional()
        .describe("Commentaire à publier sous la vidéo juste après la mise en ligne."),
      pinComment: z
        .boolean()
        .default(true)
        .describe("Tenter d'épingler ce commentaire en haut du fil."),
      pageId: z.string().optional().describe("Page Facebook cible (sinon FACEBOOK_PAGE_ID)."),
      pageAccessToken: z.string().optional().describe("Page Access Token spécifique."),
    },
    async (args) => {
      try {
        const { path, video } = await downloadVideo(args.chat, args.messageId);
        const posted = (await postVideoToPage({
          filePath: path,
          description: args.description ?? video.caption,
          title: args.title,
          pageId: args.pageId,
          pageAccessToken: args.pageAccessToken,
        })) as { id?: string };

        const result: Record<string, unknown> = {
          downloaded: path,
          telegramCaption: video.caption,
          facebook: posted,
        };

        if (!posted.id) return ok(result);

        // Permalien : pratique pour vérifier la publication d'un coup d'œil.
        result.postInfo = await getVideoPostInfo({
          videoId: posted.id,
          pageAccessToken: args.pageAccessToken,
        }).catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));

        if (!args.comment) return ok(result);

        // La vidéo est en ligne : un échec sur le commentaire est signalé mais
        // ne fait pas échouer la publication elle-même.
        try {
          const comment = (await postComment({
            postId: posted.id,
            message: args.comment,
            pageAccessToken: args.pageAccessToken,
          })) as { id?: string };
          result.comment = comment;

          if (args.pinComment && comment.id) {
            try {
              await pinComment({
                commentId: comment.id,
                pinned: true,
                pageAccessToken: args.pageAccessToken,
              });
              result.commentPinned = true;
            } catch (e) {
              result.commentPinned = false;
              result.pinError = e instanceof Error ? e.message : String(e);
            }
          }
        } catch (e) {
          result.commentError = e instanceof Error ? e.message : String(e);
        }

        return ok(result);
      } catch (e) {
        return fail(e);
      }
    }
  );

  return server;
}
