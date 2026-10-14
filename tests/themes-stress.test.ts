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

/**
 * Round A2 — the per-text visual oracle (A2-TH-2, -4, -11, -12 slipped past bounds-only checks): on the current
 * slide, no visible text overlaps another text, and no absolutely placed ::before/::after with text (a section
 * number, a label) overlaps a text — each rectangle cut to the elements that clip it (an ellipsized footer's
 * range runs on under its clip).
 */
function textOverlaps(page: Page): Promise<string[]> {
  return page.evaluate(`(() => {
    const s = document.querySelector('.reveal .slides > section.present');
    const k = s.getBoundingClientRect().width / s.offsetWidth;
    const clipOf = (el) => {
      let r = { l: -1e9, t: -1e9, r: 1e9, b: 1e9 };
      for (let p = el; p && p !== s.parentElement; p = p.parentElement) {
        const c = getComputedStyle(p);
        const x = c.overflowX !== 'visible', y = c.overflowY !== 'visible';
        if (!x && !y) continue;
        const q = p.getBoundingClientRect();
        if (x) { r.l = Math.max(r.l, q.left); r.r = Math.min(r.r, q.right); }
        if (y) { r.t = Math.max(r.t, q.top); r.b = Math.min(r.b, q.bottom); }
      }
      return r;
    };
    const cut = (x, c) => ({ l: Math.max(x.left, c.l), t: Math.max(x.top, c.t), r: Math.min(x.right, c.r), b: Math.min(x.bottom, c.b) });
    const shown = (el) => { const c = getComputedStyle(el); return c.visibility !== 'hidden' && Number(c.opacity) > 0.05 && c.display !== 'none'; };
    // under a rotation a text's rectangle is its bounding box, larger than its ink
    const rotated = (el) => { for (let p = el; p && p !== s; p = p.parentElement) { const m = /matrix\(([^)]*)\)/.exec(getComputedStyle(p).transform); if (m) { const v = m[1].split(',').map(Number); if (Math.abs(v[1]) > 0.01 || Math.abs(v[2]) > 0.01) return true; } } return false; };
    const items = [];
    const w = document.createTreeWalker(s, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const t = (n.textContent || '').trim();
      const el = n.parentElement;
      if (!t || el.closest('aside.notes, .katex, svg, canvas, .orz-qr-slot') || !shown(el)) continue;
      let hidden = false;
      for (let p = el; p && p !== s; p = p.parentElement) if (!shown(p)) { hidden = true; break; }
      if (hidden) continue;
      const c = clipOf(el);
      const r = document.createRange();
      r.selectNodeContents(n);
      for (const x of Array.from(r.getClientRects())) { const q = cut(x, c); if (q.r - q.l > 1 && q.b - q.t > 1) items.push({ el, pseudo: '', text: t.slice(0, 40), q, rot: rotated(el) }); }
    }
    for (const el of Array.from(s.querySelectorAll('*'))) {
      if (el.closest('aside.notes, svg')) continue;
      for (const ps of ['::before', '::after']) {
        const c = getComputedStyle(el, ps);
        if (c.position !== 'absolute' || !/^["']/.test(c.content) || !/\\S/.test(c.content.slice(1, -1)) || c.visibility === 'hidden' || c.display === 'none') continue;
        // placed against its own (positioned) element, where left and top are definite; one placed against an
        // ancestor may be at its static position ('auto' resolves to it), which cannot be read back here
        if (getComputedStyle(el).position === 'static') continue;
        const b = el.getBoundingClientRect();
        const ec = getComputedStyle(el);
        const left = parseFloat(c.left), top = parseFloat(c.top), wd = parseFloat(c.width), ht = parseFloat(c.height);
        if (!isFinite(left) || !isFinite(top) || !(wd > 0) || !(ht > 0)) continue;
        // its own transform: a translation moves it (a rotation makes its box a bounding box)
        const tm = /matrix\(([^)]*)\)/.exec(c.transform);
        const tv = tm ? tm[1].split(',').map(Number) : [1, 0, 0, 1, 0, 0];
        const x0 = b.left + (parseFloat(ec.borderLeftWidth) || 0) * k + (left + tv[4]) * k, y0 = b.top + (parseFloat(ec.borderTopWidth) || 0) * k + (top + tv[5]) * k;
        const q = cut({ left: x0, top: y0, right: x0 + wd * k, bottom: y0 + ht * k }, clipOf(el));
        if (q.r - q.l > 1 && q.b - q.t > 1) items.push({ el, pseudo: ps, text: el.className + ps + ' ' + c.content.slice(0, 20), q, rot: rotated(el) || Math.abs(tv[1]) > 0.01 });
      }
    }
    const out = [];
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      const a = items[i], b = items[j];
      if (a.el === b.el && !a.pseudo && !b.pseudo) continue;
      if (!a.pseudo && !b.pseudo && (a.el.contains(b.el) || b.el.contains(a.el))) continue;
      const ow = Math.min(a.q.r, b.q.r) - Math.max(a.q.l, b.q.l), oh = Math.min(a.q.b, b.q.b) - Math.max(a.q.t, b.q.t);
      // a text's rectangle is its font's whole ascent and descent: tightly set big type touches the next line's; an
      // overprint covers a good part of a line
      if (ow > 3 * k && oh > Math.max(4 * k, (a.rot || b.rot ? 0.5 : 0.3) * Math.min(a.q.b - a.q.t, b.q.b - b.q.t))) { out.push('"' + a.text + '" x "' + b.text + '" (' + Math.round(ow / k) + 'x' + Math.round(oh / k) + ')'); if (out.length > 5) return out; }
    }
    return out;
  })()`) as Promise<string[]>;
}

