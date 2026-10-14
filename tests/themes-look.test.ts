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
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assemble } from '../src/lib.js';
import { THEMES } from '../src/themes.js';
import { checkDeck } from './fit-oracle.js';
import { corpus, goTo, launchChrome, openDeck, type PageGlobal } from './helpers.js';
import { coveredTexts, redShare, textOverlaps } from './support/overprint.js';

type Page = import('playwright-core').Page;

const browser = await launchChrome({ online: true }); // deliberately online: its K.7/F.5/T.3 decks load the pinned CDN libraries (D-63)
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
  await page.addStyleTag({ content: '.reveal .slides > section, .reveal .backgrounds .slide-background { transition: none !important; }' });
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

/*
 * Closed-loop round A3 (notes/closed-loop.md): theme rules that reached more
 * than they meant — a picture rule on any paragraph with an image (A3-TH-1),
 * an absolutely placed title block over the text (A3-TH-5), a cover over the
 * author's background (A3-TH-6), a gradient bg= drawn as a colour (A3-TH-7),
 * a numbering setting that hid the section title (A3-TH-4), a status bar
 * that capped the section beside an empty footer (A3-TH-8). Offline, every
 * theme; each failed on rebuild/1.0@a9f4ab3.
 */
const chromeOnly = browser ? describe : describe.skip;
const A3 = (id: string, ratio: string, body: string, keys = ''): string => `{{nyml\nkind: document\ncarrier: slides\ntitle: Round A3\ntheme: ${id}\nratio: ${ratio}\n${keys}}}\n\n${body}`;
const offline = async (name: string, text: string): Promise<{ page: Page; ctx: import('playwright-core').BrowserContext }> => {
  const sub = join(dir, name);
  mkdirSync(sub, { recursive: true });
  copyFileSync('tests/fixtures/stress/big.svg', join(sub, 'big.svg'));
  const o = await openDeck(browser!, join(sub, 'deck.slides.html'), assemble(text));
  await o.page.addStyleTag({ content: '.reveal .slides > section, .reveal .backgrounds .slide-background { transition: none !important; }' });
  return o;
};

