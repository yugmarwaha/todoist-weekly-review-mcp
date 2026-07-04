# Todoist Weekly Review MCP

A thin MCP server that turns a weekly Todoist review into a human-in-the-loop assisted
workflow. It reads your overdue tasks and hands them, with the signals a reviewer needs
(days overdue, priority, project, times rescheduled), to the client model (e.g. Claude Code)
in chat. The client model proposes a fix per task; **you approve or veto each one in plain
language**; only then does the model call this server's write tool to apply the approved
changes. The server itself never reasons, ranks, or calls an LLM — it exposes facts and
executes explicitly approved writes. All judgment lives in the chat with you and the client
model.

v1 covers the **Overdue Pileup** case only, end to end (see `PLAN.md` / `CONTEXT.md` in this
repo for the full methodology and roadmap this was scoped from).

## Decision record: the "times rescheduled" signal (§6)

The plan's open question was whether a per-task "how many times has this been rescheduled"
signal was obtainable, and if so, where from.

**Decision: sourced from `postponed_count` on the task object itself** ("Number of times the
task's due date has been rescheduled by the user"), not from the Activity Log
(`GET /api/v1/activities`). The Activity Log exists and can show reschedule/due-date-change
events, but its availability and retention window depend on the user's Todoist plan (paid
plans get longer history) — it's a plan-gated, Sync-API-shaped endpoint, and reading it
per-task is fussier than a field that's already sitting on every task response.
`postponed_count` gives the same signal with none of that fragility, so it's what
`get_overdue_tasks` uses: the field is included as `timesRescheduled` when Todoist returns
it, and omitted entirely (not defaulted to 0) when it doesn't — a task with `timesRescheduled`
absent should be read as "unknown," not "never rescheduled."

## Verified endpoints

All confirmed against the live Todoist API v1 OpenAPI spec. Two corrections vs. the original
`IMPLEMENTATION.md` draft are called out below — that file was written before verification and
guessed at some shapes.

| Need | Method & path | Notes |
|------|---------------|-------|
| Overdue tasks | `GET /tasks/filter?query=overdue&limit=200` | **Correction:** the filter endpoint is `/tasks/filter` with query param `query`, NOT `/tasks?filter=` as originally drafted. Cursor-paginated: `{ results, next_cursor }`. |
| Update a task | `POST /tasks/{id}` | Body fields used: `content` (reword), `priority` (raw 1-4), `due_date` / `due_string` (reschedule), `labels` (full array, for apply_label). `project_id` is **not** accepted here. |
| Move to project | `POST /tasks/{id}/move` | **Correction:** moving a task is a dedicated endpoint with body `{ "project_id": ... }`, not a `project_id` field on the generic task update. |
| Complete (retire) | `POST /tasks/{id}/close` | 204/empty response. The primary "retire → done" path. |
| List projects | `GET /projects?limit=200` | Cursor-paginated like tasks. |
| Create project | `POST /projects` | Body `{ "name": ... }`. Used lazily by `move_to_project`'s find-or-create — never called standalone. |
| User info (timezone) | `GET /user` | IANA timezone string lives at `tz_info.timezone`. Falls back to the server's local timezone if absent. |
| Get a single task | `GET /tasks/{id}` | Used by `apply_label` to read the current `labels` array before appending. |

There is **no hard-delete** endpoint wired anywhere in this server. Retiring a task means
`complete` or `move_to_project` → "Someday/Maybe" — never destruction.

## Priority inversion

