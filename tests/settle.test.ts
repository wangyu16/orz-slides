/**
 * Closed-loop round A — the fit SETTLES (claims F.5–F.7; ENG-1, ENG-2,
 * ENG-7, ENG-9 of notes/closed-loop.md), in real Chrome under CPU
 * throttling (CDP `Emulation.setCPUThrottlingRate`), so the late-content
 * windows the audit found reproduce on every run:
 *
 * - F.5: after the engine says the current slide is settled
 *   (`engine.settled()`, `data-fit-settled`, the `orz-fitted` event) no box
 *   has content outside it unless it says `data-clipped`, and fitting again
 *   changes nothing — on a first visit with charts drawn late, with Present
 *   toggled, after a theme and ratio switch, on a direct jump to a diagram,
 *   and on the Stationery sample's math slide while its fonts arrive;
 * - F.6: settled means after the fonts, the content libraries and a quiet
 *   frame — never on the first provisional pass;
 * - F.7: fit is cheap — a first fit guesses from the overflow ratio and
 *   refines (at most 6 measured trials a box), a refit of an unchanged slide
 *   starts from the last scale (at most 3), and a scale that rounds to 1
 *   reports `1`.
 *
 * Online (Chart.js, Mermaid, KaTeX, webfonts from the pinned CDN): skipped
 * without the network, as K.7 and the theme tests.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assemble } from '../src/lib.js';
import { reportBoxes, reportBoxesAfter, type BoxReport } from './fit-oracle.js';
import { launchChrome, openDeck, settled, type PageGlobal } from './helpers.js';

type Page = import('playwright-core').Page;

const browser = await launchChrome();
const dir = mkdtempSync(join(tmpdir(), 'orz-slides-settle-'));
afterAll(async () => { await browser?.close(); rmSync(dir, { recursive: true, force: true }); });

const online = await (async () => {
  try {
    const r = await fetch('https://cdn.jsdelivr.net/npm/orz-markdown@2.3.0/package.json', { signal: AbortSignal.timeout(8000) });
    return r.ok;
  } catch { return false; }
})();
const real = browser && online ? describe : describe.skip;

const fixture = (name: string): string => readFileSync(`tests/fixtures/settle/${name}`, 'utf8');
const SAMPLE = readFileSync('tests/fixtures/sample/sample.slides.md', 'utf8');
const withTheme = (text: string, id: string): string => text.replace(/^theme: .*$/m, `theme: ${id}`);

async function throttle(page: Page, rate: number): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate });
}

const engine = (page: Page, call: string, ...args: unknown[]): Promise<unknown> =>
  page.evaluate(([c, a]) => ((globalThis as unknown as PageGlobal).OrzCarrier.standalone.view.engine[c as string] as (...x: unknown[]) => unknown)(...(a as unknown[])), [call, args] as const);

/** The current slide's boxes: scale and clipped, as a string (to compare a settled fit with a refit). */
const look = (r: BoxReport[]): string => r.map((b) => `${b.scale}${b.clipped ? 'C' : ''}`).join(' ');
const silent = (r: BoxReport[]): string[] => r.filter((b) => !b.clipped && !b.scroll && b.outside.length > 0).map((b) => `${b.box}: ${b.outside.slice(0, 3).join(' | ')}`);

/** Settled → the oracle holds, and a refit changes nothing (the fit was final). */
async function settledAndFinal(page: Page, where: string): Promise<void> {
  await settled(page);
  const i = (await engine(page, 'index')) as number;
  const a = await reportBoxes(page, i);
  expect(silent(a), `${where}: content cut without data-clipped`).toEqual([]);
  await engine(page, 'fitCurrent');
  const b = await reportBoxes(page, i);
  expect(look(b), `${where}: a refit after settling changed the fit (stale)`).toBe(look(a));
}

const key = async (page: Page, k: string): Promise<void> => {
  await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur?.(); });
  await page.keyboard.press(k);
};

