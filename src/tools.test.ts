import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { mapOverdueTask, ChangeItemSchema, executeChange } from "./tools.js";
import type { TodoistTask } from "./todoist.js";
import { paginate } from "./todoist.js";

// ---------------------------------------------------------------------------
// mapOverdueTask: Todoist task -> tool output mapping
// ---------------------------------------------------------------------------

function makeTask(overrides: Partial<TodoistTask> = {}): TodoistTask {
  return {
    id: "123",
    content: "Do the thing",
    project_id: "p1",
    priority: 4,
    due: { date: "2026-07-01" },
    ...overrides,
  };
}

test("mapOverdueTask includes timesRescheduled when postponed_count is present", () => {
  const task = makeTask({ postponed_count: 3 });
  const out = mapOverdueTask(task, new Map([["p1", "Work"]]), "UTC", new Date("2026-07-05T00:00:00Z"));
  assert.equal(out.timesRescheduled, 3);
  assert.equal(out.daysOverdue, 4);
  assert.equal(out.projectName, "Work");
  assert.equal(out.projectId, "p1");
  assert.equal(out.priority, 4);
  assert.equal(out.dueDate, "2026-07-01");
  assert.equal(out.isRecurring, false);
});

test("mapOverdueTask omits timesRescheduled entirely when postponed_count is absent", () => {
  const task = makeTask(); // no postponed_count
  const out = mapOverdueTask(task, new Map([["p1", "Work"]]), "UTC", new Date("2026-07-05T00:00:00Z"));
  assert.equal("timesRescheduled" in out, false);
  assert.equal(out.isRecurring, false);
});

test("mapOverdueTask handles a datetime due.date by taking the calendar date", () => {
  const task = makeTask({ due: { date: "2026-07-01T14:00:00Z" } });
  const out = mapOverdueTask(task, new Map([["p1", "Work"]]), "UTC", new Date("2026-07-05T00:00:00Z"));
  assert.equal(out.dueDate, "2026-07-01");
  assert.equal(out.isRecurring, false);
});

test("mapOverdueTask falls back to a placeholder projectName when the id isn't in the map", () => {
  const task = makeTask({ project_id: "unknown" });
  const out = mapOverdueTask(task, new Map([["p1", "Work"]]), "UTC", new Date("2026-07-05T00:00:00Z"));
  assert.equal(out.projectName, "(unknown project)");
  assert.equal(out.isRecurring, false);
});

test("mapOverdueTask throws if the task has no due date", () => {
  const task = makeTask({ due: null });
  assert.throws(() => mapOverdueTask(task, new Map(), "UTC"));
});

test("mapOverdueTask sets isRecurring true when due.is_recurring is true", () => {
  const task = makeTask({ due: { date: "2026-07-01", is_recurring: true } });
  const out = mapOverdueTask(task, new Map([["p1", "Work"]]), "UTC", new Date("2026-07-05T00:00:00Z"));
  assert.equal(out.isRecurring, true);
});

test("mapOverdueTask sets isRecurring false when due.is_recurring is absent", () => {
  const task = makeTask({ due: { date: "2026-07-01" } });
  const out = mapOverdueTask(task, new Map([["p1", "Work"]]), "UTC", new Date("2026-07-05T00:00:00Z"));
  assert.equal(out.isRecurring, false);
});

// ---------------------------------------------------------------------------
// apply_changes input validation (discriminated union)
// ---------------------------------------------------------------------------

const ChangesArraySchema = z.array(ChangeItemSchema);

test("valid reschedule with dueDate parses", () => {
  const result = ChangesArraySchema.safeParse([
    { taskId: "1", action: "reschedule", params: { dueDate: "2026-07-10" } },
  ]);
  assert.equal(result.success, true);
});

test("valid reschedule with dueString parses", () => {
  const result = ChangesArraySchema.safeParse([
    { taskId: "1", action: "reschedule", params: { dueString: "next monday" } },
  ]);
  assert.equal(result.success, true);
});

test("reschedule with neither dueDate nor dueString is rejected", () => {
  const result = ChangesArraySchema.safeParse([{ taskId: "1", action: "reschedule", params: {} }]);
  assert.equal(result.success, false);
});

