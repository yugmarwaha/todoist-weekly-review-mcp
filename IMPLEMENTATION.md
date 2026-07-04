# IMPLEMENTATION — Todoist Weekly Review MCP (v1)

> Read `PLAN.md` (what/why + all decisions) and `CONTEXT.md` (glossary) first — this file
> assumes them. This is the **build spec** for a Claude Code goal-mode session. It is
> written to be executed cold, in a **fresh implementation repo** (these md files get copied
> there). This repo (`project-ideas`) stays planning-only.

---

## 0. Build conventions (carried from the planning hub)

These global conventions govern *how you build*, not just what:

- **Long output → self-contained HTML, not a chat dump.** If during the build you need to
  present the owner something long (e.g. an endpoint-verification summary or a dogfood
  report), generate a **self-contained HTML file**: inline all CSS, no external assets,
  respect `prefers-color-scheme` (dark when the OS is dark, light otherwise), and keep text
  readable-contrast in **both** modes.
- **Capture decisions as you make them.** When you verify an endpoint/field or pick the
  reschedule-signal path (§6), record it in the repo README immediately — don't batch it.

---

## 1. Goal

Build a **thin MCP server, in TypeScript**, that lets an MCP client (Claude Code / Claude
Desktop) run a **weekly review** over the user's Todoist and fix **overdue tasks** — with
the user approving every change. The server exposes *facts* and *executes approved writes*;
all judgment (which fix, what new date) happens in the **client model, in chat**. No
server-side LLM calls (that is the budget trick).

**v1 is a walking skeleton: Overdue Pileup ONLY, end to end.** Hidden Project (v1.1) and
Stale Task (v1.2) are deliberately out of scope — see `PLAN.md` scope section.

## 2. Definition of done — what the accomplishment looks like

v1 is complete when, from a real Claude Code session connected to this server, the user can:

1. Ask "run my weekly review" → the model calls **`get_overdue_tasks`** and shows the user
   their overdue tasks with, per task: how many days overdue, priority, project, and (if
   available) how many times it's been rescheduled.
2. The model **proposes a fix per task** in chat (reschedule to a concrete date, change
   priority, or *retire* — complete / move to "Someday/Maybe"). Nothing is written yet.
3. The user **vetoes individual suggestions** in plain language ("skip #3, don't touch #5").
4. The model calls **`apply_changes`** with ONLY the surviving approved changes, and the
   server executes them against Todoist.
5. The user re-runs `get_overdue_tasks` (or checks the Todoist app) and **sees the changes
   took effect** — the applied tasks are rescheduled/retired, the vetoed ones untouched.

Plus: no change is ever written without passing through `apply_changes`; a hard **delete is
never issued**; the personal token is read from an env var and never logged or committed.

## 3. Stack & rationale

- **Language:** TypeScript (Node). Chosen because Claude Code is Node-native, plugin
  distribution is frictionless via `npx`, and the AI writes the boilerplate so TS ceremony
  costs the owner nothing. (Rust/Go rejected: this workload is I/O-bound HTTP calls — no hot
  loop — so a "fast" language buys zero runtime benefit and worsens distribution. Python
  rejected: less native to the Claude Code plugin ecosystem the owner is targeting.)
