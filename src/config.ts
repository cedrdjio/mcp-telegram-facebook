import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";

loadEnv();

/**
 * Configuration centralisée, lue depuis les variables d'environnement.
 * Les valeurs manquantes ne font pas planter le serveur au démarrage :
 * chaque outil vérifie ses prérequis au moment de l'appel et renvoie un
 * message d'erreur clair. Cela permet, par exemple, d'utiliser uniquement
 * la partie Facebook sans avoir configuré Telegram.
 */
export const config = {
  telegram: {
    apiId: process.env.TELEGRAM_API_ID ? Number(process.env.TELEGRAM_API_ID) : undefined,
    apiHash: process.env.TELEGRAM_API_HASH ?? "",
    session: process.env.TELEGRAM_SESSION ?? "",
  },
  facebook: {
    accessToken: process.env.FACEBOOK_ACCESS_TOKEN ?? "",
    pageId: process.env.FACEBOOK_PAGE_ID ?? "",
    graphVersion: process.env.FACEBOOK_GRAPH_VERSION ?? "v21.0",
  },
  downloadDir: resolve(process.env.DOWNLOAD_DIR ?? "./downloads"),
};

export function requireTelegram(): void {
  if (!config.telegram.apiId || !config.telegram.apiHash) {
    throw new Error(
      "Telegram n'est pas configuré. Définissez TELEGRAM_API_ID et TELEGRAM_API_HASH dans le fichier .env " +
        "(voir https://my.telegram.org), puis générez une session avec `npm run telegram:login`."
    );
  }
}

export function requireFacebook(): void {
  if (!config.facebook.accessToken) {
    throw new Error(
      "Facebook n'est pas configuré. Définissez FACEBOOK_ACCESS_TOKEN dans le fichier .env " +
        "(https://developers.facebook.com/tools/explorer)."
    );
  }
}
