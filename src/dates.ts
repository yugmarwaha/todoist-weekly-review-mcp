/**
 * Pure date helpers for the weekly review. No Todoist-specific logic here —
 * just calendar-date math done in a given IANA timezone so "today" and
 * "days overdue" line up with what the user actually sees in Todoist,
 * regardless of what timezone this process happens to run in.
 */

/**
 * Returns the local calendar date (YYYY-MM-DD) for `date` in the given IANA
 * timezone, using the en-CA locale trick (en-CA formats as YYYY-MM-DD).
 */
export function localDateString(date: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  } catch {
    // Invalid/unknown timezone: fall back to the server's local date.
    return new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  }
}

/**
 * Whole number of days between `dueDate` (a YYYY-MM-DD calendar date, or a
 * longer datetime string whose first 10 chars are the calendar date) and
 * "today" in `timezone`. Positive means overdue (due date is in the past);
 * zero means due today; negative means due in the future.
 *
 * Computed as a pure calendar-date diff (UTC midnight math on the two
 * YYYY-MM-DD strings) so DST transitions in `timezone` never skew the count.
 */
export function daysOverdue(dueDate: string, timezone: string, now: Date = new Date()): number {
  const dueCalendarDate = dueDate.slice(0, 10);
  const todayCalendarDate = localDateString(now, timezone);

  const due = Date.UTC(
    Number(dueCalendarDate.slice(0, 4)),
    Number(dueCalendarDate.slice(5, 7)) - 1,
    Number(dueCalendarDate.slice(8, 10)),
  );
  const today = Date.UTC(
    Number(todayCalendarDate.slice(0, 4)),
    Number(todayCalendarDate.slice(5, 7)) - 1,
    Number(todayCalendarDate.slice(8, 10)),
  );

  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((today - due) / msPerDay);
}
