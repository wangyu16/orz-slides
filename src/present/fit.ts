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
 * The search is cheap (closed-loop round A, ENG-7): a first guess from the
 * overflow ratio (√ratio: text height goes as the scale squared) or the
 * box's last scale, steps to bracket the answer, then bisection to 0.01 — at most 6 measured trials a box, 3 for a refit
 * of an unchanged slide (claim F.7) — and a box's clipping descendants are
 * read once per fit, not at every trial.
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

/** The precision of the search: a box's scale is within this of the largest that fits (it reports two decimals). */
const PRECISION = 0.01;

/** What fit did to one box. */
export interface BoxFit {
  scale: number;
  clipped: boolean;
  /** How many trial layouts the search measured (the cost; claim F.7). */
  trials: number;
}

/** An element inside a box that clips (or scrolls) its own content, and on which axes. */
interface Clipper { el: HTMLElement; x: boolean; y: boolean }

/**
 * The elements inside a box that clip their content (a theme's table, code
 * block or display formula): read once per fit — computed overflow does not
 * change with the font scale — so a trial measures only them (ENG-7).
 */
function clippersOf(box: HTMLElement): Clipper[] {
  const win = box.ownerDocument.defaultView;
  const out: Clipper[] = [];
  if (!win) return out;
  const all = box.querySelectorAll<HTMLElement>('*');
  for (let i = 0; i < all.length; i++) {
    const cs = win.getComputedStyle(all[i]);
    const x = cs.overflowX !== 'visible';
    const y = cs.overflowY !== 'visible';
    if (x || y) out.push({ el: all[i], x, y });
  }
  return out;
}

/**
 * True when the box shows less than its content. The title band grows with
 * its text (only its width is bounded; it is clipped on that axis alone), so
 * only its horizontal overflow counts. `clippers`: the box's clipping
 * elements ({@link clippersOf}; read now when not given).
 */
export function overflows(box: HTMLElement, clippers: readonly Clipper[] = clippersOf(box)): boolean {
  const widthOnly = box.classList.contains('orz-title');
  if ((!widthOnly && box.scrollHeight > box.clientHeight + 1) || box.scrollWidth > box.clientWidth + 1) return true;
  // an element inside that clips (or scrolls) its own content: a wide table or code block, a display formula
  for (const c of clippers) {
    const el = c.el;
    // nothing laid out, or a visually hidden copy (KaTeX's MathML, screen-reader text: a 1 px clip)
    if (el.clientWidth <= 2 || el.clientHeight <= 2) continue;
    if ((c.x && el.scrollWidth > el.clientWidth + 1) || (c.y && el.scrollHeight > el.clientHeight + 1)) return true;
  }
  return false;
}

/** How much of its content a box shows at its current scale (the overflow ratio, ≤ 1): the box's own axes and its clipping elements'. */
function shownRatio(box: HTMLElement, clippers: readonly Clipper[]): number {
  const widthOnly = box.classList.contains('orz-title');
  let r = 1;
  if (!widthOnly && box.scrollHeight > 0) r = Math.min(r, box.clientHeight / box.scrollHeight);
  if (box.scrollWidth > 0) r = Math.min(r, box.clientWidth / box.scrollWidth);
  for (const c of clippers) {
    const el = c.el;
    if (el.clientWidth <= 2 || el.clientHeight <= 2) continue;
    if (c.x && el.scrollWidth > 0) r = Math.min(r, el.clientWidth / el.scrollWidth);
    if (c.y && el.scrollHeight > 0) r = Math.min(r, el.clientHeight / el.scrollHeight);
  }
  return r;
}

function setScale(box: HTMLElement, scale: number): void {
  if (scale >= 1) box.style.removeProperty('--fit-scale');
  else box.style.setProperty('--fit-scale', String(Math.round(scale * 1000) / 1000));
}

/** `data-scale`: `1`, or the scale with two decimals — `1` when it rounds to 1 (ENG-9). */
export function scaleLabel(scale: number): string {
  return scale >= 1 || Math.round(scale * 100) >= 100 ? '1' : scale.toFixed(2);
}

function report(box: HTMLElement, fit: BoxFit): BoxFit {
  box.setAttribute('data-scale', scaleLabel(fit.scale));
  if (fit.clipped) box.setAttribute('data-clipped', '');
  else box.removeAttribute('data-clipped');
  return fit;
}

/** Lays a box's content out again after its scale changed (a baseline grid), before it is measured. */
export type BoxPrepare = (box: HTMLElement) => void;

/**
 * The last scale of each box, by the deck's look (theme and slide size): a
 * refit starts from it (claim F.7: a box re-rendered is a new element, so the
 * cache follows the slide's content; a theme or ratio switch keys it anew).
 */
const lastScale = new WeakMap<HTMLElement, Map<string, number>>();

