/**
 * Rebuild step 3 — the engine in real Chrome (claims K.1–K.8, C.1–C.3,
 * T.1): keys through the kit's `onKey`, fragments, overview, the speaker
 * view, Present, the timer, the chrome slots, the outline's current item,
 * the closing's QR slot, the theme and the logical size, and content drawn
 * when its slide becomes visible.
 *
 * Offline unless a test says otherwise (K.7 and K.8 load the pinned CDN
 * libraries and fonts: they need the network and skip without it).
 */
import { describe, it, expect, afterAll } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assemble } from '../src/lib.js';
import { corpus, goTo, launchChrome, openDeck, type PageGlobal } from './helpers.js';

type Page = import('playwright-core').Page;

const browser = await launchChrome({ online: true }); // deliberately online: its K.7/F.5/T.3 decks load the pinned CDN libraries (D-63)
const dir = mkdtempSync(join(tmpdir(), 'orz-slides-engine-'));
afterAll(async () => { await browser?.close(); rmSync(dir, { recursive: true, force: true }); });
const chrome = browser ? describe : describe.skip;

const SAMPLE = readFileSync('tests/fixtures/sample/sample.slides.md', 'utf8');
const sampleFile = (name: string): string => {
  const sub = join(dir, name);
  mkdirSync(sub, { recursive: true });
  copyFileSync('tests/fixtures/sample/gpc-traces.svg', join(sub, 'gpc-traces.svg'));
  return join(sub, 'sample.slides.html');
};

const index = (page: Page): Promise<number> => page.evaluate(() => (globalThis as unknown as PageGlobal).OrzCarrier.standalone.view.engine.index() as number);
const visibleFragments = (page: Page): Promise<number> => page.evaluate(() => document.querySelectorAll('.reveal .slides > section.present .fragment.visible').length);
/** Press a key with the focus on the page (not in the chrome). */
async function press(page: Page, key: string): Promise<void> {
  await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur?.(); });
  await page.keyboard.press(key);
  await page.waitForTimeout(80);
}

const online = await (async () => {
  try {
    const r = await fetch('https://cdn.jsdelivr.net/npm/orz-markdown@2.3.0/package.json', { signal: AbortSignal.timeout(8000) });
    return r.ok;
  } catch { return false; }
})();