chromeOnly('round A3: theme rules that reach only what they mean (real Chrome, offline, every theme)', () => {
  it('[T.11] A3-TH-1: a sentence with an inline icon, and a caption written on the line above its picture, keep their line height — no two lines of a paragraph over each other; a paragraph that IS a picture is p.orz-pic', async () => {
    const body = '<!-- slide -->\n## An icon in a sentence\nPress the <img src="big.svg" width="28" height="28" alt="gear"> button in the toolbar, then choose Settings and pick the export format you want from the list that opens below it.\n\n<!-- slide -->\n## A caption and its picture\nFigure 1. Conversion against time for the polymerization in flow at three temperatures, measured by NMR.\n<img src="big.svg" width="220" alt="plot">\n\n<!-- slide -->\n## A picture\n![plot](big.svg)\n';
    const bad: string[] = [];
    for (const t of THEMES) {
      const { page, ctx } = await offline(`icon-${t.id}`, A3(t.id, '16:9', body));
      for (const i of [0, 1]) {
        await goTo(page, i);
        const lh = await page.evaluate(() => getComputedStyle(document.querySelector('.reveal .slides > section.present .orz-region .markdown-body p')!).lineHeight);
        if (lh === '0px') bad.push(`${t.id} slide ${i + 1}: line-height 0`);
        for (const x of await textOverlaps(page)) bad.push(`${t.id} slide ${i + 1}: ${x}`);
      }
      await goTo(page, 2);
      if (!(await page.evaluate(() => !!document.querySelector('.reveal .slides > section.present p.orz-pic > img')))) bad.push(`${t.id}: the picture paragraph is not p.orz-pic`);
      await ctx.close();
    }
    expect(bad).toEqual([]);
  }, 300_000);

  it('[T.11] A3-TH-5 (the A2-TH-12 class): no absolutely placed block covers a text — a long title, a two-line subtitle and a three-line meta on title v1, v2 and v5 at 4:3 and 16:9, in every theme', async () => {
    const META = '**Yu Wang**, Jane Doe-Smithson · Department of Chemistry · University of Louisiana at Lafayette · Fall 2026';
    const page1 = (v: number): string => `<!-- slide template=title v=${v} -->\n# Reversible addition–fragmentation chain-transfer polymerization of functional acrylates in continuous flow reactors\n## Mechanism, kinetics, molecular weight control and the design of block copolymers for biomedical use\n${META}\n\n`;
    const body = [1, 2, 5].map(page1).join('');
    const bad: string[] = [];
    for (const t of THEMES) for (const ratio of ['4:3', '16:9']) {
      const { page, ctx } = await offline(`cover-${t.id}-${ratio.replace(':', 'x')}`, A3(t.id, ratio, body));
      for (const i of [0, 1, 2]) {
        await goTo(page, i);
        for (const x of await coveredTexts(page)) bad.push(`${t.id} ${ratio} v${[1, 2, 5][i]}: ${x}`);
        for (const x of await textOverlaps(page)) bad.push(`${t.id} ${ratio} v${[1, 2, 5][i]}: ${x}`);
      }
      await ctx.close();
    }
    expect(bad).toEqual([]);
  }, 300_000);

  it('[T.14] A3-TH-6, A3-TH-7: bg= shows on a cover page (title v5, closing v2: the author\'s background replaces the cover colour) and as a CSS gradient — on screen and on paper (the speaker\'s copies are the print pipeline\'s), in every theme', async () => {
    const body = '<!-- slide -->\n## First\n\n<!-- slide template=title v=5 bg=#d81b1b -->\n# A cover with its own background\nYu Wang\n\n<!-- slide template=closing v=2 bg=#d81b1b -->\n## Thank you\n\n<!-- slide bg="linear-gradient(#d81b1b, #d81b1b)" -->\n## A gradient background\n';
    const bad: string[] = [];
    for (const t of THEMES) {
      const { page, ctx } = await offline(`bg-${t.id}`, A3(t.id, '16:9', body));
      for (const i of [1, 2, 3]) {
        await goTo(page, i);
        await page.waitForTimeout(150);
        const r = await redShare(page);
        if (r < 0.4) bad.push(`${t.id} screen slide ${i + 1}: ${(r * 100).toFixed(0)} % red`);
      }
      const doc = await page.evaluate(() => (globalThis as unknown as PageGlobal).OrzCarrier.standalone.view.engine.printHtml({}) as Promise<{ html: string }>);
      const pr = await browser!.newContext({ viewport: { width: 1280, height: 720 } });
      await pr.route('**/*', (r) => (r.request().url().startsWith('file:') || r.request().url().startsWith('data:') ? r.continue() : r.abort()));
      const p = await pr.newPage();
      await p.setContent(doc.html);
      for (const i of [1, 2, 3]) {
        await p.evaluate((n) => { document.querySelectorAll('.orz-page')[n].scrollIntoView(); }, i);
        const r = await redShare(p);
        if (r < 0.4) bad.push(`${t.id} print slide ${i + 1}: ${(r * 100).toFixed(0)} % red`);
      }
      await pr.close();
      await ctx.close();
    }
    expect(bad).toEqual([]);
  }, 300_000);

  it('[C.1] A3-TH-4: section_numbers: none takes the number away, never the section title — the running chrome that shows the section with numbers shows its title without them, in every theme', async () => {
    const body = '<!-- slide template=section -->\n# Kinetics\n\n<!-- slide -->\n## A normal slide\ntext\n';
    const shown = async (page: Page): Promise<string[]> => page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('.reveal .slides > section.present :is(.orz-chrome-sec, .orz-head-sec)')).filter((e) => {
      const r = e.getBoundingClientRect();
      return getComputedStyle(e).display !== 'none' && r.width > 4 && r.height > 4 && parseFloat(getComputedStyle(e).fontSize) > 0;
    }).map((e) => e.className));
    const bad: string[] = [];
    for (const t of THEMES) {
      const a = await offline(`sec01-${t.id}`, A3(t.id, '16:9', body, 'section_numbers: 01\n'));
      await goTo(a.page, 1);
      const withNumbers = await shown(a.page);
      await a.ctx.close();
      const b = await offline(`secnone-${t.id}`, A3(t.id, '16:9', body, 'section_numbers: none\n'));
      await goTo(b.page, 1);
      const without = await shown(b.page);
      const text = await b.page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('.reveal .slides > section.present :is(.orz-chrome-sec, .orz-head-sec)')).map((e) => e.textContent ?? '').join(' '));
      await b.ctx.close();
      for (const c of withNumbers) if (!without.includes(c)) bad.push(`${t.id}: ${c} hidden with section_numbers: none`);
      if (without.length > 0 && !/Kinetics/.test(text)) bad.push(`${t.id}: the section title is not in the chrome`);
    }
    expect(bad).toEqual([]);
  }, 300_000);

  it('[T.11] A3-TH-8: Nocturne\'s one-row status bar gives a short footer\'s room to a long section title (at 4:3 and 16:9) — the section was capped at 40 % beside an empty footer', async () => {
    const body = '<!-- slide template=section -->\n# Reversible addition–fragmentation chain transfer in continuous flow\n\n<!-- slide -->\n## A normal slide\ntext\n';
    for (const ratio of ['4:3', '16:9']) {
      const { page, ctx } = await offline(`noc-${ratio.replace(':', 'x')}`, A3('nocturne', ratio, body, 'footer: CHEM 512\n'));
      await goTo(page, 1);
      const r = await page.evaluate(() => {
        const s = document.querySelector('.reveal .slides > section.present')!;
        const sec = s.querySelector<HTMLElement>('.orz-chrome-sec')!;
        const foot = s.querySelector<HTMLElement>('.orz-footer')!;
        return { sec: sec.clientWidth, secFull: sec.scrollWidth, foot: foot.clientWidth, footFull: foot.scrollWidth };
      });
      expect(r.footFull, `${ratio}: the short footer is whole ${JSON.stringify(r)}`).toBeLessThanOrEqual(r.foot + 1);
      expect(r.foot, `${ratio}: the footer takes only its text's room ${JSON.stringify(r)}`).toBeLessThan(r.sec);
      if (ratio === '16:9') expect(r.secFull, `${ratio}: the long section title shows whole ${JSON.stringify(r)}`).toBeLessThanOrEqual(r.sec + 1);
      await ctx.close();
    }
  }, 120_000);
});

