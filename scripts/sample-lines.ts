// Prints random samples per band for human review: npx tsx scripts/sample-lines.ts [perBand]
import { loadLibrary, type LineBand } from '../src/lines/library.js';

const lib = loadLibrary();
const perBand = Number(process.argv[2] ?? 20);
for (const band of ['high', 'mid', 'low', 'fallback'] as LineBand[]) {
  const lines = lib.lines.filter((l) => l.band === band);
  const picks = [...lines].sort(() => Math.random() - 0.5).slice(0, perBand);
  console.log(`\n### ${band} (${lines.length} lines)\n`);
  for (const l of picks) console.log(`- :${l.emoji ?? lib.emojiPools[band][0]}: ${l.text}  _(${l.pack})_`);
}
