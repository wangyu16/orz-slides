/**
 * Rebuild step 7 — `inspect --layout` in real Chrome (claim I.7, REBUILD §3c
 * Q7) and decks saved by the browser (claim V.13). The CLI (`dist/cli.js`)
 * finds the installed Chrome itself and drives it over the DevTools pipe;
 * the oracle opens the same deck through playwright-core and reads the
 * engine's own `data-scale` / `data-clipped` after each slide settles. Both
 * OFFLINE (D-63). Skips when Chrome is not installed (such a run verifies
 * nothing "real"); the refusal without Chrome is claim I.8 (tests/cli.test.ts).
 */
import { describe, it, expect, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sha256 } from 'orz-markdown/carrier';
import { assemble, extract, findChrome, inspect, layoutAdvice, type LayoutReport } from '../src/lib.js';
import { goTo, launchChrome, openDeck, LEGACY_DIR, read } from './helpers.js';

const CLI = join(process.cwd(), 'dist', 'cli.js');
const dir = realpathSync(mkdtempSync(join(tmpdir(), 'orz-slides-layout-')));
const browser = await launchChrome(); // offline (D-63)
afterAll(async () => { await browser?.close(); rmSync(dir, { recursive: true, force: true }); });
const chrome = browser && findChrome() ? describe : describe.skip;

interface Run { code: number; stdout: string; stderr: string }
const cli = (args: string[], env: NodeJS.ProcessEnv = {}): Promise<Run> => new Promise((resolve) => {
  execFile(process.execPath, [CLI, ...args], { cwd: dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, XDG_CACHE_HOME: join(dir, '.cache'), ...env } }, (error, stdout, stderr) => resolve({ code: error ? (typeof error.code === 'number' ? error.code : -1) : 0, stdout, stderr }));
});

const lines = (n: number, what: string): string => Array.from({ length: n }, (_, i) => `- ${what} ${i + 1}: a sentence that takes most of a line on a slide, to fill the box.`).join('\n');
const wideTable = `| ${Array.from({ length: 16 }, (_, i) => `Column${String(i).padStart(2, '0')}`).join(' | ')} |\n|${'---|'.repeat(16)}\n${[1, 2, 3, 4].map((r) => `| ${Array.from({ length: 16 }, (_, i) => `${r}000.${String(i * 125).padStart(3, '0')}`).join(' | ')} |`).join('\n')}`;
/** A deck with every fit outcome: unscaled, scaled, clipped at the floor, fit=off cut, a cut footer, a float, a picture beside the text. */
const DECK = `{{nyml
kind: document
carrier: slides
uid: doc-layoutreport001
title: Layout report
theme: orchard
ratio: 16:9
}}

<!-- slide template=title -->
# Layout report
## every fit outcome

<!-- slide -->
## Dense text
${lines(14, 'Point')}

<!-- slide fit=off -->
## fit=off, too much text
${lines(16, 'Line')}

<!-- slide 2col -->
## A wide table in a column
<!-- @left -->
${wideTable}
<!-- @right -->
Short.

<!-- slide main-side -->
## A picture beside the text, a float
<!-- @main -->
![a picture next to the text](pic.svg)
<!-- @side -->
- one
- two
<!-- @float left=70% top=70% w=20% h=15% -->
A float

<!-- slide -->
## A cut footer
Text.
<!-- @footer -->
${'A footer far too long for one line on a slide, '.repeat(6)}
`;

