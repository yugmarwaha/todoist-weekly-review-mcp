import { test } from "node:test";
import assert from "node:assert/strict";
import { daysOverdue, localDateString } from "./dates.js";

test("daysOverdue: date-only due, several days in the past", () => {
  const now = new Date("2026-07-10T12:00:00Z");
  assert.equal(daysOverdue("2026-07-03", "UTC", now), 7);
});

test("daysOverdue: datetime due (only first 10 chars used)", () => {
  const now = new Date("2026-07-10T12:00:00Z");
  assert.equal(daysOverdue("2026-07-08T09:30:00Z", "UTC", now), 2);
});

test("daysOverdue: due today is 0, not overdue", () => {
  const now = new Date("2026-07-10T23:00:00Z");
  assert.equal(daysOverdue("2026-07-10", "UTC", now), 0);
});

test("daysOverdue: due in the future is negative", () => {
  const now = new Date("2026-07-10T12:00:00Z");
  assert.equal(daysOverdue("2026-07-15", "UTC", now), -5);
});

test("daysOverdue: timezone edge — late-night UTC can be 'tomorrow' in a positive-offset zone", () => {
  // 2026-07-10T23:30:00Z is already 2026-07-11 in Auckland (UTC+12).
  const now = new Date("2026-07-10T23:30:00Z");
  // A task due 2026-07-10 is one full day overdue in Auckland's local "today".
  assert.equal(daysOverdue("2026-07-10", "Pacific/Auckland", now), 1);
  // But in UTC itself, "today" is still 2026-07-10, so it's due today (0).
  assert.equal(daysOverdue("2026-07-10", "UTC", now), 0);
});

test("localDateString formats using the en-CA YYYY-MM-DD trick", () => {
  const date = new Date("2026-01-05T00:00:00Z");
  assert.equal(localDateString(date, "UTC"), "2026-01-05");
});