chrome('the engine (real Chrome)', () => {
  it('[K.1] keys arrive through the kit\'s onKey: → ↓ PageDown Space next, ← ↑ PageUp previous, End and Home; reveal\'s own keyboard, controls, progress and slide number are off', async () => {
    const { page, ctx, errors } = await openDeck(browser!, sampleFile('k1'), assemble(SAMPLE));
    expect(await index(page)).toBe(0);
    await press(page, 'ArrowRight');
    expect(await index(page)).toBe(1);
    await press(page, 'PageDown');
    expect(await index(page)).toBe(2);
    await press(page, 'ArrowLeft');
    expect(await index(page)).toBe(1);
    await press(page, 'ArrowUp');
    expect(await index(page)).toBe(0);
    await press(page, 'End');
    expect(await index(page)).toBe(11);
    await press(page, 'Home');
    expect(await index(page)).toBe(0);
    await press(page, 'Space');
    expect(await index(page)).toBe(1);
    await press(page, 'Shift+Space');
    expect(await index(page)).toBe(0);
    // reveal's own key bindings are off: '?' (help), 'b' (pause) do nothing; no reveal controls or progress shown
    await press(page, 'b');
    await press(page, '?');
    const reveal = await page.evaluate(() => ({
      paused: document.querySelector('.reveal')!.classList.contains('paused'),
      help: !!document.querySelector('.reveal .overlay-help'),
      controls: Array.from(document.querySelectorAll('.reveal > .controls, .reveal > .progress, .reveal > .slide-number')).some((e) => getComputedStyle(e).display !== 'none'),
    }));
    expect(reveal).toEqual({ paused: false, help: false, controls: false });
    // with the editor open the keys are the editor's, not the deck's
    await page.evaluate(() => { (globalThis as unknown as PageGlobal).OrzCarrier.standalone.edit(); });
    await page.keyboard.press('ArrowRight');
    await page.evaluate(async () => { await (globalThis as unknown as PageGlobal).OrzCarrier.standalone.leave(); });
    expect(await index(page)).toBe(0);
    expect(errors).toEqual([]);
    await ctx.close();
  });

  it('[K.2] fragments: a step slide reveals its blocks one key at a time, in order across regions, then moves on; {{attrs[.fragment]}} fragments too', async () => {
    const { page, ctx } = await openDeck(browser!, sampleFile('k2'), assemble(SAMPLE));
    await goTo(page, 3);
    expect(await page.evaluate(() => document.querySelectorAll('.reveal .slides > section.present .fragment').length)).toBe(5);
    for (let k = 1; k <= 5; k++) {
      await press(page, 'ArrowRight');
      expect(await index(page)).toBe(3);
      expect(await visibleFragments(page)).toBe(k);
    }
    await press(page, 'ArrowRight');
    expect(await index(page)).toBe(4);
    await press(page, 'ArrowLeft');
    expect(await index(page)).toBe(3);
    await ctx.close();
    const nf = corpus('slides').find((c) => c.path.endsWith('notes-and-fragments.slides.md'))!;
    const deck = await openDeck(browser!, join(dir, 'nf.slides.html'), assemble(nf.text));
    await goTo(deck.page, 3);
    // the 2col step slide: left's two items, then right's two
    const order = await deck.page.evaluate(() => Array.from(document.querySelectorAll('.reveal .slides > section.present .fragment')).map((f) => `${f.closest('.orz-region')!.getAttribute('data-region')}:${f.textContent}`));
    expect(order).toEqual(['left:Phenolphthalein', 'left:Methyl orange', 'right:pH 8.2–10.0', 'right:pH 3.1–4.4']);
    await goTo(deck.page, 2);
    expect(await deck.page.evaluate(() => document.querySelectorAll('.reveal .slides > section.present .fragment').length)).toBe(2);
    await press(deck.page, 'ArrowRight');
    expect(await visibleFragments(deck.page)).toBe(1);
    await deck.ctx.close();
  });

  it('[K.3] overview: o opens it (every slide as a thumbnail), Escape and Enter close it, and the arrows choose the slide', async () => {
    const { page, ctx } = await openDeck(browser!, sampleFile('k3'), assemble(SAMPLE));
    const isOverview = (): Promise<boolean> => page.evaluate(() => document.querySelector('.reveal')!.classList.contains('overview'));
    await press(page, 'o');
    expect(await isOverview()).toBe(true);
    await press(page, 'ArrowRight');
    await press(page, 'ArrowRight');
    await press(page, 'Enter');
    expect(await isOverview()).toBe(false);
    expect(await index(page)).toBe(2);
    await press(page, 'Escape');
    expect(await isOverview()).toBe(true);
    await press(page, 'Escape');
    expect(await isOverview()).toBe(false);
    // the pencil's list offers it too
    await page.evaluate(() => (globalThis as unknown as PageGlobal).OrzCarrier.standalone.menu.open());
    await page.getByRole('menuitem', { name: 'Overview' }).click();
    expect(await isOverview()).toBe(true);
    await ctx.close();
  });

  it('[K.4] the speaker view (S) opens its own window: current and next slide, the notes, the position and the clock; keys there drive the deck', async () => {
    const { page, ctx } = await openDeck(browser!, sampleFile('k4'), assemble(SAMPLE));
    const popup = ctx.waitForEvent('page');
    await press(page, 's');
    const sv = await popup;
    await sv.waitForSelector('[data-sv="cur"] section.orz-slide');
    const read = () => sv.evaluate(() => ({
      title: document.title,
      cur: document.querySelector('[data-sv="cur"] section')?.getAttribute('data-n'),
      next: document.querySelector('[data-sv="next"] section')?.getAttribute('data-n'),
      notes: document.querySelector('[data-sv="notes"]')?.textContent ?? '',
      pos: document.querySelector('[data-sv="pos"]')?.textContent,
      clock: /^\d\d:\d\d:\d\d$/.test(document.querySelector('[data-sv="clock"]')?.textContent ?? ''),
    }));
    const first = await read();
    expect(first.title).toBe('Speaker view — Controlled Radical Polymerization — orz-slides engine sample');
    expect(first).toMatchObject({ cur: '1', next: '2', pos: '1 / 12', clock: true });
    expect(first.notes).toContain('The long title is deliberate');
    await sv.keyboard.press('ArrowRight');
    await sv.waitForFunction(() => document.querySelector('[data-sv="cur"] section')?.getAttribute('data-n') === '2');
    expect(await index(page)).toBe(1);
    expect((await read()).notes).toContain('No notes for this slide.');
    await ctx.close();
  });

  it('[K.5] Present (the bar action) shows the deck alone, full screen, the chrome hidden; leaving brings the chrome back', async () => {
    const { page, ctx } = await openDeck(browser!, sampleFile('k5'), assemble(SAMPLE));
    const state = () => page.evaluate(() => ({
      presenting: document.getElementById('orz-view')!.classList.contains('orz-presenting'),
      chromeHidden: document.getElementById('orz-chrome')!.hasAttribute('data-hidden'),
      fullscreen: document.fullscreenElement?.id ?? null,
    }));
    await page.evaluate(() => (globalThis as unknown as PageGlobal).OrzCarrier.standalone.menu.open());
    await page.getByRole('menuitem', { name: 'Present' }).click();
    await page.waitForFunction(() => document.getElementById('orz-view')!.classList.contains('orz-presenting'));
    const on = await state();
    expect(on.presenting).toBe(true);
    expect(on.chromeHidden).toBe(true);
    expect([null, 'orz-view']).toContain(on.fullscreen);
    // the keys still drive the deck while presenting
    await press(page, 'ArrowRight');
    expect(await index(page)).toBe(1);
    await page.evaluate(() => { (globalThis as unknown as PageGlobal).OrzCarrier.standalone.view.engine.exitPresent(); });
    await page.waitForFunction(() => !document.getElementById('orz-view')!.classList.contains('orz-presenting'));
    expect(await state()).toEqual({ presenting: false, chromeHidden: false, fullscreen: null });
    // f toggles it as well
    await press(page, 'f');
    expect((await state()).presenting).toBe(true);
    await press(page, 'f');
    expect((await state()).presenting).toBe(false);
    await ctx.close();
  });

  it('[K.6] the timer (T) shows the wall clock and the elapsed time over the deck; T again hides it', async () => {
    const { page, ctx } = await openDeck(browser!, sampleFile('k6'), assemble(SAMPLE));
    await press(page, 't');
    const t = await page.evaluate(() => ({ clock: document.querySelector('.orz-timer .orz-timer-clock')?.textContent, elapsed: document.querySelector('.orz-timer .orz-timer-elapsed')?.textContent }));
    expect(t.clock).toMatch(/^\d\d:\d\d:\d\d$/);
    expect(t.elapsed).toMatch(/^0:0\d$/);
    await press(page, 't');
    expect(await page.locator('.orz-timer').count()).toBe(0);
    await ctx.close();
  });

  (online ? it : it.skip)('[K.7] content is drawn when its slide becomes visible: the chart at its box\'s size in the theme\'s --chart-font-size, the molecule at its box\'s size, the diagram with whole labels (needs the network: the pinned CDN libraries)', async () => {
    const { page, ctx, errors } = await openDeck(browser!, sampleFile('k7'), assemble(SAMPLE), { network: true });
    await goTo(page, 4);
    await page.waitForFunction(() => {
      const c = document.querySelector<HTMLCanvasElement>('.reveal .slides > section.present canvas[data-smiles]');
      if (!c || c.width === 0 || c.height === 0) return false;
      const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return true;
      return false;
    }, null, { timeout: 30_000 });
    const smiles = await page.evaluate(() => {
      const c = document.querySelector<HTMLCanvasElement>('.reveal .slides > section.present canvas[data-smiles]')!;
      const r = c.getBoundingClientRect();
      const data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      let ink = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i] > 0) ink++;
      return { cssW: c.clientWidth, w: c.width, ratio: c.width / c.clientWidth, ink, shown: r.width > 0 };
    });
    expect(smiles.ink).toBeGreaterThan(100);
    // sized from its box (no longer a fixed 250 × 180 canvas), and drawn at least at its CSS size
    expect(smiles.cssW).toBeGreaterThan(250);
    expect(smiles.ratio).toBeGreaterThanOrEqual(0.9);
    await goTo(page, 7);
    await page.waitForFunction(() => {
      const c = document.querySelector('.reveal .slides > section.present canvas.orz-chart') as (HTMLCanvasElement & { __orzChart?: unknown }) | null;
      return !!c && !!(window as unknown as { Chart?: { getChart(c: unknown): unknown } }).Chart?.getChart(c);
    }, null, { timeout: 30_000 });
    const chart = await page.evaluate(() => {
      const c = document.querySelector<HTMLCanvasElement>('.reveal .slides > section.present canvas.orz-chart')!;
      const region = c.closest('.orz-region') as HTMLElement;
      const ch = (window as unknown as { Chart: { getChart(c: unknown): { width: number; options: { scales: Record<string, { ticks: { font?: { size?: number } } }> } } } }).Chart.getChart(c);
      return { w: ch.width, region: region.clientWidth, size: ch.options.scales['x'].ticks.font?.size, token: parseFloat(getComputedStyle(c).getPropertyValue('--chart-font-size')) };
    });
    expect(chart.w).toBeGreaterThan(chart.region * 0.8);
    expect(chart.size).toBe(chart.token);   // the theme's --chart-font-size (Orchard: 20), read by the kit
    expect(chart.token).toBeGreaterThanOrEqual(18);
    await page.waitForFunction(() => !!document.querySelector('.reveal .slides > section.present .mermaid svg'), null, { timeout: 30_000 });
    const labels = await page.evaluate(() => Array.from(document.querySelectorAll('.reveal .slides > section.present .mermaid svg .nodeLabel, .reveal .slides > section.present .mermaid svg text')).map((t) => t.textContent?.trim()).filter((x) => x));
    expect(labels.join(' ')).toContain('Initiator');
    expect(labels.join(' ')).toContain('Dormant RAFT adduct');
    expect(await page.evaluate(() => document.querySelectorAll('.reveal .slides > section.present .mermaid foreignObject').length)).toBe(0);
    expect(errors).toEqual([]);
    await ctx.close();
  }, 120_000);

  (online ? it : it.skip)('[K.8] online (webfonts, KaTeX, the libraries) no box of the sample deck is clipped, and every box reports its scale', async () => {
    const { page, ctx } = await openDeck(browser!, sampleFile('k8'), assemble(SAMPLE), { network: true });
    await page.evaluate(() => document.fonts.ready);
    const clipped: string[] = [];
    for (let i = 0; i < 12; i++) {
      await goTo(page, i);
      await page.waitForTimeout(i === 4 || i === 7 ? 2500 : 300);
      await page.evaluate(() => { (globalThis as unknown as PageGlobal).OrzCarrier.standalone.view.engine.fitCurrent(); });
      const r = await page.evaluate(() => Array.from(document.querySelectorAll('.reveal .slides > section.present .orz-box')).map((b) => ({ c: b.className, s: b.getAttribute('data-scale'), x: b.hasAttribute('data-clipped') })));
      for (const b of r) {
        expect(b.s, `slide ${i + 1} ${b.c}`).toMatch(/^(1|0\.\d\d)$/);
        if (b.x) clipped.push(`slide ${i + 1} ${b.c}`);
      }
    }
    expect(clipped).toEqual([]);
    await ctx.close();
  }, 120_000);

  (online ? it : it.skip)('[K.9] round A, ENG-5/6/8: the speaker view shows its slides from the print pipeline — charts and molecules drawn (not blank canvases) in Current and Next, every copy fitted, and a Theme switch shows there too', async () => {
    const { page, ctx } = await openDeck(browser!, sampleFile('k9'), assemble(SAMPLE), { network: true });
    await goTo(page, 6);
    const popup = ctx.waitForEvent('page');
    await press(page, 's');
    const sv = await popup;
    await sv.waitForSelector('[data-sv="cur"] section.orz-slide');
    /** A pane's slide: its number, the ink of its drawings (images or canvases), whether every box reports a scale and shows its text. */
    const pane = (which: string) => sv.evaluate(async (w) => {
      const s = document.querySelector<HTMLElement>(`[data-sv="${w}"] section.orz-slide`)!;
      const ink = async (el: HTMLImageElement | HTMLCanvasElement): Promise<number> => {
        if (el instanceof HTMLImageElement) await el.decode().catch(() => undefined);
        const c = document.createElement('canvas');
        const w0 = el instanceof HTMLImageElement ? el.naturalWidth : el.width;
        const h0 = el instanceof HTMLImageElement ? el.naturalHeight : el.height;
        if (!w0 || !h0) return 0;
        c.width = w0; c.height = h0;
        const g = c.getContext('2d')!;
        g.drawImage(el, 0, 0);
        const d = g.getImageData(0, 0, w0, h0).data;
        let n = 0;
        for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
        return n;
      };
      const drawings = Array.from(s.querySelectorAll<HTMLImageElement | HTMLCanvasElement>('canvas, img[data-orz-frozen], img.orz-chart, img[data-smiles]'));
      const inks: number[] = [];
      for (const d of drawings) inks.push(await ink(d));
      const boxes = Array.from(s.querySelectorAll<HTMLElement>('.orz-box'));
      const over = boxes.filter((b) => !b.hasAttribute('data-clipped') && (b.scrollHeight > b.clientHeight + 2 || b.scrollWidth > b.clientWidth + 2) && !b.classList.contains('orz-title'));
      return { n: s.getAttribute('data-n'), inks, scaled: boxes.every((b) => b.hasAttribute('data-scale')), over: over.map((b) => b.className) };
    }, which);
    // slide 7 current, slide 8 (the chart, never shown) next: the chart has ink, every box fitted
    // (polled: the speaker window may be in the background, where animation frames stop)
    await sv.waitForFunction(() => !!document.querySelector('[data-sv="next"] section.orz-slide [data-orz-frozen]'), null, { timeout: 60_000, polling: 250 });
    const next = await pane('next');
    expect(next.n).toBe('8');
    expect(next.inks.length).toBeGreaterThan(0);
    expect(Math.min(...next.inks), 'the chart in the Next pane is drawn').toBeGreaterThan(100);
    expect(next.scaled).toBe(true);
    expect(next.over).toEqual([]);
    // the molecule's slide (5) current (slide 4 steps through fragments: go there directly)
    await page.evaluate(() => { (globalThis as unknown as PageGlobal).OrzCarrier.standalone.view.engine.go(4); });
    await sv.waitForFunction(() => document.querySelector('[data-sv="cur"] section')?.getAttribute('data-n') === '5' && !!document.querySelector('[data-sv="cur"] section [data-orz-frozen]'), null, { timeout: 60_000, polling: 250 });
    const cur = await pane('cur');
    expect(Math.min(...cur.inks), 'the molecule in the Current pane is drawn').toBeGreaterThan(100);
    expect(cur.scaled).toBe(true);
    // a Theme switch reaches the speaker window's stylesheets
    await page.evaluate(() => { (globalThis as unknown as PageGlobal).OrzCarrier.standalone.setSetting({ theme: 'chalk' }); });
    await sv.waitForFunction(() => document.querySelector('style[data-sv-style="#orz-slide-theme"]')?.getAttribute('data-theme') === 'chalk', null, { timeout: 30_000, polling: 250 });
    expect(await sv.evaluate(() => document.querySelectorAll('style[data-sv-style="#orz-slide-theme"]').length)).toBe(1);
    await ctx.close();
  }, 180_000);

  (online ? it : it.skip)('[K.9] A2-ENG-3: opening the speaker view on an 80-slide chart deck never freezes the page — its copies are built lazily (current and next first, the rest one slide per idle period): no long task over 1 s (5–12 s before), the Next pane drawn within 5 s, a key answered while it builds', async () => {
    let t = '{{nyml\nkind: document\ntitle: Perf\ntheme: orchard\n}}\n\n';
    for (let i = 1; i <= 80; i++) t += `<!-- slide 2col -->\n## Slide ${i}\n\n- point $x_${i}^2$\n\n\`\`\`js\nlet a = ${i};\n\`\`\`\n<!-- @right -->\n{{chart type: bar\nlabels: A, B, C, D\ndata: ${i}, 3, 5, 2\n}}\n\n`;
    const { page, ctx } = await openDeck(browser!, sampleFile('k9-perf'), assemble(t), { network: true });
    await page.evaluate(() => {
      const w = window as unknown as { __lt: number[] };
      w.__lt = [];
      new PerformanceObserver((l) => { for (const e of l.getEntries()) w.__lt.push(Math.round(e.duration)); }).observe({ type: 'longtask', buffered: false });
    });
    const t0 = Date.now();
    const popup = ctx.waitForEvent('page');
    await press(page, 's');
    const sv = await popup;
    await sv.waitForFunction(() => !!document.querySelector('[data-sv="next"] section.orz-slide [data-orz-frozen]'), null, { timeout: 30_000, polling: 100 });
    expect(Date.now() - t0, 'the Next pane drawn').toBeLessThan(5000);
    const k0 = Date.now();
    await press(page, 'ArrowRight');
    await page.waitForFunction(() => (globalThis as unknown as PageGlobal).OrzCarrier.standalone.view.engine.index() === 1);
    expect(Date.now() - k0, 'a key while the copies build').toBeLessThan(1500);
    await page.waitForTimeout(10_000);
    const lt = await page.evaluate(() => (window as unknown as { __lt: number[] }).__lt);
    console.log('[K.9] long tasks while the speaker view opens (ms):', JSON.stringify(lt.slice(0, 12)), `… ${lt.length} in all`);
    expect(Math.max(0, ...lt), 'the longest task').toBeLessThan(1000);
    await ctx.close();
  }, 120_000);

  it('[K.9] A2-ENG-7: media never play off their slide — an autoplay <audio> becomes reveal\'s data-autoplay (started on its slide), and a static copy (print, the speaker view) has no autoplay at all', async () => {
    const text = '{{nyml\nkind: document\ntitle: Media\n}}\n\n<!-- slide -->\n## One\n\nhello\n\n<!-- slide -->\n## Two\n\n<audio src="tone.wav" autoplay controls></audio>\n';
    const { page, ctx } = await openDeck(browser!, sampleFile('media'), assemble(text));
    const live = await page.evaluate(() => { const a = document.querySelector('.reveal .slides audio')!; return { autoplay: a.hasAttribute('autoplay'), data: a.hasAttribute('data-autoplay') }; });
    expect(live).toEqual({ autoplay: false, data: true });
    const doc = await page.evaluate(() => (globalThis as unknown as PageGlobal).OrzCarrier.standalone.view.engine.printHtml({}) as Promise<{ html: string }>);
    expect(doc.html).not.toMatch(/autoplay/);
    expect(doc.html).toMatch(/preload="none"/);
    await ctx.close();
  });

  it('[C.1] the chrome slots: the bottom slot shows the number n / total, the section and the progress bar (its width follows --progress); the header keys turn number and bar off; the top slot holds the deck and section titles', async () => {
    const { page, ctx } = await openDeck(browser!, sampleFile('c1'), assemble(SAMPLE));
    await goTo(page, 3);
    const a = await page.evaluate(() => {
      const s = document.querySelector<HTMLElement>('.reveal .slides > section.present')!;
      const bar = s.querySelector<HTMLElement>('.orz-chrome-bar')!;
      return {
        num: s.querySelector('.orz-chrome-num')!.textContent,
        numShown: getComputedStyle(s.querySelector('.orz-chrome-num')!).display !== 'none',
        progress: s.style.getPropertyValue('--progress'),
        bar: bar.offsetWidth,
        track: s.offsetWidth - 2 * 80,
        sec: s.querySelector('.orz-chrome-sec')!.getAttribute('data-sec'),
        secTitle: s.querySelector('.orz-chrome-sec')!.textContent,
        head: [s.querySelector('.orz-head-deck')!.textContent, s.querySelector('.orz-head-sec')!.textContent],
        footer: s.querySelector('.orz-chrome .orz-footer')!.textContent!.trim(),
      };
    });
    expect(a).toMatchObject({ num: '4/12', numShown: true, progress: '0.2727', sec: '01', secTitle: 'Mechanism and kinetics', footer: 'CHEM 512 · Controlled radical polymerization' });
    expect(Math.abs(a.bar - 0.2727 * a.track)).toBeLessThan(2);
    expect(a.head).toEqual(['Controlled Radical Polymerization — orz-slides engine sample', 'Mechanism and kinetics']);
    await ctx.close();
    const off = SAMPLE.replace('ratio: 16:9\n', 'ratio: 16:9\nslide_numbers: no\nprogress: no\nsection_numbers: roman\n');
    const b = await openDeck(browser!, sampleFile('c1-off'), assemble(off));
    await goTo(b.page, 6);
    const r = await b.page.evaluate(() => {
      const s = document.querySelector('.reveal .slides > section.present')!;
      return { num: s.querySelectorAll('.orz-chrome-num').length, bar: s.querySelectorAll('.orz-chrome-bar').length, sec: s.querySelector('.orz-chrome-sec')!.getAttribute('data-sec') };
    });
    expect(r).toEqual({ num: 0, bar: 0, sec: 'II' });
    await goTo(b.page, 5);
    expect(await b.page.evaluate(() => document.querySelector('.reveal .slides > section.present .orz-section-main')!.getAttribute('data-sec'))).toBe('II');
    await b.ctx.close();
  });

  it('[C.2] the outline marks its current item on screen: the item of the next section (automatic) or here=N', async () => {
    const { page, ctx } = await openDeck(browser!, sampleFile('c2'), assemble(SAMPLE.replace('<!-- slide template=closing -->', '<!-- slide template=outline here=3 -->\n## Again\n1. One\n2. Two\n3. Three\n\n<!-- slide template=closing -->')));
    await goTo(page, 1);
    const first = await page.evaluate(() => {
      const li = document.querySelector('.reveal .slides > section.present li.orz-here')!;
      const other = document.querySelector('.reveal .slides > section.present li:not(.orz-here)')!;
      return { text: li.textContent, current: li.getAttribute('aria-current'), differs: getComputedStyle(li).backgroundColor !== getComputedStyle(other).backgroundColor };
    });
    expect(first).toEqual({ text: 'Mechanism and kinetics', current: 'step', differs: true });
    await goTo(page, 11);
    expect(await page.evaluate(() => document.querySelector('.reveal .slides > section.present li.orz-here')?.textContent)).toBe('Three');
    await ctx.close();
  });

  it('[C.3] the closing template lifts a lone {{qr}} into its own slot (its breadcrumb kept); two codes stay where they are', async () => {
    const { page, ctx } = await openDeck(browser!, sampleFile('c3'), assemble(`${SAMPLE}\n<!-- slide template=closing -->\n# Again\n${'Two codes {{qr https://a.example}} {{qr https://b.example}}'}\n`));
    await goTo(page, 11);
    const one = await page.evaluate(() => {
      const t = document.querySelector('.reveal .slides > section.present .orz-template-closing')!;
      const slot = t.querySelector(':scope > .orz-qr-slot');
      return { slot: !!slot, md: slot?.querySelector('.qrcode')?.getAttribute('data-md'), inMeta: t.querySelectorAll('.orz-title-meta .qrcode').length, meta: t.querySelector('.orz-title-meta')!.textContent!.trim().endsWith('markdown.orz.how') };
    });
    expect(one).toEqual({ slot: true, md: '{{qr https://markdown.orz.how}}', inMeta: 0, meta: true });
    await goTo(page, 12);
    expect(await page.evaluate(() => ({ slots: document.querySelectorAll('.reveal .slides > section.present .orz-qr-slot').length, codes: document.querySelectorAll('.reveal .slides > section.present .qrcode').length }))).toEqual({ slots: 0, codes: 2 });
    await ctx.close();
  });

  it('[T.1] the theme is the engine\'s: the header theme\'s own stylesheet (all 14 built); slides render at the logical size — 1280 × 720 for 16:9, 960 × 720 for 4:3 — and a Ratio or Theme setting re-presents the deck', async () => {
    const { page, ctx, errors } = await openDeck(browser!, sampleFile('t1'), assemble(SAMPLE));
    const look = () => page.evaluate(() => {
      const st = document.getElementById('orz-slide-theme')!;
      const s = document.querySelector<HTMLElement>('.reveal .slides > section.present')!;
      return { theme: st.getAttribute('data-theme'), css: st.getAttribute('data-theme-css'), w: s.offsetWidth, h: s.offsetHeight, orzThemeLink: !!document.getElementById('orz-theme') };
    });
    expect(await look()).toEqual({ theme: 'orchard', css: 'orchard', w: 1280, h: 720, orzThemeLink: false });
    await page.evaluate(() => { (globalThis as unknown as PageGlobal).OrzCarrier.standalone.setSetting({ ratio: '4:3' }); });
    await page.waitForFunction(() => document.querySelector<HTMLElement>('.reveal .slides > section.present')!.offsetWidth === 960);
    expect(await look()).toMatchObject({ w: 960, h: 720 });
    await page.evaluate(() => { (globalThis as unknown as PageGlobal).OrzCarrier.standalone.setSetting({ theme: 'paper' }); });
    await page.waitForFunction(() => document.getElementById('orz-slide-theme')!.getAttribute('data-theme') === 'paper');
    expect(await look()).toMatchObject({ theme: 'paper', css: 'paper' });
    expect(errors).toEqual([]);
    await ctx.close();
  });
});
