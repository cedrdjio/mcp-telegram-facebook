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
| `facebook_list_pages` | Liste les Pages gérées + leurs tokens |
| `facebook_post_video` | Publie une vidéo locale sur une Page (titre + description) |
| `facebook_post_feed` | Publie un post texte (avec lien) sur une Page |
| `facebook_page_insights` | Statistiques d'une Page |
| `repost_telegram_to_facebook` | **Workflow complet** : Telegram → Facebook en une étape |

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

## Outils avancés ajoutés

Le serveur expose désormais :
- `facebook_graph_request` : appel Graph générique GET/POST/DELETE
- `facebook_get_object`, `facebook_create_object`, `facebook_update_object`, `facebook_delete_object`
- `facebook_list_edge`
- `facebook_ads_insights`
- `facebook_validate_token`
- `facebook_list_ad_accounts`
- `facebook_list_campaigns`
- `facebook_list_adsets`
- `facebook_list_ads`
- `facebook_list_adcreatives`
- `facebook_list_custom_audiences`
- `facebook_list_pixels`

Ces outils couvrent la gestion Pages, publications, vidéos, commentaires et une grande partie de la Marketing API : campagnes, ensembles de publicités, annonces, créations, audiences, pixels/datasets et statistiques.

### Attention sécurité

Les opérations publicitaires qui créent, modifient, activent, mettent en pause ou suppriment des campagnes peuvent dépenser de l'argent. Testez d'abord avec `status=PAUSED`, vérifiez les IDs et ne fournissez jamais un token dans les logs ou captures.

## Moteur universel Graph API

Outils supplémentaires:
- `facebook_universal_request`: GET/POST/DELETE/PUT/PATCH, paramètres dynamiques, pagination, dry-run et confirmation.
- `facebook_analyze_request`: analyse de risque sans exécution.
- `facebook_diagnose`: diagnostic du token, Page, version et vidéos.

Les opérations sensibles retournent `confirmationRequired: true`. Relancer ensuite avec `confirm: true`. Ne jamais fournir un token dans les paramètres: le MCP utilise `FACEBOOK_ACCESS_TOKEN` et le transmet dans l'en-tête Authorization.


## Multi-Pages / moteur universel

`FACEBOOK_PAGE_ID` est uniquement une valeur par défaut. Il ne limite pas le MCP à une seule Page.

Pour cibler une autre Page, fournissez `pageId` dans l’outil concerné ou utilisez directement `facebook_universal_request` avec le chemin de la Page :

```json
{
  "method": "GET",
  "path": "/PAGE_ID/videos",
  "params": {
    "fields": "id,title,description,permalink_url",
    "limit": 25
  }
}
```

Le token doit disposer des droits sur la Page ciblée. Un seul token peut gérer plusieurs Pages accessibles via `/me/accounts`; le MCP ne doit jamais coder une Page en dur.

## Railway / Streamable HTTP

Sur Railway, configure `MCP_TRANSPORT=http`. The server listens on `0.0.0.0:$PORT` and exposes:

- `GET /health`
- `POST /mcp`
- `DELETE /mcp` for an MCP session

Each MCP HTTP session receives its own `McpServer`/Protocol instance and its own `StreamableHTTPServerTransport`. This is required by the TypeScript SDK because one Protocol instance cannot be connected to multiple transports at the same time.

The universal Graph API tool remains available as `facebook_universal_request`; it is not replaced by the specialized Facebook tools.

## ChatGPT OAuth 2.1

Le serveur HTTP Railway inclut maintenant une couche OAuth 2.1 avec PKCE S256 pour l'authentification de ChatGPT.

Endpoints publics de découverte :
- `GET /.well-known/oauth-protected-resource`
- `GET /.well-known/oauth-authorization-server`
- `GET /oauth/authorize`
- `POST /oauth/authorize`
- `POST /oauth/token`

Le endpoint `/mcp` exige ensuite `Authorization: Bearer <access_token>` et vérifie l'émetteur, l'audience, l'expiration et le scope `mcp`.

Variables Railway à définir :
- `MCP_PUBLIC_URL=https://mcp-telegram-facebook-production.up.railway.app`
- `OAUTH_JWT_SECRET` : secret aléatoire d'au moins 32 caractères
- `MCP_AUTH_USERNAME` : identifiant de connexion OAuth
- `MCP_AUTH_PASSWORD` : mot de passe de connexion OAuth

Le flux utilise le Client ID Metadata Document (CIMD) de ChatGPT et accepte les callbacks ChatGPT sous `https://chatgpt.com/connector/...`. Les codes d'autorisation sont signés et expirent rapidement ; aucun code ou mot de passe n'est écrit dans Git.
