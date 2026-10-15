/**
 * KIND-SPECIFIC (slides): the SEAM of editing mode (b), per slide (REBUILD
 * §3c owner decision 1(b), plan step 6). The entry point is the live card,
 * enlarged (owner decision 2026-10-14; src/browser/slides/editor.ts; the
 * GUI's shrink button calls `leave()`): the same
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
 *   itself over (regions, splits, title, floats, the slide's ink), in
 *   logical px — DATA from the sandboxed frame (it may be forged by the
 *   document's scripts: it places handles, badges and labels, and SEEDS
 *   what the reader then sees and confirms — a new float's place, the start
 *   of a move of a float the text gives in em — never a name, an index or
 *   an op; boxes are named from the text, round B ISO-B1). Scope: the frame
 *   is an opaque origin in an app host and a served page; a standalone file
 *   opened from disk gives it `allow-same-origin` (orz-markdown's registered
 *   decision B-2), where the document already runs in the page as its read
 *   view (round B, ISO-B3).
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
  /** The slide's ink: its lines of text and its pictures, clipped to their boxes (where labels must not lie; round B, GUI-1). */
  ink: Rect[];
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
  /** The slide theme's scheme (the overlay's outlines take the colour that reads on it). */
  scheme(): 'light' | 'dark';
  /** The editor's engine ('textarea': the basic editor, nothing dimmed). */
  engine(): string;
  /** Back to the whole deck: the slide shrinks into the live card (the GUI's shrink button; owner decision 2026-10-14). */
  leave(): void;
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
  /** `stale()`: the text changed by typing — the stage is out of date until the next `refresh()` (at the typing pause). */
  attach(host: StageHost): { refresh(): void; destroy(): void; stale?(): void };
}
