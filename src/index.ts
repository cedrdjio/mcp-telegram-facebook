#!/usr/bin/env node
/**
 * Point d'entrée STDIO — pour Claude Desktop / Claude Code (serveur local).
 * Pour le mode web (Claude.ai via Railway), voir src/http.ts.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

async function main() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Les logs vont sur stderr pour ne pas polluer le canal stdio (protocole MCP).
  console.error("Serveur MCP telegram-facebook démarré (stdio).");
}

main().catch((err) => {
  console.error("Erreur fatale au démarrage:", err);
  process.exit(1);
});