real('the fit settles (real Chrome, online, CPU throttled)', () => {
  it('[F.5] ENG-1: charts drawn when their slide shows are fitted with the slide — first visits by key, Present toggled, a theme and ratio switch: settled is final and nothing is cut silently', async () => {
    const { page, ctx, errors } = await openDeck(browser!, join(dir, 'charts.slides.html'), assemble(fixture('charts.slides.md')), { network: true });
    await throttle(page, 4);
    await settledAndFinal(page, 'open');
    const total = (await engine(page, 'total')) as number;
    for (let i = 1; i < total; i++) {
      await key(page, 'ArrowRight');
      await page.waitForFunction((n) => document.querySelectorAll('.reveal .slides > section')[n]?.classList.contains('present'), i);
      await settledAndFinal(page, `slide ${i + 1} (first visit)`);
    }
    await engine(page, 'go', 3);
    for (let k = 0; k < 4; k++) {
      await key(page, 'f');
      await settledAndFinal(page, `Present toggle ${k + 1}`);
    }
    await page.evaluate(() => { (globalThis as unknown as PageGlobal).OrzCarrier.standalone.setSetting({ theme: 'chalk', ratio: '4:3' }); });
    await page.waitForFunction(() => document.getElementById('orz-slide-theme')!.getAttribute('data-theme-css') === 'chalk' && document.querySelector<HTMLElement>('.reveal .slides > section.present')!.offsetWidth === 960);
    await settledAndFinal(page, 'chalk 4:3');
    expect(errors).toEqual([]);
    await ctx.close();
  }, 240_000);

  it('[F.5] ENG-1: a Mermaid diagram reached by a direct jump is fitted after it is drawn', async () => {
    const { page, ctx } = await openDeck(browser!, join(dir, 'diagrams.slides.html'), assemble(fixture('diagrams.slides.md')), { network: true });
    await throttle(page, 4);
    const total = (await engine(page, 'total')) as number;
    for (const i of [total - 1, 1, 3]) {
      await engine(page, 'go', i);
      await settledAndFinal(page, `jump to slide ${i + 1}`);
      expect(await page.evaluate(() => document.querySelectorAll('.reveal .slides > section.present .mermaid:not(:has(svg))').length), `slide ${i + 1}: every diagram drawn`).toBe(0);
    }
    await ctx.close();
  }, 180_000);

  it('[F.5] ENG-2 (the seed): Stationery\'s math slide while its webfonts and KaTeX fonts arrive late (delayed 2 s, CPU throttled 6x) is clean the moment the fonts are in, once settled', async () => {
    const sub = join(dir, 'stationery');
    mkdirSync(sub, { recursive: true });
    copyFileSync('tests/fixtures/sample/gpc-traces.svg', join(sub, 'gpc-traces.svg'));
    const { page, ctx } = await openDeck(browser!, join(sub, 'deck.slides.html'), assemble(withTheme(SAMPLE, 'stationery')), { network: true, wait: 'fitted', delay: { url: /fonts\.gstatic\.com|KaTeX_/, ms: 2000 } });
    await throttle(page, 6);
    await engine(page, 'go', 4);
    await page.waitForFunction(() => document.querySelectorAll('.reveal .slides > section')[4]?.hasAttribute('data-fitted'));
    await settled(page);
    // in the same task as the fonts arrive: a fit that waited for them is final; a provisional one is not
    const r = await reportBoxesAfter(page, 4, 'fonts');
    expect(silent(r), 'content cut without data-clipped').toEqual([]);
    await settledAndFinal(page, 'stationery slide 5');
    await ctx.close();
  }, 180_000);

  it('[F.6] settled is a contract: data-fit-settled and the orz-fitted event come after the fonts and the content libraries, never on the first pass', async () => {
    const { page, ctx } = await openDeck(browser!, join(dir, 'contract.slides.html'), assemble(fixture('charts.slides.md')), { network: true, wait: 'fitted' });
    await throttle(page, 4);
    await page.evaluate(() => {
      const w = window as unknown as { __fitted: Array<{ index: number; fonts: string; chart: boolean }> };
      w.__fitted = [];
      document.querySelector('.reveal.orz-deck')!.addEventListener('orz-fitted', (e) => {
        const s = document.querySelector('.reveal .slides > section.present')!;
        w.__fitted.push({ index: (e as CustomEvent<{ index: number }>).detail.index, fonts: document.fonts.status, chart: !!s.querySelector('canvas.orz-chart') && !!(window as unknown as { Chart?: { getChart(c: unknown): unknown } }).Chart?.getChart(s.querySelector('canvas.orz-chart')) });
      });
    });
    await engine(page, 'go', 2);
    // right after the jump the slide is fitted provisionally, not settled
    expect(await page.evaluate(() => document.querySelector('.reveal .slides > section.present')!.hasAttribute('data-fit-settled'))).toBe(false);
    await settled(page);
    const ev = await page.evaluate(() => (window as unknown as { __fitted: Array<{ index: number; fonts: string; chart: boolean }> }).__fitted);
    expect(ev.at(-1)).toEqual({ index: 2, fonts: 'loaded', chart: true });
    expect(await page.evaluate(() => document.querySelector('.reveal .slides > section.present')!.getAttribute('data-fit-settled'))).toBe('');
    await ctx.close();
  }, 120_000);

  it('[F.7] ENG-7, ENG-9: fit guesses from the overflow ratio and refines (≤ 6 measured trials a box; 10 before round A), a refit of an unchanged slide starts from the last scale (≤ 3); a scale that rounds to 1 reports 1', async () => {
    const out: Record<string, { first: number; again: number; ms: number }> = {};
    for (const id of ['orchard', 'notebook']) {
      const sub = join(dir, `cost-${id}`);
      mkdirSync(sub, { recursive: true });
      copyFileSync('tests/fixtures/sample/gpc-traces.svg', join(sub, 'gpc-traces.svg'));
      const { page, ctx } = await openDeck(browser!, join(sub, 'deck.slides.html'), assemble(withTheme(SAMPLE, id)), { network: true });
      await engine(page, 'go', 4);
      await settled(page);
      // the first fit of this slide (a fresh box: no last scale), and a refit
      const r = await page.evaluate(() => {
        const e = (globalThis as unknown as PageGlobal).OrzCarrier.standalone.view.engine as unknown as { fitCurrent(o?: { fresh?: boolean }): Array<{ scale: number; trials: number }> };
        const t0 = performance.now();
        const first = e.fitCurrent({ fresh: true });
        const ms = performance.now() - t0;
        const again = e.fitCurrent();
        return { first, again, ms };
      });
      for (const b of r.first) expect(b.trials, `${id}: first fit trials`).toBeLessThanOrEqual(6);
      for (const b of r.again) expect(b.trials, `${id}: refit trials`).toBeLessThanOrEqual(3);
      expect(r.again.map((b) => b.scale)).toEqual(r.first.map((b) => b.scale));
      out[id] = { first: Math.max(...r.first.map((b) => b.trials)), again: Math.max(...r.again.map((b) => b.trials)), ms: Math.round(r.ms) };
      const scales = await page.evaluate(() => Array.from(document.querySelectorAll('.reveal .slides > section.present .orz-box')).map((b) => b.getAttribute('data-scale')));
      for (const s of scales) expect(s).toMatch(/^(1|0\.\d\d)$/);
      await ctx.close();
    }
    console.log('[F.7] fit cost on the sample math slide (max trials a box, first / refit; ms of the first fit):', JSON.stringify(out));
  }, 180_000);
});
