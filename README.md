# MCP Telegram–Facebook v0.4.0

Serveur MCP distant pour ChatGPT, Telegram et Facebook Graph API, conçu pour exposer une surface d'outils stable et exploitable par les clients MCP.

## Correctifs v0.4.0

- **31 outils enregistrés avant `connect()`** pour chaque session HTTP.
- Passage de l'ancienne API `server.tool()` à **`server.registerTool()`**.
- Chaque outil possède un **titre**, des **annotations MCP** (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) et un **`outputSchema`**.
- Chaque outil déclare OAuth via **`securitySchemes` dans `_meta`** pour la compatibilité des clients ChatGPT qui lisent ce champ de rétrocompatibilité.
- Les résultats renvoient à la fois `content` et `structuredContent`.
- Les appels `tools/call` sans token renvoient un résultat MCP `isError: true` avec `_meta["mcp/www_authenticate"]`, ce qui permet à ChatGPT de déclencher l'interface OAuth au niveau de l'outil.
- `initialize` et `tools/list` restent découvrables avant connexion OAuth : ChatGPT peut donc voir les outils et leurs métadonnées avant de demander l'autorisation.
- CORS autorise explicitement `Authorization`.
- OAuth exige PKCE **S256**, vérifie issuer, audience, expiration et scope, et empêche la réutilisation d'un code d'autorisation pendant sa durée de vie.
- Les Page Access Tokens Facebook sont **résolus côté serveur** et ne sont plus proposés comme arguments d'outils ni renvoyés au modèle.
- `/health` expose le nombre et la liste des outils sans exposer de secrets.
- Les identifiants, tokens et secrets restent exclusivement dans les variables d'environnement Railway.

## Variables Railway

Conserver les variables déjà configurées. Le code n'écrase aucune valeur existante.

```env
FACEBOOK_PAGE_ID=...
FACEBOOK_ACCESS_TOKEN=...
FACEBOOK_GRAPH_VERSION=...
MCP_PUBLIC_URL=https://mcp-telegram-facebook-production.up.railway.app
OAUTH_JWT_SECRET=...
MCP_AUTH_USERNAME=...
MCP_AUTH_PASSWORD=...
```

Pour Telegram, conserver également les variables existantes (`TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, `TELEGRAM_SESSION`, etc.).

## Endpoints

- `POST /mcp` — Streamable HTTP MCP
- `GET /.well-known/oauth-protected-resource` — Protected Resource Metadata
- `GET /.well-known/oauth-authorization-server` — Authorization Server Metadata
- `GET /oauth/authorize` — Authorization Code + PKCE
- `POST /oauth/authorize` — validation des identifiants et émission du code
- `POST /oauth/token` — échange PKCE contre access token
- `GET /health` — état public non sensible et liste des outils

## Vérification rapide

Après déploiement, `/health` doit indiquer `toolCount: 31` après qu'une instance MCP a créé son serveur, et `tools` doit contenir les 31 noms.

Dans ChatGPT, reconnecter le serveur avec l'URL MCP `/mcp`. La découverte doit d'abord retourner `tools/list`; au premier `tools/call` sans token, le serveur renvoie le challenge OAuth MCP au niveau du résultat.