Todoist's API `priority` field is `1`–`4` where **`4` = highest/urgent** and `1` = normal —
the **inverse** of the Todoist UI's "P1" label (UI P1 = API `4`). This server passes the raw
API value straight through in both directions (`get_overdue_tasks` output and
`apply_changes`'s `set_priority`) and never remaps it. Every tool description repeats this so
the client model accounts for the inversion when it reasons about priority in chat.

## Setup

1. Install dependencies and build:
   ```bash
   npm install
   npm run build
   ```
2. Get a personal API token: Todoist → **Settings → Integrations → Developer** → "API token".
3. Provide it via a `.env` file (recommended) or an exported environment variable:
   ```bash
   cp .env.example .env    # then paste your token after TODOIST_API_TOKEN=
   ```
   `.env` is gitignored and is loaded by Node's built-in `--env-file-if-exists=.env` flag
   (already wired into `npm start` and `.mcp.json`) — no dotenv dependency. Never commit it
   and never `git add -f` it. Alternatively, `export TODOIST_API_TOKEN="..."` in your shell
   works too; a value already present in the environment takes precedence over `.env`.

   The server reads the token at **request time**, not at startup — it will boot and list its
   tools even if the token isn't set yet; only calling a tool that talks to Todoist requires it.

## Registering with Claude Code

Either of these works; pick one.

**Project `.mcp.json` (recommended — already committed in this repo):**
```json
{
  "mcpServers": {
    "todoist-weekly-review": {
      "command": "node",
      "args": ["--env-file-if-exists=.env", "dist/index.js"]
    }
  }
}
```
With the `.env` file from Setup step 3 in place, just open Claude Code in this project folder
and approve the `todoist-weekly-review` server when prompted. The token stays in the
gitignored `.env`; `.mcp.json` itself contains no secret. (If `.env` doesn't exist, the server
still boots — the token can instead come from your shell environment, which it inherits.)

**Or `claude mcp add` (stores the token in your user-level Claude config, outside the repo):**
```bash
claude mcp add todoist-weekly-review --env TODOIST_API_TOKEN=<your-token> -- node <absolute-path>/dist/index.js
```

**Never commit a real token.** The only file a real token should ever live in is the
gitignored `.env` (or your shell profile / user-level Claude config). If you ever paste a
literal token into a tracked file, treat it as compromised and rotate it in Todoist.

## Safety rules

- **No delete, ever.** There is no delete code path in this server. Retire a task via
  `complete` or `move_to_project` → "Someday/Maybe".
- **Only `apply_changes` writes**, and only with an explicit list of changes.
- **Per-item approval.** The client model must propose a fix per task and get your explicit
  veto/approval on each one in chat before including it in an `apply_changes` call — never
  batch or infer changes you didn't confirm.
- **`apply_changes` validates as a whole batch** (a zod discriminated union over the action
  allowlist): if any single item is malformed — unknown action, missing/invalid params — the
  **entire call is rejected and nothing is written**, rather than silently skipping just the
  bad item. This was a deliberate choice between two valid designs (see `src/tools.ts`) —
  reject-the-whole-batch is the safer failure mode for a tool that mutates your task list.
- **Read errors are explicit, never silent.** `get_overdue_tasks` / `get_projects` distinguish
  401 (bad/missing token), 403 (plan-gated), 429 (rate limited), and network errors — none of
  them ever collapse into an empty list that could be misread as "nothing overdue."
- **Token handling.** `TODOIST_API_TOKEN` is read from the environment only, at request time,
  never logged, never committed. `.env` is gitignored.

## Running the tests

```bash
npm test
```
This builds (`tsc`) then runs `node --test` against the compiled `dist/*.test.js` files:
`dates.test.ts` (day-diff math, incl. a timezone edge case), `tools.test.ts` (task→output
mapping incl. `postponed_count` present/absent, `apply_changes` param validation per action,
and `executeChange` against a mocked `fetch` — zero live API calls), and `smoke.test.ts`.

The smoke test spawns the **built** server (`dist/index.js`) as a real child process over
stdio, connects an MCP `Client`, calls `listTools`, and asserts all 3 tools
(`get_overdue_tasks`, `get_projects`, `apply_changes`) are present with non-empty descriptions
— proving the MCP request/response loop works with no `TODOIST_API_TOKEN` set at all.

Note: `node --test dist/*.test.js` (not bare `node --test dist`) is intentional — passing a
bare directory to `node --test` runs *every* `.js` file inside it as a pseudo-test, which
would also directly execute `dist/index.js` and hang forever waiting on stdin.

## Tool surface

- **`get_overdue_tasks`** *(read-only)* — every currently-overdue task as
  `{ id, content, projectId, projectName, priority, dueDate, daysOverdue, timesRescheduled? }`.
- **`get_projects`** *(read-only)* — `{ id, name }[]`, so the client model can see what
  projects (e.g. "Someday/Maybe") already exist.
- **`apply_changes`** *(write)* — `{ changes: [{ taskId, action, params? }] }` where `action`
  is one of `reschedule | set_priority | move_to_project | reword | complete | apply_label`.
  Executed sequentially; returns a per-item `{ taskId, action, ok, error? }` result.

See each tool's `description` (returned by `listTools`, and in `src/tools.ts`) for the full,
richly-specified contract — those descriptions are what steer the client model into a correct
weekly review, per the project's core design goal.