chrome('inspect --layout in real Chrome', () => {
  it('[I.7] `inspect --layout` renders the deck in the installed Chrome and reports per slide and box the fit scale and clipping — the numbers the engine itself shows — with a summary, advice for every clipped box and cut footer, the human table; a 0.x file is laid out as upgrade would write it', async () => {
    writeFileSync(join(dir, 'pic.svg'), "<svg xmlns='http://www.w3.org/2000/svg' width='800' height='600'><rect width='800' height='600' fill='#9ac'/></svg>");
    writeFileSync(join(dir, 'deck.slides.md'), DECK);
    const r = await cli(['inspect', 'deck.slides.md', '--layout', '--offline', '--json']);
    expect(r.code, r.stderr + r.stdout).toBe(0);
    const j = JSON.parse(r.stdout) as ReturnType<typeof inspect> & { layout: LayoutReport };
    // the report is the library's inspect plus the layout (and its advice)
    const { layout, advice, ...rest } = j;
    const lib = inspect(DECK, { filename: 'deck.slides.md' });
    const { advice: libAdvice, ...libRest } = lib;
    expect(rest).toEqual(JSON.parse(JSON.stringify(libRest)));
    expect(advice).toEqual([...libAdvice, ...layoutAdvice(layout)]);
    expect(layout.browser.product).toMatch(/^(Headless)?Chrome\/\d+/);
    expect(layout).toMatchObject({ network: 'offline', theme: 'orchard', ratio: '16:9', size: { width: 1280, height: 720 }, errors: [] });
    expect(layout.slides.map((s) => [s.slide, s.template, s.title])).toEqual([[1, 'title', '(title page)'], [2, null, 'Dense text'], [3, null, 'fit=off, too much text'], [4, null, 'A wide table in a column'], [5, null, 'A picture beside the text, a float'], [6, null, 'A cut footer']]);
    expect(layout.slides.map((s) => s.boxes.map((b) => b.box))).toEqual([['template'], ['title', 'body'], ['title', 'body'], ['title', 'left', 'right'], ['title', 'main', 'side', 'float 1'], ['title', 'body']]);
    const box = (s: number, name: string) => layout.slides[s - 1]!.boxes.find((b) => b.box === name)!;
    expect(box(1, 'template')).toEqual({ box: 'template', scale: 1, clipped: false, scroll: false });
    expect(box(2, 'body').scale).toBeLessThan(1);
    expect(box(2, 'body').scale).toBeGreaterThanOrEqual(0.6);
    expect(box(2, 'body').clipped).toBe(false);
    expect(box(3, 'body')).toMatchObject({ scale: 1, clipped: true });
    expect(box(4, 'left')).toMatchObject({ scale: 0.6, clipped: true });
    expect(box(4, 'right')).toMatchObject({ scale: 1, clipped: false });
    expect(box(5, 'main').clipped).toBe(false);
    expect(layout.slides[5]!.footerClipped).toBe(true);
    expect(layout.slides.every((s) => s.settled === 'yes')).toBe(true);
    const all = layout.slides.flatMap((s) => s.boxes);
    expect(layout.summary).toEqual({ slides: 6, boxes: all.length, scaled: all.filter((b) => b.scale < 1).length, clipped: 2, footersClipped: 1, minScale: 0.6 });
    expect(advice.join('\n')).toMatch(/slide 3 \(fit=off, too much text\): body is cut even at the smallest scale/);
    expect(advice.join('\n')).toMatch(/slide 4 \(A wide table in a column\): left is cut/);
    expect(advice.join('\n')).toMatch(/slide 6: the footer is cut to one line/);
    expect(advice.join('\n')).toMatch(/rendered offline/);

    // the oracle: the engine's own numbers, slide by slide, in the same deck opened through playwright
    const { page, ctx, errors } = await openDeck(browser!, join(dir, 'oracle.slides.html'), assemble(DECK));
    try {
      for (let i = 0; i < layout.slides.length; i++) {
        await goTo(page, i);
        const shown = await page.evaluate((n) => {
          const s = document.querySelectorAll('.reveal .slides > section')[n]!;
          return Array.from(s.querySelectorAll('.orz-box')).map((b) => ({ scale: Number(b.getAttribute('data-scale') ?? '1'), clipped: b.hasAttribute('data-clipped') }));
        }, i);
        const got = layout.slides[i]!.boxes;
        expect(got.length, `slide ${i + 1}`).toBe(shown.length);
        got.forEach((b, k) => {
          expect(Math.abs(b.scale - shown[k]!.scale), `slide ${i + 1} ${b.box}`).toBeLessThanOrEqual(0.02);
          expect(b.clipped, `slide ${i + 1} ${b.box}`).toBe(shown[k]!.clipped);
        });
      }
      expect(errors).toEqual([]);
    } finally { await ctx.close(); }

    // the human table
    const h = await cli(['inspect', 'deck.slides.md', '--layout', '--offline']);
    expect(h.code).toBe(0);
    expect(h.stdout).toMatch(/^layout \((Headless)?Chrome\/[\d.]+, offline, orchard, 16:9 = 1280×720\): 6 slides, \d+ boxes, \d+ scaled \(smallest 0\.6\), 2 clipped, 1 footer cut$/m);
    expect(h.stdout).toMatch(/^ {4}4 {2}A wide table in a column: title 1, left 0\.6 CLIPPED, right 1$/m);
    expect(h.stdout).toMatch(/^ {4}6 {2}A cut footer: title 1, body 1; footer CUT$/m);

    // an assembled file and a 0.x file (laid out as upgrade writes it), with a note
    writeFileSync(join(dir, 'deck.slides.html'), assemble(DECK, { delivery: 'cdn' }));
    const f = JSON.parse((await cli(['inspect', 'deck.slides.html', '--layout', '--offline', '--json'])).stdout) as { layout: LayoutReport };
    expect(f.layout.summary).toEqual(layout.summary);
    writeFileSync(join(dir, 'old.slides.html'), read(join(LEGACY_DIR, 'demo-0.8.5.slides.html')));
    const old = JSON.parse((await cli(['inspect', 'old.slides.html', '--layout', '--offline', '--json'])).stdout) as { input: string; notes: string[]; layout: LayoutReport };
    expect(old.input).toBe('legacy');
    expect(old.layout.theme).toBe('paper');
    expect(old.layout.slides.length).toBe(7);
    expect(old.notes.join('\n')).toMatch(/layout: the deck as `orz-slides upgrade` would write it/);
  }, 300_000);

  it('[I.9] `inspect --layout` run again and again, four at a time (a loaded machine): every run reports (exit 0, the same summary) — removing Chrome\'s profile never replaces a finished report — and no run leaves its temporary profile behind (final loop RR-1)', async () => {
    const tmp = join(dir, 'tmp-rr1');
    mkdirSync(tmp, { recursive: true });
    writeFileSync(join(dir, 'rr1.slides.md'), DECK);
    const runs: Run[] = [];
    for (let round = 0; round < 3; round++) runs.push(...await Promise.all([0, 1, 2, 3].map(() => cli(['inspect', 'rr1.slides.md', '--layout', '--offline', '--json'], { TMPDIR: tmp }))));
    const bad = runs.filter((r) => r.code !== 0).map((r) => `${r.code}: ${r.stdout.slice(0, 300)}${r.stderr.slice(0, 300)}`);
    expect(bad).toEqual([]);
    const summaries = new Set(runs.map((r) => JSON.stringify((JSON.parse(r.stdout) as { layout: LayoutReport }).layout.summary)));
    expect(summaries.size).toBe(1);
    expect(readdirSync(tmp).filter((f) => f.startsWith('orz-slides-layout-'))).toEqual([]);
  }, 600_000);

  it('[I.10] the README\'s library sample runs as written — copied verbatim from "## The library", against the built package by its own name (a 0.x fixture as `oldHtml`): every line runs, inspectLayout included (final loop RR-4)', async () => {
    const readme = readFileSync('README.md', 'utf8');
    const sample = /## The library\s+```ts\n([\s\S]*?)```/.exec(readme)![1]!;
    const sub = mkdtempSync(join(process.cwd(), '.readme-sample-'));
    try {
      writeFileSync(join(sub, 'sample.ts'), `import { readFileSync } from 'node:fs';\nconst oldHtml = readFileSync(${JSON.stringify(join(process.cwd(), LEGACY_DIR, 'demo-0.8.5.slides.html'))}, 'utf8');\n${sample}\nconsole.log('SAMPLE-RAN');\n`);
      const r = await new Promise<Run>((ok) => execFile(process.execPath, [join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs'), join(sub, 'sample.ts')], { cwd: sub, encoding: 'utf8', env: { ...process.env, XDG_CACHE_HOME: join(dir, '.cache') } }, (e, stdout, stderr) => ok({ code: e ? 1 : 0, stdout, stderr })));
      expect(r.stderr, r.stdout).toBe('');
      expect(r.stdout).toContain('SAMPLE-RAN');
    } finally { rmSync(sub, { recursive: true, force: true }); }
  }, 120_000);

  it('[V.13] a deck saved by the browser — the page as Chrome serializes it ("Save Page As", with its saved-from comment) — extracts byte for byte (CR LF and BOM kept) and inspects as an assembled deck holding the same text', async () => {
    const text = `﻿${DECK.replace(/\n/g, '\r\n')}`;
    const { page, ctx } = await openDeck(browser!, join(dir, 'live.slides.html'), assemble(text));
    let dom: string;
    try { dom = await page.content(); } finally { await ctx.close(); }
    expect(dom).toMatch(/class="[^"]*orz-slide/); // the rendered deck is in the saved page
    const saved = dom.replace(/^<!DOCTYPE html>/i, (m) => `${m}<!-- saved from url=(0040)file:///Users/someone/deck.slides.html -->\n`);
    writeFileSync(join(dir, 'saved.slides.html'), saved);
    const r = await cli(['extract', 'saved.slides.html', '--json']);
    expect(r.code, r.stdout).toBe(0);
    expect(readFileSync(join(dir, 'saved.slides.md')).equals(Buffer.from(text, 'utf8'))).toBe(true);
    expect(JSON.parse(r.stdout)).toMatchObject({ ok: true, kind: 'slides', format: 1, sha256: sha256(text) });
    expect(extract(saved)!.text).toBe(text);
    const i = inspect(saved);
    expect(i).toMatchObject({ input: 'assembled', kind: 'slides', sha256: sha256(text), slides: 6 });
    expect(i.checks!.island).toBe('closed');
  }, 120_000);
});
