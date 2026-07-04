# Todoist Weekly Review MCP

An MCP server for doing a weekly review of your Todoist with Claude. It lists your
overdue tasks with the signals that matter (days overdue, priority, how often you've
postponed each one). Claude suggests a fix per task, you approve or veto each one in
chat, and only the approved changes are applied. The server decides nothing on its own
and makes no LLM calls. Unofficial — not affiliated with Doist.

v1 handles overdue tasks only. Roadmap and design history: `PLAN.md`, `CONTEXT.md`.

## Quick start

```bash
npm install && npm run build
cp .env.example .env   # paste your token from Todoist → Settings → Integrations → Developer
# (or create ~/.config/todoist-weekly-review/.env instead — see below)
```

Open Claude Code in this folder, approve the `todoist-weekly-review` server when asked,
and say **"run my weekly review"**.

## Install as a Claude Code plugin

```
/plugin marketplace add yugmarwaha/todoist-weekly-review-mcp
/plugin install todoist-weekly-review@yugmarwaha-plugins
```

Then create `~/.config/todoist-weekly-review/.env` containing
`TODOIST_API_TOKEN=<your token>` (or export that variable in your shell) and run
`/todoist-weekly-review`.

## Tools

| Tool | What it does |
|------|--------------|
| `get_overdue_tasks` | Read-only. Overdue tasks + signals. |
| `get_projects` | Read-only. Your projects. |
| `apply_changes` | The only write. Actions: `reschedule`, `set_priority`, `move_to_project`, `reword`, `complete`, `apply_label`. |

## Safety

- Nothing is written without your explicit per-item approval in chat.
- No delete exists. Tasks are retired by completing them or moving them to "Someday/Maybe"
  (created automatically if missing).
- Token lives in the gitignored `.env` only — never logged, never committed.
- Read errors are loud (bad token, rate limit, etc.) — never a silent empty list.
- A malformed change rejects the whole batch before anything is written.

## Design notes

- **"Times rescheduled"** comes from the task's `postponed_count` field, so the
  plan-gated activity log isn't needed. Omitted when Todoist doesn't return it.
- **Priority is inverted in the API**: 4 = highest (the UI's P1). Passed through as-is.
- Endpoints verified against the live v1 OpenAPI spec. Two fixes vs. the draft plan:
  filtering is `GET /tasks/filter?query=…`, and moving a task is `POST /tasks/{id}/move`.
- Todoist quirk: a task due earlier *today* doesn't count as "overdue" until tomorrow.
- Days overdue are computed in your Todoist account's timezone.
- Recurring tasks are flagged `isRecurring` — completing one advances it to the next
  occurrence instead of retiring it.

## Tests

```bash
npm test
```

43 unit tests (API mocked, no live calls) plus a smoke test that boots the real server
over stdio without any token.
