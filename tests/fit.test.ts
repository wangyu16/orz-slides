/**
 * Rebuild step 3 — fit in real Chrome (claims F.1–F.4; STATUS D-46).
 *
 * The oracle is independent of the engine's own measure: every piece of
 * content of a box (each text line's rectangle, each image, canvas and
 * diagram) must lie inside the box and inside every element between it and
 * the box that clips its content — unless the box says `data-clipped`
 * (or scrolls, `fit=scroll`). That is "no silent clipping". Offline (the
 * file must work without the network): fonts and content libraries fall
 * back, which is exactly when fit must still hold.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assemble } from '../src/lib.js';
import { corpus, goTo, launchChrome, openDeck } from './helpers.js';

type Page = import('playwright-core').Page;

const browser = await launchChrome();
const dir = mkdtempSync(join(tmpdir(), 'orz-slides-fit-'));
afterAll(async () => { await browser?.close(); rmSync(dir, { recursive: true, force: true }); });
const chrome = browser ? describe : describe.skip;

interface BoxReport { slide: number; box: string; scale: string | null; clipped: boolean; scroll: boolean; outside: string[] }

/** Every box of the current slide: what it reports, and the content the oracle finds outside it (or outside a clipping element within it). */
function reportBoxes(page: Page, slide: number): Promise<BoxReport[]> {
  return page.evaluate((n) => {
    const s = document.querySelectorAll<HTMLElement>('.reveal .slides > section')[n];
    const k = s.getBoundingClientRect().width / s.offsetWidth; // screen px per logical px
    const tol = 2 * k;
    // inside an element on each axis it clips (a text line's rectangle may be taller than its line box: only a clipping axis counts)
    const inside = (r: DOMRect, el: Element): boolean => {
      const c = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const x = cs.overflowX === 'visible' || (r.left >= c.left - tol && r.right <= c.right + tol);
      const y = cs.overflowY === 'visible' || (r.top >= c.top - tol && r.bottom <= c.bottom + tol);
      return x && y;
    };
    const out: BoxReport[] = [];
    for (const box of Array.from(s.querySelectorAll<HTMLElement>('.orz-box'))) {
      const clips = (el: Element): boolean => { const cs = getComputedStyle(el); return cs.overflowX !== 'visible' || cs.overflowY !== 'visible'; };
      const outside: string[] = [];
      const check = (r: DOMRect, from: Node, what: string): void => {
        if (r.width === 0 && r.height === 0) return;
        let el: Element | null = from.nodeType === 1 ? (from as Element).parentElement : from.parentElement;
        const chain: Element[] = [];
        for (; el && el !== box; el = el.parentElement) chain.push(el);
        if (!inside(r, box)) { outside.push(`${what} outside the box`); return; }
        for (const c of chain) if (clips(c) && (c as HTMLElement).clientWidth > 2 && (c as HTMLElement).clientHeight > 2 && !inside(r, c)) { outside.push(`${what} outside ${c.tagName.toLowerCase()}.${(c as HTMLElement).className}`); return; }
      };
      const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.nodeType === 1) {
          const el = node as Element;
          if (el.closest('.katex-mathml, aside.notes')) continue;
          if (/^(IMG|CANVAS|svg|VIDEO|IFRAME)$/.test(el.tagName)) check(el.getBoundingClientRect(), el, el.tagName.toLowerCase());
          continue;
        }
        const t = node as Text;
        if (!t.textContent || !t.textContent.trim() || t.parentElement?.closest('.katex-mathml, svg')) continue;
        const range = document.createRange();
        range.selectNodeContents(t);
        for (const r of Array.from(range.getClientRects())) check(r, t, `text "${t.textContent.trim().slice(0, 24)}"`);
      }
      out.push({ slide: n, box: box.className, scale: box.getAttribute('data-scale'), clipped: box.hasAttribute('data-clipped'), scroll: box.hasAttribute('data-scroll'), outside });
    }
    return out;
  }, slide) as Promise<BoxReport[]>;
}

/** Fit every slide of a deck (visiting each) and check the oracle; returns every box's report. */
async function checkDeck(page: Page, label: string): Promise<BoxReport[]> {
  const total = await page.evaluate(() => document.querySelectorAll('.reveal .slides > section').length);
  const all: BoxReport[] = [];
  for (let i = 0; i < total; i++) {
    await goTo(page, i);
    for (const b of await reportBoxes(page, i)) {
      all.push(b);
      const where = `${label} slide ${i + 1} ${b.box}`;
      expect(b.scale, where).not.toBeNull();
      expect(Number(b.scale), where).toBeGreaterThanOrEqual(0.6);
      expect(Number(b.scale), where).toBeLessThanOrEqual(1);
      if (!b.clipped && !b.scroll) expect(b.outside, `${where}: content cut without data-clipped`).toEqual([]);
    }
  }
  return all;
}