- **MCP SDK:** official `@modelcontextprotocol/sdk` (`McpServer`), stdio transport for v1.
- **HTTP:** built-in `fetch` (Node 18+) — no extra HTTP dep needed.
- **Tool input validation:** `zod` (the SDK's standard way to declare tool input schemas).
- **Node:** use a current LTS (Node 20+).

## 4. Prerequisites & setup

1. Create the implementation repo (fresh, separate from `project-ideas`). Copy this folder's
   md files into it for reference.
2. `npm init`, add `typescript`, `@modelcontextprotocol/sdk`, `zod`; set up `tsconfig` and a
   build/run script. Target an executable entry (e.g. `dist/index.js`) that speaks MCP over
   stdio.
3. **Todoist personal API token:** the user gets it from Todoist → Settings → Integrations →
   Developer → "API token". Provide it to the server via env var **`TODOIST_API_TOKEN`**.
   Never hardcode, never commit (add `.env` to `.gitignore`; do not print the token in logs).
4. **Connect to Claude Code:** register the server so Claude Code launches `node dist/index.js`
   with `TODOIST_API_TOKEN` set. Claude Code uses **`claude mcp add`** / a **`.mcp.json`**
   entry (Claude *Desktop* uses `claude_desktop_config.json` — a different file). Verify the
   exact config shape against current Claude Code docs at build time.

## 5. Todoist API reference (verify live at build time)

Base URL: **`https://api.todoist.com/api/v1`**
Auth header: **`Authorization: Bearer $TODOIST_API_TOKEN`** (personal token works directly).

| Need | Method & path | Notes |
|------|---------------|-------|
| Get overdue tasks | `GET /tasks?filter=overdue` | Confirm the filter param/endpoint shape in live docs — v1 may route filter queries differently. Fallback: `GET /tasks` then filter client-side by `due.date < today`. |
| Update a task | `POST /tasks/{id}` | Body fields: `due_date` (or `due_string`), `priority` (1–4; **4 = highest** in the API, inverse of the UI's P1), `content` (reword), `project_id` (move). |
| Complete (retire) | `POST /tasks/{id}/close` | The safe "retire → done" path. |
| List projects | `GET /projects` | List existing projects. The find-or-create of "Someday/Maybe" happens inside `move_to_project` (§8), not here. |
| Create project | `POST /projects` | Body: `{ "name": "Someday/Maybe" }`. Create lazily, only if retire-by-move is used and it doesn't exist. |
| Create sub-task | `POST /tasks` with `parent_id` | **Not needed in v1** (that's Hidden Project / v1.1). |
| Activity log | `GET /activity` | Source of the "times rescheduled" signal. **See the flag in §6 — may be gated/absent.** |

> ⚠️ The above paths were captured from the docs but the fetching tool can be imprecise.
> During implementation, **verify each endpoint, param name, and field against the live
> Todoist API v1 docs** (https://developer.todoist.com/api/v1/) before relying on it, and
> record what you confirmed in the repo README (§0).

**Cross-cutting API facts to handle explicitly:**

- **Priority is inverted.** Todoist API `priority` is `1–4` where **`4` = highest** — the
  *opposite* of the UI (UI "P1" = highest = API `4`). v1 rule: **the server passes the raw
  API value through unchanged** (no remapping), and every tool description states this so the
  client model accounts for the inversion when it reasons. Do not silently remap.
- **Date formats.** For `reschedule`, send `due_date` as **`YYYY-MM-DD`** (date-only), or use
  `due_string` for Todoist natural language ("next monday"). Todoist due values may be
  date-only or datetime+timezone on read — handle both.
- **Timezone for "overdue".** Compute `daysOverdue` and the `due.date < today` fallback
  against the **user's Todoist timezone / local date**, not UTC, or a task can look
  a-day-off. Confirm the account timezone from the API.
- **Pagination.** v1 list endpoints (`GET /tasks`, `GET /projects`) use **cursor
  pagination** — follow `next_cursor` until exhausted, or a larger account will silently drop
  overdue tasks.
- **Labels.** `apply_label` (see §8) needs a `labels` array on `POST /tasks/{id}` — **not
  exercised in the v1 overdue skeleton**; wire it only when needed.

## 6. ⚠️ FIRST TASK — verify the "times rescheduled" signal, then decide

The plan assumes the Activity Log exposes, per task, **how many times it was rescheduled** —
this is a v1 signal that helps the model spot the *chronic* offenders (rescheduled 8 times)
vs. a task that's merely a day late.

**Before building detection, verify this is actually obtainable:**
- Hit `GET /activity` and check whether reschedule/due-date-change events are present,
  per-task-attributable, and available on the user's Todoist plan. (Activity history has
  historically been a **paid/Pro** feature and may be Sync-API-shaped — confirm.)

**Decision rule:**
- **If reschedule count is cleanly available** → include it as a signal in
  `get_overdue_tasks` output.
- **If it is NOT** (gated, missing, or too messy) → **drop it and move on.** "Days overdue +
  priority + project" alone fully carries the v1 feature. Do **not** block v1 on this signal,
  and do **not** build a fragile scraper for it. Note in the repo README which path was taken.

## 7. Build order (milestones)

Build the walking skeleton in this order; each step should be runnable/testable before the next.

1. **Skeleton server** — MCP server boots over stdio, registers one trivial tool, connects to
   Claude Code successfully. (Proves the MCP loop + config before any Todoist logic.)
2. **Auth + read** — implement `get_overdue_tasks`: call Todoist, return overdue tasks with
   signals (days overdue, priority, project; reschedule count per §6). Verify against a real
   account with real overdue tasks.
3. **Projects helper** — implement `get_projects` (read-only list; follow pagination). The
   find-or-create of "Someday/Maybe" is NOT here — it lives in the write path below.
4. **Write path** — implement `apply_changes`: accept an explicit list of approved changes,
   validate each against the v1 action allowlist, execute via the Todoist endpoints, and for
   `move_to_project` do the deterministic **find-or-create of the target project by name**.
   Return a per-change result (succeeded/failed + why).
5. **End-to-end dogfood** — run the full Definition-of-Done flow (§2) against the owner's real
   Todoist. Confirm vetoed items are untouched and approved items changed.

## 8. Tool contracts

The client model orchestrates these; the server never reasons. Keep tool *descriptions* rich
— the description is how you **steer** the model into a good review (this is the core skill).

### `get_overdue_tasks` (read, no side effects)
- **Input:** none (v1). Optionally `project_id?` later.
- **Output:** array of `{ id, content, projectId, projectName, priority, dueDate,
  daysOverdue, timesRescheduled? }`.
  - `priority` is the **raw Todoist API value (1–4, 4 = highest — inverse of UI P1)**.
  - `dueDate` is `YYYY-MM-DD` (date-only) when the task has a date; `daysOverdue` is computed
    in the user's Todoist timezone.
  - Both `projectId` and `projectName` are returned so the model can both display *and* map
    to an id for a move.
  - `timesRescheduled` present only if §6 succeeded; omit it entirely otherwise.
- **Description should tell the model:** these are candidates for a weekly review; propose a
  fix per task and ask the user to confirm before applying; higher daysOverdue / reschedule
  count = stronger candidate to retire rather than reschedule again; **remember priority is
  inverted (4 = highest)**.

### `apply_changes` (write — the human-approved step)
- **Input:** `changes: Array<{ taskId: string, action: Action, params?: {...} }>` where
  **`Action` ∈ the v1 allowlist**:
  - `reschedule` — `params.dueDate` (`YYYY-MM-DD`) **or** `params.dueString` (Todoist natural
    language).
  - `set_priority` — `params.priority` (**raw API scale, 1–4, 4 = highest**; server does not
    remap).
  - `move_to_project` — `params.projectName` (a **name**, e.g. `"Someday/Maybe"`). The server
    **resolves the name to an existing project, or creates it if missing** (deterministic
    find-or-create — the only server-side "logic", and it's plumbing, not judgment), then
    moves the task. This is the retire-by-move path; no separate create tool needed.
  - `reword` — `params.content`.
  - `complete` — no params (the primary retire path).
  - `apply_label` — `params.label`. **Wired but NOT exercised by the v1 overdue skeleton**
    (needs the `labels` array, see §5); safe to defer its implementation to when first used.
  - **`split` is v1.1; `delete` does not exist.**
- **Behavior:** validate every change against the allowlist and reject unknown actions;
  execute each; return `Array<{ taskId, action, ok, error? }>`. Partial success is allowed —
  report per-item.
- **Description must state:** only call this with changes the user has explicitly approved;
  never infer or add changes the user didn't confirm.

### `get_projects` (read)
- **Input:** none.
- **Output:** `Array<{ id, name }>`. Follow cursor pagination to completion (§5).
- **Purpose:** let the model see existing projects (incl. whether "Someday/Maybe" already
  exists). Note: creating it is handled *inside* `move_to_project` above — the model does not
  need a separate create call.

## 9. Safety / human-in-the-loop rules (non-negotiable)

- **No write without approval.** Only `apply_changes` mutates Todoist, and only with an
  explicit list the user approved. The server must not "helpfully" apply extras.
- **No hard delete in v1.** Retire = `complete` or `move_to_project` → "Someday/Maybe". The
  code path for delete must not exist.
- **Idempotent-ish & reportable.** `apply_changes` reports per-item results so a partial
  failure is visible, not silent.
- **Secrets.** `TODOIST_API_TOKEN` from env only; never logged, never committed, `.env`
  gitignored.
- **Read-path errors are explicit, never silent.** `get_overdue_tasks` / `get_projects` must
  surface a clear, distinguishable error — `401` (missing/expired token), `403` (plan-gated,
  e.g. activity log), `429` (rate limit), or network — rather than returning an empty list
  that the model would misread as "nothing overdue."

## 10. Manual dogfood test (acceptance)

No heavy test harness required for v1. Acceptance = running §2's flow live:
seed/observe a few real overdue tasks → `get_overdue_tasks` → model proposes → veto one →
`apply_changes` → confirm in the Todoist app that approved changed and vetoed did not.
(Optional: a couple of unit tests around the Todoist response → tool-output mapping.)

## 11. Out of scope for v1 (do NOT build)

- Hidden Project detection & `split into sub-tasks` (**v1.1**).
- Stale Task detection (**v1.2**).
- Notion, daily-triage, goal→task breakdown, OAuth / multi-user.
- A "heavier" server that pre-computes suggestions/rankings itself — intentionally deferred;
  keep the server thin. Revisit only if the thin design proves limiting.

## 12. Plugin-later note

The end goal is to ship this as a **Claude Code plugin** (hence TypeScript). v1 stays a plain
stdio MCP server used personally. When ready to distribute: package for `npx` execution and
wrap as a Claude Code plugin (bundled MCP server; optionally add slash commands like
`/weekly-review` later). Design v1 so this wrap is additive — keep the server entry point and
config simple and env-var driven.
