# OAuth ChatGPT — MCP Telegram–Facebook v0.4.0

Le serveur utilise le flux **OAuth 2.1 Authorization Code + PKCE S256** attendu par ChatGPT pour un serveur MCP distant.

## Discovery

```text
GET https://mcp-telegram-facebook-production.up.railway.app/.well-known/oauth-protected-resource
GET https://mcp-telegram-facebook-production.up.railway.app/.well-known/oauth-authorization-server
```

Le serveur annonce :

- resource = URL canonique du serveur
- authorization server = URL canonique du serveur
- authorization endpoint = `/oauth/authorize`
- token endpoint = `/oauth/token`
- PKCE = `S256`
- client metadata document = activé

## Sécurité des outils

Chaque outil protégé déclare une politique OAuth dans son descripteur via `_meta.securitySchemes` et le serveur vérifie réellement le token avant chaque `tools/call`.

Un appel non authentifié renvoie également :

```json
{
  "isError": true,
  "_meta": {
    "mcp/www_authenticate": ["Bearer ..."]
  }
}
```

Cette combinaison permet à ChatGPT de découvrir les outils puis de déclencher l'association OAuth au moment de l'appel.

## Secrets

Ne mettez jamais dans GitHub :

- `FACEBOOK_ACCESS_TOKEN`
- `OAUTH_JWT_SECRET`
- `MCP_AUTH_PASSWORD`
- `TELEGRAM_SESSION`

Ils doivent rester dans Railway Variables/Secrets.


### Compatibilité de routage

Le serveur accepte désormais `POST /mcp` et `POST /` pour Streamable HTTP. Il expose aussi `/.well-known/openid-configuration` en plus des métadonnées OAuth MCP afin de supporter les clients qui effectuent une découverte OIDC après l'échange du code.