test("set_priority requires an integer 1-4", () => {
  assert.equal(
    ChangesArraySchema.safeParse([{ taskId: "1", action: "set_priority", params: { priority: 4 } }]).success,
    true,
  );
  assert.equal(
    ChangesArraySchema.safeParse([{ taskId: "1", action: "set_priority", params: { priority: 5 } }]).success,
    false,
  );
  assert.equal(
    ChangesArraySchema.safeParse([{ taskId: "1", action: "set_priority", params: { priority: 0 } }]).success,
    false,
  );
});

test("move_to_project requires projectName", () => {
  assert.equal(
    ChangesArraySchema.safeParse([{ taskId: "1", action: "move_to_project", params: {} }]).success,
    false,
  );
  assert.equal(
    ChangesArraySchema.safeParse([
      { taskId: "1", action: "move_to_project", params: { projectName: "Someday/Maybe" } },
    ]).success,
    true,
  );
});

test("reword requires non-empty content", () => {
  assert.equal(
    ChangesArraySchema.safeParse([{ taskId: "1", action: "reword", params: { content: "" } }]).success,
    false,
  );
  assert.equal(
    ChangesArraySchema.safeParse([{ taskId: "1", action: "reword", params: { content: "New text" } }])
      .success,
    true,
  );
});

test("complete takes no params", () => {
  assert.equal(ChangesArraySchema.safeParse([{ taskId: "1", action: "complete" }]).success, true);
});

test("apply_label requires a label", () => {
  assert.equal(
    ChangesArraySchema.safeParse([{ taskId: "1", action: "apply_label", params: {} }]).success,
    false,
  );
  assert.equal(
    ChangesArraySchema.safeParse([{ taskId: "1", action: "apply_label", params: { label: "waiting" } }])
      .success,
    true,
  );
});

test("unknown action is rejected", () => {
  const result = ChangesArraySchema.safeParse([{ taskId: "1", action: "delete" }]);
  assert.equal(result.success, false);
});

test("one bad item rejects the whole batch (documented discriminated-union behavior)", () => {
  const result = ChangesArraySchema.safeParse([
    { taskId: "1", action: "complete" },
    { taskId: "2", action: "reschedule", params: {} }, // invalid: neither dueDate nor dueString
  ]);
  assert.equal(result.success, false);
});

// ---------------------------------------------------------------------------
// executeChange: mocked fetch, zero live API calls
// ---------------------------------------------------------------------------

type MockResponse = { status: number; body?: unknown };

function installFetchMock(responses: MockResponse[]) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let i = 0;
  const original = globalThis.fetch;
  // @ts-expect-error test override
  globalThis.fetch = async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    if (i >= responses.length) {
      throw new Error(`Unexpected extra fetch call #${i + 1} to ${url}`);
    }
    const { status, body } = responses[i++];
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => (body === undefined ? "" : JSON.stringify(body)),
    } as Response;
  };
  return { calls, restore: () => (globalThis.fetch = original) };
}

before(() => {
  process.env.TODOIST_API_TOKEN = "test-token";
});

test("executeChange: reschedule sends due_date", async () => {
  const mock = installFetchMock([{ status: 204 }]);
  try {
    const result = await executeChange({
      taskId: "1",
      action: "reschedule",
      params: { dueDate: "2026-07-10" },
    });
    assert.equal(result.ok, true);
    assert.equal(mock.calls.length, 1);
    assert.match(mock.calls[0].url, /\/tasks\/1$/);
    const sentBody = JSON.parse(String(mock.calls[0].init?.body));
    assert.deepEqual(sentBody, { due_date: "2026-07-10" });
  } finally {
    mock.restore();
  }
});

test("executeChange: complete calls close", async () => {
  const mock = installFetchMock([{ status: 204 }]);
  try {
    const result = await executeChange({ taskId: "42", action: "complete" });
    assert.equal(result.ok, true);
    assert.match(mock.calls[0].url, /\/tasks\/42\/close$/);
  } finally {
    mock.restore();
  }
});