function lookOf(box: HTMLElement): string {
  const root = box.closest('[data-orz-theme]');
  const slide = box.closest('section');
  return `${root?.getAttribute('data-orz-theme') ?? ''}|${slide ? `${slide.offsetWidth}x${slide.offsetHeight}` : ''}`;
}

/**
 * Fit one box (see the module comment); `mode` is its slide's `fit` option.
 * The search (ENG-7): scale 1; else a first guess — the box's last scale for
 * this look, or the overflow ratio — then a step to bracket the largest
 * scale that fits, then bisection to {@link PRECISION}. `fresh`: ignore the
 * last scale.
 */
export function fitBox(box: HTMLElement, mode: 'fit' | 'off' | 'scroll' = 'fit', floor = FIT_FLOOR, prepare?: BoxPrepare, o: { fresh?: boolean } = {}): BoxFit {
  let trials = 0;
  let at = Number.NaN;
  const scaleTo = (scale: number): void => { at = scale; setScale(box, scale); prepare?.(box); };
  box.removeAttribute('data-scroll');
  const look = lookOf(box);
  const remember = (fit: BoxFit): BoxFit => {
    let m = lastScale.get(box);
    if (!m) lastScale.set(box, (m = new Map()));
    m.set(look, fit.scale);
    return report(box, fit);
  };
  const last = o.fresh ? undefined : lastScale.get(box)?.get(look);
  // a box that overflowed last time starts at its last scale (its neighbour above tells), else at 1
  const prior = last !== undefined && last < 1 && mode === 'fit' ? last : undefined;
  scaleTo(prior ?? 1);
  if (box.clientWidth === 0 && box.clientHeight === 0) { scaleTo(1); return report(box, { scale: 1, clipped: false, trials }); }
  const clippers = clippersOf(box);
  const fits = (scale: number): boolean => { if (at !== scale) scaleTo(scale); trials++; return !overflows(box, clippers); };
  let lo = -1; // the largest scale known to fit
  let hi = 1; // the smallest scale known to overflow
  if (prior === undefined) {
    if (fits(1)) return remember({ scale: 1, clipped: false, trials });
    if (mode === 'scroll') {
      box.setAttribute('data-scroll', '');
      return report(box, { scale: 1, clipped: false, trials });
    }
    if (mode === 'off') return report(box, { scale: 1, clipped: true, trials });
  }
  // the first guess: the last scale, or from what the box shows of its content at scale 1 — text set at
  // scale s holds 1/s more per line and its lines are s high, so its height goes as s²: the guess is √ratio
  let g = Math.min(0.995, Math.max(floor, prior ?? Math.sqrt(shownRatio(box, clippers))));
  if (fits(g)) {
    // up in growing steps until it overflows (brackets the largest scale that fits)
    lo = g;
    let step = prior !== undefined ? PRECISION : 0.02;
    for (;;) {
      const up = Math.min(lo + step, hi - PRECISION / 2);
      if (up <= lo + 1e-9) break;
      if (fits(up)) { lo = up; step *= 2; }
      else { hi = up; break; }
    }
  } else {
    // down by what the box shows at the guess (√ratio again), until it fits
    for (;;) {
      hi = g;
      if (g <= floor) return remember({ scale: floor, clipped: true, trials });
      g = Math.max(floor, Math.min(g - PRECISION, g * Math.sqrt(shownRatio(box, clippers)) * 0.995));
      if (fits(g)) { lo = g; break; }
    }
  }
  if (lo >= 1) return remember({ scale: 1, clipped: false, trials });
  while (hi - lo > PRECISION + 1e-9) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  if (at !== lo) scaleTo(lo);
  return remember({ scale: lo, clipped: false, trials });
}

/** The boxes of a slide in fit order: the title band first (it takes the room the content gets), then the rest. */
export function boxesOf(slide: HTMLElement): HTMLElement[] {
  const all = Array.from(slide.querySelectorAll<HTMLElement>('.orz-box'));
  return [...all.filter((b) => b.classList.contains('orz-title')), ...all.filter((b) => !b.classList.contains('orz-title'))];
}

/** Fit every box of a (laid-out) slide; returns what each did, in fit order. `fresh`: no box starts from its last scale. */
export function fitSlide(slide: HTMLElement, floor = FIT_FLOOR, prepare?: BoxPrepare, o: { fresh?: boolean } = {}): BoxFit[] {
  const raw = slide.getAttribute('data-fit');
  const mode = raw === 'off' || raw === 'scroll' ? raw : 'fit';
  // reset first: a box's scale changes the room the others get
  const boxes = boxesOf(slide);
  for (const b of boxes) b.style.removeProperty('--fit-scale');
  const out = boxes.map((b) => fitBox(b, mode, floor, prepare, o));
  slide.setAttribute('data-fitted', '');
  return out;
}