/** Round A2 (A2-TH-3): every chrome text on a cover page reads on what is behind it (its own surface, else the cover). */
function coverChromeContrast(page: Page): Promise<Array<{ text: string; ink: string; bg: string }>> {
  return page.evaluate(`(() => {
    const s = document.querySelector('.reveal .slides > section.present');
    const out = [];
    const colour = (v) => { const p = document.createElement('span'); p.style.color = v; document.body.appendChild(p); const c = getComputedStyle(p).color; p.remove(); return c; };
    const cover = colour(getComputedStyle(s).getPropertyValue('--sl-cover').trim());
    for (const slot of Array.from(s.querySelectorAll(':scope > .orz-chrome'))) {
      if (getComputedStyle(slot).display === 'none') continue;
      const w = document.createTreeWalker(slot, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        const t = (n.textContent || '').trim();
        const el = n.parentElement;
        const cs = getComputedStyle(el);
        if (!t || cs.visibility === 'hidden' || cs.display === 'none') continue;
        const r = document.createRange(); r.selectNodeContents(n);
        if (!Array.from(r.getClientRects()).some((x) => x.width > 0)) continue;
        let bg = cover;
        for (let p = el; p && p !== s; p = p.parentElement) { const b = getComputedStyle(p).backgroundColor; if (!/rgba\\(0, 0, 0, 0\\)|transparent/.test(b) && !/, 0\\)$/.test(b)) { bg = b; break; } }
        out.push({ text: t.slice(0, 30), ink: cs.webkitTextFillColor && cs.webkitTextFillColor !== cs.color && !/, 0\\)$/.test(cs.webkitTextFillColor) ? cs.webkitTextFillColor : cs.color, bg });
      }
    }
    return out;
  })()`) as Promise<Array<{ text: string; ink: string; bg: string }>>;
}

