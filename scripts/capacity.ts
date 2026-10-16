/**
 * Re-measure the skill's capacity budgets at 1280 × 720 (rebuild step 8): for every theme, a deck of probe slides
 * (bullets, words, code, table rows, per container) rendered by inspectLayout (online: the themes' webfonts), and for
 * each probe group the largest count that fits UNSCALED (every box scale ≥ 0.995) and the largest not CLIPPED.
 * The numbers behind the skill's capacity table (orz-slides-skills/SKILL.md). Online (webfonts); about 12 min per ratio:
 *   npm run build && npx tsx scripts/capacity.ts 16:9 [theme,theme…]   (or 4:3) → out/capacity-16x9.json + a summary
 */
import { writeFileSync } from 'node:fs';
import { inspectLayout, THEMES } from '../src/lib.js';

const WORDS = 'polymer chains grow together while the transfer agent shuttles radicals between active and dormant ends keeping dispersity low across every sample we measured in the lab this term'.split(' ');
const words = (n: number, k = 0): string => Array.from({ length: n }, (_, i) => WORDS[(i + k) % WORDS.length]).join(' ');
const bullet = (k: number, n = 9): string => `- ${words(n, k * 3).replace(/^./, (c) => c.toUpperCase())}`;
const range = (a: number, b: number, s = 1): number[] => { const o: number[] = []; for (let i = a; i <= b; i += s) o.push(i); return o; };
const TITLE = '## Chain growth under RAFT control';

type Probe = { group: string; n: number; slide: string; box: string };
const probes: Probe[] = [];
const add = (group: string, n: number, slide: string, box: string) => probes.push({ group, n, slide, box });
for (const n of range(3, 14)) add('body: bullets (9 words)', n, `<!-- slide -->\n${TITLE}\n${range(1, n).map((i) => bullet(i)).join('\n')}\n`, 'body');
for (const n of range(40, 220, 10)) add('body: words (paragraph)', n, `<!-- slide -->\n${TITLE}\n${words(n).replace(/^./, (c) => c.toUpperCase())}.\n`, 'body');
for (const n of range(6, 26, 2)) add('body: code lines (40 chars)', n, `<!-- slide -->\n${TITLE}\n\`\`\`python\n${range(1, n).map((i) => `value_${i} = compute(chain, step=${i})  # ok`.slice(0, 40)).join('\n')}\n\`\`\`\n`, 'body');
for (const n of range(3, 16)) add('body: table rows (4 cols)', n, `<!-- slide -->\n${TITLE}\n| Agent | Mn | Đ | Time |\n|---|---|---|---|\n${range(1, n).map((i) => `| CTA-${i} | ${i * 1200} | 1.${10 + i} | ${i * 2} h |`).join('\n')}\n`, 'body');
for (const n of range(2, 12)) add('2col: bullets per column', n, `<!-- slide 2col -->\n${TITLE}\n<!-- @left -->\n${range(1, n).map((i) => bullet(i, 7)).join('\n')}\n<!-- @right -->\nA short note.\n`, 'left');
for (const n of range(20, 140, 10)) add('2col: words per column', n, `<!-- slide 2col -->\n${TITLE}\n<!-- @left -->\n${words(n)}.\n<!-- @right -->\nA short note.\n`, 'left');
for (const n of range(2, 10)) add('3col: bullets per column (5 words)', n, `<!-- slide 3col -->\n${TITLE}\n<!-- @left -->\n${range(1, n).map((i) => bullet(i, 5)).join('\n')}\n<!-- @mid -->\nShort.\n<!-- @right -->\nShort.\n`, 'left');
for (const n of range(2, 9)) add('quad: bullets per cell (5 words)', n, `<!-- slide quad -->\n${TITLE}\n<!-- @tl -->\n${range(1, n).map((i) => bullet(i, 5)).join('\n')}\n<!-- @tr -->\nShort.\n<!-- @bl -->\nShort.\n<!-- @br -->\nShort.\n`, 'tl');
for (const n of range(2, 10)) add('main-side: side bullets (5 words)', n, `<!-- slide main-side -->\n${TITLE}\n<!-- @main -->\nThe main point.\n<!-- @side -->\n${range(1, n).map((i) => bullet(i, 5)).join('\n')}\n`, 'side');
for (const n of range(3, 12)) add('main-side: main bullets (9 words)', n, `<!-- slide main-side -->\n${TITLE}\n<!-- @main -->\n${range(1, n).map((i) => bullet(i)).join('\n')}\n<!-- @side -->\nA side note.\n`, 'main');
for (const n of range(4, 22, 2)) add('slide title (h2) words', n, `<!-- slide -->\n## ${words(n).replace(/^./, (c) => c.toUpperCase())}\nOne line.\n`, 'title');
for (const n of range(4, 20, 2)) add('title page h1 words', n, `<!-- slide template=title -->\n# ${words(n).replace(/^./, (c) => c.toUpperCase())}\n## A subtitle\nName · date\n`, 'template');

const ratio = process.argv[2] === '4:3' ? '4:3' : '16:9';
const only = process.argv[3]?.split(',');
const results: Record<string, Record<string, { fits: number | null; clipFree: number | null }>> = {};
for (const t of THEMES.filter((t) => !only || only.includes(t.id))) {
  const text = `{{nyml\nkind: document\ncarrier: slides\nuid: doc-capacity00000001\ntitle: Capacity\ntheme: ${t.id}\nratio: ${ratio}\nfooter: CHEM 512 · capacity probe\n}}\n\n${probes.map((p) => p.slide).join('\n')}`;
  const t0 = Date.now();
  const r = await inspectLayout(text, {});
  const per: Record<string, { fits: number | null; clipFree: number | null }> = {};
  probes.forEach((p, i) => {
    const s = r.slides[i]!;
    const b = s.boxes.find((x) => x.box === p.box);
    const g = (per[p.group] ??= { fits: null, clipFree: null });
    if (!b) return;
    if (b.scale >= 0.995 && !b.clipped) g.fits = Math.max(g.fits ?? 0, p.n);
    if (!b.clipped) g.clipFree = Math.max(g.clipFree ?? 0, p.n);
  });
  results[t.id] = per;
  console.error(`${t.id} ${ratio}: ${((Date.now() - t0) / 1000).toFixed(0)} s, settled ${r.slides.filter((s) => s.settled === 'yes').length}/${r.slides.length}, errors ${r.errors.length}`);
}
writeFileSync(`out/capacity-${ratio.replace(':', 'x')}.json`, JSON.stringify(results, null, 1));
const groups = [...new Set(probes.map((p) => p.group))];
for (const g of groups) {
  const fits = Object.entries(results).map(([id, r]) => [id, r[g]?.fits ?? 0] as const);
  const clip = Object.entries(results).map(([id, r]) => [id, r[g]?.clipFree ?? 0] as const);
  const min = Math.min(...fits.map((x) => x[1])); const max = Math.max(...fits.map((x) => x[1]));
  console.log(`${g.padEnd(38)} unscaled: min ${min} (${fits.filter((x) => x[1] === min).map((x) => x[0]).join(',')}) max ${max}; not cut: min ${Math.min(...clip.map((x) => x[1]))}`);
}
