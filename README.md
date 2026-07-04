# Todoist Weekly Review MCP

> Status: v1 in progress. This README is being written as the server is built (see
> `IMPLEMENTATION.md` §0 — decisions are recorded here as they're made, not batched at the end).

## What this is

A thin MCP server that turns a weekly Todoist review into a human-in-the-loop assisted
workflow. It reads your overdue tasks and hands them, with the signals a reviewer needs
(days overdue, priority, project, times rescheduled), to the client model (e.g. Claude Code)
in chat. The client model proposes a fix per task; **you approve or veto each one in plain
language**; only then does the model call this server's write tool to apply the approved
changes. The server itself never reasons, ranks, or calls an LLM — it exposes facts and
executes explicitly approved writes. All judgment lives in the chat with you and the client
model.

More to come as the build progresses (decision records, verified-endpoints table, setup
instructions).
