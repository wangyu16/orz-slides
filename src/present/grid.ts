/**
 * The baseline grid in a deck (REBUILD §3c step 4, the Notebook theme): a
 * theme that sets orz-markdown's `--orz-grid` on a region's body has its
 * text written on ruled lines by the kit's grid pass (`window.OrzBaselineGrid`,
 * installed by `enhanceDocument`, orz-markdown 2.3.0). The pass watches an
 * article's size, but fit changes a box's font size (and so the grid's pitch)
 * without resizing it — so fit re-aligns the box at every trial scale
 * (src/present/fit.ts `prepare`): the grid's margins are measured as part of
 * what must fit. A theme without `--orz-grid` costs one style read per box.
 *
 * The SLIDE is ruled (closed-loop round A, TK-3): the kit aligns a body's
 * lines from the body's own top, so a region that does not start on one of
 * the slide's lines (the second and third row of a row split) wrote its text
 * between them. An unscaled body therefore first gets the top padding that
 * moves it onto the slide's next line (a multiple of the pitch from the
 * slide's top); a body fit had to shrink is a sheet with its own ruling and
 * keeps its own top.
 */
import type { BoxPrepare } from './fit.js';

type Grid = { align(root: Element): unknown };

/** The padding this pass added to a body's top (to take back). */
const PAD = 'data-orz-grid-pad';

/** The `prepare` step of fit for the page `win` (a no-op until the kit's grid is installed). */
export function gridPrepare(win: Window): BoxPrepare {
  return (box) => {
    const g = (win as unknown as { OrzBaselineGrid?: Grid }).OrzBaselineGrid;
    if (!g || typeof g.align !== 'function') return;
    for (const body of Array.from(box.querySelectorAll<HTMLElement>(':scope > .markdown-body'))) {
      if (!win.getComputedStyle(body).getPropertyValue('--orz-grid').trim()) continue;
      if (body.hasAttribute(PAD)) { body.style.removeProperty('padding-top'); body.removeAttribute(PAD); }
      try { g.align(body); } catch { /* the grid's own failure: the text as CSS lays it out */ continue; }
      if (box.style.getPropertyValue('--fit-scale') !== '') continue;
      onSlideLines(win, box, body, g);
    }
  };
}

/** Pad an aligned body's top so its first line is one of the slide's lines (a multiple of the pitch from the slide's top). */
function onSlideLines(win: Window, box: HTMLElement, body: HTMLElement, g: Grid): void {
  const pitch = parseFloat(body.getAttribute('data-orz-grid') ?? '');
  const slide = box.closest('section');
  if (!slide || !(pitch > 1)) return;
  const sr = slide.getBoundingClientRect();
  const k = slide.offsetWidth > 0 ? sr.width / slide.offsetWidth : 1; // screen px per logical px (reveal scales the slide)
  if (!(k > 0)) return;
  const cs = win.getComputedStyle(body);
  const padTop = parseFloat(cs.paddingTop) || 0;
  const top = (body.getBoundingClientRect().top - sr.top) / k + (parseFloat(cs.borderTopWidth) || 0) + padTop;
  const off = (pitch - (((top % pitch) + pitch) % pitch)) % pitch;
  if (off < 0.5 || pitch - off < 0.5) return;
  body.style.setProperty('padding-top', `${padTop + off}px`);
  body.setAttribute(PAD, String(off));
  try { g.align(body); } catch { /* as it is */ }
}
