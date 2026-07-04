#!/usr/bin/env node
// Verifies the esbuild single-file bundle (plugin/server.cjs) actually boots
// as an MCP server and exposes exactly the 3 expected tools. Modeled on
// scripts/mcp-call.mjs. No Todoist token is needed — listTools works even
// without one.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const EXPECTED_TOOLS = ["get_overdue_tasks", "get_projects", "apply_changes"];

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["plugin/server.cjs"],
  cwd: new URL("..", import.meta.url).pathname,
});
const client = new Client({ name: "smoke-bundle-client", version: "0.0.1" });
await client.connect(transport);

const result = await client.listTools();
const names = result.tools.map((t) => t.name).sort();
console.log("Tools found in plugin/server.cjs:", names.join(", "));

await client.close();

const expectedSorted = [...EXPECTED_TOOLS].sort();
const matches =
  names.length === expectedSorted.length &&
  names.every((n, i) => n === expectedSorted[i]);

if (!matches) {
  console.error(
    `FAIL: expected exactly [${expectedSorted.join(", ")}] but got [${names.join(", ")}]`,
  );
  process.exit(1);
}

console.log("OK: exactly the 3 expected tools are present.");
