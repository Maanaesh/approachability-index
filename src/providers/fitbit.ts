import { DateTime } from 'luxon';
import type pg from 'pg';
import type { Config } from '../config.js';
import { getMetrics, upsertMetrics } from '../db/metrics.js';
import { computeFitbitScore, type DailyMetrics } from '../score/fitbit.js';
import { postTokenForm, ReauthRequired, type Provider, type ScoreResult } from './types.js';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://health.googleapis.com/v4/users/me/dataTypes';
const SCOPES = [
  'https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly',
  'https://www.googleapis.com/auth/googlehealth.sleep.readonly',
];
const RECONNECT_REMINDER_MS = 6 * 24 * 3600_000;
const MIN_HISTORY = 7;

class TemporaryError extends Error {}

type GDate = string | { year: number; month: number; day: number };

function dateOf(v: GDate | undefined): string | null {
  if (!v) return null;
  if (typeof v === 'string') return v.slice(0, 10);
  return `${v.year}-${String(v.month).padStart(2, '0')}-${String(v.day).padStart(2, '0')}`;
}

function sleepDate(interval: any, tz: string): string | null {
  const civil = interval?.civilEndTime;
  if (typeof civil === 'string') return civil.slice(0, 10);
  if (civil?.date) return dateOf(civil.date);
  return interval?.endTime ? DateTime.fromISO(interval.endTime, { zone: tz }).toISODate() : null;
}

async function listAll(fetchFn: typeof fetch, accessToken: string, type: string, filter: string, pageSize: number): Promise<any[]> {
  const out: any[] = [];
  let pageToken = '';
  do {
    const q = new URLSearchParams({ filter, pageSize: String(pageSize) });
    if (pageToken) q.set('pageToken', pageToken);
    const res = await fetchFn(`${API}/${type}/dataPoints?${q}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (res.status === 401) throw new ReauthRequired('google 401');
    if (!res.ok) throw new TemporaryError(`google ${res.status}`);
    const body = (await res.json()) as { dataPoints?: any[]; nextPageToken?: string };
    out.push(...(body.dataPoints ?? []));
    pageToken = body.nextPageToken ?? '';
  } while (pageToken);
  return out;
}

export async function fetchDailyMetrics(
  accessToken: string,
  fromDate: string,
  toDate: string,
  tz: string,
  fetchFn: typeof fetch = fetch,
): Promise<DailyMetrics[]> {
  const byDate = new Map<string, DailyMetrics>();
  const row = (date: string) => {
    if (!byDate.has(date)) byDate.set(date, { date, hrvMs: null, rhrBpm: null, minutesAsleep: null });
    return byDate.get(date)!;
  };
  // The API only supports >= and < on dates, and sleep can only be filtered on interval.end_time (UTC).
  const dayAfter = DateTime.fromISO(toDate).plus({ days: 1 }).toISODate();
  const dateRange = (field: string) => `${field}.date >= "${fromDate}" AND ${field}.date < "${dayAfter}"`;
  const utc = (d: string) => DateTime.fromISO(d, { zone: tz }).startOf('day').toUTC().toISO({ suppressMilliseconds: true });
  const sleepFilter = `sleep.interval.end_time >= "${utc(fromDate)}" AND sleep.interval.end_time < "${utc(dayAfter!)}"`;

  const [hrv, rhr, sleep] = await Promise.all([
    listAll(fetchFn, accessToken, 'daily-heart-rate-variability', dateRange('daily_heart_rate_variability'), 1000),
    listAll(fetchFn, accessToken, 'daily-resting-heart-rate', dateRange('daily_resting_heart_rate'), 1000),
    listAll(fetchFn, accessToken, 'sleep', sleepFilter, 25),
  ]);

  for (const p of hrv) {
    const d = dateOf(p.dailyHeartRateVariability?.date);
    const v = p.dailyHeartRateVariability?.averageHeartRateVariabilityMilliseconds;
    if (d && v != null) row(d).hrvMs = Number(v);
  }
  for (const p of rhr) {
    const d = dateOf(p.dailyRestingHeartRate?.date);
    const v = p.dailyRestingHeartRate?.beatsPerMinute;
    if (d && v != null) row(d).rhrBpm = Number(v);
  }
  for (const p of sleep) {
    if (p.sleep?.metadata?.mainSleep !== true) continue;
    const d = sleepDate(p.sleep.interval, tz);
    const v = p.sleep.summary?.minutesAsleep;
    if (d && d >= fromDate && d <= toDate && v != null) row(d).minutesAsleep = Number(v);
  }
  return [...byDate.values()].filter((r) => r.date >= fromDate && r.date <= toDate).sort((a, b) => a.date.localeCompare(b.date));
}

// Google's testing mode expires refresh tokens after 7 days; nudge on day 6.
export function needsReconnectReminder(issuedAt: Date, now: Date): boolean {
  return now.getTime() - issuedAt.getTime() >= RECONNECT_REMINDER_MS;
}

const shiftDate = (date: string, days: number) => DateTime.fromISO(date).plus({ days }).toISODate()!;

export function fitbitProvider(
  cfg: Config,
  deps: { pool: pg.Pool },
  fetchFn: typeof fetch = fetch,
): Provider & { backfill(accessToken: string, userId: string, tz: string, days?: number, now?: Date): Promise<void> } {
  const redirectUri = `${cfg.publicBaseUrl}/oauth/fitbit/callback`;
  const tokenParams = { client_id: cfg.google.clientId, client_secret: cfg.google.clientSecret };

  return {
    id: 'fitbit',
    authUrl(state) {
      const q = new URLSearchParams({
        client_id: cfg.google.clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: SCOPES.join(' '),
        access_type: 'offline',
        prompt: 'consent',
        include_granted_scopes: 'true',
        state,
      });
      return `${AUTH_URL}?${q}`;
    },
    exchangeCode: (code) => postTokenForm(fetchFn, TOKEN_URL, { ...tokenParams, grant_type: 'authorization_code', code, redirect_uri: redirectUri }),
    refresh: (refreshToken) => postTokenForm(fetchFn, TOKEN_URL, { ...tokenParams, grant_type: 'refresh_token', refresh_token: refreshToken }),

    async getTodayScore(accessToken, { userId, localDate, tz }): Promise<ScoreResult> {
      try {
        await upsertMetrics(deps.pool, userId, await fetchDailyMetrics(accessToken, shiftDate(localDate, -1), localDate, tz, fetchFn));
      } catch (err) {
        if (err instanceof TemporaryError) return { score: null, reason: 'temporary_error' };
        throw err;
      }
      const rows = await getMetrics(deps.pool, userId, shiftDate(localDate, -30), localDate);
      const today = rows.find((r) => r.date === localDate) ?? { date: localDate, hrvMs: null, rhrBpm: null, minutesAsleep: null };
      const history = rows.filter((r) => r.date !== localDate);
      const score = computeFitbitScore(today, history);
      if (score != null) return { score, reason: 'ok' };
      const usable = history.filter((r) => r.hrvMs != null || r.rhrBpm != null).length;
      return { score: null, reason: usable < MIN_HISTORY ? 'insufficient_history' : 'no_data' };
    },

    async backfill(accessToken, userId, tz, days = 30, now = new Date()) {
      const today = DateTime.fromJSDate(now, { zone: tz }).toISODate()!;
      await upsertMetrics(deps.pool, userId, await fetchDailyMetrics(accessToken, shiftDate(today, -days), today, tz, fetchFn));
    },
  };
}
