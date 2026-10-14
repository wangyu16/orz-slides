/**
 * Closed-loop round A — the 14 themes on the STRESS deck (tests/fixtures/
 * stress: every template variant, a long footer, a 16-row table, 18
 * bullets, wide code, h3–h6, the four callouts, a task list, a sequence
 * diagram and a gantt chart, a 10-slice pie, a three-row split, inline math
 * in a title, a big picture) at 16:9 and 4:3 — what the sample deck lacks,
 * and so what every theme finding of round A slipped through (TK-1 … TK-5):
 *
 * - T.3 (stress): no silent clipping (the fit oracle) on every slide;
 * - T.11: the chrome-slot oracle — every text of the running head and the
 *   bottom slot lies inside its slot and the slide, or is explicitly
 *   ellipsized (one line, overflow hidden, `text-overflow: ellipsis`);
 * - T.10: every template variant has a look of its own in every theme (each
 *   pair of a template's variants differs on ≥ 0.75 % of the slide's pixels (identical pages: < 0.2 %),
 *   the same text on each), and the cover pages' ink reads on the cover
 *   (≥ 4.5 : 1);
 * - T.6 (stress): six distinct chart colours (`--chart-1…6`, CIE76 ΔE ≥ 18
 *   for every pair); a gantt chart takes its region's width (not Mermaid's
 *   300 px fallback) and its axis labels do not overprint;
 * - T.12: a theme that writes on a ruled slide (Notebook, `--orz-grid`)
 *   starts every unscaled region on one of the slide's lines.
 *
 * Online (webfonts and the libraries), as the other theme tests.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assemble } from '../src/lib.js';
import { THEMES } from '../src/themes.js';
import { TEMPLATES } from '../src/deck/parse.js';
import { checkDeck } from './fit-oracle.js';
import { goTo, launchChrome, openDeck } from './helpers.js';

type Page = import('playwright-core').Page;

const browser = await launchChrome();
const dir = mkdtempSync(join(tmpdir(), 'orz-slides-stress-'));
afterAll(async () => { await browser?.close(); rmSync(dir, { recursive: true, force: true }); });

const online = await (async () => {
  try {
    const r = await fetch('https://cdn.jsdelivr.net/npm/orz-markdown@2.3.0/package.json', { signal: AbortSignal.timeout(8000) });
    return r.ok;
  } catch { return false; }
})();
const real = browser && online ? describe : describe.skip;

const STRESS = readFileSync('tests/fixtures/stress/stress.slides.md', 'utf8');
const deckFor = (id: string, ratio: string): string => STRESS.replace(/^theme: .*$/m, `theme: ${id}`).replace(/^ratio: .*$/m, `ratio: ${ratio}`);
const fileFor = (name: string): string => {
  const sub = join(dir, name);
  mkdirSync(sub, { recursive: true });
  copyFileSync('tests/fixtures/stress/big.svg', join(sub, 'big.svg'));
  return join(sub, 'deck.slides.html');
};

/** The stress deck's slides (0-based): the variant pages first, in TEMPLATES order, then the content slides. */
const VARIANTS: Array<{ template: string; v: number; slide: number }> = [];
{
  let i = 0;
  for (const [template, n] of Object.entries(TEMPLATES)) for (let v = 1; v <= n; v++) VARIANTS.push({ template, v, slide: i++ });
}
const findSlide = (title: string): number => STRESS.split(/^<!-- slide/m).slice(1).findIndex((s) => s.includes(`## ${title}`));

