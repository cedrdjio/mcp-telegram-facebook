# Authentification ChatGPT — MCP Telegram–Facebook

Cette version ajoute OAuth 2.1 + PKCE S256 pour le serveur Streamable HTTP Railway.

## Variables Railway

```env
MCP_PUBLIC_URL=https://mcp-telegram-facebook-production.up.railway.app
OAUTH_JWT_SECRET=<secret aleatoire >= 32 caracteres>
MCP_AUTH_USERNAME=<identifiant OAuth>
MCP_AUTH_PASSWORD=<mot de passe OAuth>
```

Ne committez jamais ces valeurs.

## Découverte

- `GET /.well-known/oauth-protected-resource`
- `GET /.well-known/oauth-authorization-server`

## OAuth

- `GET /oauth/authorize`
- `POST /oauth/authorize`
- `POST /oauth/token`

Le serveur accepte le Client ID Metadata Document de ChatGPT et les URI de callback ChatGPT sous `https://chatgpt.com/connector/...` ainsi que `https://chatgpt.com/connector_platform_oauth_redirect`.

Le code d'autorisation est signé, lié au `redirect_uri`, au `client_id`, au `resource` et au PKCE `code_challenge`, puis expire après 5 minutes. Le token d'accès expire après 1 heure.

## MCP

Toutes les requêtes `/mcp` doivent présenter :

```http
Authorization: Bearer <access_token>
```

Le serveur vérifie l'émetteur, l'audience, l'expiration et le scope `mcp`. En absence de token valide, il renvoie `401` avec `WWW-Authenticate` pointant vers les métadonnées de ressource protégée.