chrome('fit (real Chrome, offline)', () => {
  it('[F.1] every box of every slide of every slides corpus deck fits, is scaled to at least the floor, or says data-clipped — no silent clipping', async () => {
    for (const c of corpus('slides')) {
      const { page, ctx, errors } = await openDeck(browser!, join(dir, c.path.replace(/^slides\//, '').replace(/\.md$/, '.html')), assemble(c.text));
      const boxes = await checkDeck(page, c.path);
      expect(boxes.length, c.path).toBeGreaterThan(0);
      expect(errors, c.path).toEqual([]);
      await ctx.close();
    }
  });

  it('[F.2] D-46: a long title on title v2 (and on v1) stays inside the slide — the template page is a fitted box, nothing spills past either edge', async () => {
    const c = corpus('slides').find((x) => x.path.endsWith('title-v2-long-title.slides.md'))!;
    const { page, ctx } = await openDeck(browser!, join(dir, 'd46.slides.html'), assemble(c.text));
    for (const i of [0, 1, 2]) {
      await goTo(page, i);
      const r = await page.evaluate((n) => {
        const s = document.querySelectorAll<HTMLElement>('.reveal .slides > section')[n];
        const t = s.querySelector<HTMLElement>('.orz-template')!;
        const h1 = t.querySelector<HTMLElement>('h1')!;
        const sr = s.getBoundingClientRect();
        const hr = h1.getBoundingClientRect();
        return { scale: t.getAttribute('data-scale'), clipped: t.hasAttribute('data-clipped'), inside: hr.left >= sr.left - 1 && hr.right <= sr.right + 1 && hr.top >= sr.top - 1 && hr.bottom <= sr.bottom + 1, title: h1.textContent };
      }, i);
      expect(r.inside, `slide ${i + 1}: the title is inside the slide`).toBe(true);
      expect(r.clipped, `slide ${i + 1}`).toBe(false);
    }
    await checkDeck(page, 'D-46');
    await ctx.close();
  });

  it('[F.3] both axes: a table wider than the slide is scaled to the floor and then marked clipped; dense text is scaled; a big picture takes its column; fit=off is not scaled but marked; fit=scroll scrolls; a long section title is scaled into the page', async () => {
    const text = readFileSync('tests/fixtures/fit/wide.slides.md', 'utf8');
    const { page, ctx, errors } = await openDeck(browser!, join(dir, 'wide.slides.html'), assemble(text));
    const boxes = await checkDeck(page, 'wide');
    const region = (slide: number) => boxes.find((b) => b.slide === slide && b.box.includes('orz-region'))!;
    expect(region(0)).toMatchObject({ scale: '0.60', clipped: true });
    expect(region(1)).toMatchObject({ clipped: false });
    expect(Number(region(2).scale)).toBeLessThan(1);
    expect(region(2).clipped).toBe(false);
    expect(boxes.filter((b) => b.slide === 3).every((b) => !b.clipped)).toBe(true);
    expect(region(4)).toMatchObject({ scale: '1', clipped: true });
    expect(region(5)).toMatchObject({ scale: '1', clipped: false, scroll: true });
    const section = boxes.find((b) => b.slide === 6)!;
    expect(Number(section.scale)).toBeLessThan(1);
    expect(section.clipped).toBe(false);
    expect(region(7)).toMatchObject({ scale: '1', clipped: false });
    expect(errors).toEqual([]);
    await ctx.close();
  });

  it('[F.4] the sample deck (math, code, a table, a picture, a float, a molecule, a chart and a diagram): every box fits or says so; fit runs on the visible slide only', async () => {
    const sub = join(dir, 'sample');
    rmSync(sub, { recursive: true, force: true });
    (await import('node:fs')).mkdirSync(sub);
    copyFileSync('tests/fixtures/sample/gpc-traces.svg', join(sub, 'gpc-traces.svg'));
    const { page, ctx, errors } = await openDeck(browser!, join(sub, 'sample.slides.html'), assemble(readFileSync('tests/fixtures/sample/sample.slides.md', 'utf8')));
    // before any navigation only the first slide was fitted
    expect(await page.evaluate(() => Array.from(document.querySelectorAll('.reveal .slides > section')).map((s) => s.hasAttribute('data-fitted')))).toEqual([true, ...Array(11).fill(false)]);
    // offline (no KaTeX stylesheet, no webfonts) a box may be cut — then it says so (online it is not: tests/engine.test.ts K.8)
    await checkDeck(page, 'sample');
    expect(errors).toEqual([]);
    await ctx.close();
  });
});