/** T.11: every chrome text inside its slot and the slide, unless its line is explicitly ellipsized. */
function chromeOutside(page: Page): Promise<string[]> {
  return page.evaluate(`(() => {
    const s = document.querySelector('.reveal .slides > section.present');
    const k = s.getBoundingClientRect().width / s.offsetWidth;
    const tol = 1.5 * k;
    const sr = s.getBoundingClientRect();
    const out = [];
    for (const slot of Array.from(s.querySelectorAll(':scope > .orz-head, :scope > .orz-chrome'))) {
      if (getComputedStyle(slot).display === 'none') continue;
      const w = document.createTreeWalker(slot, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        const t = (n.textContent || '').trim();
        const el = n.parentElement;
        if (!t || el.closest('.katex-mathml')) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || Number(cs.opacity) === 0 || cs.display === 'none') continue;
        // the element that holds the text's line: explicitly one line and ellipsized?
        let part = el, ellipsized = false;
        for (let p = el; p && p !== slot.parentElement; p = p.parentElement) {
          const c = getComputedStyle(p);
          if (c.textOverflow === 'ellipsis' && c.overflowX !== 'visible' && (c.whiteSpace === 'nowrap' || c.textWrapMode === 'nowrap')) { ellipsized = true; part = p; break; }
          if (p === slot) break;
        }
        const r = document.createRange();
        r.selectNodeContents(n);
        const rects = Array.from(r.getClientRects()).filter((x) => x.width > 0 && x.height > 0);
        // the box the text must keep to: its part of the slot (the footer, the number …) and the slide
        const holder = el.closest('.orz-footer, .orz-chrome-num, .orz-chrome-sec, .orz-head-deck, .orz-head-sec') || slot;
        const hr = holder.getBoundingClientRect();
        for (const x of rects) {
          const inSlide = x.left >= sr.left - tol && x.right <= sr.right + tol && x.top >= sr.top - tol && x.bottom <= sr.bottom + tol;
          const clipX = getComputedStyle(holder).overflowX !== 'visible';
          const clipY = getComputedStyle(holder).overflowY !== 'visible';
          const inHolder = (clipX ? x.left >= hr.left - tol && x.right <= hr.right + tol : true) && (clipY ? x.top >= hr.top - tol && x.bottom <= hr.bottom + tol : true);
          if (ellipsized) {
            const pr = part.getBoundingClientRect();
            if (!(pr.left >= sr.left - tol && pr.right <= sr.right + tol && pr.top >= sr.top - tol && pr.bottom <= sr.bottom + tol)) { out.push('"' + t.slice(0, 30) + '": its ellipsized line leaves the slide'); break; }
            continue;
          }
          if (!inSlide || !inHolder) { out.push('"' + t.slice(0, 30) + '" (' + holder.className + '): ' + (!inSlide ? 'outside the slide' : 'cut by its slot') + ' (' + Math.round(x.top - sr.top) + '..' + Math.round(x.bottom - sr.top) + ')'); break; }
        }
      }
    }
    return out;
  })()`) as Promise<string[]>;
}

