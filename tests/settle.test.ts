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

  it('[F.7] ENG-7, ENG-9, A2-ENG-6: fit guesses from the overflow ratio, learns the exponent when the guess still overflows, and refines — ≤ 8 measured trials for EVERY box of the sample and stress decks (the stress deck: 7–8 before round A2, now ≤ 5; 10 before round A), a refit of an unchanged slide ≤ 3; a scale that rounds to 1 reports 1', async () => {
    const STRESS = readFileSync('tests/fixtures/stress/stress.slides.md', 'utf8');
    const out: Record<string, { first: number; again: number; boxes: number }> = {};
    for (const [name, text, asset] of [['sample-paper', withTheme(SAMPLE, 'paper'), 'tests/fixtures/sample/gpc-traces.svg'], ['sample-notebook', withTheme(SAMPLE, 'notebook'), 'tests/fixtures/sample/gpc-traces.svg'], ['stress-neon', withTheme(STRESS, 'neon'), 'tests/fixtures/stress/big.svg'], ['stress-notebook', withTheme(STRESS, 'notebook'), 'tests/fixtures/stress/big.svg']] as const) {
      const sub = join(dir, `cost-${name}`);
      mkdirSync(sub, { recursive: true });
      copyFileSync(asset, join(sub, asset.split('/').pop()!));
      const { page, ctx } = await openDeck(browser!, join(sub, 'deck.slides.html'), assemble(text), { network: true });
      // every slide: the first fit of each box (a fresh box: no last scale), and a refit
      const r = await page.evaluate(async () => {
        const e = (globalThis as unknown as PageGlobal).OrzCarrier.standalone.view.engine as unknown as { total(): number; go(i: number): void; settled(): Promise<void>; fitCurrent(o?: { fresh?: boolean }): Array<{ scale: number; trials: number }> };
        const over: string[] = [];
        let first = 0, again = 0, boxes = 0;
        for (let i = 0; i < e.total(); i++) {
          e.go(i);
          await e.settled();
          const f = e.fitCurrent({ fresh: true });
          const a = e.fitCurrent();
          f.forEach((b, k) => {
            boxes++;
            first = Math.max(first, b.trials);
            again = Math.max(again, a[k].trials);
            if (b.trials > 8 || a[k].trials > 3 || Math.abs(a[k].scale - b.scale) > 1e-9) over.push(`slide ${i + 1} box ${k + 1}: ${b.trials} / ${a[k].trials} trials, ${b.scale} / ${a[k].scale}`);
          });
        }
        return { over, first, again, boxes };
      });
      expect(r.over, name).toEqual([]);
      out[name] = { first: r.first, again: r.again, boxes: r.boxes };
      const scales = await page.evaluate(() => Array.from(document.querySelectorAll('.reveal .slides > section.present .orz-box')).map((b) => b.getAttribute('data-scale')));
      for (const x of scales) expect(x).toMatch(/^(1|0\.\d\d)$/);
      await ctx.close();
    }
    console.log('[F.7] fit cost (max trials a box, first / refit, over every box):', JSON.stringify(out));
  }, 600_000);

  it('[F.6] A2-ENG-1: settling is per fit CYCLE, not per slide age — a refit more than 10 s into a slide (Present, a theme switch) settles with the new fit, never "timeout" at once with the stale scale', async () => {
    const { page, ctx } = await openDeck(browser!, join(dir, 'cycle.slides.html'), assemble(fixture('charts.slides.md')), { network: true });
    await engine(page, 'go', 3);
    await settled(page);
    await page.waitForTimeout(11_000);
    await page.evaluate(() => {
      const w = window as unknown as { __ev: Array<{ timeout: boolean; attr: string | null }> };
      w.__ev = [];
      document.querySelector('.reveal.orz-deck')!.addEventListener('orz-fitted', (e) => {
        w.__ev.push({ timeout: (e as CustomEvent<{ timeout: boolean }>).detail.timeout, attr: document.querySelector('.reveal .slides > section.present')!.getAttribute('data-fit-settled') });
      });
    });
    await key(page, 'f');
    await settledAndFinal(page, 'Present after 11 s');
    await page.evaluate(() => { (globalThis as unknown as PageGlobal).OrzCarrier.standalone.setSetting({ theme: 'notebook', ratio: '4:3' }); });
    await page.waitForFunction(() => document.getElementById('orz-slide-theme')!.getAttribute('data-theme-css') === 'notebook');
    await settledAndFinal(page, 'theme switch after 11 s');
    const ev = await page.evaluate(() => (window as unknown as { __ev: Array<{ timeout: boolean; attr: string | null }> }).__ev);
    expect(ev.length).toBeGreaterThan(0);
    expect(ev.filter((x) => x.timeout || x.attr !== ''), JSON.stringify(ev)).toEqual([]);
    await settled(page);
    expect(await page.evaluate(() => document.querySelector('.reveal .slides > section.present')!.getAttribute('data-fit-settled'))).toBe('');
    await ctx.close();
  }, 120_000);

  it('[F.6] A2-ENG-2: a theme <style>\'s @import (its webfont CSS, delayed 4 s) is waited for — settled() and the print document come after the theme\'s fonts, never with fallback fonts', async () => {
    const sub = join(dir, 'late-import');
    mkdirSync(sub, { recursive: true });
    copyFileSync('tests/fixtures/sample/gpc-traces.svg', join(sub, 'gpc-traces.svg'));
    const { page, ctx } = await openDeck(browser!, join(sub, 'deck.slides.html'), assemble(withTheme(SAMPLE, 'orchard')), { network: true, wait: 'fitted', delay: { url: /fonts\.googleapis\.com\/css/, ms: 4000 } });
    const t0 = Date.now();
    const printed = page.evaluate(async () => {
      const e = (globalThis as unknown as PageGlobal).OrzCarrier.standalone.view.engine as unknown as { printHtml(): Promise<{ html: string }> };
      await e.printHtml();
      return Array.from(document.fonts).some((f) => /Bricolage/.test(f.family) && f.status === 'loaded');
    });
    await settled(page);
    const atSettle = await page.evaluate(() => ({ font: Array.from(document.fonts).some((f) => /Bricolage/.test(f.family) && f.status === 'loaded'), loading: !!document.querySelector('style[data-orz-loading]') }));
    expect(Date.now() - t0, 'settled waited for the delayed font CSS').toBeGreaterThan(2500);
    expect(atSettle).toEqual({ font: true, loading: false });
    expect(await printed, 'the print document was built with the theme\'s fonts').toBe(true);
    await settledAndFinal(page, 'after the late import');
    await ctx.close();
  }, 120_000);

  it('[F.6] round A2: a chart whose frame jitters by a pixel (Chart.js resize ↔ layout; Stationery\'s bar and pie slide) still settles — a resize refit that changes nothing, twice, ends the resize watch — within seconds, never "timeout" nor never', async () => {
    const STRESS = readFileSync('tests/fixtures/stress/stress.slides.md', 'utf8');
    const sub = join(dir, 'jitter');
    mkdirSync(sub, { recursive: true });
    copyFileSync('tests/fixtures/stress/big.svg', join(sub, 'big.svg'));
    const { page, ctx } = await openDeck(browser!, join(sub, 'deck.slides.html'), assemble(withTheme(STRESS, 'stationery')), { network: true });
    const i = STRESS.split(/^<!-- slide/m).slice(1).findIndex((x) => x.includes('## Bar chart'));
    const r = await page.evaluate(async (n) => {
      const e = (globalThis as unknown as PageGlobal).OrzCarrier.standalone.view.engine as unknown as { go(i: number): void; settled(): Promise<void> };
      const t = performance.now();
      e.go(n);
      const ok = await Promise.race([e.settled().then(() => 'settled'), new Promise((res) => setTimeout(() => res('never'), 20_000))]);
      return { ok, ms: performance.now() - t, attr: document.querySelector('.reveal .slides > section.present')!.getAttribute('data-fit-settled') };
    }, i);
    expect(r.ok).toBe('settled');
    expect(r.attr).toBe('');
    expect(r.ms).toBeLessThan(8000);
    await settledAndFinal(page, 'the jittering chart slide');
    await ctx.close();
  }, 120_000);
});
