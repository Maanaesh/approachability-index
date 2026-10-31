import { DateTime } from 'luxon';

export type Phase = 'before' | 'polling' | 'fallback';

const POLL_START_HOUR = 6;
const FALLBACK_HOUR = 11;
const POLL_INTERVAL_MS = 30 * 60_000;

export function schedulePhase(now: Date, tz: string): { phase: Phase; localDate: string } {
  const local = DateTime.fromJSDate(now, { zone: tz });
  const phase: Phase = local.hour < POLL_START_HOUR ? 'before' : local.hour < FALLBACK_HOUR ? 'polling' : 'fallback';
  return { phase, localDate: local.toISODate()! };
}

export function endOfLocalDay(now: Date, tz: string): number {
  return Math.floor(DateTime.fromJSDate(now, { zone: tz }).set({ hour: 23, minute: 59, second: 0, millisecond: 0 }).toSeconds());
}

export function isPollDue(now: Date, lastAttempt: Date | null): boolean {
  return lastAttempt === null || now.getTime() - lastAttempt.getTime() >= POLL_INTERVAL_MS;
}
