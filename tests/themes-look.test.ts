/**
 * Rebuild step 4 — the 14 slide themes in real Chrome (claims T.3–T.8), each
 * on the sample deck (tests/fixtures/sample: math, code, a table, a picture,
 * a float, a molecule, a chart, a diagram, a dense slide, a closing QR):
 *
 * - T.3 no silent clipping (the fit oracle, tests/fit-oracle.ts), and online
 *   no box of the sample deck is clipped at all;
 * - T.4 every text in the chrome slots (running head, footer, section,
 *   number) is at least 20 px at the logical 1280 × 720;
 * - T.5 contrast from what is drawn: body ink ≥ 4.5 : 1 and titles ≥ 3 : 1
 *   against the background sampled from a screenshot with the text hidden;
 * - T.6 the chart and the diagram are drawn with the theme's tokens
 *   (`--chart-*`, `--mm-*`); dark themes draw them dark-native (light ink on
 *   the slide's dark, no light panel);
 * - T.7 the D-46 long title fits on the title pages in every theme;
 * - T.8 the Theme setting switches the theme (stylesheet, section labels,
 *   colours, the chart redrawn in the new tokens).
 *
 * Online (webfonts and the pinned content libraries): skipped without the
 * network, as K.7 and K.8.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assemble } from '../src/lib.js';
import { THEMES } from '../src/themes.js';
import { checkDeck } from './fit-oracle.js';
import { corpus, goTo, launchChrome, openDeck, type PageGlobal } from './helpers.js';

type Page = import('playwright-core').Page;

const browser = await launchChrome();
const dir = mkdtempSync(join(tmpdir(), 'orz-slides-themes-'));
afterAll(async () => { await browser?.close(); rmSync(dir, { recursive: true, force: true }); });

const online = await (async () => {
  try {
    const r = await fetch('https://cdn.jsdelivr.net/npm/orz-markdown@2.3.0/package.json', { signal: AbortSignal.timeout(8000) });
    return r.ok;
  } catch { return false; }
})();
const real = browser && online ? describe : describe.skip;

const SAMPLE = readFileSync('tests/fixtures/sample/sample.slides.md', 'utf8');
const withTheme = (text: string, id: string): string => text.replace(/^theme: .*$/m, `theme: ${id}`);
const deckFile = (name: string): string => {
  const sub = join(dir, name);
  mkdirSync(sub, { recursive: true });
  copyFileSync('tests/fixtures/sample/gpc-traces.svg', join(sub, 'gpc-traces.svg'));
  return join(sub, 'deck.slides.html');
};
/** The sample deck's slides (0-based). */
const S = { title: 0, step: 3, chart: 7, closing: 11 } as const;

