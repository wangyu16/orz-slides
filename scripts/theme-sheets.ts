/**
 * The theme review page (REBUILD §3c steps 4 and 9): the sample deck in every
 * slide theme, rendered by THIS engine, with a contact sheet per theme and an
 * index page — written to the family test hub (output/orz-test/slides/engine/).
 * A development tool: not shipped, not part of the tests.
 *
 *   npx tsx scripts/theme-sheets.ts                 every theme: decks, sheets, index
 *   npx tsx scripts/theme-sheets.ts sky paper       only these (the index lists all)
 *   add --no-sheets to write the decks and the index only
 *
 * Needs a built engine (dist/orz-slides.browser.js: `npm run build`, or any
 * test run) and Chrome (playwright-core, channel 'chrome'). The decks are
 * inline files of tests/fixtures/sample/sample.slides.md with the header's
 * theme set; the sheets are taken online (webfonts and libraries load), each
 * slide at its logical size (1280 × 720), the `step` slide mid-reveal.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { THEMES, type SlideTheme } from '../src/themes.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '../output/orz-test/slides/engine');
const SAMPLE = join(ROOT, 'tests/fixtures/sample');
const STEP_SLIDE = 3; // 0-based: the `step` slide, shown with three of its steps (the paragraph and two items)

const args = process.argv.slice(2);
const only = args.filter((a) => !a.startsWith('--'));
const wantSheets = !args.includes('--no-sheets');

const DESC: Record<string, string> = {
  orchard: 'Off-white page, calm green, Bricolage Grotesque; leaf-cut wash panels, a big green section numeral, a progress line ending in a leaf.',
  sky: 'Airy sky-blue page with soft corner tints and Figtree headings; a centred title signed with a star, the outline as a thread of haloed dots.',
  stationery: 'Warm paper, teal ink, Epilogue over Literata; a pen stroke over each title, punched tags, a dashed footer rule inked by progress.',
  preprint: 'White journal page, Fira Sans over Vollkorn, one navy accent; a running head with a progress rule, the title page as a paper\'s first page.',
  'small-press': 'Linen, Josefin Sans over Cardo, bottle green; colophon stroke-and-dot, cut-out round badges, a press seal on the title page.',
  notebook: 'A ruled exercise book: text written on the blue lines beside the pink margin, the cover\'s name label, sticky notes, taped pictures.',
  sticker: 'Dot-grid sketchbook: Chewy stickers with ink outlines and hard shadows, highlighter marks, round number stickers, a taped QR.',
  inscription: 'Navy night, Cinzel capitals between rules keyed by a blue lozenge; corner-bracket title plate, lozenge folio.',
  copper: 'Teal-black, big tight Sora over Vollkorn; copper segment rules, a huge copper section numeral, copper-to-violet progress.',
  nocturne: 'A graphite editor at night: syntax-coloured headings, a status-bar footer, a line-number gutter title page, an active-file outline.',
  architect: 'Blueprint drafting sheet, lighter: grid paper, a slim title block, titles on dimension lines, detail-bubble sections; Barlow over mono labels.',
  chalk: 'Green slate with chalk dust and a simple wooden tray; hand-lettered titles over yellow chalk strokes, coloured-chalk callouts.',
  neon: 'Instrument panel in a dark lab: faint scope grid, tick-scale title rules, mono readouts, a segmented progress meter, phosphor cyan.',
  paper: 'A finely printed book: EB Garamond in brown ink, centred titles with fleurons, roman part numerals, the course line in the footer.',
};

async function decks(list: readonly SlideTheme[]): Promise<void> {
  const { assemble } = await import('../src/lib.js');
  const text = readFileSync(join(SAMPLE, 'sample.slides.md'), 'utf8');
  mkdirSync(OUT, { recursive: true });
  copyFileSync(join(SAMPLE, 'gpc-traces.svg'), join(OUT, 'gpc-traces.svg'));
  for (const t of list) {
    const md = text.replace(/^theme: .*$/m, `theme: ${t.id}`);
    writeFileSync(join(OUT, `${t.id}.slides.html`), assemble(md));
    console.log('deck', t.id);
  }
}

async function sheets(list: readonly SlideTheme[]): Promise<void> {
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ channel: 'chrome' });
  const shots = '/tmp/orz-slides-theme-sheets';
  mkdirSync(shots, { recursive: true });
  mkdirSync(join(OUT, 'sheets'), { recursive: true });
  const one = async (t: SlideTheme): Promise<void> => {
    // 1334 × 750: reveal's 4 % margin leaves the 1280 × 720 slide at scale 1
    const ctx = await browser.newContext({ viewport: { width: 1334, height: 750 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.goto('file://' + join(OUT, `${t.id}.slides.html`), { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await page.waitForFunction(() => document.querySelector('.reveal.orz-deck.ready .slides > section.present[data-fitted]') !== null, null, { timeout: 60_000 });
    await page.addStyleTag({ content: 'body > :not(#orz-view) { visibility: hidden !important; } .reveal .slides > section { transition: none !important; }' });
    await page.evaluate(() => document.fonts.ready);
    const n = await page.evaluate(() => document.querySelectorAll('.reveal .slides > section').length);
    const files: string[] = [];
    for (let i = 0; i < n; i++) {
      await page.evaluate(([i, steps]) => {
        const e = (globalThis as unknown as { OrzCarrier: { standalone: { view: { engine: { go(n: number): void; next(): void } } } } }).OrzCarrier.standalone.view.engine;
        e.go(i);
        for (let k = 0; k < steps; k++) e.next();
      }, [i, i === STEP_SLIDE ? 3 : 0]);
      await page.waitForTimeout(i === 0 ? 2500 : 1500);
      await page.evaluate(() => document.fonts.ready);
      const box = await page.evaluate((k) => {
        const r = document.querySelectorAll('.reveal .slides > section')[k].getBoundingClientRect();
        return { x: r.left, y: r.top, width: r.width, height: r.height };
      }, i);
      const file = join(shots, `${t.id}-${String(i + 1).padStart(2, '0')}.png`);
      await page.screenshot({ path: file, clip: box });
      files.push(file);
    }
    await ctx.close();
    const ctx2 = await browser.newContext({ viewport: { width: 1960, height: 400 }, deviceScaleFactor: 1 });
    const p2 = await ctx2.newPage();
    const tiles = files.map((f, i) => `<figure><img src="data:image/png;base64,${readFileSync(f).toString('base64')}"><figcaption>${i + 1}</figcaption></figure>`).join('');
    await p2.setContent(`<!doctype html><style>
      body{margin:0;background:#26272b;font:600 15px/1 system-ui,sans-serif;color:#c9cbd1}
      header{padding:18px 28px 6px;display:flex;gap:18px;align-items:baseline}
      header b{font-size:24px;color:#f2f2f4}
      main{display:grid;grid-template-columns:repeat(3,620px);gap:22px 20px;padding:14px 28px 28px}
      figure{margin:0;position:relative}
      img{display:block;width:620px;height:349px;box-shadow:0 0 0 1px rgba(255,255,255,.14)}
      figcaption{position:absolute;left:8px;top:8px;background:rgba(0,0,0,.6);color:#fff;padding:3px 7px;border-radius:3px;font-size:13px}
      </style><header><b>${t.name}</b><span>orz-slides 1.0 engine · ${t.derivedFrom ? `derived from orz-markdown ${t.derivedFrom}` : 'updated 0.x theme'}</span><span>· slide ${STEP_SLIDE + 1} shown mid-reveal</span></header><main>${tiles}</main>`);
    await p2.waitForTimeout(150);
    await p2.screenshot({ path: join(OUT, 'sheets', `${t.id}.png`), fullPage: true });
    await ctx2.close();
    console.log('sheet', t.id);
  };
  const queue = [...list];
  await Promise.all(Array.from({ length: 3 }, async () => { while (queue.length) await one(queue.shift()!); }));
  await browser.close();
}

function index(): string {
  const tile = (t: SlideTheme): string => `
    <article class="tile">
      <a class="sheet" href="sheets/${t.id}.png" target="_blank" rel="noopener"><img src="sheets/${t.id}.png" alt="Contact sheet: ${t.name}" loading="lazy"></a>
      <div class="meta">
        <h3>${t.name}${t.derivedFrom ? ` <small>from ${t.derivedFrom}</small>` : ' <small>updated 0.x</small>'}</h3>
        <p>${DESC[t.id] ?? ''}</p>
        <div class="actions"><a href="${t.id}.slides.html" target="_blank" rel="noopener">Open</a><a href="sheets/${t.id}.png" target="_blank" rel="noopener">Sheet</a></div>
      </div>
    </article>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>orz-slides 1.0 engine (rebuild/1.0) — the 14 themes</title>
<style>
  :root { --ink: oklch(0.24 0.02 250); --muted: oklch(0.48 0.02 250); --line: oklch(0.90 0.01 250); --paper: oklch(0.985 0.004 250); --card: oklch(1 0 0 / 0.7); --accent: oklch(0.52 0.13 250); }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--paper); color: var(--ink); font: 16px/1.6 ui-sans-serif, -apple-system, "Segoe UI", system-ui, sans-serif; }
  main { max-width: 96rem; margin: 0 auto; padding: 3rem 1.5rem 5rem; }
  h1 { font-size: 2.1rem; line-height: 1.15; margin: 0 0 .4rem; letter-spacing: -0.01em; }
  h2 { font-size: 1.35rem; margin: 3rem 0 .4rem; }
  p.lead { color: var(--muted); margin: 0 0 1rem; max-width: 62rem; }
  a { color: var(--accent); }
  kbd { font: 0.85em ui-monospace, Menlo, monospace; border: 1px solid var(--line); border-radius: 4px; padding: 0 .3em; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(26rem, 1fr)); gap: 1.25rem; }
  .tile { background: var(--card); border: 1px solid var(--line); border-radius: 10px; overflow: hidden; display: flex; flex-direction: column; }
  .tile .sheet { display: block; background: #26272b; }
  .tile img { display: block; width: 100%; height: auto; }
  .tile .meta { padding: .9rem 1.1rem 1rem; }
  .tile h3 { margin: 0 0 .25rem; font-size: 1.05rem; }
  .tile h3 small { font-weight: 500; color: var(--muted); font-size: .8rem; margin-left: .3rem; }
  .tile p { margin: 0 0 .7rem; color: var(--muted); font-size: .93rem; }
  .actions a { display: inline-block; margin-right: .9rem; font-weight: 600; text-decoration: none; }
  .actions a:hover { text-decoration: underline; }
</style></head><body><main>
  <h1>orz-slides 1.0 engine (rebuild/1.0) — the 14 themes</h1>
  <p class="lead">The real engine now (REBUILD §3c step 4), not the concepts: the same 12-slide sample deck — title page with the long D-46 title, outline with the current item, section pages, a stepped slide (shown mid-reveal), math and a molecule, code with a table under a header row, a chart and a diagram, a quad, a picture with a float, a dense slide that fit scales down, and a closing page whose QR code sits in its own slot — in each slide theme, every theme carried inside the engine (inline and <code>--cdn</code> files style the same). <em>Open</em> is the live deck: arrows / <kbd>Space</kbd>, <kbd>O</kbd> overview, <kbd>S</kbd> speaker view, <kbd>T</kbd> timer, <kbd>F</kbd> present, <kbd>Cmd/Ctrl+P</kbd> print; the pencil's Theme setting switches theme. The approved concepts are in the <a href="../index.html">concept gallery</a>.</p>
  <h2>Derived from the orz-markdown themes (10)</h2>
  <div class="grid">${THEMES.filter((t) => t.derivedFrom).map(tile).join('')}</div>
  <h2>Updated 0.x themes (4)</h2>
  <div class="grid">${THEMES.filter((t) => !t.derivedFrom).map(tile).join('')}</div>
</main></body></html>
`;
}

async function main(): Promise<void> {
  if (!existsSync(join(ROOT, 'dist/orz-slides.browser.js'))) throw new Error('no built engine: run npm run build (or the tests) first');
  const list = THEMES.filter((t) => !only.length || only.includes(t.id));
  await decks(list);
  if (wantSheets) await sheets(list);
  writeFileSync(join(OUT, 'index.html'), index());
  console.log('index', join(OUT, 'index.html'));
}
main().catch((e) => { console.error(e); process.exit(1); });
