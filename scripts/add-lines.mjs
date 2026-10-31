// Usage: node scripts/add-lines.mjs <draft.json>
// Draft format: { "pack": "<id>", "high": [...], "mid": [...], "low": [...], "fallback": [...] }
// Appends new lines with stable, sequential ids; skips texts already in the library.
import { readFileSync, writeFileSync } from 'node:fs';

const LIB = 'content/status-lines.json';
const lib = JSON.parse(readFileSync(LIB, 'utf8'));
const draft = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const existing = new Set(lib.lines.map((l) => l.text.toLowerCase()));
let added = 0;
for (const band of ['high', 'mid', 'low', 'fallback']) {
  const ids = lib.lines.filter((l) => l.pack === draft.pack && l.band === band).map((l) => Number(l.id.split('-').pop()));
  let next = Math.max(0, ...ids) + 1;
  for (const entry of draft[band] ?? []) {
    const [text, emoji] = Array.isArray(entry) ? entry : [entry];
    if (existing.has(text.toLowerCase())) continue;
    existing.add(text.toLowerCase());
    lib.lines.push({ id: `${draft.pack}-${band}-${String(next++).padStart(3, '0')}`, pack: draft.pack, band, text, ...(emoji ? { emoji } : {}) });
    added++;
  }
}
writeFileSync(LIB, JSON.stringify(lib, null, 2) + '\n');
console.log(`${draft.pack}: +${added} (total ${lib.lines.length})`);
