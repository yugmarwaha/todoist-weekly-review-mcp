# CLAUDE.md

Thin MCP server (TypeScript, stdio) for a human-in-the-loop Todoist weekly review.
Spec lives in `IMPLEMENTATION.md`; decisions in `PLAN.md`; glossary in `CONTEXT.md`.

## Commands

- `npm run build` — compile to `dist/`
- `npm test` — build + unit tests + stdio smoke test (no token needed, API is mocked)
- `node scripts/mcp-call.mjs <tool> ['<json>']` — call one tool against the real server

## Layout

- `src/index.ts` — entry; boots McpServer, registers tools
- `src/tools.ts` — the 3 tools (`get_overdue_tasks`, `get_projects`, `apply_changes`) and their zod schemas
- `src/todoist.ts` — Todoist API v1 client (auth, pagination, error mapping)
- `src/dates.ts` — timezone-aware date math

## Non-negotiable rules

- Only `apply_changes` writes, and only with changes the user explicitly approved per item.
- No hard delete. The code path must not exist. Retire = `complete` or move to "Someday/Maybe".
- Token from `TODOIST_API_TOKEN` env only (loaded from gitignored `.env`). Never log or commit it.
- No server-side LLM calls, no pre-computed suggestions — judgment lives in the client model.
- Read errors must stay loud and distinguishable (401/403/429/network), never an empty list.
- Never write to stdout except MCP protocol; diagnostics go to stderr.

## API gotchas (verified live)

- Priority: API 4 = highest (UI P1). Pass through raw, never remap.
- Filter endpoint is `GET /tasks/filter?query=…`, not `/tasks?filter=`.
- Moving a task is `POST /tasks/{id}/move`; the update endpoint rejects `project_id`.
- Reschedule count = `postponed_count` on the task (activity log not needed, it's plan-gated).
- A task due earlier today is not "overdue" until the next day.
- All list endpoints use cursor pagination (`cursor` / `next_cursor`) — follow to exhaustion.

## Style

Keep the README and any docs short and plain. Tool descriptions are the steering
mechanism for the client model — keep them rich and behavioral instead.
