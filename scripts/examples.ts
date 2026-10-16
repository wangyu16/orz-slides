/**
 * Regenerate examples/*.slides.html from their text twins
 * (examples/*.slides.md) with the built library (`npm run build` first):
 * `starter` is the one inline example (the engine inside: it opens
 * offline), the others are cdn decks for the web (small files that load the
 * engine from jsDelivr) — the repository stays lean (an inline deck is about
 * 2.2 MB); each keeps its includes. tests/examples.test.ts fails when a
 * committed example is not a fresh assembly of its text (the shape of
 * orz-mdhtml's and orz-paged's scripts/examples.ts).
 *
 *   npm run examples
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { twinName } from 'orz-markdown/carrier';
import { assemble, extract } from '../src/lib.js';

const DIR = 'examples';
/** The one example assembled inline; everything else is a cdn deck for the web. */
const INLINE_EXAMPLES: ReadonlySet<string> = new Set(['starter.slides.md']);

for (const name of readdirSync(DIR).filter((f) => f.endsWith('.slides.md')).sort()) {
  const text = readFileSync(join(DIR, name), 'utf8');
  const out = join(DIR, twinName(name)!);
  const includes = existsSync(out) ? extract(readFileSync(out, 'utf8'))?.includes : undefined;
  const html = assemble(text, { delivery: INLINE_EXAMPLES.has(name) ? 'inline' : 'cdn', ...(includes ? { includes } : {}) });
  writeFileSync(out, html, 'utf8');
  console.log(`${out}  ${(Buffer.byteLength(html) / 1024).toFixed(1)} KiB`);
}
