/**
 * Script de connexion Telegram interactif — à lancer UNE SEULE FOIS :
 *
 *     npm run build && npm run telegram:login
 *
 * Il demande votre numéro de téléphone + le code reçu (et le mot de passe 2FA
 * si activé), puis affiche une chaîne de session à coller dans TELEGRAM_SESSION
 * (fichier .env). Le serveur MCP réutilisera cette session sans reconnexion.
 */
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { config } from "../config.js";

async function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout });
  const answer = await rl.question(question);
  rl.close();
  return answer.trim();
}

async function main() {
  if (!config.telegram.apiId || !config.telegram.apiHash) {
    console.error(
      "❌ TELEGRAM_API_ID et TELEGRAM_API_HASH manquants dans .env " +
        "(à récupérer sur https://my.telegram.org)."
    );
    process.exit(1);
  }

  const client = new TelegramClient(
    new StringSession(config.telegram.session),
    config.telegram.apiId,
    config.telegram.apiHash,
    { connectionRetries: 5 }
  );

  await client.start({
    phoneNumber: async () => prompt("📱 Numéro de téléphone (format international, ex +33...) : "),
    password: async () => prompt("🔒 Mot de passe 2FA (laisser vide si non activé) : "),
    phoneCode: async () => prompt("💬 Code reçu par Telegram : "),
    onError: (err) => console.error("Erreur de connexion:", err),
  });

  const session = (client.session as StringSession).save();
  console.log("\n✅ Connexion réussie !\n");
  console.log("Copiez cette valeur dans votre fichier .env :\n");
  console.log(`TELEGRAM_SESSION=${session}\n`);

  await client.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error("Échec:", err);
  process.exit(1);
});
