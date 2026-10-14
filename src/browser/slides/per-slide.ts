/**
 * KIND-SPECIFIC (slides): the SEAM of editing mode (b), per slide (REBUILD
 * §3c owner decision 1(b), plan step 6). Step 5 builds the entry point —
 * the toolbar's **This slide** toggle (src/browser/slides/editor.ts): the
 * same text editor with the text outside the caret's slide dimmed
 * (`setFocusRange`; one history for both modes, Q6) and the live view as the
 * stage in the preview frame (`orz-slides-live { stage: true }`). The layout
 * GUI itself is step 6: an implementation of {@link SlideLayoutGui} handed
 * to `attachSlidesTools({ layoutGui })`, attached when the mode is entered
 * and destroyed when it is left.
 *
 * What the GUI gets ({@link StageHost}) — and the rules it must keep:
 * - `shell`: the ONE editor. Every layout op is a text edit through
 *   `shell.applyEdits(edits, { label })` (one undo step each), computed by a
 *   pure `src/layout-ops.ts` over marker lines only (step 6); clicking a box
 *   is `shell.select(from, to)` on its markdown. No hidden layout data.
 * - `slide()`: the caret's slide of the current text (parseDeck: spans of the
 *   marker, every region source and float — what the ops rewrite).
 * - `geometry()`: the stage's last fit report — each box's kind, region
 *   name, scale, clipping and rectangle in logical px — DATA from the
 *   sandboxed frame (it may be forged by the document's scripts: use it to
 *   place handles and badges, never as the source of an edit). The overlay
 *   (dividers, handles, badges) lives in the TRUSTED page over the frame;
 *   step 6 adds the frame's position to the host for that.
 * - `refresh()` is called when a new fit report arrives.
 */
import type { EditorShell } from 'orz-markdown/carrier/editor';
import type { Slide } from '../../types.js';

/** A box of the stage, as the frame reports it (logical px, relative to the slide). */
export interface StageBox { kind: string; name: string; scale: number; clipped: boolean; x: number; y: number; w: number; h: number }

/** The stage's last fit report: the slide it is of, and its boxes. */
export interface StageGeometry { index: number; boxes: StageBox[] }

/** What the per-slide mode gives the layout GUI. */
export interface StageHost {
  readonly shell: EditorShell;
  slide(): { index: number; slide: Slide } | null;
  geometry(): StageGeometry | null;
}

/** The layout GUI (step 6): attached on entering the per-slide mode. */
export interface SlideLayoutGui {
  attach(host: StageHost): { refresh(): void; destroy(): void };
}
