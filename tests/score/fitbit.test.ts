import { describe, expect, it } from 'vitest';
import { computeFitbitScore, type DailyMetrics } from '../../src/score/fitbit.js';

// 30 days before 2026-11-01; HRV alternates 50/60 (mean 55, SD 5), RHR alternates 55/65 (mean 60, SD 5)
function history(days = 30): DailyMetrics[] {
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(Date.UTC(2026, 10, 1 - (i + 1)));
    return {
      date: d.toISOString().slice(0, 10),
      hrvMs: i % 2 === 0 ? 50 : 60,
      rhrBpm: i % 2 === 0 ? 55 : 65,
      minutesAsleep: 450,
    };
  });
}
const today = (m: Partial<DailyMetrics>): DailyMetrics => ({ date: '2026-11-01', hrvMs: 55, rhrBpm: 60, minutesAsleep: 450, ...m });

describe('computeFitbitScore', () => {
  it('spec target: baseline HRV and RHR with 6h sleep scores 46', () => {
    expect(computeFitbitScore(today({ minutesAsleep: 360 }), history())).toBe(46);
  });
  it('baseline day with full sleep scores 50', () => {
    expect(computeFitbitScore(today({ minutesAsleep: 480 }), history())).toBe(50);
  });
  it('returns null with only 6 history days', () => {
    expect(computeFitbitScore(today({}), history(6))).toBeNull();
  });
  it('returns null when HRV and RHR are both missing today', () => {
    expect(computeFitbitScore(today({ hrvMs: null, rhrBpm: null }), history())).toBeNull();
  });
  it('HRV +1 SD and RHR -1 SD with full sleep scores 66', () => {
    expect(computeFitbitScore(today({ hrvMs: 60, rhrBpm: 55, minutesAsleep: 480 }), history())).toBe(66);
  });
  it('re-weights when sleep is missing: HRV +1 SD → 63', () => {
    expect(computeFitbitScore(today({ hrvMs: 60, minutesAsleep: null }), history())).toBe(63);
  });
  it('clamps to 0 and 100', () => {
    expect(computeFitbitScore(today({ hrvMs: 500, rhrBpm: 20 }), history())).toBe(100);
    expect(computeFitbitScore(today({ hrvMs: 1, rhrBpm: 200, minutesAsleep: 0 }), history())).toBe(0);
  });
  it('ignores a history row with the same date as today', () => {
    const h = [...history(), { date: '2026-11-01', hrvMs: 1000, rhrBpm: 1000, minutesAsleep: 0 }];
    expect(computeFitbitScore(today({ minutesAsleep: 360 }), h)).toBe(46);
  });
});
