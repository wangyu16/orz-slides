/**
 * The fit oracle (claims F.1–F.4, T.3): independent of the engine's own
 * measure, every piece of content of a box (each text line's rectangle, each
 * word — white space hanging past a line's end shows nothing — each
 * image, canvas and diagram) must lie inside the box and inside every
 * element between it and the box that clips its content — unless the box
 * says `data-clipped` (or scrolls, `fit=scroll`). That is "no silent
 * clipping".
 */
import { expect } from 'vitest';
import { goTo } from './helpers.js';

type Page = import('playwright-core').Page;

export interface BoxReport { slide: number; box: string; scale: string | null; clipped: boolean; scroll: boolean; outside: string[] }

/** Every box of the current slide: what it reports, and the content the oracle finds outside it (or outside a clipping element within it). */
export function reportBoxes(page: Page, slide: number): Promise<BoxReport[]> {
  return page.evaluate(boxesIn, slide) as Promise<BoxReport[]>;
}

/**
 * The same report taken in the page right after `ready` resolves (in the
 * same task: no frame, so no queued refit, runs in between).
 */
export function reportBoxesAfter(page: Page, slide: number, ready: 'fonts'): Promise<BoxReport[]> {
  return page.evaluate(`(async () => { await document.fonts.ready; return (${boxesIn.toString()})(${slide}); })()`) as Promise<BoxReport[]>;
}

/** The oracle, in the page (self-contained: it is also sent as source). */
function boxesIn(n: number): BoxReport[] {
  {
    const s = document.querySelectorAll<HTMLElement>('.reveal .slides > section')[n];
    const k = s.getBoundingClientRect().width / s.offsetWidth; // screen px per logical px
    const tol = 2 * k;
    // inside an element on each axis it clips (a text line's rectangle may be taller than its line box: only a clipping axis counts)
    // (an element that clips with overflow: clip shows its content overflow-clip-margin past its edge)
    const inside = (r: DOMRect, el: Element): boolean => {
      const c = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const m = cs.overflowX === 'clip' && cs.overflowY === 'clip' ? (parseFloat(cs.getPropertyValue('overflow-clip-margin').replace(/^[a-z-]+\s*/, '')) || 0) * k : 0;
      const x = cs.overflowX === 'visible' || (r.left >= c.left - tol - m && r.right <= c.right + tol + m);
      const y = cs.overflowY === 'visible' || (r.top >= c.top - tol - m && r.bottom <= c.bottom + tol + m);
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
      // what a closed <details> holds besides its summary is not rendered (round A3: its text has rectangles all the same)
      const unrendered = (el: Element | null): boolean => { const d = el?.closest('details:not([open])'); return !!d && !el!.closest('summary'); };
      const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.nodeType === 1) {
          const el = node as Element;
          if (el.closest('.katex-mathml, aside.notes') || unrendered(el)) continue;
          if (/^(IMG|CANVAS|svg|VIDEO|IFRAME)$/.test(el.tagName)) check(el.getBoundingClientRect(), el, el.tagName.toLowerCase());
          continue;
        }
        const t = node as Text;
        if (!t.textContent || !t.textContent.trim() || t.parentElement?.closest('.katex-mathml, svg') || unrendered(t.parentElement)) continue;
        // word by word: white space that hangs past a line's end (pre-wrap) shows nothing
        const range = document.createRange();
        const words = /\S+/g;
        let w: RegExpExecArray | null;
        let found = false;
        while (!found && (w = words.exec(t.textContent)) !== null) {
          range.setStart(t, w.index);
          range.setEnd(t, w.index + w[0].length);
          const before = outside.length;
          for (const r of Array.from(range.getClientRects())) { check(r, t, `text "${t.textContent.trim().slice(0, 24)}"`); if (outside.length > before) { found = true; break; } }
        }
      }
      out.push({ slide: n, box: box.className, scale: box.getAttribute('data-scale'), clipped: box.hasAttribute('data-clipped'), scroll: box.hasAttribute('data-scroll'), outside });
    }
    return out;
  }
}

/** Fit every slide of a deck (visiting each) and check the oracle; returns every box's report. */
export async function checkDeck(page: Page, label: string): Promise<BoxReport[]> {
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
