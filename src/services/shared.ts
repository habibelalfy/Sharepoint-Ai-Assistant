/**
 * Small shared date/logic helpers for the business-logic services.
 *
 * @module services/shared
 */

const COMPLETED = 'Completed';

/** True when an item is not completed and its due date has passed. */
export function isOverdue(
  status: string | undefined,
  dueDate: string | undefined,
  now: Date,
): boolean {
  if (status === COMPLETED) {
    return false;
  }
  if (!dueDate) {
    return false;
  }
  const due = new Date(dueDate);
  return !Number.isNaN(due.getTime()) && due.getTime() < now.getTime();
}

/** Adds whole days (UTC) to a date and returns the result as an ISO 8601 string. */
export function addDays(date: Date | string, days: number): string {
  const base = typeof date === 'string' ? new Date(date) : new Date(date.getTime());
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString();
}

/** Clamps a number to the inclusive range [0, 100]. */
export function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}
