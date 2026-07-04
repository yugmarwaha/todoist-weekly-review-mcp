/**
 * Thin Todoist REST API v1 client. Reads the token from the environment at
 * REQUEST time (not at import time) so the server can boot and list its
 * tools even when TODOIST_API_TOKEN isn't set yet — only calling a tool that
 * needs Todoist requires the token.
 *
 * See README.md for the verified-endpoints table and the corrections made
 * vs. the original IMPLEMENTATION.md draft (filter endpoint, move endpoint).
 */

const BASE_URL = "https://api.todoist.com/api/v1";

export class TodoistAuthError extends Error {}

function getToken(): string {
  const token = process.env.TODOIST_API_TOKEN;
  if (!token) {
    throw new Error(
      "TODOIST_API_TOKEN is not set. Export it before calling this tool (see README.md setup instructions).",
    );
  }
  return token;
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
  const url = path.startsWith("http") ? path : `${BASE_URL}${path}`;

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
  const items: T[] = [];
  let cursor: string | null = null;

  do {
    const separator = pathWithoutCursor.includes("?") ? "&" : "?";
    const path = cursor
      ? `${pathWithoutCursor}${separator}cursor=${encodeURIComponent(cursor)}`
      : pathWithoutCursor;
    const page = (await todoistFetch(path)) as CursorPage<T>;
    items.push(...page.results);
    cursor = page.next_cursor;
  } while (cursor);

  return items;
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
