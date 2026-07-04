/**
 * Stdio smoke test: spawns the BUILT server (dist/index.js) as a real child
 * process over stdio, connects an MCP Client, and asserts the 4 tools are
 * registered with their descriptions. Proves the MCP request/response loop
 * works end to end — with no TODOIST_API_TOKEN set — before any live Todoist
 * call is ever made.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const serverEntry = path.join(path.dirname(fileURLToPath(import.meta.url)), "index.js");

test("smoke: server boots over stdio and lists all 4 tools without a token", async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverEntry],
    // Deliberately no TODOIST_API_TOKEN — the server must still boot and
    // list tools; only calling a tool that touches Todoist should require it.
    env: {},
  });

  const client = new Client({ name: "smoke-test-client", version: "0.0.1" });
  await client.connect(transport);

  try {
    const { tools } = await client.listTools();
    const byName = new Map(tools.map((t) => [t.name, t]));

    assert.equal(tools.length, 4);
    for (const name of ["get_overdue_tasks", "get_stale_tasks", "get_projects", "apply_changes"]) {
      assert.ok(byName.has(name), `expected tool ${name} to be registered`);
      const description = byName.get(name)?.description ?? "";
      assert.ok(description.length > 0, `expected tool ${name} to have a description`);
    }

    assert.match(byName.get("get_overdue_tasks")?.description ?? "", /daysOverdue/);
    assert.match(byName.get("get_stale_tasks")?.description ?? "", /minDaysSinceUpdate/);
    assert.match(byName.get("apply_changes")?.description ?? "", /approved/i);
  } finally {
    // The server (dist/index.js) reads stdin over a plain pipe and doesn't
    // exit on EOF by itself, so client.close() alone can leave the child
    // process running and keep `node --test` from ever finishing. Force-kill
    // it by pid to guarantee the test process can exit.
    const pid = transport.pid;
    await client.close();
    if (pid) {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // already exited — fine
      }
    }
  }
});
