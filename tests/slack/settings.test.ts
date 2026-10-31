import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { DEFAULT_BANDS } from '../../src/bands.js';
import { loadLibrary } from '../../src/lines/library.js';
import { addBand, buildSettingsView, parseSettingsSubmission, removeBand } from '../../src/slack/settings.js';
import { getBag, saveBag } from '../../src/db/bags.js';
import { getPrefs, savePrefs } from '../../src/db/prefs.js';
import { upsertUser } from '../../src/db/users.js';
import { testDb } from '../helpers/db.js';

const lib = loadLibrary();
const allPacks = lib.packs.map((p) => p.id);
const defaults = { bands: DEFAULT_BANDS, packIds: allPacks, customLines: [] };

// Simulate what Slack sends back on submit: the view's initial values, with overrides.
function submitted(over: Record<string, Record<string, unknown>> = {}) {
  const view = buildSettingsView(defaults, lib) as any;
  const values: Record<string, Record<string, any>> = {};
  for (const b of view.blocks) {
    if (b.type !== 'input') continue;
    const el = b.element;
    const v =
      el.type === 'static_select' ? { type: el.type, selected_option: el.initial_option ?? null }
      : el.type === 'checkboxes' ? { type: el.type, selected_options: el.initial_options ?? [] }
      : { type: el.type, value: el.initial_value ?? null };
    values[b.block_id] = { v };
  }
  for (const [block, val] of Object.entries(over)) values[block] = { v: { ...values[block]?.v, ...val } };
  return { values, meta: JSON.parse(view.private_metadata) };
}
const ctx = { lib, userId: 'U1', workspaceEmoji: new Set(['partyparrot']) };

describe('buildSettingsView', () => {
  it('has 3 band rows and all 7 packs checked by default', () => {
    const view = buildSettingsView(defaults, lib) as any;
    expect(view.callback_id).toBe('settings');
    expect(view.blocks.filter((b: any) => /^band_\d+_label$/.test(b.block_id))).toHaveLength(3);
    const packs = view.blocks.find((b: any) => b.block_id === 'packs');
    expect(packs.element.options).toHaveLength(7);
    expect(packs.element.initial_options).toHaveLength(7);
  });
});

describe('parseSettingsSubmission', () => {
  it('accepts the unchanged defaults', () => {
    const { values, meta } = submitted();
    const r = parseSettingsSubmission(values, meta, ctx);
    expect(r.ok && r.prefs.bands).toEqual(DEFAULT_BANDS);
  });

  it('reports a gap on the later band min block', () => {
    const { values, meta } = submitted({ band_1_min: { value: '36' } });
    const r = parseSettingsSubmission(values, meta, ctx);
    expect(r.ok).toBe(false);
    expect(!r.ok && Object.keys(r.errors)).toContain('band_1_min');
  });

  it('requires at least one pack', () => {
    const { values, meta } = submitted({ packs: { selected_options: [] } });
    const r = parseSettingsSubmission(values, meta, ctx);
    expect(!r.ok && r.errors.packs).toBeTruthy();
  });

  it('rejects a custom line over 100 characters', () => {
    const { values, meta } = submitted({ band_2_custom: { value: 'x'.repeat(101) } });
    const r = parseSettingsSubmission(values, meta, ctx);
    expect(!r.ok && r.errors.band_2_custom).toBeTruthy();
  });

  it('rejects an unknown emoji but accepts workspace custom emoji', () => {
    const bad = submitted({ band_0_emoji: { value: ':not_a_real_emoji_xyz:' } });
    const r1 = parseSettingsSubmission(bad.values, bad.meta, ctx);
    expect(!r1.ok && r1.errors.band_0_emoji).toBeTruthy();
    const ok = submitted({ band_0_emoji: { value: ':partyparrot:' } });
    expect(parseSettingsSubmission(ok.values, ok.meta, ctx).ok).toBe(true);
  });

  it('parses custom lines (one per row) and pack selection', () => {
    const { values, meta } = submitted({
      band_2_custom: { value: 'ask me anything today\n\n  shipping mode  ' },
      fallback_custom: { value: 'still booting' },
      packs: { selected_options: [{ value: 'soft' }, { value: 'tech' }] },
    });
    const r = parseSettingsSubmission(values, meta, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.prefs.packIds).toEqual(['soft', 'tech']);
    expect(r.prefs.customLines.map((l) => [l.bandKey, l.text])).toEqual([
      ['high', 'ask me anything today'], ['high', 'shipping mode'], ['fallback', 'still booting'],
    ]);
    expect(new Set(r.prefs.customLines.map((l) => l.id)).size).toBe(3);
  });
});

describe('addBand / removeBand', () => {
  it('addBand splits the top band and stays valid; capped at 5', () => {
    const four = addBand(DEFAULT_BANDS);
    expect(four).toHaveLength(4);
    expect(four[3].max).toBe(100);
    expect(four[2].max + 1).toBe(four[3].min);
    expect(addBand(addBand(four))).toHaveLength(5);
  });
  it('removeBand drops the top band and extends the previous to 100; floor of 2', () => {
    const two = removeBand(DEFAULT_BANDS);
    expect(two).toHaveLength(2);
    expect(two[1].max).toBe(100);
    expect(removeBand(two)).toHaveLength(2);
  });
});

describe('saving settings', () => {
  let db: { pool: pg.Pool; close: () => Promise<void> };
  beforeAll(async () => { db = await testDb(); });
  afterAll(async () => { await db.close(); });
  beforeEach(async () => {
    await db.pool.query('TRUNCATE users CASCADE');
    await upsertUser(db.pool, { slackUserId: 'U1', teamId: 'T', tz: 'UTC' });
  });

  it('a valid submission saves and resets shuffle bags', async () => {
    await saveBag(db.pool, 'U1', 'high', { order: ['a'], position: 1, lastDrawn: 'a' });
    const { values, meta } = submitted({ packs: { selected_options: [{ value: 'soft' }] } });
    const r = parseSettingsSubmission(values, meta, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    await savePrefs(db.pool, 'U1', r.prefs);
    expect((await getPrefs(db.pool, 'U1', allPacks)).packIds).toEqual(['soft']);
    expect(await getBag(db.pool, 'U1', 'high')).toBeNull();
  });
});
