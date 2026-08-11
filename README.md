# mcp-telegram-facebook

Serveur **MCP** (Model Context Protocol) qui permet à Claude de :

- 📥 **Récupérer des vidéos sur Telegram** (canaux, groupes, discussions)
- ✍️ **Ajouter une description personnalisée** et **reposter sur Facebook**
- 📄 **Gérer une Page Facebook** (publications, statistiques)

> 📢 **Publicités :** la gestion des campagnes publicitaires n'est volontairement
> pas incluse ici — elle est assurée par le **MCP Facebook Ads officiel**, plus
> complet. Ce serveur se concentre sur ce qu'il fait de unique : Telegram + Pages.

## Outils exposés

| Outil | Rôle |
|-------|------|
| `telegram_list_videos` | Liste les vidéos récentes d'un chat/canal Telegram |
| `telegram_download_video` | Télécharge une vidéo sur le disque local |
| `telegram_video_frames` | **Extrait des images de la vidéo et les renvoie visibles** — permet de voir le contenu avant d'écrire la description |
| `facebook_list_pages` | Liste les Pages gérées + leurs tokens |
| `facebook_post_video` | Publie une vidéo locale sur une Page (titre + description) |
| `facebook_post_feed` | Publie un post texte (avec lien) sur une Page |
| `facebook_list_posts` | Liste les publications d'une Page (message, permalien, nb de commentaires) |
| `facebook_list_videos` | Liste les vidéos publiées (titre, description, `post_id`) |
| `facebook_update_video` | Réécrit la description d'une vidéo en ligne, sans perdre vues ni commentaires |
| `facebook_delete_post` | Supprime une publication ou une vidéo |
| `facebook_list_comments` | Liste les commentaires d'une publication |
| `facebook_post_comment` | **Commente au nom de la Page**, avec épinglage optionnel |
| `facebook_pin_comment` | Épingle / désépingle un commentaire |
| `facebook_update_comment` | Modifie un commentaire publié |
| `facebook_delete_comment` | Supprime un commentaire |
| `facebook_page_insights` | Statistiques d'une Page |
| `repost_telegram_to_facebook` | **Workflow complet** : Telegram → Facebook + commentaire épinglé en une étape |

---

## 1. Prérequis

- **Node.js ≥ 18.17**
- Un compte **Telegram** + des identifiants API (`API_ID` / `API_HASH`)
- Une **application Facebook** avec un jeton d'accès (`Access Token`)

---

## 2. Installation

```bash
git clone https://github.com/cedrdjio/mcp-telegram-facebook.git
cd mcp-telegram-facebook
npm install
npm run build
```

---

## 3. Configuration des clés d'API

Copiez le modèle et remplissez-le :

```bash
cp .env.example .env
```

### Telegram

1. Allez sur <https://my.telegram.org> → **API development tools**.
2. Créez une application, récupérez `App api_id` et `App api_hash`.
3. Renseignez `TELEGRAM_API_ID` et `TELEGRAM_API_HASH` dans `.env`.
4. Générez une **session** (connexion unique, un code vous est envoyé sur Telegram) :

   ```bash
   npm run build
   npm run telegram:login
   ```

   Le script affiche une ligne `TELEGRAM_SESSION=...` — collez-la dans `.env`.
   Vous n'aurez plus jamais à ressaisir le code.

### Facebook

1. Allez sur <https://developers.facebook.com/tools/explorer>.
2. Sélectionnez votre application et générez un **jeton** avec les permissions :
   `pages_show_list`, `pages_manage_posts`, `pages_read_engagement`, `read_insights`.
3. Renseignez `FACEBOOK_ACCESS_TOKEN`.
4. (Optionnel) Définissez `FACEBOOK_PAGE_ID` pour éviter de le passer à chaque appel.

> 💡 Pour publier sur une Page, utilisez de préférence un **Page Access Token**
> (renvoyé par `facebook_list_pages`). Pensez à un **jeton longue durée** pour la production.

---

## 4. Brancher le serveur sur Claude

### Claude Desktop

Éditez le fichier de configuration :