/*
 * Closed-loop round A4 (notes/closed-loop.md): A3's status-bar fix cut a SHORT
 * footer beside a long section title (A4-TH-1); the kit's common.css made a
 * picture inside a link, a list item or a table cell a block, breaking an
 * icon's sentence (A4-TH-2); `section_numbers: none` left an empty number
 * badge on the section pages (A4-TH-3); a photo inside a callout, quote,
 * list or cell, and two pictures side by side, were not sized to their box —
 * the fit floored at 0.6 and cut a third of the picture (A4-TH-4). Offline,
 * every theme; each failed on rebuild/1.0@ab85c1e (kit orz-markdown@dc301f7).
 */
const PHOTO = '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800"><rect width="1200" height="800" fill="#7a9"/><circle cx="600" cy="400" r="300" fill="#357"/></svg>';
const GEAR = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#c33"/></svg>';
const offlineWith = async (name: string, text: string, o: { viewport?: { width: number; height: number } } = {}): Promise<{ page: Page; ctx: import('playwright-core').BrowserContext }> => {
  const sub = join(dir, name);
  mkdirSync(sub, { recursive: true });
  writeFileSync(join(sub, 'photo.svg'), PHOTO);
  writeFileSync(join(sub, 'gear.svg'), GEAR);
  const r = await openDeck(browser!, join(sub, 'deck.slides.html'), assemble(text), o);
  await r.page.addStyleTag({ content: '.reveal .slides > section, .reveal .backgrounds .slide-background { transition: none !important; }' });
  return r;
};