test("executeChange: move_to_project finds existing project by case-insensitive name", async () => {
  const mock = installFetchMock([
    { status: 200, body: { results: [{ id: "p9", name: "Someday/Maybe" }], next_cursor: null } },
    { status: 204 }, // move
  ]);
  try {
    const result = await executeChange({
      taskId: "1",
      action: "move_to_project",
      params: { projectName: "someday/maybe" },
    });
    assert.equal(result.ok, true);
    assert.equal(mock.calls.length, 2);
    assert.match(mock.calls[1].url, /\/tasks\/1\/move$/);
    const sentBody = JSON.parse(String(mock.calls[1].init?.body));
    assert.deepEqual(sentBody, { project_id: "p9" });
  } finally {
    mock.restore();
  }
});

test("executeChange: move_to_project creates the project when missing", async () => {
  const mock = installFetchMock([
    { status: 200, body: { results: [], next_cursor: null } },
    { status: 200, body: { id: "new1", name: "Someday/Maybe" } }, // create
    { status: 204 }, // move
  ]);
  try {
    const result = await executeChange({
      taskId: "1",
      action: "move_to_project",
      params: { projectName: "Someday/Maybe" },
    });
    assert.equal(result.ok, true);
    assert.equal(mock.calls.length, 3);
    assert.match(mock.calls[1].url, /\/projects$/);
    assert.match(mock.calls[2].url, /\/tasks\/1\/move$/);
  } finally {
    mock.restore();
  }
});

test("executeChange: apply_label appends to existing labels without duplicating", async () => {
  const mock = installFetchMock([
    { status: 200, body: { id: "1", content: "x", project_id: "p1", priority: 1, due: null, labels: ["a"] } },
    { status: 204 },
  ]);
  try {
    const result = await executeChange({ taskId: "1", action: "apply_label", params: { label: "b" } });
    assert.equal(result.ok, true);
    const sentBody = JSON.parse(String(mock.calls[1].init?.body));
    assert.deepEqual(sentBody.labels, ["a", "b"]);
  } finally {
    mock.restore();
  }
});

test("executeChange: reports failure per item on a 401 without throwing", async () => {
  const mock = installFetchMock([{ status: 401 }]);
  try {
    const result = await executeChange({ taskId: "1", action: "complete" });
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /401/);
  } finally {
    mock.restore();
  }
});

// ---------------------------------------------------------------------------
// paginate: cursor following, MAX_PAGES limit, repeated cursor detection
// ---------------------------------------------------------------------------

test("paginate follows next_cursor across 2 pages and concatenates results", async () => {
  const mock = installFetchMock([
    {
      status: 200,
      body: {
        results: [{ id: "1", name: "First" }, { id: "2", name: "Second" }],
        next_cursor: "page2cursor",
      },
    },
    {
      status: 200,
      body: { results: [{ id: "3", name: "Third" }], next_cursor: null },
    },
  ]);
  try {
    const items = (await paginate("/projects?limit=200")) as Array<{ id: string; name: string }>;
    assert.equal(items.length, 3);
    assert.equal(items[0].id, "1");
    assert.equal(items[1].id, "2");
    assert.equal(items[2].id, "3");
  } finally {
    mock.restore();
  }
});

test("paginate throws when the API returns the same next_cursor twice", async () => {
  const mock = installFetchMock([
    {
      status: 200,
      body: { results: [{ id: "1", name: "First" }], next_cursor: "samecursor" },
    },
    {
      status: 200,
      body: { results: [{ id: "2", name: "Second" }], next_cursor: "samecursor" },
    },
  ]);
  try {
    await assert.rejects(
      () => paginate("/projects?limit=200"),
      (err: Error) => err.message.includes("did not advance (repeated cursor)"),
    );
  } finally {
    mock.restore();
  }
});

test("paginate throws after exceeding 100 pages", async () => {
  const responses: Array<{ status: number; body: unknown }> = [];
  // Create 101 responses, each with an incrementing cursor
  for (let i = 0; i < 101; i++) {
    responses.push({
      status: 200,
      body: {
        results: [{ id: String(i), name: `Item ${i}` }],
        next_cursor: `cursor${i + 1}`,
      },
    });
  }
  const mock = installFetchMock(responses);
  try {
    await assert.rejects(
      () => paginate("/projects?limit=200"),
      (err: Error) => err.message.includes("exceeded 100 pages"),
    );
  } finally {
    mock.restore();
  }
});

after(() => {
  delete process.env.TODOIST_API_TOKEN;
});
