import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import type { App } from '@slack/bolt';
import { FALLBACK, MAX_BANDS, MIN_BANDS, normalizeEmoji, type Band, type Tone } from '../bands.js';
import { getPrefs, savePrefs, type CustomLine, type Prefs } from '../db/prefs.js';
import type { Library } from '../lines/library.js';
import type { RunDeps } from '../runner/runUser.js';

const require = createRequire(import.meta.url);
const STANDARD_EMOJI = new Set<string>(
  (require('emoji-datasource/emoji.json') as { short_names: string[] }[]).flatMap((e) => e.short_names),
);
const MAX_LINE = 100;
const TONES: { value: Tone; text: string }[] = [
  { value: 'high', text: '✨ high-energy lines' },
  { value: 'mid', text: '🫠 mid lines' },
  { value: 'low', text: '🔋 low-key lines' },
];

type Meta = { bandKeys: string[] };
type Values = Record<string, Record<string, any>>;
export type ParseResult = { ok: true; prefs: Prefs } | { ok: false; errors: Record<string, string> };

const plain = (text: string) => ({ type: 'plain_text', text, emoji: true });
const option = (text: string, value: string) => ({ text: plain(text), value });

function input(blockId: string, label: string, element: Record<string, unknown>, optional = false) {
  return { type: 'input', block_id: blockId, label: plain(label), optional, element: { action_id: 'v', ...element } };
}

const linesText = (lines: CustomLine[], bandKey: string) => lines.filter((l) => l.bandKey === bandKey).map((l) => l.text).join('\n');

export function buildSettingsView(prefs: Prefs, lib: Library): Record<string, unknown> {
  const bands = [...prefs.bands].sort((a, b) => a.min - b.min);
  const blocks: unknown[] = [
    { type: 'section', text: { type: 'mrkdwn', text: 'tune your vibe ✨ bands must cover 0–100 with no gaps. teammates only ever see the emoji and line, never the number.' } },
  ];
  bands.forEach((b, i) => {
    const custom = linesText(prefs.customLines, b.key);
    const tone = TONES.find((t) => t.value === b.tone)!;
    blocks.push(
      { type: 'divider' },
      input(`band_${i}_label`, `Band ${i + 1} name`, { type: 'plain_text_input', initial_value: b.label, max_length: 30 }),
      input(`band_${i}_min`, 'From score', { type: 'number_input', is_decimal_allowed: false, min_value: '0', max_value: '100', initial_value: String(b.min) }),
      input(`band_${i}_max`, 'To score', { type: 'number_input', is_decimal_allowed: false, min_value: '0', max_value: '100', initial_value: String(b.max) }),
      input(`band_${i}_tone`, 'Draw lines from', { type: 'static_select', options: TONES.map((t) => option(t.text, t.value)), initial_option: option(tone.text, tone.value) }),
      input(`band_${i}_emoji`, 'Emoji for your own lines', { type: 'plain_text_input', initial_value: `:${b.emoji}:` }),
      input(`band_${i}_custom`, 'Your own lines (one per row, optional)', { type: 'plain_text_input', multiline: true, ...(custom ? { initial_value: custom } : {}) }, true),
    );
  });
  const fallbackCustom = linesText(prefs.customLines, FALLBACK.key);
  const packOptions = lib.packs.map((p) => option(`:${p.emoji}: ${p.name}`, p.id));
  blocks.push(
    { type: 'divider' },
    input('fallback_custom', 'Your own “no score yet” lines (optional)', { type: 'plain_text_input', multiline: true, ...(fallbackCustom ? { initial_value: fallbackCustom } : {}) }, true),
    input('packs', 'Line packs', { type: 'checkboxes', options: packOptions, initial_options: packOptions.filter((o) => prefs.packIds.includes(o.value)) }),
    {
      type: 'actions',
      block_id: 'band_controls',
      elements: [
        { type: 'button', action_id: 'add_band', text: plain('➕ Add band') },
        { type: 'button', action_id: 'remove_band', text: plain('➖ Remove top band') },
      ],
    },
  );
  return {
    type: 'modal',
    callback_id: 'settings',
    title: plain('Approachability'),
    submit: plain('Save'),
    close: plain('Cancel'),
    private_metadata: JSON.stringify({ bandKeys: bands.map((b) => b.key) } satisfies Meta),
    blocks,
  };
}

const val = (values: Values, block: string) => values[block]?.v;
const splitLines = (text: string | null | undefined) => (text ?? '').split('\n').map((l) => l.trim()).filter(Boolean);

// Best-effort read of the form, used both for submit and for add/remove re-renders.
function readForm(values: Values, meta: Meta, userId: string): Prefs & { rawCustom: Record<string, string[]> } {
  const rawCustom: Record<string, string[]> = {};
  const bands: Band[] = meta.bandKeys.map((key, i) => {
    rawCustom[key] = splitLines(val(values, `band_${i}_custom`)?.value);
    return {
      key,
      label: (val(values, `band_${i}_label`)?.value ?? '').trim() || `Band ${i + 1}`,
      min: Number(val(values, `band_${i}_min`)?.value),
      max: Number(val(values, `band_${i}_max`)?.value),
      tone: (val(values, `band_${i}_tone`)?.selected_option?.value ?? 'mid') as Tone,
      emoji: normalizeEmoji(val(values, `band_${i}_emoji`)?.value ?? ''),
    };
  });
  rawCustom[FALLBACK.key] = splitLines(val(values, 'fallback_custom')?.value);
  const packIds: string[] = (val(values, 'packs')?.selected_options ?? []).map((o: { value: string }) => o.value);
  let n = 0;
  const customLines = Object.entries(rawCustom).flatMap(([bandKey, lines]) => lines.map((text) => ({ id: `${userId}:${bandKey}:${n++}`, bandKey, text })));
  return { bands, packIds, customLines, rawCustom };
}

