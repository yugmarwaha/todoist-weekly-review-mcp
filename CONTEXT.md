# CONTEXT — glossary (Todoist Weekly Review MCP)

Glossary only. No implementation details. Terms are canonical names the server + docs use.

## The Mess — the messy states the weekly review detects

Ranked by how much they hurt the owner (1 = worst):

1. **Overdue Pileup** — tasks whose due date is in the past and that the owner keeps
   rescheduling instead of doing. The signal is "past due" (and ideally "rescheduled
   repeatedly", if the API exposes that).

2. **Hidden Project** — a single task whose text is really a whole multi-step project,
   not one action (e.g. "plan trip", "sort out taxes"). Detected by the *client model's*
   judgment of the task text, not a hard rule. Fix = break it into real sub-tasks / a project.

3. **Stale Task** — a task that has sat untouched for a long time: never completed, never
   progressed, often no due date. Signal is "old + no recent activity".

## Other terms

- **Weekly Review** — the whole assisted pass: detect items of The Mess, propose fixes,
  apply the ones the owner confirms.
- **Reorganize** — the allowed changes the review may make to a task. v1 allowlist:
  `reschedule`, `set priority`, `move to project`, `split into sub-tasks`, `reword`,
  `complete`, `apply label`. **No hard delete in v1** (irreversible — retire a task by
  completing it or moving it to a "Someday/Maybe" project instead).
- **Retire** — the safe way to get rid of a task without destroying it. **v1 paths:** mark
  **complete**, or **move to a "Someday/Maybe" project**. (Retire-by-*label* is deferred — not
  wired in the v1 overdue skeleton.) Used for Overdue/Stale tasks no longer worth doing.
- **Human-in-the-loop** — no write happens without explicit owner confirmation.