chromeOnly('round A4: footers, icons, section badges and pictures in containers (real Chrome, offline, every theme)', () => {
  it('[T.11] A4-TH-1: Nocturne\'s status bar shares its room fairly — a short footer beside a long section title is never cut (4:3 and 16:9), a long footer beside a short section takes the rest, two long texts each keep a fair share', async () => {
    const LONG_SEC = 'Reversible addition–fragmentation chain-transfer polymerization of functional acrylates in continuous flow';
    const LONG_FOOT = 'CHEM 512 · Controlled radical polymerization · University of Louisiana at Lafayette · Fall 2026';
    const cases: Array<[string, string, string]> = [['short-foot', 'CHEM 512', LONG_SEC], ['long-foot', LONG_FOOT, 'Kinetics'], ['both-long', LONG_FOOT, LONG_SEC]];
    const bad: string[] = [];
    for (const ratio of ['4:3', '16:9']) for (const [name, foot, sec] of cases) {
      const body = `<!-- slide template=section -->\n# ${sec}\n\n<!-- slide -->\n## A normal slide\ntext\n`;
      const { page, ctx } = await offlineWith(`a4noc-${name}-${ratio.replace(':', 'x')}`, A3('nocturne', ratio, body, `footer: ${foot}\n`));
      await goTo(page, 1);
      const r = await page.evaluate(() => {
        const s = document.querySelector('.reveal .slides > section.present')!;
        const chrome = s.querySelector<HTMLElement>('.orz-chrome')!;
        const sec = s.querySelector<HTMLElement>('.orz-chrome-sec')!;
        const line = s.querySelector<HTMLElement>('.orz-footer .markdown-body > *')!;
        const outer = (e: Element | null): number => { if (!e) return 0; const c = getComputedStyle(e); return e.getBoundingClientRect().width + parseFloat(c.marginLeft) + parseFloat(c.marginRight); };
        const cs = getComputedStyle(chrome);
        const k = chrome.getBoundingClientRect().width / chrome.offsetWidth;
        const room = chrome.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
        const used = (outer(s.querySelector('.orz-chrome > .orz-footer')) + outer(sec) + outer(s.querySelector('.orz-chrome > .orz-chrome-num'))) / k;
        return { chrome: chrome.clientWidth, free: Math.round(room - used), foot: line.clientWidth, footFull: line.scrollWidth, sec: sec.clientWidth, secFull: sec.scrollWidth };
      });
      const tag = `${ratio} ${name} ${JSON.stringify(r)}`;
      if (name === 'short-foot' && r.footFull > r.foot + 1) bad.push(`${tag}: the short footer is cut`);
      if (name === 'long-foot' && r.secFull > r.sec + 1) bad.push(`${tag}: the short section is cut`);
      if (name === 'long-foot' && r.free > 4) bad.push(`${tag}: the long footer is cut while ${r.free} px stay free`);
      if (name === 'both-long' && (r.foot < r.chrome * 0.25 || r.sec < r.chrome * 0.25)) bad.push(`${tag}: one long text starves the other`);
      await ctx.close();
    }
    expect(bad).toEqual([]);
  }, 120_000);

  it('[T.11] A4-TH-2: a picture inside a link, a list item or a table cell keeps its line — a linked inline icon, an icon in a tight list item and in a cell, and a badge row stay inline, on the line of the text beside them, in every theme', async () => {
    const body = '<!-- slide -->\n## Icons\nPress the ![gear](gear.svg) button, then [![gear](gear.svg)](https://x.org) and pick the format.\n\n- Press ![gear](gear.svg) in a list\n\n| Key | What |\n|---|---|\n| ![gear](gear.svg) here | a cell |\n\n[![build](gear.svg)](https://x.org) [![cov](gear.svg)](https://x.org) badges\n';
    const bad: string[] = [];
    for (const t of THEMES) {
      const { page, ctx } = await offlineWith(`a4icon-${t.id}`, A3(t.id, '16:9', body));
      const r = await page.evaluate(() => {
        const s = document.querySelector('.reveal .slides > section.present')!;
        const out: string[] = [];
        for (const im of Array.from(s.querySelectorAll<HTMLImageElement>('.orz-region img'))) {
          const where = `${im.parentElement!.tagName.toLowerCase()} > img`;
          if (getComputedStyle(im).display === 'block') out.push(`${where}: display block`);
          // the text node next to it (before, else after) shares its line
          const host = im.parentElement!.tagName === 'A' ? im.parentElement! : im;
          let n: Node | null = host.previousSibling;
          while (n && !(n.nodeType === 3 && (n.textContent ?? '').trim())) n = n.previousSibling;
          if (!n) { n = host.nextSibling; while (n && !(n.nodeType === 3 && (n.textContent ?? '').trim())) n = n.nextSibling; }
          if (!n) continue;
          const rg = document.createRange();
          rg.selectNodeContents(n);
          const rects = Array.from(rg.getClientRects());
          const near = n === host.previousSibling || (n.compareDocumentPosition(host) & Node.DOCUMENT_POSITION_FOLLOWING) ? rects[rects.length - 1] : rects[0];
          const c = im.getBoundingClientRect();
          const mid = (c.top + c.bottom) / 2;
          if (!near || mid < near.top - 2 || mid > near.bottom + 2) out.push(`${where}: not on the line of its text`);
        }
        return out;
      });
      for (const x of r) bad.push(`${t.id}: ${x}`);
      await ctx.close();
    }
    expect(bad).toEqual([]);
  }, 300_000);

  it('[C.1] A4-TH-3: section_numbers: none takes the section page\'s number badge away entirely — no pseudo-element that shows the number with 01 is drawn (an empty disc, tag, tab or ring), in every theme', async () => {
    const body = '<!-- slide template=section -->\n# Kinetics\n\n<!-- slide -->\n## A normal slide\ntext\n';
    const pseudo = (page: Page): Promise<Record<string, { content: string; display: string; w: number; h: number }>> => page.evaluate(() => {
      const el = document.querySelector<HTMLElement>('.reveal .slides > section.present .orz-section-main')!;
      const out: Record<string, { content: string; display: string; w: number; h: number }> = {};
      for (const p of ['::before', '::after']) { const cs = getComputedStyle(el, p); out[p] = { content: cs.content, display: cs.display, w: parseFloat(cs.width) || 0, h: parseFloat(cs.height) || 0 }; }
      return out;
    });
    const bad: string[] = [];
    for (const t of THEMES) {
      const a = await offlineWith(`a4sec01-${t.id}`, A3(t.id, '16:9', body, 'section_numbers: 01\n'));
      const withNumber = await pseudo(a.page);
      await a.ctx.close();
      const b = await offlineWith(`a4secnone-${t.id}`, A3(t.id, '16:9', body, 'section_numbers: none\n'));
      const without = await pseudo(b.page);
      const title = await b.page.evaluate(() => document.querySelector('.reveal .slides > section.present .orz-section-main')!.textContent ?? '');
      await b.ctx.close();
      for (const p of ['::before', '::after']) {
        if (!/01/.test(withNumber[p].content)) continue; // not the number's pseudo
        if (without[p].display !== 'none' && without[p].content !== 'none') bad.push(`${t.id} ${p}: drawn without a number (${JSON.stringify(without[p])})`);
      }
      if (!/Kinetics/.test(title)) bad.push(`${t.id}: the section title is gone`);
    }
    expect(bad).toEqual([]);
  }, 300_000);

  it('[T.11][F.3] A4-TH-4: a photo inside a callout, a quote, a list item or a table cell, and two pictures side by side, are sized to their box — no box clipped, no picture cut — in every theme at 16:9 (and three at 4:3)', async () => {
    const S = [
      '## Two side by side\n![a](photo.svg) ![b](photo.svg)',
      '## In a list\n- ![a](photo.svg)\n- second item',
      '## In a loose list\n- ![a](photo.svg)\n\n- second item',
      '## In a quote\n> ![a](photo.svg)',
      '## In a callout\n::: info\n![a](photo.svg)\n:::',
      '## In a table\n| a | b |\n|---|---|\n| ![a](photo.svg) | text |',
    ];
    const body = S.map((x) => `<!-- slide -->\n${x}\n`).join('\n');
    const bad: string[] = [];
    const runs: Array<[string, string]> = [...THEMES.map((t): [string, string] => [t.id, '16:9']), ['orchard', '4:3'], ['architect', '4:3'], ['notebook', '4:3']];
    for (const [id, ratio] of runs) {
      const { page, ctx } = await offlineWith(`a4pho-${id}-${ratio.replace(':', 'x')}`, A3(id, ratio, body), { viewport: ratio === '4:3' ? { width: 960, height: 720 } : { width: 1280, height: 720 } });
      for (let i = 0; i < S.length; i++) {
        await goTo(page, i);
        const r = await page.evaluate(() => {
          const s = document.querySelector('.reveal .slides > section.present')!;
          const out: string[] = [];
          if (s.querySelector('[data-clipped]')) out.push('clipped');
          for (const im of Array.from(s.querySelectorAll('.orz-region img'))) {
            const r = im.getBoundingClientRect();
            let v = { l: r.left, t: r.top, r: r.right, b: r.bottom };
            for (let p = im.parentElement; p && p !== s; p = p.parentElement) {
              const c = getComputedStyle(p);
              if (c.overflowX !== 'visible' || c.overflowY !== 'visible') { const q = p.getBoundingClientRect(); v = { l: Math.max(v.l, q.left), t: Math.max(v.t, q.top), r: Math.min(v.r, q.right), b: Math.min(v.b, q.bottom) }; }
            }
            const cut = 1 - (Math.max(0, v.b - v.t) * Math.max(0, v.r - v.l)) / Math.max(1, r.width * r.height);
            if (cut > 0.02) out.push(`a picture cut ${Math.round(cut * 100)} %`);
            if (r.height < 60) out.push(`a picture shrunk to ${Math.round(r.height)} px`);
          }
          return out;
        });
        for (const x of r) bad.push(`${id} ${ratio} ${S[i].split('\n')[0]}: ${x}`);
      }
      await ctx.close();
    }
    expect(bad).toEqual([]);
  }, 300_000);
});
