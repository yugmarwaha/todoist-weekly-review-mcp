# PLAN — Todoist Weekly Review MCP

> Status: **planning** (docs not yet complete). This folder is planning-only; when done,
> its md files move to a fresh implementation repo. See root `CLAUDE.md` for conventions.

## One-liner

An MCP server that turns Todoist into a smart **weekly review** assistant: it reads the
user's tasks, spots what's gone stale/messy, and (with the user's confirmation) reorganizes
them. The reasoning is done by the **client's** model (e.g. Claude Code); the server exposes
well-designed tools that *steer* that model into a good review. Server-side LLM calls: none.

## Why this project

- **Learning goal:** go deep on MCP + tool design; learn to *steer* an AI on a task big
  enough that it can't one-shot it. Owner reviews code slowly (Claude Code learning mode).
- **Resume goal:** MCP is the in-demand 2026 skill. Differentiator vs. the ~9 existing
  Todoist MCP servers (incl. Doist's official `ai.todoist.net/mcp`): those are plain
  CRUD wrappers; this one encodes a *weekly-review methodology* in its tool design.
- **Users:** 0 expected. Owner dogfoods it → instantly catches wrong output. Fine.
- **Budget:** cheap by design — intelligence lives in the client model, not the server.

## Decisions so far

- **Domain:** Todoist (owner uses it daily). Apple Notes explicitly out (privacy). Notion
  is a possible *later* target, not now.
- **Core use case:** a **weekly review that reorganizes the mess** (chosen over daily-triage
  and goal→task-breakdown). Those two are possible later extensions, not v1.
- **The Mess (v1 detection targets), ranked:** 1) Overdue Pileup, 2) Hidden Project,
  3) Stale Task. Defined in CONTEXT.md. Detectable via Todoist API + **Activity Log**
  (records reschedules/edits) + `created_at`/`due`; Hidden Project is client-model judgment.
- **Writes are in scope:** "reorganize" implies changing tasks → the server takes actions,
  so **human-in-the-loop confirmation** is a first-class concern.
- **Interaction = strict two-step, per-item veto.** A `propose` tool returns the full
  week's plan of suggested fixes and writes *nothing*. A separate `apply` tool executes
  only the changes the owner approved. Owner can veto individual suggestions in chat; the
  client model then calls `apply` with just the survivors. **`apply` takes an explicit list
  of changes** (never "apply the last proposal"), so approval is unambiguous.

- **Allowed fix actions (`apply` allowlist):** `reschedule`, `set priority`,
  `move to project`, `split into sub-tasks`, `reword`, `complete`, `apply label`.
  **No hard delete in v1** — tasks are *retired* (completed or moved to "Someday/Maybe"),
  never destroyed. See CONTEXT.md "Reorganize" / "Retire".

- **Auth = personal API token via environment variable (v1).** Owner copies their token
  from Todoist settings into an env var; never hardcoded, never committed. OAuth is the
  documented upgrade path *only if* this ever goes multi-user (it exists so other users can
  grant their own accounts — needs app registration, a redirect URL, and token refresh;
  all unnecessary for a single-user dogfood tool).

## Scope — walking skeleton

**v1 = the full loop for Overdue Pileup ONLY**, end to end:
detect overdue tasks → `propose` fixes (nothing written) → owner per-item veto in chat →
`apply` the approved changes → confirm they changed in Todoist. Building the *simplest*
Mess type through the *whole* pipeline is deliberate: the hard part to learn is the MCP
request/response loop, auth, and the two-step propose/apply flow — learn it once on easy
mode, then the rest is additive.

- **v1.1** — add **Hidden Project** detection + `split into sub-tasks` fix.
- **v1.2** — add **Stale Task** detection.
- **Later (not planned yet):** Notion target, daily-triage use case, goal→task breakdown,
  OAuth / multi-user, **heavier "smart" server** (see below), **ship as a Claude Code
  plugin** (the end goal — drives the stack choice below).

## Stack

- **TypeScript + official `@modelcontextprotocol/sdk`** (stdio transport), `zod` for tool
  input schemas, built-in `fetch` for Todoist. Rationale: Claude Code is Node-native and the
  end goal is a **Claude Code plugin**, so building in TS = no rewrite + frictionless `npx`
  distribution; the AI writes the boilerplate so TS ceremony is ~free. Rust/Go rejected
  (workload is I/O-bound HTTP — a "fast" language buys nothing and worsens distribution);
  Python rejected (less native to the plugin ecosystem being targeted).
- Full build spec lives in **`IMPLEMENTATION.md`** (written for a Claude Code goal-mode
  session in the fresh implementation repo).

## v1 MCP tool surface

Deliberately **thin/dumb server**: it exposes facts and executes approved writes. All
judgment (which fix, what new date) happens in the **client model, in chat** — that is the
proposal step, and it keeps server-side LLM cost at zero. So the earlier "`propose` tool"
is really just the read tool below; proposing is the model thinking between read and write.

- **`get_overdue_tasks`** *(read)* — returns each overdue task enriched with the signals the
  model reasons over: days overdue, times rescheduled (from Activity Log), priority, project.
  Facts only, no judgment.
- **`apply_changes`** *(write)* — takes an **explicit list** of `{task_id, action, params}`
  where `action` ∈ the v1 allowlist. Executes only these. This is the human-approved step.
- **`get_projects`** *(read)* — lists projects so the model can find/create the
  "Someday/Maybe" project used to *retire* tasks.

Flow: `get_overdue_tasks` → model proposes fixes in chat → owner per-item veto →
`apply_changes` with the survivors.

### Deferred: npm publishing (decided 2026-07-04 — plugin first, npm later)

Prerequisites are already in place (LICENSE, `repository`/`files`/`prepublishOnly` in
package.json, bin entry + shebang). When ready:

1. Create a free npmjs.com account, verify email, `npm login`.
2. Check the name is still free: `npm view todoist-weekly-review-mcp` (404 = free).
3. `npm publish` (runs tests via prepublishOnly; ships only `dist/`, README, LICENSE).
4. Users then need no clone at all:
   `claude mcp add todoist-weekly-review --env TODOIST_API_TOKEN=<their-token> -- npx -y todoist-weekly-review-mcp`
5. No permissions needed from anyone; keep the "unofficial, not affiliated with Doist" line.

### Future feature (not v1): heavier server

A server that pre-computes suggestions itself (ranking, suggested reschedule dates, etc.)
is deliberately **out of scope for now**. Revisit only if the thin design proves limiting.

## Status

Core planning **complete** — no blocking open questions. Ready to move these md files into a
fresh implementation repo when the owner chooses to start building.