export function parseSettingsSubmission(values: Values, meta: Meta, ctx: { lib: Library; userId: string; workspaceEmoji: Set<string> }): ParseResult {
  const form = readForm(values, meta, ctx.userId);
  const errors: Record<string, string> = {};
  const err = (block: string, msg: string) => { errors[block] ??= msg; };

  form.bands.forEach((b, i) => {
    if (!Number.isInteger(b.min)) err(`band_${i}_min`, 'needs a whole number');
    if (!Number.isInteger(b.max)) err(`band_${i}_max`, 'needs a whole number');
    if (Number.isInteger(b.min) && Number.isInteger(b.max) && b.min > b.max) err(`band_${i}_max`, '“to” must be ≥ “from”');
    if (!b.emoji || !(STANDARD_EMOJI.has(b.emoji) || ctx.workspaceEmoji.has(b.emoji))) err(`band_${i}_emoji`, 'that emoji doesn’t exist here');
    if (form.rawCustom[b.key].some((l) => l.length > MAX_LINE)) err(`band_${i}_custom`, `keep each line to ${MAX_LINE} characters`);
  });
  if (form.rawCustom[FALLBACK.key].some((l) => l.length > MAX_LINE)) err('fallback_custom', `keep each line to ${MAX_LINE} characters`);
  if (form.packIds.length === 0) err('packs', 'keep at least one pack on');

  const order = form.bands.map((b, i) => ({ b, i })).sort((x, y) => x.b.min - y.b.min);
  if (order.length) {
    if (order[0].b.min !== 0) err(`band_${order[0].i}_min`, 'the lowest band must start at 0');
    if (order[order.length - 1].b.max !== 100) err(`band_${order[order.length - 1].i}_max`, 'the top band must end at 100');
  }
  for (let k = 1; k < order.length; k++) {
    const prev = order[k - 1].b;
    const cur = order[k];
    if (cur.b.min > prev.max + 1) err(`band_${cur.i}_min`, `gap after “${prev.label}” — start at ${prev.max + 1}`);
    if (cur.b.min <= prev.max) err(`band_${cur.i}_min`, `overlaps “${prev.label}” — start at ${prev.max + 1}`);
  }

  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, prefs: { bands: order.map((o) => o.b), packIds: form.packIds, customLines: form.customLines } };
}

const newKey = () => `band_${randomBytes(4).toString('hex')}`;

export function addBand(bands: Band[]): Band[] {
  const sorted = [...bands].sort((a, b) => a.min - b.min);
  const top = sorted[sorted.length - 1];
  if (sorted.length >= MAX_BANDS || top.min >= 100) return sorted;
  const split = Math.floor((top.min + 100) / 2);
  return [...sorted.slice(0, -1), { ...top, max: split }, { key: newKey(), label: 'New band', min: split + 1, max: 100, tone: top.tone, emoji: top.emoji }];
}

export function removeBand(bands: Band[]): Band[] {
  const sorted = [...bands].sort((a, b) => a.min - b.min);
  if (sorted.length <= MIN_BANDS) return sorted;
  const rest = sorted.slice(0, -1);
  return [...rest.slice(0, -1), { ...rest[rest.length - 1], max: 100 }];
}

async function workspaceEmoji(client: any): Promise<Set<string>> {
  try {
    return new Set(Object.keys((await client.emoji.list()).emoji ?? {}));
  } catch {
    return new Set();
  }
}

export function registerSettings(app: App, deps: RunDeps) {
  const allPacks = () => deps.library.packs.map((p) => p.id);

  async function openSettings({ triggerId, userId, client }: { triggerId: string; userId: string; client: any }) {
    const prefs = await getPrefs(deps.pool, userId, allPacks());
    await client.views.open({ trigger_id: triggerId, view: buildSettingsView(prefs, deps.library) });
  }

  app.view('settings', async ({ ack, body, view, client }) => {
    const meta = JSON.parse(view.private_metadata) as Meta;
    const result = parseSettingsSubmission(view.state.values as Values, meta, { lib: deps.library, userId: body.user.id, workspaceEmoji: await workspaceEmoji(client) });
    if (!result.ok) return void (await ack({ response_action: 'errors', errors: result.errors }));
    await ack();
    await savePrefs(deps.pool, body.user.id, result.prefs);
  });

  for (const actionId of ['add_band', 'remove_band'] as const) {
    app.action(actionId, async ({ ack, body, client }) => {
      await ack();
      const view = (body as any).view;
      const form = readForm(view.state.values, JSON.parse(view.private_metadata), body.user.id);
      const bands = actionId === 'add_band' ? addBand(form.bands) : removeBand(form.bands);
      await client.views.update({ view_id: view.id, hash: view.hash, view: buildSettingsView({ ...form, bands }, deps.library) as any });
    });
  }

  return openSettings;
}