async function settle(page: Page): Promise<void> {
  // everything the page loads (webfonts, KaTeX's stylesheet) has arrived and fit has run after it
  await page.waitForLoadState('load', { timeout: 90_000 });
  // no slide transition: a slide is measured and sampled where it rests
  await page.addStyleTag({ content: '.reveal .slides > section { transition: none !important; }' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
}

/** Every text of the current slide's chrome slots, with its computed size (logical px), when it is shown. */
function chromeTexts(page: Page): Promise<Array<{ text: string; size: number }>> {
  return page.evaluate(() => {
    const s = document.querySelector('.reveal .slides > section.present')!;
    const out: Array<{ text: string; size: number }> = [];
    for (const slot of Array.from(s.querySelectorAll(':scope > .orz-head, :scope > .orz-chrome'))) {
      const w = document.createTreeWalker(slot, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        const t = (n.textContent ?? '').trim();
        const el = n.parentElement!;
        if (!t || el.closest('.katex-mathml')) continue;
        const r = document.createRange();
        r.selectNodeContents(n);
        const rects = Array.from(r.getClientRects()).filter((x) => x.width > 0 && x.height > 0);
        const cs = getComputedStyle(el);
        if (!rects.length || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
        out.push({ text: t.slice(0, 30), size: parseFloat(cs.fontSize) });
      }
    }
    return out;
  });
}

/** WCAG contrast of an element's text against the background drawn behind it (sampled with the text hidden). */
async function contrast(page: Page, selector: string): Promise<{ ratio: number; ink: string; bg: string } | null> {
  const box = await page.evaluate((sel) => {
    const el = document.querySelector<HTMLElement>(`.reveal .slides > section.present ${sel}`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const fill = cs.getPropertyValue('-webkit-text-fill-color');
    return { x: r.left, y: r.top, width: r.width, height: Math.min(r.height, 120), ink: fill && fill !== cs.color && !/rgba\(0, 0, 0, 0\)/.test(fill) ? fill : cs.color };
  }, selector);
  if (!box || box.width < 2 || box.height < 2) return null;
  const hide = await page.addStyleTag({ content: `.reveal .slides > section.present ${selector}, .reveal .slides > section.present ${selector} * { color: transparent !important; -webkit-text-fill-color: transparent !important; -webkit-text-stroke: 0 !important; text-shadow: none !important; text-decoration-color: transparent !important; } .reveal .slides > section.present ${selector} :is(svg, img, canvas, .katex) { visibility: hidden !important; }` });
  await page.waitForTimeout(60);
  const png = await page.screenshot({ clip: { x: box.x, y: box.y, width: box.width, height: box.height } });
  await hide.evaluate((el) => (el as Element).remove());
  return page.evaluate(async ({ data, ink }) => {
    const img = new Image();
    img.src = `data:image/png;base64,${data}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const g = c.getContext('2d')!;
    g.drawImage(img, 0, 0);
    const px = g.getImageData(0, 0, c.width, c.height).data;
    const ch: number[][] = [[], [], []];
    for (let i = 0; i < px.length; i += 4) for (let k = 0; k < 3; k++) ch[k].push(px[i + k]);
    const median = ch.map((v) => v.sort((a, b) => a - b)[v.length >> 1]);
    const probe = document.createElement('span');
    probe.style.color = ink;
    document.body.appendChild(probe);
    const m = /rgba?\(([\d.]+), ([\d.]+), ([\d.]+)(?:, ([\d.]+))?\)/.exec(getComputedStyle(probe).color)!;
    probe.remove();
    const a = m[4] === undefined ? 1 : Number(m[4]);
    const fg = [1, 2, 3].map((k, j) => Number(m[k]) * a + median[j] * (1 - a));
    const lum = (rgb: number[]): number => {
      const [r, gg, b] = rgb.map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
      return 0.2126 * r + 0.7152 * gg + 0.0722 * b;
    };
    const [l1, l2] = [lum(fg), lum(median)].sort((x, y) => y - x);
    return { ratio: (l1 + 0.05) / (l2 + 0.05), ink: `rgb(${fg.map(Math.round).join(',')})`, bg: `rgb(${median.join(',')})` };
  }, { data: png.toString('base64'), ink: box.ink });
}

/** The chart and the diagram of the current slide, against the theme's tokens (colours normalised by the browser). */
function graphics(page: Page): Promise<{ chart: Record<string, unknown>; tokens: Record<string, unknown>; mermaid: Record<string, unknown> }> {
  return page.evaluate(() => {
    const s = document.querySelector('.reveal .slides > section.present')!;
    const norm = (c: unknown): string => {
      const p = document.createElement('span');
      p.style.color = '';
      p.style.color = String(c ?? '');
      document.body.appendChild(p);
      const v = p.style.color ? getComputedStyle(p).color : `invalid:${String(c)}`;
      p.remove();
      return v;
    };
    const lum = (c: string): number => {
      const m = /rgba?\(([\d.]+), ([\d.]+), ([\d.]+)/.exec(c);
      if (!m) return NaN;
      const [r, g, b] = [m[1], m[2], m[3]].map((v) => { const x = Number(v) / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const canvas = s.querySelector<HTMLCanvasElement>('canvas.orz-chart')!;
    const C = (window as unknown as { Chart: { getChart(c: unknown): { options: { scales: Record<string, { ticks: { color: unknown; font?: { size?: unknown } } }> }; data: { datasets: Array<{ borderColor: unknown }> } } | undefined } }).Chart;
    const ch = C.getChart(canvas)!;
    const cs = getComputedStyle(canvas);
    const frame = canvas.closest<HTMLElement>('.orz-chart-frame')!;
    const fbg = norm(getComputedStyle(frame).backgroundColor);
    const svg = s.querySelector('div.mermaid svg')!;
    const node = svg.querySelector<SVGElement>('.node rect, .node polygon, .node path')!;
    const label = svg.querySelector<SVGElement>('.node text, .node .nodeLabel, .node tspan')!;
    const mbg = norm(getComputedStyle(s.querySelector('div.mermaid')!).backgroundColor);
    return {
      chart: {
        tick: norm(ch.options.scales['x'].ticks.color),
        series: norm(ch.data.datasets[0].borderColor),
        size: Number(ch.options.scales['x'].ticks.font?.size),
        frameBg: fbg,
      },
      tokens: {
        text: norm(cs.getPropertyValue('--chart-text').trim()),
        c1: norm(cs.getPropertyValue('--chart-1').trim()),
        size: parseFloat(cs.getPropertyValue('--chart-font-size')),
        node: norm(getComputedStyle(s.querySelector('div.mermaid')!).getPropertyValue('--mm-node').trim()),
      },
      mermaid: {
        node: norm(getComputedStyle(node).fill),
        labelLum: lum(norm(getComputedStyle(label).fill !== 'none' && label.tagName !== 'SPAN' && label.tagName !== 'DIV' ? getComputedStyle(label).fill : getComputedStyle(label).color)),
        nodeLum: lum(norm(getComputedStyle(node).fill)),
        tickLum: lum(norm(ch.options.scales['x'].ticks.color)),
        bg: mbg,
        bgAlpha: /rgba\(.*, ([\d.]+)\)$/.exec(mbg)?.[1] ?? '1',
        bgLum: lum(mbg),
        frameAlpha: /rgba\(.*, ([\d.]+)\)$/.exec(fbg)?.[1] ?? '1',
        frameLum: lum(fbg),
      },
    };
  });
}

real('the 14 slide themes on the sample deck (real Chrome, online)', () => {
  for (const t of THEMES) {
    it(`[T.3][T.4][T.5][T.6] ${t.id}: no silent clipping and nothing clipped; chrome text >= 20px; body ink >= 4.5:1, titles >= 3:1; chart and diagram in the theme's tokens${t.scheme === 'dark' ? ', dark-native' : ''}`, async () => {
      const { page, ctx, errors } = await openDeck(browser!, deckFile(t.id), assemble(withTheme(SAMPLE, t.id)), { network: true });
      await settle(page);
      expect(await page.evaluate(() => document.getElementById('orz-slide-theme')!.getAttribute('data-theme-css'))).toBe(t.id);
      // T.3: the oracle on every slide, then nothing clipped at all
      const boxes = await checkDeck(page, t.id);
      expect(boxes.filter((b) => b.clipped).map((b) => `slide ${b.slide + 1} ${b.box}`), `${t.id}: clipped boxes`).toEqual([]);
      // T.4: chrome slot text on every slide
      const small: string[] = [];
      for (let i = 0; i < 12; i++) {
        await goTo(page, i);
        for (const x of await chromeTexts(page)) if (x.size < 19.95) small.push(`slide ${i + 1} "${x.text}" ${x.size}px`);
      }
      expect(small, `${t.id}: chrome text under 20px`).toEqual([]);
      // T.5: contrast of body ink and titles against what is drawn behind them
      await goTo(page, S.step);
      await settle(page);
      const body = await contrast(page, '.orz-region > .markdown-body > p:first-child');
      const band = await contrast(page, '.orz-title h2');
      await goTo(page, S.title);
      await settle(page);
      const main = await contrast(page, '.orz-title-main');
      expect(body, `${t.id}: body`).not.toBeNull();
      expect(body!.ratio, `${t.id}: body ink ${body!.ink} on ${body!.bg}`).toBeGreaterThanOrEqual(4.5);
      expect(band!.ratio, `${t.id}: title band ${band!.ink} on ${band!.bg}`).toBeGreaterThanOrEqual(3);
      expect(main!.ratio, `${t.id}: title page ${main!.ink} on ${main!.bg}`).toBeGreaterThanOrEqual(3);
      // T.6: the chart and the diagram in the theme's tokens
      await goTo(page, S.chart);
      await page.waitForFunction(() => {
        const c = document.querySelector('.reveal .slides > section.present canvas.orz-chart');
        const C = (window as unknown as { Chart?: { getChart(c: unknown): unknown } }).Chart;
        return !!c && !!C && !!C.getChart(c) && !!document.querySelector('.reveal .slides > section.present div.mermaid svg .node');
      }, null, { timeout: 30_000 });
      const g = await graphics(page);
      expect(g.chart.tick, `${t.id}: tick colour = --chart-text`).toBe(g.tokens.text);
      expect(g.chart.series, `${t.id}: first series = --chart-1`).toBe(g.tokens.c1);
      expect(g.chart.size, `${t.id}: chart font = --chart-font-size`).toBe(g.tokens.size);
      expect(g.tokens.size, `${t.id}: chart font size`).toBeGreaterThanOrEqual(18);
      expect(g.mermaid.node, `${t.id}: diagram node fill = --mm-node`).toBe(g.tokens.node);
      if (t.scheme === 'dark') {
        expect(g.mermaid.tickLum, `${t.id}: chart ink is light`).toBeGreaterThan(0.35);
        expect(g.mermaid.labelLum, `${t.id}: diagram labels are light`).toBeGreaterThan(0.35);
        expect(g.mermaid.nodeLum, `${t.id}: diagram nodes are dark`).toBeLessThan(0.2);
        expect(Number(g.mermaid.bgAlpha) === 0 || (g.mermaid.bgLum as number) < 0.2, `${t.id}: no light panel behind the diagram (${String(g.mermaid.bg)})`).toBe(true);
        expect(Number(g.mermaid.frameAlpha) === 0 || (g.mermaid.frameLum as number) < 0.2, `${t.id}: no light panel behind the chart`).toBe(true);
      } else {
        expect(g.mermaid.tickLum, `${t.id}: chart ink is dark`).toBeLessThan(0.3);
        expect(g.mermaid.labelLum, `${t.id}: diagram labels are dark`).toBeLessThan(0.3);
      }
      expect(errors, t.id).toEqual([]);
      await ctx.close();
    }, 240_000);
  }

  it('[T.7] D-46: the long title stays inside the slide on the title pages (v2 and v1) in every theme, the page fitted and not clipped', async () => {
    const c = corpus('slides').find((x) => x.path.endsWith('title-v2-long-title.slides.md'))!;
    for (const t of THEMES) {
      const { page, ctx } = await openDeck(browser!, deckFile(`d46-${t.id}`), assemble(withTheme(c.text, t.id)), { network: true });
      await settle(page);
      for (const i of [0, 1, 2]) {
        await goTo(page, i);
        const r = await page.evaluate((n) => {
          const s = document.querySelectorAll<HTMLElement>('.reveal .slides > section')[n];
          const tpl = s.querySelector<HTMLElement>('.orz-template')!;
          const h1 = tpl.querySelector<HTMLElement>('h1')!;
          const sr = s.getBoundingClientRect();
          const hr = h1.getBoundingClientRect();
          return { clipped: tpl.hasAttribute('data-clipped'), inside: hr.left >= sr.left - 1 && hr.right <= sr.right + 1 && hr.top >= sr.top - 1 && hr.bottom <= sr.bottom + 1 };
        }, i);
        expect(r, `${t.id} slide ${i + 1}`).toEqual({ clipped: false, inside: true });
      }
      await checkDeck(page, `D-46 ${t.id}`);
      await ctx.close();
    }
  }, 300_000);

  it('[T.8] the Theme setting switches the theme: its stylesheet, its section labels (Paper roman), its colours and scheme, the chart redrawn in its tokens', async () => {
    const { page, ctx, errors } = await openDeck(browser!, deckFile('switch'), assemble(SAMPLE), { network: true });
    const look = () => page.evaluate(() => {
      const s = document.querySelectorAll<HTMLElement>('.reveal .slides > section');
      return {
        css: document.getElementById('orz-slide-theme')!.getAttribute('data-theme-css'),
        sec: s[2].querySelector('.orz-section-main')!.getAttribute('data-sec'),
        bg: getComputedStyle(s[0]).backgroundColor + getComputedStyle(s[0]).backgroundImage,
        scheme: document.querySelector('meta[name="color-scheme"]')?.getAttribute('content') ?? null,
      };
    });
    const first = await look();
    expect(first).toMatchObject({ css: 'orchard', sec: '01' });
    for (const [id, sec, scheme] of [['paper', 'I', 'light'], ['nocturne', '01', 'dark'], ['chalk', '01', 'dark']] as const) {
      await page.evaluate((x) => { (globalThis as unknown as PageGlobal).OrzCarrier.standalone.setSetting({ theme: x }); }, id);
      await page.waitForFunction((x) => document.getElementById('orz-slide-theme')!.getAttribute('data-theme-css') === x && document.querySelectorAll('.reveal .slides > section')[2]?.querySelector('.orz-section-main') !== null, id);
      await page.waitForTimeout(300);
      const now = await look();
      expect(now, id).toMatchObject({ css: id, sec, scheme });
      expect(now.bg, `${id}: the slide background changed`).not.toBe(first.bg);
      await goTo(page, S.chart);
      await page.waitForFunction(() => {
        const c = document.querySelector('.reveal .slides > section.present canvas.orz-chart');
        const C = (window as unknown as { Chart?: { getChart(c: unknown): unknown } }).Chart;
        return !!c && !!C && !!C.getChart(c);
      }, null, { timeout: 30_000 });
      const g = await graphics(page);
      expect(g.chart.tick, `${id}: the chart redrawn in the new tokens`).toBe(g.tokens.text);
    }
    expect(errors).toEqual([]);
    await ctx.close();
  }, 180_000);
});
