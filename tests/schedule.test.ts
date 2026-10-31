import { describe, expect, it } from 'vitest';
import { endOfLocalDay, isPollDue, schedulePhase } from '../src/schedule.js';

const at = (iso: string) => new Date(iso);
const unix = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

describe('schedulePhase', () => {
  it('Asia/Kolkata (+05:30) window boundaries', () => {
    expect(schedulePhase(at('2026-11-02T00:29:00Z'), 'Asia/Kolkata').phase).toBe('before');
    expect(schedulePhase(at('2026-11-02T00:30:00Z'), 'Asia/Kolkata')).toEqual({ phase: 'polling', localDate: '2026-11-02' });
    expect(schedulePhase(at('2026-11-02T05:30:00Z'), 'Asia/Kolkata').phase).toBe('fallback');
  });

  it('America/New_York on DST change day: 06:00 local is 11:00Z', () => {
    expect(schedulePhase(at('2026-11-01T10:59:00Z'), 'America/New_York').phase).toBe('before');
    expect(schedulePhase(at('2026-11-01T11:00:00Z'), 'America/New_York')).toEqual({ phase: 'polling', localDate: '2026-11-01' });
  });

  it('Pacific/Auckland local date is ahead of UTC', () => {
    expect(schedulePhase(at('2026-11-01T20:00:00Z'), 'Pacific/Auckland').localDate).toBe('2026-11-02');
  });
});

describe('endOfLocalDay', () => {
  it('Kolkata 23:59 local', () => {
    expect(endOfLocalDay(at('2026-11-02T03:00:00Z'), 'Asia/Kolkata')).toBe(unix('2026-11-02T18:29:00Z'));
  });
  it('New York on DST change day', () => {
    expect(endOfLocalDay(at('2026-11-01T12:00:00Z'), 'America/New_York')).toBe(unix('2026-11-02T04:59:00Z'));
  });
});

describe('isPollDue', () => {
  it('due with no prior attempt', () => {
    expect(isPollDue(at('2026-11-01T12:00:00Z'), null)).toBe(true);
  });
  it('not due at 29 minutes, due at 30', () => {
    const last = at('2026-11-01T12:00:00Z');
    expect(isPollDue(at('2026-11-01T12:29:00Z'), last)).toBe(false);
    expect(isPollDue(at('2026-11-01T12:30:00Z'), last)).toBe(true);
  });
});
