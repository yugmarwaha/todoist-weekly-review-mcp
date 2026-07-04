/**
 * Thin Todoist REST API v1 client. Reads the token from the environment at
 * REQUEST time (not at import time) so the server can boot and list its
 * tools even when TODOIST_API_TOKEN isn't set yet — only calling a tool that
 * needs Todoist requires the token.
 *
 * See README.md for the verified-endpoints table and the corrections made
 * vs. the original IMPLEMENTATION.md draft (filter endpoint, move endpoint).
 */

import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";

const BASE_URL = "https://api.todoist.com/api/v1";

export class TodoistAuthError extends Error {}

const TOKEN_CONFIG_PATH = path.join(os.homedir(), ".config", "todoist-weekly-review", ".env");

/**
 * Pure parser for the token config file's contents: looks for a
 * `TODOIST_API_TOKEN=<value>` line, ignoring blank lines and `#` comments,
 * trimming whitespace, and stripping surrounding quotes from the value.
 * Exported for unit testing without touching the filesystem.
 */
export function tokenFromEnvFileText(text: string): string | undefined {
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (key !== "TODOIST_API_TOKEN") continue;
    let value = line.slice(eq + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    return value || undefined;
  }
  return undefined;
}

// Cache the token once we've successfully read it from the config file, so
// we don't hit the filesystem on every request. Only a SUCCESSFUL read is
// cached — if the file is missing (or has no token yet), we keep trying on
// later calls so a user can create it without restarting the server.
let cachedFileToken: string | undefined;

function tokenFromConfigFile(): string | undefined {
  if (cachedFileToken) return cachedFileToken;
  try {
    const text = fs.readFileSync(TOKEN_CONFIG_PATH, "utf8");
    const token = tokenFromEnvFileText(text);
    if (token) {
      cachedFileToken = token;
      return token;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function getToken(): string {
  const envToken = process.env.TODOIST_API_TOKEN;
  if (envToken) return envToken;

  const fileToken = tokenFromConfigFile();
  if (fileToken) return fileToken;

  throw new Error(
    "TODOIST_API_TOKEN is not set. Either export it in your shell, or create " +
      "~/.config/todoist-weekly-review/.env containing a line: " +
      "TODOIST_API_TOKEN=<your token>. Get a token from Todoist → Settings → " +
      "Integrations → Developer.",
  );
}

/**
 * Low-level fetch wrapper: sets the auth header, handles JSON bodies, and
 * maps non-2xx responses / network failures to clear, distinguishable
 * errors. Always throws on failure — callers must NOT swallow this into an
 * empty result, per the safety rules (a read failure must never look like
 * "nothing overdue").
 */
export async function todoistFetch(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<unknown> {
  const token = getToken();
  const url = `${BASE_URL}${path}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: init.method ?? "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Network error calling Todoist API (${path}): ${message}`);
  }

  if (response.status === 401) {
    throw new TodoistAuthError("Todoist rejected the token (401): check TODOIST_API_TOKEN");
  }
  if (response.status === 403) {
    throw new Error(
      "Forbidden (403): this endpoint/feature may be gated by your Todoist plan",
    );
  }
  if (response.status === 429) {
    throw new Error("Rate limited (429): retry later");
  }
  if (!response.ok) {
    const bodySnippet = (await response.text().catch(() => "")).slice(0, 500);
    throw new Error(`Todoist API error ${response.status} on ${path}: ${bodySnippet}`);
  }

  if (response.status === 204) {
    return undefined;
  }

  const text = await response.text();
  if (!text) {
    return undefined;
  }
  return JSON.parse(text);
}

interface CursorPage<T> {
  results: T[];
  next_cursor: string | null;
}

/**
 * Follows `cursor`/`next_cursor` to exhaustion for any Todoist v1 list
 * endpoint that returns `{ results, next_cursor }`. `pathWithoutCursor`
 * should already include any other query params (e.g. `?query=overdue`);
 * this helper appends `cursor=` itself.
 */
export async function paginate<T>(pathWithoutCursor: string): Promise<T[]> {
  const MAX_PAGES = 100;
  const items: T[] = [];
  let cursor: string | null = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    const separator = pathWithoutCursor.includes("?") ? "&" : "?";
    const path = cursor
      ? `${pathWithoutCursor}${separator}cursor=${encodeURIComponent(cursor)}`
      : pathWithoutCursor;
    const result = (await todoistFetch(path)) as CursorPage<T>;
    items.push(...result.results);
    if (result.next_cursor === null || result.next_cursor === undefined) {
      return items;
    }
    if (result.next_cursor === cursor) {
      throw new Error(
        `Todoist pagination did not advance (repeated cursor) on ${pathWithoutCursor} — aborting`,
      );
    }
    cursor = result.next_cursor;
  }
  throw new Error(
    `Todoist pagination exceeded ${MAX_PAGES} pages on ${pathWithoutCursor} — aborting to avoid an unbounded loop`,
  );
}

export interface TodoistDue {
  date: string;
  string?: string;
  lang?: string;
  is_recurring?: boolean;
  timezone?: string | null;
}

export interface TodoistTask {
  id: string;
  content: string;
  project_id: string;
  priority: number;
  due: TodoistDue | null;
  postponed_count?: number;
  checked?: boolean;
  labels?: string[];
}

export interface TodoistProject {
  id: string;
  name: string;
}

export async function getUserTimezone(): Promise<string> {
  try {
    const user = (await todoistFetch("/user")) as { tz_info?: { timezone?: string } };
    const tz = user?.tz_info?.timezone;
    if (tz) return tz;
  } catch (err) {
    console.error("Could not fetch user timezone, falling back to server local time:", err);
  }
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export async function getAllProjects(): Promise<TodoistProject[]> {
  return paginate<TodoistProject>("/projects?limit=200");
}

export async function getOverdueTasks(): Promise<TodoistTask[]> {
  return paginate<TodoistTask>("/tasks/filter?query=overdue&limit=200");
}

export async function getTask(taskId: string): Promise<TodoistTask> {
  return (await todoistFetch(`/tasks/${encodeURIComponent(taskId)}`)) as TodoistTask;
}

export async function updateTask(
  taskId: string,
  body: Record<string, unknown>,
): Promise<void> {
  await todoistFetch(`/tasks/${encodeURIComponent(taskId)}`, { method: "POST", body });
}

export async function moveTask(taskId: string, projectId: string): Promise<void> {
  await todoistFetch(`/tasks/${encodeURIComponent(taskId)}/move`, {
    method: "POST",
    body: { project_id: projectId },
  });
}

export async function closeTask(taskId: string): Promise<void> {
  await todoistFetch(`/tasks/${encodeURIComponent(taskId)}/close`, { method: "POST" });
}

export async function createProject(name: string): Promise<TodoistProject> {
  return (await todoistFetch("/projects", {
    method: "POST",
    body: { name },
  })) as TodoistProject;
}

/**
 * Deterministic find-or-create for move_to_project: exact (case-insensitive)
 * name match against the full project list; create it if not found. This is
 * the only server-side "logic" in apply_changes — plumbing, not judgment.
 */
export async function findOrCreateProjectByName(name: string): Promise<TodoistProject> {
  const projects = await getAllProjects();
  const match = projects.find((p) => p.name.toLowerCase() === name.toLowerCase());
  if (match) return match;
  return createProject(name);
}
