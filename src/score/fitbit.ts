export type DailyMetrics = { date: string; hrvMs: number | null; rhrBpm: number | null; minutesAsleep: number | null };

const BASELINE_DAYS = 30;
const MIN_BASELINE = 7;
const SLEEP_TARGET_MIN = 450;
const WEIGHTS = { hrv: 0.5, rhr: 0.3, sleep: 0.2 };

function daysBefore(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function zScore(value: number, sample: number[]): number {
  const mean = sample.reduce((a, b) => a + b, 0) / sample.length;
  const sd = Math.sqrt(sample.reduce((a, b) => a + (b - mean) ** 2, 0) / sample.length);
  return sd === 0 ? 0 : (value - mean) / sd;
}

export function computeFitbitScore(today: DailyMetrics, history: DailyMetrics[]): number | null {
  const from = daysBefore(today.date, BASELINE_DAYS);
  const baseline = history.filter((h) => h.date >= from && h.date < today.date);
  const hrvs = baseline.map((h) => h.hrvMs).filter((v): v is number => v != null);
  const rhrs = baseline.map((h) => h.rhrBpm).filter((v): v is number => v != null);

  const parts: { weight: number; z: number }[] = [];
  if (today.hrvMs != null && hrvs.length >= MIN_BASELINE) {
    parts.push({ weight: WEIGHTS.hrv, z: zScore(today.hrvMs, hrvs) });
  }
  if (today.rhrBpm != null && rhrs.length >= MIN_BASELINE) {
    parts.push({ weight: WEIGHTS.rhr, z: -zScore(today.rhrBpm, rhrs) });
  }
  if (parts.length === 0) return null;
  if (today.minutesAsleep != null) {
    const ratio = Math.min(today.minutesAsleep / SLEEP_TARGET_MIN, 1);
    parts.push({ weight: WEIGHTS.sleep, z: (ratio - 1) * 5 });
  }

  const totalWeight = parts.reduce((a, p) => a + p.weight, 0);
  const z = parts.reduce((a, p) => a + (p.weight / totalWeight) * p.z, 0);
  return Math.min(100, Math.max(0, Math.round(50 + 20 * z)));
}
