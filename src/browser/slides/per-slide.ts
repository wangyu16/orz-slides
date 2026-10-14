/**
 * KIND-SPECIFIC (slides): the SEAM of editing mode (b), per slide (REBUILD
 * §3c owner decision 1(b), plan step 6). Step 5 built the entry point — the
 * toolbar's **This slide** toggle (src/browser/slides/editor.ts): the same
 * text editor with the text outside the caret's slide dimmed
 * (`setFocusRange`; one history for both modes, Q6) and the live view as the
 * stage in the preview frame (`orz-slides-live { stage: true }`). Step 6's
 * layout GUI (src/browser/slides/layout-gui.ts) is a {@link SlideLayoutGui}
 * handed to `attachSlidesTools({ layoutGui })`, attached when the mode is
 * entered and destroyed when it is left.
 *
 * What the GUI gets ({@link StageHost}) — and the rules it must keep:
 * - `shell`: the ONE editor. Every layout op is a text edit through
 *   `shell.applyEdits(edits, { label })` (one undo step each), computed by
 *   the pure `src/layout-ops.ts` over marker lines only; clicking a box is
 *   `shell.select(from, to)` on its markdown. No hidden layout data.
 * - `slide()`: the caret's slide of the current text.
 * - `geometry()`: the stage's last fit report — each box's kind, region
 *   name, scale, clipping and rectangle, and the parts the overlay places
 *   itself over (regions, splits, title, floats), in logical px — DATA from
 *   the sandboxed frame (it may be forged by the document's scripts: it
 *   places handles and badges, never an input of an edit).
 * - `pane()` / `frame()`: the trusted container over the frame and the
 *   frame; the stage's place is computed by the page itself
 *   (`stageLayout` of the frame's size and the insets the GUI asks for with
 *   `setStage`), the frame draws the slide there — the overlay never asks
 *   the frame where anything is but the slide's inner layout.
 * - `refresh()` is called when a new fit report arrives and when the text
 *   changes.
 */
import type { EditorShell } from 'orz-markdown/carrier/editor';
import type { Slide } from '../../types.js';
import type { Rect, StageInsets } from './stage-geometry.js';

/** A box of the stage, as the frame reports it (logical px, relative to the slide). */
export interface StageBox { kind: string; name: string; scale: number; clipped: boolean; x: number; y: number; w: number; h: number }

/** The parts of the slide the overlay places itself over (logical px, relative to the slide; data from the frame). */
export interface StageParts {
  /** Every layout box, empty ones too, in document order. */
  regions: Array<Rect & { name: string; empty: boolean }>;
  /** Every split in document order (the tree's pre-order) and its children's boxes. */
  splits: Array<Rect & { dir: 'row' | 'col'; kids: Rect[] }>;
  title: Rect | null;
  content: Rect | null;
  template: Rect | null;
  footer: Rect | null;
  floats: Rect[];
}

/** The stage's last fit report: the slide it is of, its boxes and parts, and whether it is of the current text. */
export interface StageGeometry { index: number; boxes: StageBox[]; parts: StageParts | null; current: boolean }

/** A drag preview (styles for the stage's slide; data to the frame). */
export interface StagePreview {
  splits?: Array<{ index: number; dir: 'row' | 'col'; css: string }>;
  floats?: Array<{ index: number; left: number; top: number; w: number; h: number }>;
  reset?: boolean;
}

/** What the per-slide mode gives the layout GUI. */
export interface StageHost {
  readonly shell: EditorShell;
  slide(): { index: number; slide: Slide } | null;
  geometry(): StageGeometry | null;
  /** The trusted container over the preview frame (the editor's preview pane), or null before it exists. */
  pane(): HTMLElement | null;
  /** The preview frame element. */
  frame(): HTMLIFrameElement | null;
  /** The space the GUI keeps over the frame, and whether a template's variant thumbnails are drawn under the stage. */
  setStage(o: { insets: StageInsets; variants: boolean }): void;
  /** The deck's logical slide size (16:9 1280 × 720, 4:3 960 × 720). */
  slideSize(): { width: number; height: number };
  /** Preview a drag on the stage (or put it back). */
  preview(p: StagePreview): void;
  /** Show the caret's slide on the stage now (after an op), not after the typing pause. */
  syncNow(): void;
  /** Put the caret on a slide (the stage follows). */
  goTo(index: number): void;
  /** A slide's fit when it has been shown on the stage or the live view (the filmstrip's dot). */
  fitOf(index: number): { scale: number; clipped: boolean } | null;
}

/** The layout GUI: attached on entering the per-slide mode. */
export interface SlideLayoutGui {
  attach(host: StageHost): { refresh(): void; destroy(): void };
}
