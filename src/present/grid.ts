/**
 * The baseline grid in a deck (REBUILD §3c step 4, the Notebook theme): a
 * theme that sets orz-markdown's `--orz-grid` on a region's body has its
 * text written on ruled lines by the kit's grid pass (`window.OrzBaselineGrid`,
 * installed by `enhanceDocument`, orz-markdown 2.3.0). The pass watches an
 * article's size, but fit changes a box's font size (and so the grid's pitch)
 * without resizing it — so fit re-aligns the box at every trial scale
 * (src/present/fit.ts `prepare`): the grid's margins are measured as part of
 * what must fit. A theme without `--orz-grid` costs one style read per box.
 */
import type { BoxPrepare } from './fit.js';

type Grid = { align(root: Element): unknown };

/** The `prepare` step of fit for the page `win` (a no-op until the kit's grid is installed). */
export function gridPrepare(win: Window): BoxPrepare {
  return (box) => {
    const g = (win as unknown as { OrzBaselineGrid?: Grid }).OrzBaselineGrid;
    if (!g || typeof g.align !== 'function') return;
    for (const body of Array.from(box.querySelectorAll<HTMLElement>(':scope > .markdown-body'))) {
      if (!win.getComputedStyle(body).getPropertyValue('--orz-grid').trim()) continue;
      try { g.align(body); } catch { /* the grid's own failure: the text as CSS lays it out */ }
    }
  };
}
