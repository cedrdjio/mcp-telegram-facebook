import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { config, requireTelegram } from "./config.js";

let client: TelegramClient | null = null;

/**
 * Retourne un client Telegram connecté (singleton).
 * Utilise la session stockée dans TELEGRAM_SESSION : aucune interaction
 * n'est requise au runtime du MCP (la connexion interactive se fait une
 * seule fois via `npm run telegram:login`).
 */
export async function getTelegramClient(): Promise<TelegramClient> {
  requireTelegram();

  if (client && client.connected) return client;

  const session = new StringSession(config.telegram.session);
  client = new TelegramClient(session, config.telegram.apiId!, config.telegram.apiHash, {
    connectionRetries: 5,
  });

  await client.connect();

  if (!(await client.checkAuthorization())) {
    throw new Error(
      "Session Telegram invalide ou expirée. Régénérez-la avec `npm run telegram:login` " +
        "et copiez la nouvelle valeur dans TELEGRAM_SESSION."
    );
  }

  return client;
}

export interface TelegramVideo {
  messageId: number;
  chatId: string;
  date: string;
  caption: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  durationSeconds: number | null;
}

/** Extrait les métadonnées d'un message contenant une vidéo, ou null. */
function extractVideo(message: Api.Message, chatId: string): TelegramVideo | null {
  const media = message.media;
  if (!(media instanceof Api.MessageMediaDocument)) return null;

  const doc = media.document;
  if (!(doc instanceof Api.Document)) return null;

  const videoAttr = doc.attributes.find(
    (a): a is Api.DocumentAttributeVideo => a instanceof Api.DocumentAttributeVideo
  );
  const isVideoMime = doc.mimeType?.startsWith("video/");
  if (!videoAttr && !isVideoMime) return null;

  const fileNameAttr = doc.attributes.find(
    (a): a is Api.DocumentAttributeFilename => a instanceof Api.DocumentAttributeFilename
  );

  return {
    messageId: message.id,
    chatId,
    date: new Date(message.date * 1000).toISOString(),
    caption: message.message ?? "",
    fileName: fileNameAttr?.fileName ?? `video_${message.id}.mp4`,
    mimeType: doc.mimeType ?? "video/mp4",
    sizeBytes: Number(doc.size ?? 0),
    durationSeconds: videoAttr ? videoAttr.duration : null,
  };
}

/**
 * Liste les vidéos récentes d'un chat/canal Telegram.
 * @param chat identifiant du chat : @username, id numérique, ou lien t.me.
 * @param limit nombre de messages à examiner.
 */
export async function listVideos(chat: string, limit = 20): Promise<TelegramVideo[]> {
  const tg = await getTelegramClient();
  const entity = await tg.getEntity(chat);
  const chatId = String((entity as { id?: unknown }).id ?? chat);

  const messages = await tg.getMessages(entity, { limit });
  const videos: TelegramVideo[] = [];
  for (const message of messages) {
    const video = extractVideo(message, chatId);
    if (video) videos.push(video);
  }
  return videos;
}

/**
 * Télécharge une vidéo Telegram sur le disque local.
 * @returns le chemin absolu du fichier téléchargé.
 */
export async function downloadVideo(chat: string, messageId: number): Promise<{
  path: string;
  video: TelegramVideo;
}> {
  const tg = await getTelegramClient();
  const entity = await tg.getEntity(chat);
  const chatId = String((entity as { id?: unknown }).id ?? chat);

  const messages = await tg.getMessages(entity, { ids: [messageId] });
  const message = messages[0];
  if (!message) throw new Error(`Message ${messageId} introuvable dans ${chat}.`);

  const video = extractVideo(message, chatId);
  if (!video) throw new Error(`Le message ${messageId} ne contient pas de vidéo.`);

  await mkdir(config.downloadDir, { recursive: true });
  const outPath = join(config.downloadDir, `${chatId}_${messageId}_${video.fileName}`);

  const buffer = await tg.downloadMedia(message, {});
  if (!buffer) throw new Error("Le téléchargement de la vidéo a échoué (contenu vide).");

  const { writeFile } = await import("node:fs/promises");
  await writeFile(outPath, buffer as Buffer);

  return { path: outPath, video };
}
