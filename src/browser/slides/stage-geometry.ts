/**
 * KIND-SPECIFIC (slides): where the per-slide mode's stage sits in the
 * preview frame — ONE pure function used by both sides (rebuild step 6):
 * the frame's live runtime (src/browser/slides/live-frame.ts) draws the
 * slide there, and the trusted page (src/browser/slides/layout-gui.ts)
 * places its overlay there. The page decides the insets (its toolbar, the
 * filmstrip, the status line) and tells the frame; it never asks the frame
 * where the stage is, so a document script that moves the slide in the
 * frame misplaces only the picture, not the overlay.
 */

/** Space the trusted page keeps for its own chrome over the frame (CSS px of the frame's viewport). */
export interface StageInsets { top: number; right: number; bottom: number; left: number }

export interface Rect { x: number; y: number; w: number; h: number }

/** The stage: the slide's port (and its scale from logical px), and the variant thumbnails' places. */
export interface StageLayout {
  port: Rect & { scale: number };
  variants: Rect[];
}

/** Padding around the stage inside the insets (CSS px). */
export const STAGE_PAD = 14;

/**
 * The stage in a viewport of `vw` × `vh` CSS px: the slide (logical
 * `sw` × `sh`) contained, centred, in the space the insets leave (less the
 * padding); with `variants` (a template's looks), a row of that many
 * thumbnails under it.
 */
export function stageLayout(vw: number, vh: number, insets: StageInsets, sw: number, sh: number, variants = 0): StageLayout {
  const ax = insets.left + STAGE_PAD;
  const ay = insets.top + STAGE_PAD;
  const aw = Math.max(40, vw - insets.left - insets.right - 2 * STAGE_PAD);
  const ah = Math.max(40, vh - insets.top - insets.bottom - 2 * STAGE_PAD);
  const n = Math.max(0, Math.min(8, Math.floor(variants)));
  // the variant row: thumbnails at the slide's aspect, at most 96 px tall and a quarter of the height
  let rowH = 0;
  let tw = 0;
  let th = 0;
  const gap = 10;
  if (n > 0) {
    th = Math.max(28, Math.min(96, Math.floor(ah * 0.24)));
    tw = Math.round((th * sw) / sh);
    const need = n * tw + (n - 1) * gap;
    if (need > aw) {
      tw = Math.max(36, Math.floor((aw - (n - 1) * gap) / n));
      th = Math.round((tw * sh) / sw);
    }
    rowH = th + 22 + gap;
  }
  const s = Math.max(0.05, Math.min(aw / sw, (ah - rowH) / sh));
  const w = Math.round(sw * s);
  const h = Math.round(sh * s);
  const x = Math.round(ax + (aw - w) / 2);
  const y = Math.round(ay + Math.max(0, (ah - rowH - h) / 2));
  const out: Rect[] = [];
  if (n > 0) {
    const total = n * tw + (n - 1) * gap;
    const x0 = Math.round(ax + (aw - total) / 2);
    const y0 = y + h + gap + 4;
    for (let i = 0; i < n; i++) out.push({ x: x0 + i * (tw + gap), y: y0, w: tw, h: th });
  }
  return { port: { x, y, w, h, scale: w / sw }, variants: out };
}

/** The live card's head (its slide number and fit badge), CSS px. */
export const CARD_HEAD = 28;
/** The card's margin from the frame's bottom (CSS px) and from its right edge (clear of a classic scrollbar). */
export const CARD_MARGIN = 12;
export const CARD_MARGIN_RIGHT = 22;

/**
 * The live card in the whole-deck view (owner decision 2026-10-14): the
 * caret's slide in the frame's bottom-right corner — a head and the slide
 * port under it. Computed by both sides, as {@link stageLayout}: the frame
 * draws the card there, the trusted page lays its own buttons over it
 * (enlarge, fold), so a click on the card is the reader's, never the frame's.
 */
export function cardLayout(vw: number, vh: number, sw: number, sh: number): { card: Rect; port: Rect & { scale: number } } {
  const w = Math.round(Math.max(120, Math.min(400, vw * 0.46, (vh * 0.5 - CARD_HEAD) * (sw / sh))));
  const ph = Math.round((w * sh) / sw);
  const h = CARD_HEAD + ph;
  const x = Math.round(vw - CARD_MARGIN_RIGHT - w);
  const y = Math.round(vh - CARD_MARGIN - h);
  return { card: { x, y, w, h }, port: { x, y: y + CARD_HEAD, w, h: ph, scale: w / sw } };
}
