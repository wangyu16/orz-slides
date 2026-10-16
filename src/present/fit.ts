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
 * The search is cheap (closed-loop rounds A and A2, ENG-7, A2-ENG-6): a
 * first guess from the overflow ratio (√ratio: text height goes as the
 * scale squared) or the box's last scale; when it still overflows, the
 * exponent is learned from the last two measurements (content that does not
 * reflow scales as s¹) — a secant in log space; then a step to bracket the
 * answer and bisection to 0.01 — at most 8 measured trials a box, 3 for a
 * refit of an unchanged slide (claim F.7) — and a box's clipping
 * descendants are read once per fit, not at every trial.
 *
 * Overflow is measured in logical px (layout sizes are not affected by
 * reveal's scaling transform): the box's own scroll size, and every element
 * inside it that clips or scrolls its own content (a theme's table, code
 * block or display formula with `overflow: auto` hides a wide line inside
 * itself, which the box cannot see). Only a laid-out slide can be measured: the engine fits the visible
 * slide (and every slide of the print document).
 *
 * No theme writes on a baseline grid any more (owner decision 2026-10-14:
 * Notebook's ruling is the slide's background, independent of the content),
 * so a trial scale is just the box's `--fit-scale`.
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
  const slack = paintedSlack(box);
  if ((!widthOnly && box.scrollHeight > box.clientHeight + slack) || box.scrollWidth > box.clientWidth + slack) return true;
  // an element inside that clips (or scrolls) its own content: a wide table or code block, a display formula
  for (const c of clippers) {
    const el = c.el;
    // nothing laid out, or a visually hidden copy (KaTeX's MathML, screen-reader text: a 1 px clip)
    if (el.clientWidth <= 2 || el.clientHeight <= 2) continue;
    if ((c.x && el.scrollWidth > el.clientWidth + 1) || (c.y && el.scrollHeight > el.clientHeight + 1)) return true;
  }
  return false;
}

/**
 * How far content may pass a box's edge and still be painted whole (final loop FINAL-ENG-1): a box that clips with
 * `overflow: clip` paints its `overflow-clip-margin` past its edge, so a heading's glyph ink below its line box (a
 * theme's tight line height, the fallback fonts) or a hairline decoration there is not a cut — and, because it grows
 * with the scale, counting it drove a heading-only template page down to the floor and marked it clipped. Capped at
 * 6 px (a theme may give a box a larger margin for a drawn leader; text is never let further out than that). At least
 * 1 (sub-pixel layout).
 */
function paintedSlack(box: HTMLElement): number {
  const win = box.ownerDocument.defaultView;
  if (!win) return 1;
  const cs = win.getComputedStyle(box);
  if (cs.overflowX !== 'clip' || cs.overflowY !== 'clip') return 1;
  const m = parseFloat(cs.getPropertyValue('overflow-clip-margin').replace(/^[a-z-]+\s*/, '')) || 0;
  return Math.max(1, Math.min(6, m));
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
export function fitBox(box: HTMLElement, mode: 'fit' | 'off' | 'scroll' = 'fit', floor = FIT_FLOOR, o: { fresh?: boolean } = {}): BoxFit {
  let trials = 0;
  let at = Number.NaN;
  const scaleTo = (scale: number): void => { at = scale; setScale(box, scale); };
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
  // scale s holds 1/s more per line and its lines are s high, so its height goes as s^k with k ≈ 2: the
  // guess is ratio^(1/2). A box whose content does not reflow (a table, a picture, code) scales as s^1, so
  // after a guess that still overflows the exponent is LEARNED from the last two measurements (a secant in
  // log space; round A2, A2-ENG-6: √ratio alone stepped down 0.04 at a time on such boxes)
  let k = 2;
  let rAt = prior === undefined ? shownRatio(box, clippers) : Number.NaN;
  let sAt = 1;
  let g = Math.min(0.995, Math.max(floor, prior ?? Math.pow(rAt, 1 / k)));
  if (fits(g)) {
    lo = g;
    if (prior !== undefined) {
      // a refit: up in growing steps from the last scale until it overflows (brackets the answer)
      let step = PRECISION;
      for (;;) {
        const up = Math.min(lo + step, hi - PRECISION / 2);
        if (up <= lo + 1e-9) break;
        if (fits(up)) { lo = up; step *= 2; }
        else { hi = up; break; }
      }
    } else {
      // √ratio fitted: this content shrinks faster than s² — one more guess with k = 3, then bisection
      const up = Math.min(hi - PRECISION / 2, Math.max(lo + PRECISION, Math.pow(rAt, 1 / 3)));
      if (up > lo + 1e-9) { if (fits(up)) lo = up; else hi = up; }
    }
  } else {
    for (;;) {
      hi = g;
      if (g <= floor) return remember({ scale: floor, clipped: true, trials });
      const r = shownRatio(box, clippers);
      if (Number.isFinite(rAt) && sAt > g && r > rAt) k = Math.min(4, Math.max(0.5, Math.log(r / rAt) / Math.log(sAt / g)));
      sAt = g;
      rAt = r;
      g = Math.max(floor, Math.min(g - PRECISION, g * Math.pow(r, 1 / k) * 0.997));
      if (fits(g)) { lo = g; break; }
    }
    // the secant usually lands within the precision of the answer: one step up tells
    const up = Math.min(lo + PRECISION, hi - PRECISION / 2);
    if (up > lo + 1e-9) { if (fits(up)) lo = up; else hi = up; }
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
export function fitSlide(slide: HTMLElement, floor = FIT_FLOOR, o: { fresh?: boolean } = {}): BoxFit[] {
  const raw = slide.getAttribute('data-fit');
  const mode = raw === 'off' || raw === 'scroll' ? raw : 'fit';
  // reset first: a box's scale changes the room the others get
  const boxes = boxesOf(slide);
  for (const b of boxes) b.style.removeProperty('--fit-scale');
  const out = boxes.map((b) => fitBox(b, mode, floor, o));
  // the footer is one ellipsized line: when it is cut it says so (data-clipped; its title holds the full text: A2-TH-13)
  for (const f of Array.from(slide.querySelectorAll<HTMLElement>('.orz-footer'))) {
    const cut = Array.from(f.querySelectorAll<HTMLElement>(':scope > .markdown-body > *')).some((p) => p.scrollWidth > p.clientWidth + 1);
    if (cut) f.setAttribute('data-clipped', ''); else f.removeAttribute('data-clipped');
  }
  slide.setAttribute('data-fitted', '');
  return out;
}