- macOS : `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows : `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "telegram-facebook": {
      "command": "node",
      "args": ["/CHEMIN/ABSOLU/VERS/mcp-telegram-facebook/dist/index.js"],
      "env": {
        "TELEGRAM_API_ID": "123456",
        "TELEGRAM_API_HASH": "xxxxxxxx",
        "TELEGRAM_SESSION": "1Ab...collée...ici",
        "FACEBOOK_ACCESS_TOKEN": "EAAB...",
        "FACEBOOK_PAGE_ID": "1234567890"
      }
    }
  }
}
```

> Vous pouvez soit mettre les variables dans le bloc `env` ci-dessus, soit vous
> reposer sur le fichier `.env` du projet (les deux fonctionnent).

Redémarrez Claude Desktop : l'icône 🔌 doit lister les outils `telegram_*` et `facebook_*`.

### Claude Code (CLI)

```bash
claude mcp add telegram-facebook -- node /CHEMIN/ABSOLU/mcp-telegram-facebook/dist/index.js
```

### Claude.ai (web) — connecteur personnalisé

Le serveur peut aussi tourner en HTTP (voir `src/http.ts`), déployé par exemple sur
Railway. Le formulaire *« Ajouter un connecteur personnalisé »* de Claude.ai
n'accepte que de l'**OAuth** (pas d'en-tête `Authorization` personnalisé, pas de
paramètre d'URL) et effectue le flux standard **Authorization Code + PKCE**
(redirection navigateur vers `/authorize`, puis échange sur `/oauth/token`) —
le serveur implémente donc ce flux, avec un client pré-enregistré via
`MCP_OAUTH_CLIENT_ID` / `MCP_OAUTH_CLIENT_SECRET` (pas de Dynamic Client
Registration). Une fois le code validé, il délivre simplement le jeton
`MCP_AUTH_TOKEN` existant.

1. Définissez, en plus des autres variables, `MCP_OAUTH_CLIENT_ID` et
   `MCP_OAUTH_CLIENT_SECRET` (valeurs aléatoires, voir `.env.example`).
2. Sur **claude.ai → Paramètres → Connecteurs → Ajouter un connecteur personnalisé** :
   - **URL du serveur MCP distant** : `https://<votre-domaine>/mcp`
   - **Paramètres avancés → ID client OAuth** : valeur de `MCP_OAUTH_CLIENT_ID`
   - **Paramètres avancés → Secret client OAuth** : valeur de `MCP_OAUTH_CLIENT_SECRET`
3. Cliquez **Ajouter** puis **Connecter** : Claude découvre les endpoints via
   `/.well-known/oauth-authorization-server`, redirige vers `/authorize`
   (approuvé automatiquement, usage personnel), échange le code sur
   `/oauth/token`, puis utilise le jeton obtenu en `Authorization: Bearer` sur `/mcp`.

---

## 5. Tester

### a) Test rapide du serveur (sans Claude)

Vérifie que le serveur démarre et expose bien ses outils :

```bash
printf '%s\n' \
'{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}' \
'{"jsonrpc":"2.0","method":"notifications/initialized"}' \
'{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
| node dist/index.js
```

Vous devez voir la liste des 12 outils dans la réponse JSON.

### b) Avec l'inspecteur officiel MCP

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

Une interface web s'ouvre : vous pouvez appeler chaque outil manuellement.

### c) Dans Claude, exemples de requêtes

- « Liste les 10 dernières vidéos du canal `@moncanal` »
- « Télécharge la vidéo message 4523 de `@moncanal` puis reposte-la sur ma Page
  avec la description : *Nouvelle vidéo exclusive ! 🔥* »
- « Affiche les statistiques de ma Page sur les 7 derniers jours »

---

## Notes & limites

- **Telegram** utilise l'API MTProto (compte utilisateur), ce qui permet de
  télécharger des vidéos volumineuses depuis n'importe quel canal/groupe dont
  vous êtes membre — au-delà de la limite de 20 Mo de l'API Bot.
- **Publication vidéo Facebook** : upload multipart standard, adapté jusqu'à
  ~1 Go. Un futur ajout pourra gérer l'upload *resumable* pour les très gros fichiers.
- **Publicités** : gérées par le MCP Facebook Ads officiel, pas par ce serveur.
- Ne committez **jamais** votre `.env` (déjà ignoré par git).

## Licence

MIT
