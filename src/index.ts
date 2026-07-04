#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools.js";

async function main() {
  const server = new McpServer({
    name: "todoist-weekly-review",
    version: "0.1.0",
  });

  registerTools(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Exit cleanly when the client end of stdio closes (e.g. the MCP client
  // disconnects), rather than lingering as an orphaned process.
  process.stdin.on("end", () => process.exit(0));

  // Never log to stdout: it's the MCP transport. Diagnostics only on stderr.
  console.error("todoist-weekly-review MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error starting todoist-weekly-review MCP server:", err);
  process.exit(1);
});