const lab = (rgb: number[]): number[] => {
  const lin = (c: number): number => { const x = c / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  const [r, g, b] = rgb.map(lin);
  const f = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const X = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047, Y = r * 0.2126 + g * 0.7152 + b * 0.0722, Z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
};
const rgbOf = (c: string): number[] => (/rgba?\(([\d.]+), ([\d.]+), ([\d.]+)/.exec(c) ?? ['', '0', '0', '0']).slice(1, 4).map(Number);
const deltaE = (a: string, b: string): number => { const A = lab(rgbOf(a)), B = lab(rgbOf(b)); return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]); };
const contrast = (a: string, b: string): number => {
  const L = (c: string): number => { const [r, g, bl] = rgbOf(c).map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * bl; };
  const [x, y] = [L(a), L(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

real('the 14 themes on the stress deck (real Chrome, online)', () => {
  for (const t of THEMES) {
    it(`[T.3][T.11][T.10][T.6][T.12] ${t.id}: stress deck at 16:9 and 4:3 — no silent clipping, chrome text inside its slot or ellipsized; every variant its own look, covers readable; six distinct chart colours, a full-width gantt; ruled regions on the slide's lines`, async () => {
      for (const ratio of ['16:9', '4:3']) {
        const { page, ctx, errors } = await openDeck(browser!, fileFor(`${t.id}-${ratio.replace(':', 'x')}`), assemble(deckFor(t.id, ratio)), { network: true });
        await page.addStyleTag({ content: '.reveal .slides > section { transition: none !important; }' });
        // T.3 on every slide; T.11 on every slide
        const boxes = await checkDeck(page, `${t.id} ${ratio}`);
        expect(boxes.length).toBeGreaterThan(40);
        const total = await page.evaluate(() => document.querySelectorAll('.reveal .slides > section').length);
        const chrome: string[] = [];
        for (let i = 0; i < total; i++) {
          await goTo(page, i);
          for (const x of await chromeOutside(page)) chrome.push(`slide ${i + 1}: ${x}`);
        }
        expect(chrome, `${t.id} ${ratio}: chrome text cut or outside the slide`).toEqual([]);
        if (ratio === '16:9') {
          // T.10: each template's variants pairwise distinct (same text; slide numbers and section numerals made alike)
          await page.addStyleTag({ content: '.reveal .slides > section .orz-chrome { visibility: hidden !important; } .reveal .slides > section .orz-head { visibility: hidden !important; }' });
          await page.evaluate(() => { for (const el of Array.from(document.querySelectorAll('[data-sec]'))) el.setAttribute('data-sec', '01'); });
          const shots: Record<string, Buffer> = {};
          for (const x of VARIANTS) {
            await goTo(page, x.slide);
            await page.waitForTimeout(80);
            shots[`${x.template}-${x.v}`] = await page.screenshot({ clip: { x: 0, y: 0, width: 1280, height: 720 } });
          }
          const same: string[] = [];
          for (const [template, n] of Object.entries(TEMPLATES)) {
            for (let a = 1; a <= n; a++) for (let b = a + 1; b <= n; b++) {
              const share = await page.evaluate(async ([p, q]) => {
                const load = async (s: string): Promise<Uint8ClampedArray> => { const img = new Image(); img.src = `data:image/png;base64,${s}`; await img.decode(); const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d')!; g.drawImage(img, 0, 0); return g.getImageData(0, 0, c.width, c.height).data; };
                const [x, y] = [await load(p), await load(q)];
                let diff = 0;
                for (let i = 0; i < x.length; i += 4) if (Math.abs(x[i] - y[i]) + Math.abs(x[i + 1] - y[i + 1]) + Math.abs(x[i + 2] - y[i + 2]) > 48) diff++;
                return diff / (x.length / 4);
              }, [shots[`${template}-${a}`].toString('base64'), shots[`${template}-${b}`].toString('base64')] as const);
              if (share < 0.0075) same.push(`${template} v${a} ~ v${b} (${(share * 100).toFixed(2)}% of pixels differ)`);
            }
          }
          expect(same, `${t.id}: variants that look alike`).toEqual([]);
          // the cover pages' ink on the cover
          for (const x of VARIANTS.filter((v) => (v.template === 'title' && v.v === 5) || (v.template === 'closing' && v.v === 2))) {
            const c = await page.evaluate((n) => {
              const s = document.querySelectorAll<HTMLElement>('.reveal .slides > section')[n];
              const probe = (prop: string): string => { const p = document.createElement('span'); p.style.color = getComputedStyle(s).getPropertyValue(prop).trim(); s.appendChild(p); const v = getComputedStyle(p).color; p.remove(); return v; };
              return { cover: probe('--sl-cover'), ink: probe('--sl-cover-ink'), title: getComputedStyle(s.querySelector('.orz-title-main')!).color };
            }, x.slide);
            expect(contrast(c.cover, c.ink), `${t.id} ${x.template} v${x.v}: cover ink ${c.ink} on ${c.cover}`).toBeGreaterThanOrEqual(4.5);
            expect(c.title, `${t.id} ${x.template} v${x.v}: the title is in the cover ink`).toBe(c.ink);
          }
          // T.6: six distinct chart colours, read where the chart is drawn
          await goTo(page, findSlide('Bar chart'));
          const pal = await page.evaluate(() => {
            const c = document.querySelector('.reveal .slides > section.present canvas, .reveal .slides > section.present .orz-chart')!;
            const cs = getComputedStyle(c);
            return [1, 2, 3, 4, 5, 6].map((i) => { const p = document.createElement('span'); p.style.color = cs.getPropertyValue(`--chart-${i}`).trim(); document.body.appendChild(p); const v = p.style.color ? getComputedStyle(p).color : ''; p.remove(); return v; });
          });
          expect(pal.filter((x) => x === ''), `${t.id}: --chart-1…6 all set`).toEqual([]);
          const close: string[] = [];
          for (let a = 0; a < 6; a++) for (let b = a + 1; b < 6; b++) if (deltaE(pal[a], pal[b]) < 18) close.push(`--chart-${a + 1} ${pal[a]} ~ --chart-${b + 1} ${pal[b]} (ΔE ${deltaE(pal[a], pal[b]).toFixed(1)})`);
          expect(close, `${t.id}: chart colours too alike`).toEqual([]);
          // TK-2: the gantt chart takes its region's width, its axis labels apart
          await goTo(page, findSlide('Sequence and gantt'));
          await page.waitForFunction(() => document.querySelectorAll('.reveal .slides > section.present div.mermaid svg').length === 2, null, { timeout: 30_000 });
          const g = await page.evaluate(() => {
            const svg = Array.from(document.querySelectorAll<SVGSVGElement>('.reveal .slides > section.present div.mermaid svg')).find((x) => x.getAttribute('aria-roledescription') === 'gantt' || x.querySelector('.tick'))!;
            const region = svg.closest('.orz-region') as HTMLElement;
            const ticks = Array.from(svg.querySelectorAll('.tick text')).map((x) => x.getBoundingClientRect()).filter((r) => r.width > 0).sort((a, b) => a.left - b.left);
            let overlap = 0;
            for (let i = 1; i < ticks.length; i++) if (ticks[i].left < ticks[i - 1].right - 1) overlap++;
            return { vb: Number((svg.getAttribute('viewBox') ?? '0 0 0 0').split(/\s+/)[2]), region: region.clientWidth, overlap, ticks: ticks.length };
          });
          expect(g.vb, `${t.id}: gantt drawn at its region's width, not 300`).toBeGreaterThan(0.6 * g.region);
          expect(g.overlap, `${t.id}: gantt axis labels overprint ${JSON.stringify(g)}`).toBe(0);
          // T.12: ruled themes — every unscaled region of the three-row slide starts on one of the slide's lines
          const rows = findSlide('Three rows');
          await goTo(page, rows);
          const off = await page.evaluate((n) => {
            const s = document.querySelectorAll<HTMLElement>('.reveal .slides > section')[n];
            const k = s.getBoundingClientRect().width / s.offsetWidth;
            const out: number[] = [];
            for (const b of Array.from(s.querySelectorAll<HTMLElement>('.orz-region[data-scale="1"] > .markdown-body[data-orz-grid]'))) {
              const pitch = Number(b.getAttribute('data-orz-grid'));
              const cs = getComputedStyle(b);
              const top = (b.getBoundingClientRect().top - s.getBoundingClientRect().top) / k + parseFloat(cs.borderTopWidth) + parseFloat(cs.paddingTop);
              out.push(Math.min(top % pitch, pitch - (top % pitch)));
            }
            return out;
          }, rows);
          for (const o of off) expect(o, `${t.id}: a ruled region starts ${o.toFixed(1)} px off the slide's lines`).toBeLessThan(1);
          if (t.id === 'notebook') expect(off.length, 'notebook: the three rows are ruled').toBe(3);
        }
        expect(errors, `${t.id} ${ratio}`).toEqual([]);
        await ctx.close();
      }
    }, 600_000);
  }
});
