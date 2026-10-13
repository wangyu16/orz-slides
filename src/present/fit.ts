/**
 * Fit (REBUILD §3c step 3; fixes STATUS D-46): every box of a slide
 * (`.orz-box`: the title band, each region, a template page's body, each
 * float) is made to show its content on BOTH axes — a box that overflows
 * is scaled down (`--fit-scale`, its font size; images, diagrams and
 * SMILES follow the text size) by bisection to the largest scale at which
 * it fits, never below the floor; a box that still overflows at the floor
 * is marked clipped. Every box reports what happened, for the editor's
 * badge and for tests: `data-scale` (`1`, or the scale, two decimals) and
 * `data-clipped` (present when content is cut) — no silent clipping.
 *
 * A slide's `fit` option: `fit` (default) as above; `off` — no scaling,
 * overflow still reported (`data-clipped`); `scroll` — the boxes scroll
 * (`data-scroll` when they do), nothing is clipped.
 *
 * Overflow is measured in logical px (layout sizes are not affected by
 * reveal's scaling transform): the box's own scroll size, and every element
 * inside it that clips or scrolls its own content (a theme's table, code
 * block or display formula with `overflow: auto` hides a wide line inside
 * itself, which the box cannot see). Only a laid-out slide can be measured: the engine fits the visible
 * slide (and every slide of the print document).
 *
 * A theme that writes text on a baseline grid (Notebook: orz-markdown's
 * `--orz-grid`) re-aligns a box's content at every trial scale (`prepare`,
 * src/present/grid.ts): the grid's margins are part of what has to fit, and
 * its pitch follows the scale.
 */

/** The smallest scale fit uses (0.x's floor). */
export const FIT_FLOOR = 0.6;

/** Bisection steps between the floor and 1 (precision ≈ 0.4 / 2^7 ≈ 0.003). */
const STEPS = 7;

/** What fit did to one box. */
export interface BoxFit {
  scale: number;
  clipped: boolean;
}

/**
 * True when the box shows less than its content. The title band grows with
 * its text (only its width is bounded; it is clipped on that axis alone), so
 * only its horizontal overflow counts.
 */
export function overflows(box: HTMLElement): boolean {
  const widthOnly = box.classList.contains('orz-title');
  if ((!widthOnly && box.scrollHeight > box.clientHeight + 1) || box.scrollWidth > box.clientWidth + 1) return true;
  // an element inside that clips (or scrolls) its own content: a wide table or code block, a display formula
  const inner = box.querySelectorAll<HTMLElement>('*');
  for (let i = 0; i < inner.length; i++) {
    const el = inner[i];
    // nothing laid out, or a visually hidden copy (KaTeX's MathML, screen-reader text: a 1 px clip)
    if (el.clientWidth <= 2 || el.clientHeight <= 2) continue;
    const wide = el.scrollWidth > el.clientWidth + 1;
    const tall = el.scrollHeight > el.clientHeight + 1;
    if (!wide && !tall) continue;
    const cs = el.ownerDocument.defaultView?.getComputedStyle(el);
    if (!cs) return true;
    if ((wide && cs.overflowX !== 'visible') || (tall && cs.overflowY !== 'visible')) return true;
  }
  return false;
}

function setScale(box: HTMLElement, scale: number): void {
  if (scale >= 1) box.style.removeProperty('--fit-scale');
  else box.style.setProperty('--fit-scale', String(Math.round(scale * 1000) / 1000));
}

function report(box: HTMLElement, fit: BoxFit): BoxFit {
  box.setAttribute('data-scale', fit.scale >= 1 ? '1' : fit.scale.toFixed(2));
  if (fit.clipped) box.setAttribute('data-clipped', '');
  else box.removeAttribute('data-clipped');
  return fit;
}

/** Lays a box's content out again after its scale changed (a baseline grid), before it is measured. */
export type BoxPrepare = (box: HTMLElement) => void;

/** Fit one box (see the module comment); `mode` is its slide's `fit` option. */
export function fitBox(box: HTMLElement, mode: 'fit' | 'off' | 'scroll' = 'fit', floor = FIT_FLOOR, prepare?: BoxPrepare): BoxFit {
  const scaleTo = (scale: number): void => { setScale(box, scale); prepare?.(box); };
  box.removeAttribute('data-scroll');
  scaleTo(1);
  if (box.clientWidth === 0 && box.clientHeight === 0) return report(box, { scale: 1, clipped: false });
  if (!overflows(box)) return report(box, { scale: 1, clipped: false });
  if (mode === 'scroll') {
    box.setAttribute('data-scroll', '');
    return report(box, { scale: 1, clipped: false });
  }
  if (mode === 'off') return report(box, { scale: 1, clipped: true });
  scaleTo(floor);
  if (overflows(box)) return report(box, { scale: floor, clipped: true });
  let lo = floor;
  let hi = 1;
  for (let i = 0; i < STEPS; i++) {
    const mid = (lo + hi) / 2;
    scaleTo(mid);
    if (overflows(box)) hi = mid;
    else lo = mid;
  }
  scaleTo(lo);
  return report(box, { scale: lo, clipped: false });
}

/** The boxes of a slide in fit order: the title band first (it takes the room the content gets), then the rest. */
export function boxesOf(slide: HTMLElement): HTMLElement[] {
  const all = Array.from(slide.querySelectorAll<HTMLElement>('.orz-box'));
  return [...all.filter((b) => b.classList.contains('orz-title')), ...all.filter((b) => !b.classList.contains('orz-title'))];
}

/** Fit every box of a (laid-out) slide; returns what each did, in fit order. */
export function fitSlide(slide: HTMLElement, floor = FIT_FLOOR, prepare?: BoxPrepare): BoxFit[] {
  const raw = slide.getAttribute('data-fit');
  const mode = raw === 'off' || raw === 'scroll' ? raw : 'fit';
  // reset first: a box's scale changes the room the others get
  const boxes = boxesOf(slide);
  for (const b of boxes) b.style.removeProperty('--fit-scale');
  const out = boxes.map((b) => fitBox(b, mode, floor, prepare));
  slide.setAttribute('data-fitted', '');
  return out;
}
