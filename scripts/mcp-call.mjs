#!/usr/bin/env node
// Tiny MCP client for dogfooding: spawns the built server over stdio and
// calls one tool. Usage: node scripts/mcp-call.mjs <toolName> ['<json-args>']
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const [toolName, argsJson] = process.argv.slice(2);
if (!toolName) {
  console.error("usage: node scripts/mcp-call.mjs <toolName> ['<json-args>']");
  process.exit(1);
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["--env-file-if-exists=.env", "dist/index.js"],
  cwd: new URL("..", import.meta.url).pathname,
});
const client = new Client({ name: "dogfood-client", version: "0.0.1" });
await client.connect(transport);

const result = await client.callTool({
  name: toolName,
  arguments: argsJson ? JSON.parse(argsJson) : {},
});
for (const block of result.content ?? []) {
  if (block.type === "text") console.log(block.text);
}
if (result.isError) process.exitCode = 2;
await client.close();