const M_CVD: Record<string, number[][]> = { protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]], deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]], tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]] };
const simulate = (c: string, m: number[][]): string => {
  const lin = (v: number): number => { const x = v / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  const gam = (v: number): number => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
  const l = rgbOf(c).map(lin);
  const o = m.map((row) => gam(Math.min(1, Math.max(0, row[0] * l[0] + row[1] * l[1] + row[2] * l[2]))));
  return `rgb(${o.map((v) => Math.round(v)).join(', ')})`;
};

real('the 14 themes on the stress deck (real Chrome, online)', () => {
  for (const t of THEMES) {
    it(`[T.3][T.11][T.10][T.6][T.12][T.14] ${t.id}: stress deck at 16:9 and 4:3 — no silent clipping, no template page clipped, chrome text inside its slot or ellipsized, no text over another; every variant its own look, covers and their chrome readable; six chart colours apart for every reader, a 10-slice pie of ten, gantt charts readable; ruled regions on the slide's lines; bg= on any slide`, async () => {
      for (const ratio of ['16:9', '4:3']) {
        const { page, ctx, errors } = await openDeck(browser!, fileFor(`${t.id}-${ratio.replace(':', 'x')}`), assemble(deckFor(t.id, ratio)), { network: true });
        await page.addStyleTag({ content: '.reveal .slides > section { transition: none !important; }' });
        // T.3 on every slide; T.11 on every slide
        const boxes = await checkDeck(page, `${t.id} ${ratio}`);
        expect(boxes.length).toBeGreaterThan(40);
        const total = await page.evaluate(() => document.querySelectorAll('.reveal .slides > section').length);
        // A2-TH-10/11: no template page is clipped (an 8-item outline, a long title v6, a long subtitle beside v4's band)
        expect(boxes.filter((b) => /orz-template/.test(b.box) && b.clipped).map((b) => `slide ${b.slide + 1}`), `${t.id} ${ratio}: a template page clipped`).toEqual([]);
        const chrome: string[] = [];
        const overlaps: string[] = [];
        for (let i = 0; i < total; i++) {
          await goTo(page, i);
          for (const x of await chromeOutside(page)) chrome.push(`slide ${i + 1}: ${x}`);
          for (const x of await textOverlaps(page)) overlaps.push(`slide ${i + 1}: ${x}`);
        }
        expect(chrome, `${t.id} ${ratio}: chrome text cut or outside the slide`).toEqual([]);
        // round A2 (A2-TH-2, -4, -11, -12): no text over another text, no placed number or label over a text
        expect(overlaps, `${t.id} ${ratio}: texts that overprint`).toEqual([]);
        // A2-TH-9: the untitled three-row slide — every ruled region is unscaled on the slide's lines, or says it is scaled
        const rows2 = total - 1;
        await goTo(page, rows2);
        const off2 = await page.evaluate((n) => {
          const s = document.querySelectorAll<HTMLElement>('.reveal .slides > section')[n];
          const k = s.getBoundingClientRect().width / s.offsetWidth;
          const out: string[] = [];
          for (const b of Array.from(s.querySelectorAll<HTMLElement>('.orz-region > .markdown-body[data-orz-grid]'))) {
            const box = b.parentElement!;
            const pitch = Number(b.getAttribute('data-orz-grid'));
            const cs = getComputedStyle(b);
            const top = (b.getBoundingClientRect().top - s.getBoundingClientRect().top) / k + parseFloat(cs.borderTopWidth) + parseFloat(cs.paddingTop);
            const line = pitch / (parseFloat(box.style.getPropertyValue('--fit-scale')) || 1);
            const o = Math.min(top % line, line - (top % line));
            if (box.getAttribute('data-scale') === '1' && o >= 1) out.push(`${box.getAttribute('data-region')} says scale 1 but starts ${o.toFixed(1)} px off the slide's lines`);
          }
          return out;
        }, rows2);
        expect(off2, `${t.id} ${ratio}: untitled three rows`).toEqual([]);
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
          // A2-TH-3: on the cover pages every chrome text reads on what is behind it
          for (const x of VARIANTS.filter((v) => (v.template === 'title' && v.v === 5) || (v.template === 'closing' && v.v === 2))) {
            await goTo(page, x.slide);
            for (const c of await coverChromeContrast(page)) expect(contrast(c.ink, c.bg), `${t.id} ${x.template} v${x.v}: chrome "${c.text}" ${c.ink} on ${c.bg}`).toBeGreaterThanOrEqual(4.5);
          }
          // A2-TH-1: a bg= slide after the first shows its background (reveal's background layer, never a slide rule's copy)
          const bgSlide = findSlide('A slide with its own background');
          await goTo(page, bgSlide);
          await page.waitForTimeout(250);
          const layer = await page.evaluate(() => {
            const b = document.querySelector<HTMLElement>('.reveal .backgrounds > .slide-background.present')!;
            const r = b.getBoundingClientRect();
            return { top: r.top, height: r.height, vh: window.innerHeight, bg: getComputedStyle(b).backgroundColor };
          });
          expect(layer, `${t.id}: the bg= layer on screen`).toMatchObject({ top: 0, bg: 'rgb(216, 27, 27)' });
          const shot = await page.screenshot({ clip: { x: 0, y: 0, width: 1280, height: 720 } });
          const red = await page.evaluate(async (data) => {
            const img = new Image(); img.src = `data:image/png;base64,${data}`; await img.decode();
            const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
            const g = c.getContext('2d')!; g.drawImage(img, 0, 0);
            const px = g.getImageData(0, 0, c.width, c.height).data;
            let n = 0; for (let i = 0; i < px.length; i += 4) if (Math.abs(px[i] - 216) + Math.abs(px[i + 1] - 27) + Math.abs(px[i + 2] - 27) < 60) n++;
            return n / (px.length / 4);
          }, shot.toString('base64'));
          expect(red, `${t.id}: share of the slide in its bg= colour`).toBeGreaterThan(0.4);
          // … and no slide rule styles reveal's copies of the sections' classes (the audit of every deck.css and theme selector)
          const copies = await page.evaluate(() => {
            const host = document.querySelector('.reveal .backgrounds')!;
            const bare = document.createElement('div');
            bare.className = 'slide-background';
            host.appendChild(bare);
            const props = ['position', 'padding-top', 'padding-left', 'padding-bottom', 'margin-top', 'border-top-width', 'box-shadow', 'background-image', 'filter', 'isolation'];
            const want = getComputedStyle(bare);
            const out: string[] = [];
            for (const b of Array.from(host.querySelectorAll<HTMLElement>(':scope > .slide-background.orz-slide'))) {
              const cs = getComputedStyle(b);
              for (const p of props) if (cs.getPropertyValue(p) !== want.getPropertyValue(p)) out.push(`${p}: ${cs.getPropertyValue(p)} (reveal: ${want.getPropertyValue(p)})`);
              for (const ps of ['::before', '::after']) { const c = getComputedStyle(b, ps).content; if (c !== 'none' && c !== 'normal') out.push(`${ps} ${c}`); }
              if (!b.style.backgroundColor && !/rgba\(0, 0, 0, 0\)/.test(cs.backgroundColor)) out.push(`background-color ${cs.backgroundColor}`);
            }
            bare.remove();
            return [...new Set(out)];
          });
          expect(copies, `${t.id}: slide rules that style reveal's background copies`).toEqual([]);
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
          // A2-TH-8: … and apart for a colour-blind reader (Machado 2009 simulation, ΔE ≥ 10)
          const cvd: string[] = [];
          for (const [k2, m] of Object.entries(M_CVD)) for (let a = 0; a < 6; a++) for (let b = a + 1; b < 6; b++) { const d = deltaE(simulate(pal[a], m), simulate(pal[b], m)); if (d < 10) cvd.push(`${k2}: --chart-${a + 1} ~ --chart-${b + 1} (ΔE ${d.toFixed(1)})`); }
          expect(cvd, `${t.id}: chart colours a colour-blind reader cannot tell apart`).toEqual([]);
          // A2-TH-7: a 10-slice pie — more categories than the palette — has ten distinct slices (no wrap: A = G …)
          const slices = await page.evaluate(() => {
            const cs = Array.from(document.querySelectorAll<HTMLCanvasElement>('.reveal .slides > section.present canvas.orz-chart'));
            const C = (window as unknown as { Chart: { getChart(c: unknown): { config: { type: string }; data: { datasets: Array<{ backgroundColor: unknown }> } } | undefined } }).Chart;
            const pie = cs.map((c) => C.getChart(c)).find((ch) => ch && ch.config.type === 'pie')!;
            const norm = (v: string): string => { const p = document.createElement('span'); p.style.color = v; document.body.appendChild(p); const x = getComputedStyle(p).color; p.remove(); return x; };
            return (pie.data.datasets[0].backgroundColor as string[]).map(norm);
          });
          expect(slices).toHaveLength(10);
          const same2: string[] = [];
          for (let a = 0; a < 10; a++) for (let b = a + 1; b < 10; b++) if (deltaE(slices[a], slices[b]) < 10) same2.push(`${String.fromCharCode(65 + a)} ~ ${String.fromCharCode(65 + b)} (ΔE ${deltaE(slices[a], slices[b]).toFixed(1)})`);
          expect(same2, `${t.id}: pie slices alike`).toEqual([]);
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
          // A2-TH-6: a semester and a multi-year gantt in half a slide — labels apart, the year shown when the span crosses
          // years, text at the slide's type size (logical px), and no "today" line
          await goTo(page, findSlide('Semester and grant gantt'));
          await page.waitForFunction(() => document.querySelectorAll('.reveal .slides > section.present div.mermaid svg').length === 2, null, { timeout: 30_000 });
          const gs = await page.evaluate(() => {
            const s = document.querySelector<HTMLElement>('.reveal .slides > section.present')!;
            const k = s.getBoundingClientRect().width / s.offsetWidth;
            return Array.from(s.querySelectorAll<SVGSVGElement>('div.mermaid svg')).map((svg) => {
              const texts = Array.from(svg.querySelectorAll('.tick text'));
              const ticks = texts.map((x) => x.getBoundingClientRect()).filter((r) => r.width > 0).sort((a, b) => a.left - b.left);
              let overlap = 0;
              for (let i = 1; i < ticks.length; i++) if (ticks[i].left < ticks[i - 1].right - 1) overlap++;
              const today = Array.from(svg.querySelectorAll<SVGElement>('.today')).filter((x) => getComputedStyle(x).display !== 'none' && x.getBoundingClientRect().height > 0).length;
              const task = svg.querySelector('.taskText, .taskTextOutsideRight, .taskTextOutsideLeft');
              return { labels: texts.map((x) => x.textContent), overlap, ticks: ticks.length, today, tick: ticks.length ? ticks[0].height / k : 0, task: task ? task.getBoundingClientRect().height / k : 0 };
            });
          });
          for (const x of gs) {
            expect(x.overlap, `${t.id}: gantt labels overprint ${JSON.stringify(x)}`).toBe(0);
            expect(x.ticks, `${t.id}: gantt ticks ${JSON.stringify(x)}`).toBeGreaterThanOrEqual(2);
            expect(x.today, `${t.id}: a "today" line on a slide`).toBe(0);
            expect(x.tick, `${t.id}: gantt axis text (logical px) ${JSON.stringify(x)}`).toBeGreaterThanOrEqual(11);
          }
          expect(gs[1].labels.join(' '), `${t.id}: the grant's axis shows its years`).toMatch(/20(26|27|28)/);
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
