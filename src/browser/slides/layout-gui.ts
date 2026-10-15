/**
 * KIND-SPECIFIC (slides): the layout GUI of editing mode (b), per slide
 * (REBUILD §3c owner decisions 1(b) and 6, Q6, plan step 6) — the
 * {@link SlideLayoutGui} the per-slide mode attaches to its stage.
 *
 * It lives in the TRUSTED page, over the sandboxed preview frame: a toolbar
 * (the slide, its layout presets, the selected box's or float's actions, a
 * template's looks, the slide's options, notes and footer), the filmstrip
 * (every slide, virtualised; add / duplicate / delete / drag-reorder), the
 * overlay on the stage (a box per layout region, the title, the footer,
 * dividers between boxes, floats with handles, a fit badge per box) and a
 * status line (what the last op did, Undo / Redo, the keys).
 *
 * Rules it keeps:
 * - **The text is the only state.** Every op is `applyOp` (src/layout-ops.ts)
 *   → `shell.applyEdits(edits, { label })`: ONE undo step in the ONE editor,
 *   the changed lines flashed (`shell.flash`). A drag or a run of arrow
 *   nudges shows a preview and writes once, when it ends (the preview is the
 *   only thing not in the text, and it lasts until the pointer is up or the
 *   keys pause) — to the slide and the text it STARTED on (closed-loop round
 *   B, OPS-2): a run is written before any navigation, undo or mode switch,
 *   and dropped when the text changed under it; a refused write puts the
 *   stage back as the text says.
 * - **Only the reader's own input acts**: every handler that leads to an op
 *   checks `event.isTrusted`; nothing the frame sends is an op — its reports
 *   (the boxes' rectangles, the slide's ink) place handles, badges and
 *   labels, and seed only what the reader then sees and confirms (a new
 *   float's place; the start of a move of a float the text gives in em); an
 *   op's numbers come from the text and the pointer (a float's start from its
 *   marker where it is in % or px, a divider's sizes from the snapped pointer
 *   position shown in the bubble); boxes are named from the text. The
 *   stage's own place is computed here (`stageLayout`), never asked.
 * - **Labels never cover content, and are read at rest** (round B, GUI-1):
 *   each name and fit badge takes the first place that lies on no text or
 *   picture of the slide (above its box, inside a top corner, under it,
 *   inside a bottom corner); a cut box is outlined in red and its badge is
 *   never hidden; the toolbar says every box that does not fit. Handles sit
 *   on the edges; the toolbar and the filmstrip (beside the slide or under
 *   it, whichever leaves the slide larger) are not over the slide.
 * - Touch and keyboard: pointer events everywhere, larger targets on coarse
 *   pointers; every box, divider, float and slide is focusable with its own
 *   keys (the `?` panel lists them) and a screen-reader label.
 */
import type { EditorShell } from 'orz-markdown/carrier/editor';
import { readHeader } from 'orz-markdown/carrier';
import { installCss } from 'orz-markdown/carrier/app';
import { parseDeck, TEMPLATES } from '../../deck/parse.js';
import { leaves, normalizeTree } from '../../deck/layout-spec.js';
import {
  applyOp, blockingProblem, floatStart, LayoutOpError, nameProblem, pairRatio, partAt, placeFloat, PRESET_CHOICES, PRESET_LABEL, presetOf, presetTree, slideMap, snapTracks, splitsOf, stepTracks,
  TEMPLATE_LABEL, type FloatBox, type LayoutOp, type OpResult, type PresetChoice, type SlideMap,
} from '../../layout-ops.js';
import type { Deck, LayoutNode, Slide } from '../../types.js';
import type { SlideLayoutGui, StageGeometry, StageHost } from './per-slide.js';
import { STAGE_PAD, stageLayout, type Rect, type StageInsets } from './stage-geometry.js';

/** How long a run of arrow keys waits before it is written (one undo step for the run). */
export const NUDGE_COMMIT_MS = 650;
/** Filmstrip row height (CSS px; coarse pointers get more). */
const ROW = 66;
const ROW_COARSE = 80;
/** The filmstrip beside the stage (its width) or under it (its height; an item's width) — whichever leaves the slide larger (round B, GUI-4). */
const STRIP_W = 148;
const STRIP_H = 84;
const STRIP_H_COARSE = 100;
const ITEM_W = 150;
const ITEM_W_COARSE = 170;

/** The keys, as the `?` panel lists them. */
export const LAYOUT_KEYS: ReadonlyArray<readonly [string, string]> = [
  ['Tab / Shift+Tab', 'the toolbar, the filmstrip, then each box, divider and float'],
  ['Arrows (box)', 'go to the box on that side'],
  ['Space (box, float)', 'select its text in the editor'],
  ['Enter (box, float)', 'edit its text'],
  ['C / R (box)', 'split into columns / rows'],
  ['F2 (box)', 'rename'],
  ['Alt+Arrows (box)', 'swap the text with the box on that side'],
  ['Alt+Shift+Arrows (box)', 'move the text to the end of the box on that side'],
  ['Delete (box)', 'delete — its text goes to the neighbour'],
  ['Arrows (divider)', 'the next simple size'],
  ['Enter (divider)', 'write the size now'],
  ['Arrows (float)', 'move 1 % (Shift: 5 %)'],
  ['Alt+Arrows (float)', 'resize'],
  ['] / [ (float)', 'bring forward / send backward'],
  ['Delete (float)', 'delete the float'],
  ['Up / Down (filmstrip)', 'go to a slide (Left / Right when it is under the slide)'],
  ['Home / End (filmstrip)', 'the first / last slide'],
  ['Page Up / Page Down (filmstrip)', 'a screenful of slides'],
  ['Enter (filmstrip)', 'go to the slide\'s boxes'],
  ['Alt+Up / Alt+Down (filmstrip)', 'move the slide'],
  ['Delete (filmstrip)', 'delete the slide'],
  ['Page Up / Page Down', 'previous / next slide'],
  ['Ctrl/Cmd+Z, Shift+Ctrl/Cmd+Z', 'undo / redo'],
  ['?', 'this list'],
  ['Escape', 'cancel a drag or a run of keys; close a panel; clear the selection'],
];

type Sel = { kind: 'box'; name: string } | { kind: 'float'; index: number } | { kind: 'title' } | null;

const SVG = {
  col: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.5" y="2.5" width="13" height="11" rx="1"/><path d="M8 2.5v11"/></svg>',
  row: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.5" y="2.5" width="13" height="11" rx="1"/><path d="M1.5 8h13"/></svg>',
  rename: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 12.5h2.5l7-7-2.5-2.5-7 7z"/></svg>',
  del: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 4.5h9M6.5 4.5V3h3v1.5M5 4.5l.6 8.5h4.8l.6-8.5"/></svg>',
  swap: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 5.5h9l-2.5-2.5M13 10.5H4l2.5 2.5"/></svg>',
  move: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 8h10M9.5 5l3 3-3 3"/></svg>',
  float: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.5" y="2.5" width="13" height="11" rx="1" opacity=".5"/><rect x="7.5" y="6.5" width="6" height="5" rx=".5"/></svg>',
  up: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 9.5l4-4 4 4"/></svg>',
  down: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6.5l4 4 4-4"/></svg>',
  add: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10"/></svg>',
  dup: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1"/><path d="M3.5 10.5v-7a1 1 0 0 1 1-1h7"/></svg>',
  grip: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4h.01M10 4h.01M6 8h.01M10 8h.01M6 12h.01M10 12h.01"/></svg>',
  strip: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.5" y="2.5" width="4" height="11" rx="1"/><rect x="7.5" y="2.5" width="7" height="11" rx="1"/></svg>',
};

const GUI_CSS = `
.orz-lg { position: absolute; inset: 0; z-index: 3; pointer-events: none; font: 13px/1.35 var(--orz-chrome-font, system-ui, sans-serif); color: var(--orz-chrome-fg); --lg-accent: var(--orz-chrome-accent, #2f6fde); --lg-hit: 10px; --lg-handle: 10px;
  /* the overlay on the SLIDE reads on the slide's theme (round B, GUI-5: ≥ 3 : 1): a dark line and a light halo on a light slide, the other way round on a dark one */
  --lg-ink: oklch(45% 0.17 258); --lg-halo: rgb(255 255 255 / .75); --lg-cut: oklch(52% 0.2 27); --lg-shrunk: oklch(48% 0.15 255); --lg-fits: oklch(48% 0.12 150); }
.orz-lg[data-scheme="dark"] { --lg-ink: oklch(82% 0.11 245); --lg-halo: rgb(0 0 0 / .6); --lg-cut: oklch(72% 0.17 27); --lg-shrunk: oklch(80% 0.1 255); --lg-fits: oklch(80% 0.12 150); }
@media (pointer: coarse) { .orz-lg { --lg-hit: 26px; --lg-handle: 22px; } }
.orz-lg button { font: inherit; color: inherit; }
.orz-lg :focus-visible { outline: 2px solid var(--orz-chrome-focus, var(--lg-accent)); outline-offset: 2px; }
.orz-lg-bar, .orz-lg-strip, .orz-lg-status, .orz-lg-pop { pointer-events: auto; background: var(--orz-chrome-surface, #fff); }
.orz-lg-bar { position: absolute; left: 0; right: 0; top: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; padding: 6px 8px; border-bottom: 1px solid var(--orz-chrome-border, #ddd); }
.orz-lg-group { display: inline-flex; align-items: center; gap: 2px; padding-right: 6px; margin-right: 2px; border-right: 1px solid var(--orz-chrome-border, #ddd); }
.orz-lg-group:last-child { border-right: 0; }
.orz-lg-group[hidden] { display: none; }
.orz-lg-n { font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; padding: 0 4px; }
.orz-lg-note { color: var(--orz-chrome-muted, #666); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 32ch; }
.orz-lg-btn { display: inline-flex; align-items: center; gap: 4px; min-height: 28px; min-width: 28px; padding: 0 7px; border: 1px solid transparent; border-radius: 6px; background: transparent; cursor: pointer; white-space: nowrap; }
.orz-lg-btn:hover:not(:disabled) { background: var(--orz-chrome-hover, #f0f0f3); }
.orz-lg-btn:disabled { opacity: .4; cursor: default; }
.orz-lg-btn[aria-pressed="true"], .orz-lg-btn[aria-checked="true"] { border-color: var(--lg-accent); color: var(--lg-accent); background: color-mix(in oklch, var(--lg-accent) 9%, transparent); }
.orz-lg-btn svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.4; stroke-linecap: round; stroke-linejoin: round; }
.orz-lg-btn--danger:hover:not(:disabled) { color: var(--orz-chrome-danger, #c22); }
@media (pointer: coarse) { .orz-lg-btn { min-height: 40px; min-width: 40px; } }
.orz-lg-mini { display: inline-block; width: 26px; height: 16px; padding: 1px; border: 1px solid currentColor; border-radius: 3px; opacity: .85; }
.orz-lg-mini b { display: grid; gap: 1.5px; width: 100%; height: 100%; }
.orz-lg-mini > i, .orz-lg-mini b > i { display: block; width: 100%; height: 100%; background: currentColor; opacity: .32; border-radius: 1px; }
.orz-lg-mini > i { height: 100%; }
.orz-lg-strip { position: absolute; left: 0; bottom: 0; width: 148px; display: flex; flex-direction: column; border-right: 1px solid var(--orz-chrome-border, #ddd); }
.orz-lg-strip[data-axis="x"] { right: 0; width: auto; flex-direction: row; border-right: 0; border-top: 1px solid var(--orz-chrome-border, #ddd); }
.orz-lg-strip[data-axis="x"] .orz-lg-strip-head { display: grid; grid-template-columns: auto auto; align-content: center; border-bottom: 0; border-right: 1px solid var(--orz-chrome-border, #ddd); }
.orz-lg-strip[data-axis="x"] .orz-lg-strip-scroll { overflow-x: auto; overflow-y: hidden; }
.orz-lg-strip[data-axis="x"] .orz-lg-strip-inner { height: 100%; }
.orz-lg-strip[data-axis="x"] .orz-lg-drop { left: auto; right: auto; top: 4px; bottom: 4px; width: 3px; height: auto; margin: 0 0 0 -2px; }
.orz-lg-strip[data-axis="x"] .orz-lg-ghost { left: auto; right: auto; top: 4px; }
.orz-lg-strip[hidden] { display: none; }
.orz-lg-strip-head { display: flex; gap: 2px; padding: 4px; border-bottom: 1px solid var(--orz-chrome-border, #ddd); }
.orz-lg-strip-scroll { position: relative; flex: 1; overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain; scroll-behavior: auto; }
.orz-lg-strip-inner { position: relative; }
.orz-lg-item { position: absolute; left: 4px; right: 4px; display: grid; grid-template-columns: 22px 1fr 18px; grid-template-rows: auto auto; align-items: center; gap: 2px 4px; padding: 4px; border: 1px solid transparent; border-radius: 6px; cursor: pointer; user-select: none; -webkit-user-select: none; }
.orz-lg-item:hover { background: var(--orz-chrome-hover, #f0f0f3); }
.orz-lg-item[aria-selected="true"] { border-color: var(--lg-accent); background: color-mix(in oklch, var(--lg-accent) 8%, transparent); }
.orz-lg-item-n { grid-row: 1 / span 2; font-weight: 600; font-variant-numeric: tabular-nums; text-align: right; color: var(--orz-chrome-muted, #666); }
.orz-lg-item-thumb { display: flex; align-items: center; gap: 4px; min-width: 0; height: 28px; }
.orz-lg-item-thumb .orz-lg-mini { width: 44px; height: 26px; flex: none; }
.orz-lg-item-line { grid-column: 2 / span 2; display: flex; gap: 4px; min-width: 0; font-size: 11.5px; white-space: nowrap; }
.orz-lg-item-kind { flex: none; font-size: 11px; color: var(--orz-chrome-muted, #666); white-space: nowrap; }
.orz-lg-item-kind:empty { display: none; }
.orz-lg-item-t { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* a template slide's thumbnail: its own drawing per kind (round B, GUI-10) */
.orz-lg-tpl { position: relative; display: block; width: 100%; height: 100%; }
.orz-lg-tpl > i { position: absolute; display: block; background: currentColor; border-radius: 1px; opacity: .45; }
.orz-lg-tpl--title > i:nth-child(1) { left: 15%; right: 15%; top: 30%; height: 22%; opacity: .6; } .orz-lg-tpl--title > i:nth-child(2) { left: 30%; right: 30%; top: 62%; height: 10%; }
.orz-lg-tpl--section > i:nth-child(1) { left: 12%; width: 16%; top: 35%; height: 30%; opacity: .7; border-radius: 50%; } .orz-lg-tpl--section > i:nth-child(2) { left: 34%; right: 12%; top: 42%; height: 16%; }
.orz-lg-tpl--outline > i { left: 15%; height: 9%; } .orz-lg-tpl--outline > i:nth-child(1) { top: 18%; right: 30%; opacity: .6; } .orz-lg-tpl--outline > i:nth-child(2) { top: 40%; right: 40%; } .orz-lg-tpl--outline > i:nth-child(3) { top: 58%; right: 35%; } .orz-lg-tpl--outline > i:nth-child(4) { top: 76%; right: 45%; }
.orz-lg-tpl--closing > i:nth-child(1) { left: 12%; width: 46%; top: 38%; height: 20%; opacity: .6; } .orz-lg-tpl--closing > i:nth-child(2) { right: 12%; width: 22%; top: 25%; height: 50%; border-radius: 2px; }
.orz-lg-item-grip { grid-column: 3; grid-row: 1; display: flex; align-items: center; justify-content: center; width: 18px; height: 26px; cursor: grab; touch-action: none; color: var(--orz-chrome-muted, #666); }
.orz-lg-item-grip svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 2.4; stroke-linecap: round; }
@media (pointer: coarse) { .orz-lg-item-grip { width: 32px; height: 40px; } .orz-lg-item { grid-template-columns: 22px 1fr 32px; } }
.orz-lg-dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; flex: none; }
.orz-lg-dot[data-fit="fits"] { background: oklch(64% 0.15 150); }
.orz-lg-dot[data-fit="shrunk"] { background: oklch(62% 0.14 255); }
.orz-lg-dot[data-fit="cut"] { background: oklch(58% 0.19 27); }
.orz-lg-drop { position: absolute; left: 4px; right: 4px; height: 3px; margin-top: -2px; border-radius: 2px; background: var(--lg-accent); pointer-events: none; }
.orz-lg-ghost { position: absolute; left: 4px; right: 4px; opacity: .85; pointer-events: none; box-shadow: 0 6px 18px rgba(0,0,0,.18); background: var(--orz-chrome-surface, #fff); border-color: var(--lg-accent) !important; }
.orz-lg-status { position: absolute; left: 0; right: 0; bottom: 0; display: flex; align-items: center; gap: 6px; min-height: 30px; padding: 3px 8px; border-top: 1px solid var(--orz-chrome-border, #ddd); font-size: 12px; }
.orz-lg-status { min-height: 44px; }
.orz-lg-msg { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* a refusal says how to fix it: two lines, the whole text in its title and a click away (round B, GUI-8) */
.orz-lg-msg[data-tone="warn"] { color: var(--orz-chrome-warning, #a60); white-space: normal; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-height: 1.35; cursor: help; }
.orz-lg-msg[data-tone="ok"]::before { content: ""; display: inline-block; width: 7px; height: 7px; margin-right: 6px; border-radius: 50%; background: oklch(78% 0.15 90); vertical-align: 1px; }
.orz-lg-stage { position: absolute; pointer-events: none; }
.orz-lg-stage.is-stale > * { opacity: .45; pointer-events: none; }
.orz-lg-box { position: absolute; pointer-events: auto; box-sizing: border-box; border: 1.5px dashed var(--lg-ink); box-shadow: 0 0 0 1px var(--lg-halo); border-radius: 2px; cursor: pointer; touch-action: manipulation; }
.orz-lg-box:hover { border-style: solid; background: color-mix(in oklch, var(--lg-ink) 5%, transparent); }
.orz-lg-box.is-cursor { border-style: solid; }
.orz-lg-box.is-selected { border: 2px solid var(--lg-ink); background: color-mix(in oklch, var(--lg-ink) 7%, transparent); }
.orz-lg-box.is-target { border: 2px solid oklch(66% 0.17 150); background: color-mix(in oklch, oklch(66% 0.17 150) 10%, transparent); }
.orz-lg-box--title, .orz-lg-box--footer { border-color: color-mix(in oklch, var(--lg-ink) 70%, transparent); }
/* the fit on the outline itself (never tucked: round B, GUI-1) */
.orz-lg-box[data-fit="cut"] { border: 2.5px solid var(--lg-cut); }
.orz-lg-box[data-fit="shrunk"] { border-color: var(--lg-shrunk); }
.orz-lg-tag, .orz-lg-badge { position: absolute; bottom: 100%; margin-bottom: 1px; max-width: calc(100% - 8px); padding: 0 5px; border-radius: 4px 4px 0 0; font: 600 10.5px/15px var(--orz-chrome-font, system-ui, sans-serif); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; transition: opacity .15s; }
.orz-lg-tag { left: 6px; background: var(--lg-accent); color: var(--orz-chrome-accent-fg, #fff); cursor: grab; touch-action: none; }
.orz-lg-box--title .orz-lg-tag, .orz-lg-box--footer .orz-lg-tag { background: var(--orz-chrome-muted, #777); cursor: pointer; }
.orz-lg-badge { right: 6px; background: oklch(94% 0.03 150); color: oklch(42% 0.12 150); }
.orz-lg-badge[data-fit="shrunk"] { background: oklch(93% 0.03 255); color: oklch(45% 0.14 255); }
.orz-lg-badge[data-fit="cut"] { background: oklch(52% 0.2 27); color: #fff; }
/* a label placed by placeLabels(): inside or under its box when its place above would lie on text */
.orz-lg-tag[data-at], .orz-lg-badge[data-at] { border-radius: 4px; }
.orz-lg-stage :is(.orz-lg-tag, .orz-lg-badge).is-tucked:not([data-fit="cut"]) { opacity: 0; }
.orz-lg-stage :is(.orz-lg-box, .orz-lg-float):is(:hover, :focus-visible, .is-selected) > :is(.orz-lg-tag, .orz-lg-badge).is-tucked { opacity: 1; }
/* labels sit OUTSIDE their box, on its top edge: never over its own content; while the pointer is over a box, the other boxes' labels (over its edge) fade */
.orz-lg-stage:has(:is(.orz-lg-box, .orz-lg-float):hover) :is(.orz-lg-box, .orz-lg-float):not(:hover) > :is(.orz-lg-tag, .orz-lg-badge) { opacity: .15; }
.orz-lg-stage.is-dragging :is(.orz-lg-tag, .orz-lg-badge) { opacity: .15; }
.orz-lg-empty { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); max-width: calc(100% - 8px); padding: 2px 6px; border-radius: 6px; font-size: 11px; line-height: 1.3; text-align: center; color: var(--orz-chrome-muted, #666); background: color-mix(in oklch, var(--orz-chrome-surface, #fff) 85%, transparent); pointer-events: none; }
.orz-lg-div { position: absolute; pointer-events: auto; touch-action: none; display: flex; align-items: center; justify-content: center; }
.orz-lg-div[aria-orientation="vertical"] { cursor: col-resize; }
.orz-lg-div[aria-orientation="horizontal"] { cursor: row-resize; }
.orz-lg-div::before { content: ""; position: absolute; background: var(--lg-ink); opacity: 0; border-radius: 2px; transition: opacity .12s; }
.orz-lg-div[aria-orientation="vertical"]::before { top: 0; bottom: 0; left: 50%; width: 3px; transform: translateX(-50%); }
.orz-lg-div[aria-orientation="horizontal"]::before { left: 0; right: 0; top: 50%; height: 3px; transform: translateY(-50%); }
.orz-lg-div:hover::before, .orz-lg-div:focus-visible::before, .orz-lg-div.is-dragging::before { opacity: .9; }
.orz-lg-div::after { content: ""; position: relative; width: 8px; height: 22px; border-radius: 4px; background: var(--orz-chrome-surface, #fff); box-shadow: 0 0 0 1.5px var(--lg-ink); opacity: .55; transition: opacity .12s; }
.orz-lg-div[aria-orientation="horizontal"]::after { width: 22px; height: 8px; }
.orz-lg-div:hover::after, .orz-lg-div:focus-visible::after, .orz-lg-div.is-dragging::after { opacity: 1; }
/* a touch screen has no hover: the grip and its line are drawn at rest, so a divider is found (round B, GUI-5) */
@media (hover: none) { .orz-lg-div::after { opacity: .95; width: 12px; height: 30px; } .orz-lg-div[aria-orientation="horizontal"]::after { width: 30px; height: 12px; } .orz-lg-div::before { opacity: .5; } }
.orz-lg.is-readonly :is(.orz-lg-div, .orz-lg-h) { display: none; }
.orz-lg-float { position: absolute; pointer-events: auto; box-sizing: border-box; border: 1.5px dashed oklch(62% 0.16 300); border-radius: 2px; cursor: move; touch-action: none; }
.orz-lg-float.is-selected { border: 2px solid oklch(55% 0.19 300); }
.orz-lg-float .orz-lg-tag { background: oklch(55% 0.19 300); cursor: move; }
.orz-lg-h { position: absolute; width: var(--lg-handle); height: var(--lg-handle); margin: calc(var(--lg-handle) / -2) 0 0 calc(var(--lg-handle) / -2); border-radius: 2px; background: var(--orz-chrome-surface, #fff); box-shadow: 0 0 0 1.5px oklch(55% 0.19 300); opacity: 0; touch-action: none; }
.orz-lg-float:hover .orz-lg-h, .orz-lg-float.is-selected .orz-lg-h, .orz-lg-float:focus-visible .orz-lg-h { opacity: 1; }
.orz-lg-h[data-h="nw"] { left: 0; top: 0; cursor: nwse-resize; } .orz-lg-h[data-h="ne"] { left: 100%; top: 0; cursor: nesw-resize; }
.orz-lg-h[data-h="sw"] { left: 0; top: 100%; cursor: nesw-resize; } .orz-lg-h[data-h="se"] { left: 100%; top: 100%; cursor: nwse-resize; }
.orz-lg-h[data-h="n"] { left: 50%; top: 0; cursor: ns-resize; } .orz-lg-h[data-h="s"] { left: 50%; top: 100%; cursor: ns-resize; }
.orz-lg-h[data-h="w"] { left: 0; top: 50%; cursor: ew-resize; } .orz-lg-h[data-h="e"] { left: 100%; top: 50%; cursor: ew-resize; }
.orz-lg-variant { position: absolute; pointer-events: auto; border: 2px solid transparent; border-radius: 4px; background: transparent; cursor: pointer; padding: 0; }
.orz-lg-variant:hover { border-color: color-mix(in oklch, var(--lg-accent) 50%, transparent); }
.orz-lg-variant[aria-checked="true"] { border-color: var(--lg-accent); }
.orz-lg-variant > span { position: absolute; left: 50%; top: 100%; transform: translate(-50%, 3px); font-size: 11px; color: var(--orz-chrome-muted, #666); white-space: nowrap; }
.orz-lg-variant[aria-checked="true"] > span { color: var(--lg-accent); font-weight: 600; }
.orz-lg-bubble { position: absolute; z-index: 5; transform: translate(-50%, calc(-100% - 12px)); padding: 3px 8px; border-radius: 6px; font: 600 12px/1.3 var(--orz-chrome-font, system-ui, sans-serif); background: var(--orz-chrome-fg, #222); color: var(--orz-chrome-surface, #fff); white-space: nowrap; pointer-events: none; }
.orz-lg-bubble small { font-weight: 400; opacity: .8; margin-left: 6px; }
.orz-lg-pop { position: absolute; z-index: 6; min-width: 200px; max-width: min(380px, calc(100% - 8px)); max-height: calc(100% - 8px); overflow: auto; box-sizing: border-box; padding: 8px; border: 1px solid var(--orz-chrome-border, #ddd); border-radius: 8px; box-shadow: var(--orz-chrome-shadow, 0 8px 24px rgba(0,0,0,.18)); }
.orz-lg-pop h3 { margin: 0 0 6px; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: var(--orz-chrome-muted, #666); }
.orz-lg-pop label { display: flex; align-items: center; gap: 6px; margin: 4px 0; }
.orz-lg-pop input[type="text"], .orz-lg-pop select { flex: 1; min-width: 0; min-height: 26px; padding: 2px 6px; border: 1px solid var(--orz-chrome-border, #ccc); border-radius: 5px; background: var(--orz-chrome-surface, #fff); color: inherit; font: inherit; }
.orz-lg-pop .orz-lg-err { min-height: 1.2em; color: var(--orz-chrome-danger, #c22); font-size: 12px; }
.orz-lg-pop .orz-lg-row { display: flex; gap: 4px; flex-wrap: wrap; }
.orz-lg-pop dl { display: grid; grid-template-columns: auto 1fr; gap: 3px 10px; margin: 0; font-size: 12px; }
.orz-lg-pop dl { grid-template-columns: minmax(0, 11em) minmax(0, 1fr); }
.orz-lg-pop dt { font-family: var(--orz-chrome-mono, monospace); overflow-wrap: anywhere; }
.orz-lg-pop dd { margin: 0; color: var(--orz-chrome-muted, #555); }
.orz-lg-catch { position: absolute; inset: 0; z-index: 4; pointer-events: auto; touch-action: none; background: transparent; }
.orz-lg-catch[hidden] { display: none; }
.orz-lg-float.is-selected { z-index: 1; }
.orz-lg-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.orz-lg-fit { font-weight: 600; }
.orz-lg-fit[data-fit="cut"] { color: var(--orz-chrome-danger, #c22); }
.orz-lg-full { margin: 0; max-width: 46ch; font-size: 12.5px; line-height: 1.45; white-space: normal; }
`;

/* ───────────────────────── small helpers ───────────────────────── */

/** A value for an attribute selector, CSS-safe whatever it holds (round B, ISO-B2: a newline threw in querySelector). */
const esc = (v: string): string => {
  const C = (globalThis as unknown as { CSS?: { escape?(s: string): string } }).CSS;
  return C?.escape ? C.escape(v) : v.replace(/[^\w-]/g, (c) => `\\${c.charCodeAt(0).toString(16)} `);
};

const isMac = (w: Window): boolean => /Mac|iPhone|iPad/.test(w.navigator?.platform ?? '');

/** The text's changed range between two versions (common prefix and suffix) — what undo/redo changed. */
function changedRange(a: string, b: string): { from: number; to: number } | null {
  if (a === b) return null;
  let p = 0;
  while (p < a.length && p < b.length && a.charCodeAt(p) === b.charCodeAt(p)) p++;
  let s = 0;
  while (s < a.length - p && s < b.length - p && a.charCodeAt(a.length - 1 - s) === b.charCodeAt(b.length - 1 - s)) s++;
  return { from: p, to: Math.max(p, b.length - s) };
}

/** "2 lines changed, 1 added" for an op's edits. */
function diffSummary(text: string, r: OpResult): string {
  const count = (s: string): number => (s === '' ? 0 : (s.match(/\r\n|\r|\n/g)?.length ?? 0) + (/(?:\r\n|\r|\n)$/.test(s) ? 0 : 1));
  let del = 0;
  let ins = 0;
  let changed = 0;
  for (const e of r.edits) {
    const d = count(text.slice(e.from, e.to));
    const i = count(e.insert);
    changed += Math.min(d, i);
    del += d - Math.min(d, i);
    ins += i - Math.min(d, i);
  }
  const pl = (n: number, w: string): string => `${n} line${n === 1 ? '' : 's'} ${w}`;
  const parts = [changed ? pl(changed, 'changed') : '', ins ? pl(ins, 'added') : '', del ? pl(del, 'removed') : ''].filter((x) => x);
  return parts.join(', ') || 'no line changed';
}

/** A layout tree as a tiny diagram (CSS grid; fr tracks as written, other tracks as 1fr). */
function mini(doc: Document, n: LayoutNode): HTMLElement {
  const box = doc.createElement('span');
  box.className = 'orz-lg-mini';
  box.setAttribute('aria-hidden', 'true');
  const draw = (x: LayoutNode): HTMLElement => {
    if (x.kind === 'region') return doc.createElement('i');
    const b = doc.createElement('b');
    const tr = x.tracks.map((t) => (/^\d+(?:\.\d+)?(?:fr)?$/.test(t) ? `${t.replace(/fr$/, '')}fr` : t === 'auto' ? '.6fr' : '1fr')).join(' ');
    b.style.setProperty(x.dir === 'col' ? 'grid-template-columns' : 'grid-template-rows', tr);
    for (const c of x.children) b.append(draw(c));
    return b;
  };
  box.append(draw(normalizeTree(n)));
  return box;
}

function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, cls?: string, attrs: Record<string, string> = {}): HTMLElementTagNameMap[K] {
  const e = doc.createElement(tag);
  if (cls) e.className = cls;
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

/* ───────────────────────── the GUI ───────────────────────── */

/** The test handle of an attached GUI (`editor.slides.layoutGui()`). */
export interface LayoutGuiApi {
  /** What the GUI shows now. */
  state(): { slide: number; total: number; selection: Sel; boxes: string[]; floats: number; dividers: number; stage: Rect & { scale: number }; insets: StageInsets; status: string; template: string | null; blocked: string | null; stale: boolean; strip: number[]; stripAxis: 'x' | 'y' | null; dragging: boolean; pending: boolean };
  /** Apply an op through the GUI's own path (tests of the path; the reader's input goes through the trusted handlers). */
  run(op: LayoutOp): boolean;
}

/** The default layout GUI (see the module comment). */
export function createLayoutGui(): SlideLayoutGui {
  return { attach: (host: StageHost) => mountLayoutGui(host) };
}

function mountLayoutGui(host: StageHost): { refresh(): void; destroy(): void; stale(): void; api: LayoutGuiApi } {
  const shell: EditorShell = host.shell;
  const root = shell.root as unknown as ShadowRoot;
  let pane = host.pane();
  const doc = (pane?.ownerDocument ?? (root as unknown as { ownerDocument?: Document }).ownerDocument ?? document) as Document;
  const win = (doc.defaultView ?? window) as Window;
  installCss(root as never, GUI_CSS);
  const offs: Array<() => void> = [];
  const timers = new Set<number>();
  const later = (fn: () => void, ms: number): number => { const id = win.setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); return id; };
  const cancel = (id: number | null): void => { if (id !== null) { win.clearTimeout(id); timers.delete(id); } };
  const listen = <E extends Event>(t: EventTarget, type: string, fn: (e: E) => void, o?: AddEventListenerOptions): void => {
    t.addEventListener(type, fn as EventListener, o);
    offs.push(() => t.removeEventListener(type, fn as EventListener, o));
  };
  const coarse = (): boolean => win.matchMedia?.('(pointer: coarse)').matches === true;
  let destroyed = false;

  // ── the DOM ──
  const ui = el(doc, 'div', 'orz-lg', { 'data-orz-layout-gui': '' });
  const bar = el(doc, 'div', 'orz-lg-bar', { role: 'toolbar', 'aria-label': 'Slide layout' });
  const strip = el(doc, 'div', 'orz-lg-strip', { role: 'region', 'aria-label': 'Slides' });
  const stage = el(doc, 'div', 'orz-lg-stage', { role: 'group', 'aria-label': 'The slide' });
  const status = el(doc, 'div', 'orz-lg-status');
  const msg = el(doc, 'span', 'orz-lg-msg', { role: 'status', 'aria-live': 'polite' });
  const bubble = el(doc, 'div', 'orz-lg-bubble');
  bubble.hidden = true;
  /** During a drag: a layer over the whole pane holding the pointer (the frame never gets it; a redraw never loses it). */
  const catcher = el(doc, 'div', 'orz-lg-catch', { 'aria-hidden': 'true' });
  catcher.hidden = true;
  // the toolbar first: the tab order is the reading order (round B, GUI-12); the layers stack by position
  ui.append(bar, strip, stage, status, bubble, catcher);

  /**
   * Hold a pointer for a drag: the catcher captures it, so moves over the frame and redraws of the
   * element that started the drag lose nothing. Handlers get trusted events only; `end` runs once.
   */
  function hold(e: PointerEvent, cursor: string, h: { move(ev: PointerEvent): void; end(ev: PointerEvent, commit: boolean): void }): void {
    catcher.hidden = false;
    catcher.style.cursor = cursor;
    let done = false;
    const move = (ev: Event): void => { if ((ev as PointerEvent).pointerId === e.pointerId && ev.isTrusted) h.move(ev as PointerEvent); };
    const finish = (ev: Event, commit: boolean): void => {
      if (done || (ev as PointerEvent).pointerId !== e.pointerId) return;
      done = true;
      catcher.removeEventListener('pointermove', move);
      catcher.removeEventListener('pointerup', up);
      catcher.removeEventListener('pointercancel', cancelEv);
      catcher.removeEventListener('lostpointercapture', cancelEv);
      try { catcher.releasePointerCapture(e.pointerId); } catch { /* released */ }
      catcher.hidden = true;
      drag = null;
      h.end(ev as PointerEvent, commit && ev.isTrusted);
      if (redrawLater) { redrawLater = false; refresh(); }
    };
    const up = (ev: Event): void => finish(ev, true);
    const cancelEv = (ev: Event): void => finish(ev, false);
    catcher.addEventListener('pointermove', move);
    catcher.addEventListener('pointerup', up);
    catcher.addEventListener('pointercancel', cancelEv);
    try { catcher.setPointerCapture(e.pointerId); } catch { /* a pointer that is gone */ }
    catcher.addEventListener('lostpointercapture', cancelEv);
    drag = { cancel: () => finish({ pointerId: e.pointerId, isTrusted: false } as unknown as Event, false) };
  }
  /** A redraw asked for during a drag (or a run of keys): done when it ends. */
  let redrawLater = false;

  // the bar's groups
  const gSlide = el(doc, 'span', 'orz-lg-group');
  const stripBtn = btn('Slides', SVG.strip, { title: 'Show or hide the filmstrip', pressed: true, data: 'strip' });
  const nLabel = el(doc, 'span', 'orz-lg-n');
  gSlide.append(stripBtn, nLabel);
  const gPresets = el(doc, 'span', 'orz-lg-group', { role: 'radiogroup', 'aria-label': 'Layout' });
  const presetBtns = new Map<PresetChoice, HTMLButtonElement>();
  for (const p of PRESET_CHOICES) {
    const b = btn(PRESET_LABEL[p], '', { title: `Layout: ${PRESET_LABEL[p]} (${p})`, iconOnly: true, data: `preset-${p}`, role: 'radio' });
    b.append(mini(doc, presetTree(p)));
    presetBtns.set(p, b);
    gPresets.append(b);
  }
  const custom = el(doc, 'span', 'orz-lg-note');
  gPresets.append(custom);
  /** The fit of every box, in words, at rest (round B, GUI-1: a cut box is said in the toolbar too). */
  const fitNote = el(doc, 'span', 'orz-lg-note orz-lg-fit', { 'aria-live': 'polite' });
  const gBox = el(doc, 'span', 'orz-lg-group', { role: 'group' });
  const bCols = btn('Columns', SVG.col, { title: 'Split the box into two columns (C)', data: 'split-col' });
  const bRows = btn('Rows', SVG.row, { title: 'Split the box into two rows (R)', data: 'split-row' });
  const bRename = btn('Rename', SVG.rename, { title: 'Rename the box (F2)', iconOnly: true, data: 'rename' });
  const bSwap = btn('Swap text with…', SVG.swap, { title: 'Swap this box\'s text with another box (Alt+Arrows)', iconOnly: true, data: 'swap' });
  const bMove = btn('Move text to…', SVG.move, { title: 'Move this box\'s text to the end of another box', iconOnly: true, data: 'move' });
  const bDel = btn('Delete box', SVG.del, { title: 'Delete the box — its text goes to the neighbouring box (Delete)', iconOnly: true, data: 'delete-box', danger: true });
  const boxLabel = el(doc, 'span', 'orz-lg-note');
  gBox.append(boxLabel, bCols, bRows, bRename, bSwap, bMove, bDel);
  const gFloat = el(doc, 'span', 'orz-lg-group', { role: 'group' });
  const bAddFloat = btn('Add a float', SVG.float, { title: 'Add a float: a free box on top of the layout, placed where it covers no text and no other float', data: 'float-add', iconOnly: true });
  bAddFloat.append(doc.createTextNode('Float'));
  const bFwd = btn('Bring forward', SVG.up, { title: 'Bring the float forward (])', iconOnly: true, data: 'float-forward' });
  const bBack = btn('Send backward', SVG.down, { title: 'Send the float backward ([)', iconOnly: true, data: 'float-backward' });
  const bFDel = btn('Delete float', SVG.del, { title: 'Delete the float and its text (Delete)', iconOnly: true, data: 'float-delete', danger: true });
  gFloat.append(bAddFloat, bFwd, bBack, bFDel);
  const gTemplate = el(doc, 'span', 'orz-lg-group', { role: 'radiogroup', 'aria-label': 'Look' });
  const tplNote = el(doc, 'span', 'orz-lg-note');
  gTemplate.append(tplNote);
  const gSlideOpts = el(doc, 'span', 'orz-lg-group');
  const bOpts = btn('Slide options', '', { title: 'The slide\'s options: fit, background, transition, step by step', data: 'options' });
  const bNotes = btn('Notes', '', { title: 'Edit the speaker notes (adds them when the slide has none)', data: 'notes' });
  const bFooter = btn('Footer', '', { title: 'Edit the slide\'s footer (adds one when the slide has none)', data: 'footer' });
  gSlideOpts.append(bOpts, bNotes, bFooter);
  bar.append(gSlide, gPresets, gTemplate, gBox, gFloat, gSlideOpts, fitNote);

  // the filmstrip
  const stripHead = el(doc, 'div', 'orz-lg-strip-head');
  const sAdd = btn('Add slide', SVG.add, { title: 'Add a slide after this one', iconOnly: true, data: 'slide-add' });
  const sDup = btn('Duplicate slide', SVG.dup, { title: 'Duplicate this slide', iconOnly: true, data: 'slide-duplicate' });
  const sDel = btn('Delete slide', SVG.del, { title: 'Delete this slide', iconOnly: true, data: 'slide-delete', danger: true });
  const sHide = btn('Hide the filmstrip', SVG.strip, { title: 'Hide the filmstrip (the Slides button shows it again)', iconOnly: true, data: 'strip-hide' });
  stripHead.append(sAdd, sDup, sDel, sHide);
  const stripScroll = el(doc, 'div', 'orz-lg-strip-scroll', { role: 'listbox', 'aria-label': 'Slides — Up and Down go to a slide, Alt+Up and Alt+Down move it', tabindex: '0' });
  const stripInner = el(doc, 'div', 'orz-lg-strip-inner');
  stripScroll.append(stripInner);
  strip.append(stripHead, stripScroll);

  // the status line
  const bUndo = btn('Undo', '', { title: `Undo (${isMac(win) ? '⌘Z' : 'Ctrl+Z'})`, data: 'undo' });
  const bRedo = btn('Redo', '', { title: `Redo (${isMac(win) ? '⇧⌘Z' : 'Ctrl+Shift+Z'})`, data: 'redo' });
  const bKeys = btn('Keys', '', { title: 'The keyboard shortcuts (?)', data: 'keys' });
  status.append(msg, bUndo, bRedo, bKeys);

  function btn(label: string, icon: string, o: { title?: string; iconOnly?: boolean; pressed?: boolean; data?: string; danger?: boolean; role?: string } = {}): HTMLButtonElement {
    const b = el(doc, 'button', `orz-lg-btn${o.danger ? ' orz-lg-btn--danger' : ''}`, { type: 'button', 'aria-label': label });
    if (o.title) b.title = o.title;
    if (o.role) b.setAttribute('role', o.role);
    if (o.pressed !== undefined) b.setAttribute('aria-pressed', String(o.pressed));
    if (o.data) b.setAttribute('data-act', o.data);
    if (icon) b.insertAdjacentHTML('beforeend', icon);
    if (!o.iconOnly) b.append(doc.createTextNode(label));
    return b;
  }

  // ── state (all derived from the text, but the reader's selection and the preview of a drag) ──
  let sel: Sel = null;
  let stripOn = true;
  let stageRect: Rect & { scale: number } = { x: 0, y: 0, w: 0, h: 0, scale: 1 };
  let variantRects: Rect[] = [];
  let insets: StageInsets = { top: 0, right: 0, bottom: 0, left: 0 };
  let current: { text: string; deck: Deck; index: number; slide: Slide; map: SlideMap; blocked: string | null } | null = null;
  let geom: StageGeometry | null = null;
  /** The stage's boxes as drawn: the frame's rectangles, named from the text (in the text's order). */
  let regionRects: Array<Rect & { name: string; empty: boolean }> = [];
  /** Typed since the last redraw: the stage is stale until the typing pause (round B, B-ED-4). */
  let textDirty = false;
  let pop: HTMLElement | null = null;
  let drag: { cancel(): void } | null = null;
  /**
   * A run of keys not written yet (round B, OPS-2: bound to the slide and the text it started on — written
   * there, or not at all when the text changed under it; flushed before any navigation, undo or mode switch).
   */
  let pending: { key: string; slide: number; base: string; timer: number | null; commit(): void; cancel(): void } | null = null;
  let lastStatus = '';

  const say = (text: string, tone: 'ok' | 'warn' | 'info' = 'info'): void => {
    lastStatus = text;
    msg.textContent = text;
    msg.title = text;
    msg.setAttribute('data-tone', tone);
  };

  /* ── reading the text ── */
  function read(): void {
    const text = shell.getText();
    const s = host.slide();
    if (!s) { current = null; return; }
    const deck = parseDeck(text);
    const map = slideMap(text, s.index);
    if (!map) { current = null; return; }
    const b = blockingProblem(text, s.index);
    // another slide: a popover opened for the last one closes (its choices were that slide's)
    if (current && current.index !== s.index) closePop();
    current = { text, deck, index: s.index, slide: s.slide, map, blocked: b ? b.message : null };
    // the selection follows the text: a renamed or deleted box is no longer selected
    if (sel?.kind === 'box' && !(s.slide.kind === 'template' ? ['body'] : leaves(s.slide.layout)).includes(sel.name)) sel = null;
    if (sel?.kind === 'float' && sel.index >= s.slide.floats.length) sel = null;
  }

  /* ── ops ── */
  /**
   * Apply an op to a slide (default: the caret's) — ONE undo step, the changed lines flashed. `base`: the
   * text a drag or a run of keys started from; when the text is no longer that, nothing is written.
   * A refusal puts the stage back as the text says (a drag's preview goes: round B, OPS-5).
   */
  function run(op: LayoutOp, index?: number, base?: string): OpResult | null {
    flushPending();
    const text = shell.getText();
    const s = host.slide();
    const i = index ?? s?.index;
    const refused = (m: string, tone: 'warn' | 'info' = 'warn'): null => {
      say(m, tone);
      host.preview({ reset: true });
      if (!drag) later(() => { if (!drag && !pending) drawStage(); }, 0);
      return null;
    };
    if (i === undefined) return null;
    if (shell.isReadOnly()) return refused('The document is read-only.');
    if (base !== undefined && text !== base) return refused('The text changed meanwhile: that change was not written.');
    let r: OpResult;
    try {
      r = applyOp(text, i, op);
    } catch (e) {
      return refused(e instanceof LayoutOpError ? capital(e.message) : `Could not change the layout: ${String((e as Error)?.message ?? e)}`, e instanceof LayoutOpError && e.code === 'no-change' ? 'info' : 'warn');
    }
    let ok = false;
    try { ok = shell.applyEdits(r.edits, { label: r.label }); } catch (e) { return refused(`Could not change the text: ${String((e as Error)?.message ?? e)}`); }
    if (!ok) return refused('The document is read-only.');
    const after = shell.getText();
    try { (shell as unknown as { flash?(r: Array<{ from: number; to: number }>): void }).flash?.(r.changed.map((c) => ({ from: Math.min(c.from, after.length), to: Math.min(c.to, after.length) }))); } catch { /* an older kit */ }
    if (r.slide !== i || op.type.startsWith('slide-')) host.goTo(r.slide);
    if (r.select) shell.select(r.select.from, r.select.to, { scroll: true });
    // the caret stays on the op's slide (a deleted last block, an empty box at the next slide's marker: round B, B-ED-1)
    if (host.slide()?.index !== r.slide) host.goTo(r.slide);
    say(`${r.label} — ${op.type === 'slide-move' ? `${r.edits.reduce((n, e) => n + (e.insert.match(/\r\n|\r|\n/g)?.length ?? 0), 0)} lines moved` : diffSummary(text, r)}`, /no free place/.test(r.label) ? 'warn' : 'ok');
    host.syncNow();
    refresh();
    return r;
  }
  const capital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
  /** Go to a slide: what is pending is written first, a drag is cancelled (round B, OPS-2). */
  function go(i: number): void {
    flushPending();
    drag?.cancel();
    host.goTo(i);
  }

  function history(dir: 'undo' | 'redo'): void {
    // a drag in progress is cancelled first: its drop must not land on what the undo puts at its number (round B, OPS-7)
    drag?.cancel();
    flushPending();
    const before = shell.getText();
    const ok = dir === 'undo' ? shell.undo() : shell.redo();
    if (!ok) { say(dir === 'undo' ? 'Nothing to undo.' : 'Nothing to redo.'); return; }
    const after = shell.getText();
    const c = changedRange(before, after);
    if (c) {
      try { (shell as unknown as { flash?(r: Array<{ from: number; to: number }>): void }).flash?.([c]); } catch { /* an older kit */ }
      // keep the stage on the slide the change was on
      const d = parseDeck(after);
      const at = d.slides.findIndex((s, k) => c.from >= s.marker.from && c.from < (d.slides[k + 1]?.marker.from ?? Infinity));
      if (at >= 0 && at !== current?.index) host.goTo(at);
    }
    say(dir === 'undo' ? 'Undone.' : 'Redone.', 'ok');
    host.syncNow();
    refresh();
  }

  /* ── where things go ── */
  function placeStage(): void {
    pane = host.pane();
    const frame = host.frame();
    if (!pane || !frame) return;
    const pr = pane.getBoundingClientRect();
    const fr = frame.getBoundingClientRect();
    const size = host.slideSize();
    const tpl = current?.slide.kind === 'template' && current.slide.template ? TEMPLATES[current.slide.template] : 0;
    const L = stageLayout(fr.width, fr.height, insets, size.width, size.height, tpl);
    const ox = fr.left - pr.left;
    const oy = fr.top - pr.top;
    stageRect = { x: L.port.x + ox, y: L.port.y + oy, w: L.port.w, h: L.port.h, scale: L.port.scale };
    variantRects = L.variants.map((r) => ({ x: r.x + ox, y: r.y + oy, w: r.w, h: r.h }));
    Object.assign(stage.style, { left: `${stageRect.x}px`, top: `${stageRect.y}px`, width: `${stageRect.w}px`, height: `${stageRect.h}px` });
  }

  /** Where the filmstrip is: beside the slide ('y', a column) or under it ('x', a row). */
  let stripAxis: 'x' | 'y' = 'y';
  strip.setAttribute('data-axis', stripAxis);
  const stripH = (): number => (coarse() ? STRIP_H_COARSE : STRIP_H);
  function measureInsets(): void {
    const frame = host.frame();
    pane = host.pane();
    if (!frame || !pane) return;
    // a pane too low for a slide and a filmstrip: the filmstrip goes (the Slides button brings it back)
    if (pane.clientHeight < 360 && stripOn && !userStrip) setStrip(false, false);
    const top = bar.offsetHeight;
    const bottom = status.offsetHeight;
    // the filmstrip beside the slide or under it, whichever leaves the slide larger (round B, GUI-4: a width-bound
    // slide in a tall pane gained a quarter of its size under it); a 2 % margin keeps it from flapping
    if (stripOn) {
      const fr = frame.getBoundingClientRect();
      const size = host.slideSize();
      const nv = current?.slide.kind === 'template' && current.slide.template ? TEMPLATES[current.slide.template] : 0;
      const beside = stageLayout(fr.width, fr.height, { top, right: 0, bottom, left: STRIP_W }, size.width, size.height, nv).port.scale;
      const under = stageLayout(fr.width, fr.height, { top, right: 0, bottom: bottom + stripH(), left: 0 }, size.width, size.height, nv).port.scale;
      const axis = under > beside * 1.02 ? 'x' : beside > under * 1.02 ? 'y' : stripAxis;
      if (axis !== stripAxis) { stripAxis = axis; strip.setAttribute('data-axis', axis); stripDrawn = ''; }
    }
    if (stripAxis === 'y') Object.assign(strip.style, { top: `${top}px`, bottom: `${bottom}px`, height: '', width: `${STRIP_W}px` });
    else Object.assign(strip.style, { top: '', bottom: `${bottom}px`, height: `${stripH()}px`, width: '' });
    const next = stripOn ? (stripAxis === 'y' ? { top, right: 0, bottom, left: strip.offsetWidth } : { top, right: 0, bottom: bottom + strip.offsetHeight, left: 0 }) : { top, right: 0, bottom, left: 0 };
    const tpl = current?.slide.kind === 'template';
    if (JSON.stringify(next) !== JSON.stringify(insets) || tpl !== lastTpl) {
      insets = next;
      lastTpl = tpl;
      host.setStage({ insets, variants: tpl === true });
    }
    placeStage();
  }
  let lastTpl: boolean | undefined;
  let userStrip = false;
  function setStrip(on: boolean, byUser = true): void {
    stripOn = on;
    if (byUser) userStrip = true;
    strip.hidden = !on;
    stripBtn.setAttribute('aria-pressed', String(on));
    measureInsets();
    drawStage();
    if (on) drawStrip(true);
    if (!on && byUser) say('The filmstrip is hidden: the Slides button shows it again.');
  }

  /** A rectangle of the slide (logical px) in the stage's px. */
  const toStage = (r: Rect): Rect => ({ x: r.x * stageRect.scale, y: r.y * stageRect.scale, w: r.w * stageRect.scale, h: r.h * stageRect.scale });
  const place = (e: HTMLElement, r: Rect): void => { Object.assign(e.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` }); };

  /* ── the bar ── */
  function drawBar(): void {
    const c = current;
    const total = c?.deck.slides.length ?? 0;
    nLabel.textContent = c ? `Slide ${c.index + 1} of ${total}` : 'No slide';
    const tpl = c?.slide.kind === 'template';
    const blocked = c?.blocked ?? null;
    const p = c && !tpl ? presetOf(c.slide.layout) : null;
    for (const [k, b] of presetBtns) {
      b.setAttribute('aria-checked', String(p === k));
      b.disabled = !c || tpl || !!blocked;
      b.title = tpl ? `A ${TEMPLATE_LABEL[c!.slide.template!] ?? 'template'} has its own layout: choose its look instead` : blocked ? `Fix this first: ${blocked}` : `Layout: ${PRESET_LABEL[k]} (${k})`;
    }
    custom.textContent = c && !tpl && !p ? `custom: ${c.slide.layoutSpec || 'body'}` : '';
    custom.title = custom.textContent;
    gPresets.hidden = !!tpl;
    // a template: its looks
    gTemplate.hidden = !tpl;
    gTemplate.querySelectorAll('.orz-lg-btn').forEach((b) => b.remove());
    if (c && tpl && c.slide.template) {
      const n = TEMPLATES[c.slide.template];
      const v = c.slide.templateVariant ?? 1;
      tplNote.textContent = `${TEMPLATE_LABEL[c.slide.template] ?? c.slide.template}: its own layout — choose its look`;
      for (let k = 1; k <= n; k++) {
        const b = btn(`Look ${k}`, '', { title: `Look ${k} (v=${k})`, data: `variant-${k}`, role: 'radio' });
        b.textContent = String(k);
        b.setAttribute('aria-checked', String(k === v));
        b.addEventListener('click', (e) => { if (e.isTrusted) run({ type: 'variant', v: k }); });
        gTemplate.append(b);
      }
    }
    // the selection's actions
    const box = sel?.kind === 'box' ? sel.name : null;
    const fl = sel?.kind === 'float' ? sel.index : null;
    const names = c ? (tpl ? [] : leaves(c.slide.layout)) : [];
    gBox.hidden = !box || !!tpl;
    boxLabel.textContent = box ? `Box ${box}` : '';
    for (const b of [bCols, bRows, bRename, bSwap, bMove, bDel]) b.disabled = !!blocked || !box;
    bDel.disabled = bDel.disabled || names.length < 2;
    bSwap.disabled = bSwap.disabled || names.length < 2;
    bMove.disabled = bMove.disabled || names.length < 2;
    bAddFloat.disabled = !c || !!blocked;
    for (const b of [bFwd, bBack, bFDel]) { b.hidden = fl === null; b.disabled = !!blocked; }
    for (const b of [bOpts, bNotes, bFooter]) b.disabled = !c || !!blocked;
    bNotes.setAttribute('aria-label', c?.slide.notes !== undefined ? 'Speaker notes' : 'Add speaker notes');
    bFooter.setAttribute('aria-label', c?.slide.footer !== undefined ? 'Slide footer' : 'Add a slide footer');
    // read-only (a quiet update running): nothing on the stage or the toolbar changes the text (round B, OPS-5)
    const ro = shell.isReadOnly();
    ui.classList.toggle('is-readonly', ro);
    if (ro) for (const b of Array.from(bar.querySelectorAll<HTMLButtonElement>('button:not([data-act="strip"])'))) b.disabled = true;
    ui.setAttribute('data-scheme', host.scheme?.() === 'dark' ? 'dark' : 'light');
    if (blocked) say(`This slide's layout cannot change until its text is fixed: ${blocked}`, 'warn');
  }

  /* ── the stage overlay ── */
  function drawStage(): void {
    const active = (root as unknown as Document).activeElement as HTMLElement | null;
    const had = active && stage.contains(active) ? active.getAttribute('data-key') : null;
    const focusTo = wantFocus ?? had;
    stage.replaceChildren();
    const c = current;
    geom = host.geometry();
    if (!c || !geom || geom.index !== c.index || !geom.parts) { stage.classList.add('is-stale'); return; }
    stage.classList.toggle('is-stale', !geom.current || textDirty);
    const parts = geom.parts;
    const tpl = c.slide.kind === 'template';
    // the boxes are named from the TEXT, the frame's rectangles taken in document order (round B, ISO-B1: a name the
    // frame reports is never an op's input); a report that does not match the text's boxes draws a stale stage
    const names = tpl ? [] : leaves(c.slide.layout);
    if (!tpl && parts.regions.length !== names.length) { stage.classList.add('is-stale'); regionRects = []; return; }
    regionRects = parts.regions.map((r, k) => ({ ...r, name: names[k] }));
    const regionFits = geom.boxes.filter((b) => b.kind === 'region');
    const fitOf = (kind: string, name: string, k = 0): { scale: number; clipped: boolean } | null => {
      const b = kind === 'region' ? (regionFits.length === names.length ? regionFits[names.indexOf(name)] : undefined) : geom!.boxes.filter((x) => x.kind === kind)[kind === 'float' ? k : 0];
      return b ? { scale: b.scale, clipped: b.clipped } : null;
    };
    const fitWord = (f: { scale: number; clipped: boolean }): 'cut' | 'shrunk' | 'fits' => (f.clipped ? 'cut' : f.scale < 0.995 ? 'shrunk' : 'fits');
    const notFit: Array<{ name: string; f: { scale: number; clipped: boolean } }> = [];
    const badge = (f: { scale: number; clipped: boolean } | null): HTMLElement | null => {
      if (!f) return null;
      const b = el(doc, 'span', 'orz-lg-badge', { 'data-fit': f.clipped ? 'cut' : f.scale < 0.995 ? 'shrunk' : 'fits', 'aria-hidden': 'true' });
      b.textContent = f.clipped ? 'cut' : f.scale < 0.995 ? `shrunk to ${Math.round(f.scale * 100)}%` : 'fits';
      return b;
    };
    const fitWords = (f: { scale: number; clipped: boolean } | null): string => (!f ? '' : f.clipped ? ', its text is cut even at the smallest size' : f.scale < 0.995 ? `, shrunk to ${Math.round(f.scale * 100)}%` : ', fits');
    const cursor = partAt(c.map, (shell as unknown as { getSelection?(): { from: number } | null }).getSelection?.()?.from ?? -1);
    const addBox = (kind: 'region' | 'title' | 'footer' | 'template', name: string, r: Rect, label: string, f: { scale: number; clipped: boolean } | null, empty: boolean): HTMLElement => {
      const b = el(doc, 'div', `orz-lg-box orz-lg-box--${kind}`, { tabindex: '0', role: 'button', 'data-key': `${kind}:${name}`, 'data-box': name, 'data-kind': kind });
      if (f) { b.setAttribute('data-fit', fitWord(f)); if (fitWord(f) !== 'fits' && kind !== 'footer') notFit.push({ name: kind === 'title' ? 'title' : kind === 'template' ? 'the page' : name, f }); }
      place(b, toStage(r));
      const tag = el(doc, 'span', 'orz-lg-tag', { 'aria-hidden': 'true' });
      tag.textContent = label;
      b.append(tag);
      const bd = badge(f);
      if (bd) b.append(bd);
      if (empty && kind !== 'footer') {
        const h = el(doc, 'span', 'orz-lg-empty', { 'aria-hidden': 'true' });
        h.textContent = 'empty — double-click to write';
        b.append(h);
      }
      const sr = kind === 'title' ? 'The slide title' : kind === 'footer' ? 'The footer' : `Box ${name}`;
      b.setAttribute('aria-label', `${sr}${empty ? ', empty' : ''}${fitWords(f)}. Enter edits its text${kind === 'region' ? '; C or R splits it, F2 renames, Delete deletes it' : ''}.`);
      if ((kind === 'region' || kind === 'template') && sel?.kind === 'box' && sel.name === name) b.classList.add('is-selected');
      if (kind === 'title' && sel?.kind === 'title') b.classList.add('is-selected');
      if (cursor && 'box' in cursor && cursor.box === name && (kind === 'region' || kind === 'template')) b.classList.add('is-cursor');
      stage.append(b);
      return b;
    };
    if (parts.title && c.slide.title !== undefined) addBox('title', 'title', parts.title, 'title', fitOf('title', 'title'), false);
    if (tpl) {
      if (parts.template) {
        const m = c.map.boxes[0];
        addBox('template', 'body', parts.template, `${c.slide.template ?? 'template'}${c.slide.templateVariant ? ` · look ${c.slide.templateVariant}` : ''}`, fitOf('template', 'template'), !!m?.empty);
      }
    } else {
      for (const r of regionRects) {
        const m = c.map.boxes.find((x) => x.name === r.name);
        addBox('region', r.name, r, r.name, fitOf('region', r.name), m ? m.empty : r.empty);
      }
      drawDividers(parts);
    }
    if (parts.footer && (c.slide.footer !== undefined || readHeader(c.text)?.fields['footer'])) {
      const b = addBox('footer', 'footer', parts.footer, c.slide.footer !== undefined ? 'slide footer' : 'deck footer', null, false);
      b.style.minHeight = '10px';
    }
    // floats (in order; the frame's rectangles place them)
    parts.floats.forEach((r, k) => {
      const f = el(doc, 'div', 'orz-lg-float', { tabindex: '0', role: 'button', 'data-key': `float:${k}`, 'data-float': String(k) });
      place(f, toStage(r));
      const m = c.map.floats[k];
      const tag = el(doc, 'span', 'orz-lg-tag', { 'aria-hidden': 'true' });
      tag.textContent = `float ${k + 1}${m?.z !== undefined ? ` · z ${m.z}` : ''}`;
      f.append(tag);
      const ff = fitOf('float', 'float', k);
      const bd = badge(ff);
      if (bd) f.append(bd);
      if (ff && fitWord(ff) !== 'fits') notFit.push({ name: `float ${k + 1}`, f: ff });
      for (const h of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) f.append(el(doc, 'span', 'orz-lg-h', { 'data-h': h, 'aria-hidden': 'true' }));
      if (m?.empty) { const e = el(doc, 'span', 'orz-lg-empty', { 'aria-hidden': 'true' }); e.textContent = 'empty float — double-click to write'; f.append(e); }
      f.setAttribute('aria-label', `Float ${k + 1} of ${parts.floats.length}${m ? `, at ${Math.round(m.box.left)} %, ${Math.round(m.box.top)} %, ${Math.round(m.box.w)} by ${Math.round(m.box.h)} %` : ''}${m?.empty ? ', empty' : ''}. Arrows move it, Alt+Arrows resize, ] and [ bring it forward or send it back, Delete deletes it, Enter edits its text.`);
      if (sel?.kind === 'float' && sel.index === k) f.classList.add('is-selected');
      if (cursor && 'float' in cursor && cursor.float === k) f.classList.add('is-cursor');
      stage.append(f);
    });
    // a template's looks: buttons over the thumbnails the frame draws
    if (tpl && c.slide.template) {
      const v = c.slide.templateVariant ?? 1;
      const group = el(doc, 'div', '', { role: 'radiogroup', 'aria-label': 'Looks' });
      variantRects.forEach((r, k) => {
        const b = el(doc, 'button', 'orz-lg-variant', { type: 'button', role: 'radio', 'aria-checked': String(k + 1 === v), 'aria-label': `Look ${k + 1}`, 'data-key': `variant:${k + 1}`, 'data-variant': String(k + 1) });
        place(b, { x: r.x - stageRect.x, y: r.y - stageRect.y, w: r.w, h: r.h });
        const lab = el(doc, 'span');
        lab.textContent = `look ${k + 1}`;
        b.append(lab);
        group.append(b);
      });
      stage.append(group);
    }
    fitNote.textContent = notFit.length ? `Fit: ${notFit.map((x) => `${x.name} ${x.f.clipped ? 'cut' : `shrunk to ${Math.round(x.f.scale * 100)}%`}`).join(' · ')}` : '';
    fitNote.setAttribute('data-fit', notFit.some((x) => x.f.clipped) ? 'cut' : notFit.length ? 'shrunk' : 'fits');
    fitNote.hidden = notFit.length === 0;
    placeLabels();
    if (focusTo) {
      const t = stage.querySelector(`[data-key="${esc(focusTo)}"]`) as HTMLElement | null;
      if (t) { t.focus({ preventScroll: true }); if (focusTo === wantFocus) wantFocus = null; }
    }
  }

  /**
   * The labels (name tags, fit badges) at rest (round B, GUI-1): each takes the first place that lies on no
   * text or picture of the slide (the frame's ink) and on no other label — above its box (as before), inside
   * its top corners, under it, inside its bottom corners; a label with no such place is tucked away until its
   * box is hovered, focused or selected — but a "cut" badge is never tucked (it then sits inside the box's
   * bottom right corner, over the text that is cut anyway).
   */
  function placeLabels(): void {
    const sr = stage.getBoundingClientRect();
    const k = stageRect.scale;
    type Q = { l: number; t: number; r: number; b: number };
    const ink: Q[] = (geom?.parts?.ink ?? []).map((x) => ({ l: sr.left + x.x * k, t: sr.top + x.y * k, r: sr.left + (x.x + x.w) * k, b: sr.top + (x.y + x.h) * k }));
    const over = (a: Q, b: Q, m: number): boolean => Math.min(a.r, b.r) - Math.max(a.l, b.l) > m && Math.min(a.b, b.b) - Math.max(a.t, b.t) > m;
    const area: Q = { l: sr.left - STAGE_PAD + 1, t: sr.top - STAGE_PAD + 1, r: sr.right + STAGE_PAD - 1, b: sr.bottom + STAGE_PAD - 1 };
    const inside = (q: Q): boolean => q.l >= area.l && q.t >= area.t && q.r <= area.r && q.b <= area.b;
    const placed: Q[] = [];
    for (const box of Array.from(stage.querySelectorAll<HTMLElement>('.orz-lg-box, .orz-lg-float'))) {
      const br = box.getBoundingClientRect();
      for (const lab of Array.from(box.querySelectorAll<HTMLElement>(':scope > .orz-lg-tag, :scope > .orz-lg-badge'))) {
        lab.classList.remove('is-tucked');
        lab.removeAttribute('data-at');
        Object.assign(lab.style, { top: '', left: '', right: '', bottom: '' });
        const w = lab.offsetWidth;
        const h = lab.offsetHeight;
        const badge = lab.classList.contains('orz-lg-badge');
        const cut = lab.getAttribute('data-fit') === 'cut';
        const xl = br.left + 6;
        const xr = br.right - 6 - w;
        const xs = badge ? [xr, xl] : [xl, xr];
        const ys: Array<[string, number]> = [['above', br.top - h - 1], ['top', br.top + 2], ['below', br.bottom + 1], ['bottom', br.bottom - h - 2]];
        const cands: Array<{ at: string; q: Q }> = [];
        for (const [at, y] of ys) for (const x of xs) cands.push({ at: `${at}-${x === xl ? 'left' : 'right'}`, q: { l: x, t: y, r: x + w, b: y + h } });
        let pick = cands.find((c) => inside(c.q) && !ink.some((i) => over(c.q, i, 1)) && !placed.some((p) => over(c.q, p, 0.5)));
        if (!pick && cut) pick = cands.find((c) => c.at === 'bottom-right') ?? cands[0];
        if (!pick) { lab.classList.add('is-tucked'); continue; }
        lab.setAttribute('data-at', pick.at);
        Object.assign(lab.style, { top: `${pick.q.t - br.top}px`, left: `${pick.q.l - br.left}px`, right: 'auto', bottom: 'auto' });
        placed.push(pick.q);
      }
    }
  }

  /** The dividers: one between each two children of each split (the frame's rectangles, matched to the tree's splits). */
  function drawDividers(parts: NonNullable<StageGeometry['parts']>): void {
    const c = current!;
    const splits = splitsOf(c.slide.layout);
    if (splits.length !== parts.splits.length || splits.some((s, k) => s.node.dir !== parts.splits[k].dir || s.node.children.length !== parts.splits[k].kids.length)) return;
    const hit = coarse() ? 26 : 10;
    splits.forEach((s, k) => {
      const r = parts.splits[k];
      for (let i = 0; i < s.node.children.length - 1; i++) {
        const a = r.kids[i];
        const b = r.kids[i + 1];
        const d = el(doc, 'div', 'orz-lg-div', { tabindex: '0', role: 'separator', 'data-key': `div:${s.path.join('.')}:${i}`, 'data-split': String(k), 'data-i': String(i) });
        const vertical = s.node.dir === 'col';
        d.setAttribute('aria-orientation', vertical ? 'vertical' : 'horizontal');
        const ratio = pairRatio(s.node.tracks, i);
        const A = leaves(s.node.children[i]).join(', ');
        const B = leaves(s.node.children[i + 1]).join(', ');
        const share = ratio ? Math.round((100 * ratio[0]) / (ratio[0] + ratio[1])) : 50;
        d.setAttribute('aria-valuemin', '0');
        d.setAttribute('aria-valuemax', '100');
        d.setAttribute('aria-valuenow', String(share));
        d.setAttribute('aria-valuetext', ratio ? `${ratio[0]} to ${ratio[1]}` : `${s.node.tracks[i]} and ${s.node.tracks[i + 1]}`);
        d.setAttribute('aria-label', `Divider between ${A} and ${B}: ${ratio ? `${ratio[0]} to ${ratio[1]}` : `${s.node.tracks[i]} / ${s.node.tracks[i + 1]}`}. Arrow keys step through simple ratios; drag to resize.`);
        d.title = `${s.node.tracks.join(' / ')} — drag, or arrow keys`;
        const pos = vertical ? (a.x + a.w + b.x) / 2 : (a.y + a.h + b.y) / 2;
        const R = toStage(r);
        const p = pos * stageRect.scale;
        place(d, vertical ? { x: p - hit / 2, y: R.y, w: hit, h: R.h } : { x: R.x, y: p - hit / 2, w: R.w, h: hit });
        stage.append(d);
      }
    });
  }

  /* ── the filmstrip (virtualised; a column beside the slide or a row under it) ── */
  const rowH = (): number => (coarse() ? ROW_COARSE : ROW);
  /** An item's size along the filmstrip. */
  const stepOf = (): number => (stripAxis === 'x' ? (coarse() ? ITEM_W_COARSE : ITEM_W) : rowH());
  const scrollPos = (): number => (stripAxis === 'x' ? stripScroll.scrollLeft : stripScroll.scrollTop);
  const setScrollPos = (v: number): void => { if (stripAxis === 'x') stripScroll.scrollLeft = v; else stripScroll.scrollTop = v; };
  const viewLen = (): number => (stripAxis === 'x' ? stripScroll.clientWidth : stripScroll.clientHeight);
  let stripDrawn = '';
  function drawStrip(force = false): void {
    if (!stripOn) return;
    const c = current;
    const n = c?.deck.slides.length ?? 0;
    const h = stepOf();
    if (stripAxis === 'x') { stripInner.style.width = `${n * h + 8}px`; stripInner.style.height = ''; } else { stripInner.style.height = `${n * h + 8}px`; stripInner.style.width = ''; }
    const top = scrollPos();
    const view = viewLen() || 400;
    const first = Math.max(0, Math.floor(top / h) - 3);
    const last = Math.min(n - 1, Math.ceil((top + view) / h) + 3);
    const key = `${stripAxis}|${c?.text.length}|${c?.text === undefined ? '' : hashText(c.text)}|${c?.index}|${first}|${last}|${h}`;
    if (!force && key === stripDrawn) return;
    stripDrawn = key;
    const keep = stripInner.querySelector('.orz-lg-drop, .orz-lg-ghost');
    stripInner.replaceChildren();
    if (keep) stripInner.append(keep);
    if (!c) return;
    for (let i = first; i <= last; i++) stripInner.append(stripItem(c.deck, i, h, i === c.index));
    stripScroll.setAttribute('aria-activedescendant', `orz-lg-slide-${c.index}`);
  }
  /** Cheap identity of a text for the strip's redraw check (length + a sample hash). */
  function hashText(t: string): number {
    let x = 0;
    const step = Math.max(1, Math.floor(t.length / 4096));
    for (let i = 0; i < t.length; i += step) x = (Math.imul(x, 31) + t.charCodeAt(i)) | 0;
    return x;
  }
  function stripItem(deck: Deck, i: number, h: number, selected: boolean): HTMLElement {
    const s = deck.slides[i];
    const it = el(doc, 'div', 'orz-lg-item', { role: 'option', id: `orz-lg-slide-${i}`, 'aria-selected': String(selected), 'data-slide': String(i) });
    if (stripAxis === 'x') Object.assign(it.style, { left: `${4 + i * h}px`, right: 'auto', top: '4px', bottom: '4px', width: `${h - 6}px`, height: '' });
    else Object.assign(it.style, { top: `${4 + i * h}px`, height: `${h - 6}px` });
    const num = el(doc, 'span', 'orz-lg-item-n');
    num.textContent = String(i + 1);
    const thumb = el(doc, 'span', 'orz-lg-item-thumb');
    const kind = el(doc, 'span', 'orz-lg-item-kind');
    if (s.kind === 'template') {
      // a schematic of its kind: a title page, a section page, an outline, a closing page look apart (round B, GUI-10)
      const m = el(doc, 'span', 'orz-lg-mini', { 'aria-hidden': 'true', 'data-template': s.template ?? '' });
      const t = el(doc, 'span', `orz-lg-tpl orz-lg-tpl--${s.template ?? 'title'}`);
      const parts = { title: 2, section: 2, outline: 4, closing: 2 }[s.template ?? 'title'] ?? 1;
      for (let k = 0; k < parts; k++) t.append(doc.createElement('i'));
      m.append(t);
      thumb.append(m);
      kind.textContent = `${TEMPLATE_LABEL[s.template ?? ''] ?? 'template'}${s.templateVariant ? ` ${s.templateVariant}` : ''}`;
    } else {
      thumb.append(mini(doc, s.layout));
      kind.textContent = [s.floats.length ? `${s.floats.length} float${s.floats.length > 1 ? 's' : ''}` : '', s.notes !== undefined ? 'notes' : ''].filter((x) => x).join(' · ');
    }
    const f = host.fitOf(i);
    if (f) {
      const dot = el(doc, 'span', 'orz-lg-dot', { 'data-fit': f.clipped ? 'cut' : f.scale < 0.995 ? 'shrunk' : 'fits', title: f.clipped ? 'cut on paper' : f.scale < 0.995 ? `shrunk to ${Math.round(f.scale * 100)}%` : 'fits' });
      thumb.append(dot);
    }
    const grip = el(doc, 'span', 'orz-lg-item-grip', { 'aria-hidden': 'true', title: 'Drag to move the slide' });
    grip.innerHTML = SVG.grip;
    const t = el(doc, 'span', 'orz-lg-item-t');
    const title = s.title ?? (s.kind === 'template' ? firstLine(s.regions[0]?.markdown ?? '') : firstLine(s.regions[0]?.markdown ?? '')) ?? '';
    t.textContent = plain(title) || '(no title)';
    // the kind on the second line, whole, before the title (round B, GUI-10: it was cut to "Ti…")
    const line = el(doc, 'span', 'orz-lg-item-line');
    line.append(kind, t);
    it.setAttribute('aria-label', `Slide ${i + 1}: ${t.textContent}${kind.textContent ? ` (${kind.textContent})` : ''}`);
    it.append(num, thumb, grip, line);
    return it;
  }
  const firstLine = (md: string): string => md.split('\n').find((l) => l.trim() !== '') ?? '';
  const plain = (s: string): string => s.replace(/^#+\s*/, '').replace(/[*_`~[\]]/g, '').replace(/\]\([^)]*\)/g, '').trim().slice(0, 120);

  /** Bring a slide's item into view. */
  function revealRow(i: number): void {
    const h = stepOf();
    const top = i * h;
    if (top < scrollPos()) setScrollPos(top);
    else if (top + h > scrollPos() + viewLen()) setScrollPos(top + h - viewLen());
  }

  /* ── refresh ── */
  function refresh(): void {
    if (destroyed) return;
    if (!ui.isConnected) {
      pane = host.pane();
      if (!pane) return;
      pane.append(ui);
    }
    if (drag) { redrawLater = true; return; }
    // the text changed under a run of keys (typing, an undo from the editor): the run is dropped, never written elsewhere
    if (pending && shell.getText() !== pending.base) cancelPending('The text changed: the size or place being set was not written.');
    textDirty = false;
    read();
    drawBar();
    measureInsets();
    if (pending) { redrawLater = true; return; }
    drawStage();
    drawStrip();
    if (current) revealRowIfMoved(current.index);
  }
  let lastRow = -1;
  function revealRowIfMoved(i: number): void { if (i !== lastRow) { lastRow = i; revealRow(i); drawStrip(true); } }

  /* ── selecting ── */
  function selectBox(name: string, focusEditor = false): void {
    sel = { kind: 'box', name };
    const c = current;
    const m = c?.map.boxes.find((b) => b.name === name);
    if (m?.range) shell.select(m.range.from, m.range.to, { scroll: true });
    else if (m && !m.range && c) say(`${name} is empty and has no place in the text yet — double-click it (or press Enter) to give it one.`);
    if (focusEditor) {
      // the editor gets the focus only where the op put the caret (round B, OPS-1: typing landed in the title)
      if (m && !m.range) { const r = run({ type: 'ensure-region', name }); if (!r?.select) return; }
      shell.focus();
    }
    drawBar();
    markSelection();
  }
  function selectTemplateBody(focusEditor = false): void {
    sel = { kind: 'box', name: 'body' };
    const m = current?.map.boxes[0];
    if (m?.range) shell.select(m.range.from, m.range.to, { scroll: true });
    else if (focusEditor && !run({ type: 'ensure-region', name: 'body' })?.select) return;
    if (focusEditor) shell.focus();
    drawBar();
    markSelection();
  }
  function selectFloat(k: number, focusEditor = false): void {
    sel = { kind: 'float', index: k };
    const f = current?.map.floats[k];
    if (f) shell.select(f.range.from, f.range.to, { scroll: true });
    if (focusEditor) shell.focus();
    drawBar();
    markSelection();
  }
  function selectTitle(focusEditor = false): void {
    sel = { kind: 'title' };
    const t = current?.map.title;
    if (t) shell.select(t.from + (/^\s*##\s*/.exec(current!.text.slice(t.from, t.to))?.[0].length ?? 0), t.to, { scroll: true });
    if (focusEditor) shell.focus();
    drawBar();
    markSelection();
  }
  function selectFooter(focusEditor = false): void {
    const c = current;
    if (!c) return;
    if (c.map.footer) { shell.select(c.map.footer.from, c.map.footer.to, { scroll: true }); if (focusEditor) shell.focus(); return; }
    // the deck footer: its header line
    const h = readHeader(c.text);
    const m = h ? /^footer:[ \t]*(.*)$/m.exec(c.text.slice(0, h.end)) : null;
    if (m) { const at = m.index + m[0].length - m[1].length; shell.select(at, at + m[1].length, { scroll: true }); if (focusEditor) shell.focus(); say('The deck footer is in the header (every slide shows it); the Footer button gives this slide its own.'); }
  }
  function markSelection(): void {
    stage.querySelectorAll('.is-selected').forEach((e) => e.classList.remove('is-selected'));
    if (sel?.kind === 'box') stage.querySelector(`.orz-lg-box[data-box="${esc(sel.name)}"]:not(.orz-lg-box--title):not(.orz-lg-box--footer)`)?.classList.add('is-selected');
    if (sel?.kind === 'float') stage.querySelector(`.orz-lg-float[data-float="${sel.index}"]`)?.classList.add('is-selected');
    if (sel?.kind === 'title') stage.querySelector('.orz-lg-box--title')?.classList.add('is-selected');
  }
  /** Focus a stage element by key — now if it is there, else when the stage is drawn again (after an op's new report). */
  let wantFocus: string | null = null;
  function focusKey(key: string): void {
    wantFocus = key;
    const t = stage.querySelector(`[data-key="${esc(key)}"]`) as HTMLElement | null;
    if (t && !stage.classList.contains('is-stale')) { t.focus({ preventScroll: true }); }
    // forget a wish that never came true (the element is gone for good)
    later(() => { if (wantFocus === key) wantFocus = null; }, 3000);
  }

  /* ── popovers ── */
  function closePop(): void { pop?.remove(); pop = null; }
  function openPop(anchor: HTMLElement, build: (p: HTMLElement) => void, label: string): HTMLElement {
    closePop();
    const p = el(doc, 'div', 'orz-lg-pop', { role: 'dialog', 'aria-label': label });
    build(p);
    ui.append(p);
    const pr = (host.pane() ?? ui).getBoundingClientRect();
    const ar = anchor.getBoundingClientRect();
    const x = Math.max(4, Math.min(pr.width - p.offsetWidth - 4, ar.left - pr.left));
    const below = ar.bottom - pr.top + 6;
    const y = below + p.offsetHeight > pr.height - 4 ? Math.max(4, ar.top - pr.top - p.offsetHeight - 6) : below;
    Object.assign(p.style, { left: `${x}px`, top: `${y}px` });
    pop = p;
    (p.querySelector('input, select, button') as HTMLElement | null)?.focus();
    return p;
  }
  function renamePop(name: string, anchor: HTMLElement): void {
    openPop(anchor, (p) => {
      const h = el(doc, 'h3');
      h.textContent = `Rename ${name}`;
      const input = el(doc, 'input', '', { type: 'text', 'aria-label': `New name for ${name}`, spellcheck: 'false', autocomplete: 'off' });
      input.value = name;
      const err = el(doc, 'div', 'orz-lg-err', { role: 'alert' });
      const row = el(doc, 'div', 'orz-lg-row');
      const ok = btn('Rename', '', { data: 'rename-ok' });
      const no = btn('Cancel', '', { data: 'rename-cancel' });
      row.append(ok, no);
      const taken = current ? [...leaves(current.slide.layout), ...current.slide.regions.map((r) => r.name)].filter((x) => x !== name) : [];
      const check = (): string | null => { const v = input.value.trim(); const pr = v === name ? null : nameProblem(v, taken); err.textContent = pr ? capital(pr) : ''; return pr; };
      input.addEventListener('input', check);
      const commit = (e: Event): void => {
        if (!e.isTrusted) return;
        const v = input.value.trim();
        if (v === name) { closePop(); return; }
        if (check()) return;
        closePop();
        if (run({ type: 'rename', box: name, to: v })) { sel = { kind: 'box', name: v }; drawBar(); markSelection(); focusKey(`region:${v}`); }
      };
      ok.addEventListener('click', commit);
      no.addEventListener('click', () => { closePop(); focusKey(`region:${name}`); });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commit(e); } if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePop(); focusKey(`region:${name}`); } });
      p.append(h, input, err, row);
      later(() => input.select(), 0);
    }, `Rename ${name}`);
  }
  function boxMenu(kind: 'swap' | 'move', name: string, anchor: HTMLElement): void {
    openPop(anchor, (p) => {
      const h = el(doc, 'h3');
      h.textContent = kind === 'swap' ? `Swap the text of ${name} with` : `Move the text of ${name} to the end of`;
      const row = el(doc, 'div', 'orz-lg-row', { role: 'menu' });
      for (const n of leaves(current!.slide.layout).filter((x) => x !== name)) {
        const b = btn(n, '', { data: `${kind}-${n}` });
        b.setAttribute('role', 'menuitem');
        b.addEventListener('click', (e) => { if (!e.isTrusted) return; closePop(); if (run(kind === 'swap' ? { type: 'swap', a: name, b: n } : { type: 'move-content', from: name, to: n })) focusKey(`region:${n}`); });
        row.append(b);
      }
      p.append(h, row);
    }, kind === 'swap' ? 'Swap text' : 'Move text');
  }
  function optionsPop(anchor: HTMLElement): void {
    const c = current;
    if (!c) return;
    const o = c.slide.options;
    /** A row of choices (radio buttons the reader clicks; one op each). */
    const choices = (label: string, key: string, items: ReadonlyArray<readonly [string, string]>, now: string, apply: (v: string) => LayoutOp): HTMLElement => {
      const wrap = el(doc, 'div');
      const h = el(doc, 'div', 'orz-lg-note');
      h.textContent = label;
      const row = el(doc, 'div', 'orz-lg-row', { role: 'radiogroup', 'aria-label': label });
      for (const [v, t] of items) {
        const b = btn(t, '', { data: `opt-${key}-${v || 'default'}`, role: 'radio' });
        b.setAttribute('aria-checked', String(v === now));
        b.addEventListener('click', (e) => { if (e.isTrusted && v !== now && run(apply(v))) optionsPop(anchor); });
        row.append(b);
      }
      wrap.append(h, row);
      return wrap;
    };
    openPop(anchor, (p) => {
      const h = el(doc, 'h3');
      h.textContent = `Slide ${c.index + 1} options`;
      const fit = choices('When the text does not fit', 'fit', [['fit', 'Shrink to fit'], ['scroll', 'Scroll'], ['off', 'Leave (may be cut)']], o.fit ?? 'fit', (v) => ({ type: 'options', set: { fit: v as 'fit' | 'scroll' | 'off' } }));
      const tNow = o.transition && ['none', 'fade', 'slide', 'convex', 'concave', 'zoom'].includes(o.transition) ? o.transition : '';
      const tr = choices('Transition', 't', [['', "Deck's"], ['none', 'None'], ['fade', 'Fade'], ['slide', 'Slide'], ['convex', 'Convex'], ['concave', 'Concave'], ['zoom', 'Zoom']], tNow, (v) => ({ type: 'options', set: { transition: v || null } }));
      // background
      const bgWrap = el(doc, 'div');
      const bgH = el(doc, 'div', 'orz-lg-note');
      bgH.textContent = 'Background';
      const bgRow = el(doc, 'div', 'orz-lg-row');
      const bg = el(doc, 'input', '', { type: 'text', 'aria-label': 'Background: a colour, a gradient or an image path', placeholder: '#f4f1ea, a gradient, an image', 'data-opt': 'bg', spellcheck: 'false' });
      bg.value = o.bg ?? '';
      const set = btn('Set', '', { data: 'opt-bg-set' });
      const clear = btn('None', '', { data: 'opt-bg-none' });
      clear.disabled = o.bg === undefined;
      const err = el(doc, 'div', 'orz-lg-err', { role: 'alert' });
      const apply = (v: string | null): void => {
        if ((v || null) === (o.bg ?? null)) return;
        const before = lastStatus;
        if (run({ type: 'options', set: { bg: v || null } })) optionsPop(anchor);
        else err.textContent = lastStatus !== before ? lastStatus : 'Not a background';
      };
      bg.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.isTrusted) { e.preventDefault(); apply(bg.value.trim()); } });
      set.addEventListener('click', (e) => { if (e.isTrusted) apply(bg.value.trim()); });
      clear.addEventListener('click', (e) => { if (e.isTrusted) apply(null); });
      bgRow.append(bg, set, clear);
      bgWrap.append(bgH, bgRow, err);
      // step
      const stRow = el(doc, 'label');
      const st = el(doc, 'input', '', { type: 'checkbox', 'data-opt': 'step' });
      st.checked = o.step === true;
      st.addEventListener('click', (e) => { if (e.isTrusted && run({ type: 'options', set: { step: st.checked } })) optionsPop(anchor); });
      stRow.append(st, doc.createTextNode('Show its list items one by one (step)'));
      p.append(h, fit, tr, bgWrap, stRow);
    }, 'Slide options');
  }
  function keysPop(anchor: HTMLElement): void {
    openPop(anchor, (p) => {
      const h = el(doc, 'h3');
      h.textContent = 'Keys';
      const dl = el(doc, 'dl');
      for (const [k, v] of LAYOUT_KEYS) { const dt = el(doc, 'dt'); dt.textContent = k; const dd = el(doc, 'dd'); dd.textContent = v; dl.append(dt, dd); }
      const close = btn('Close', '', { data: 'keys-close' });
      close.addEventListener('click', () => { closePop(); bKeys.focus(); });
      p.append(h, dl, close);
    }, 'Keyboard shortcuts');
  }

  /* ── pending keyboard changes (one undo step for a run of keys) ── */
  function flushPending(): void { const p = pending; pending = null; p?.commit(); }
  function cancelPending(why?: string): void { const p = pending; pending = null; p?.cancel(); if (p && why) say(why, 'warn'); }
  /**
   * A run of keys on one element (`key`): each key extends the run (its preview shown) and restarts the
   * wait; the run is written once — when the keys pause, the focus leaves, another op starts or the reader
   * goes to another slide — to the slide it STARTED on, and only if the text is still the one it started
   * from (round B, OPS-2).
   */
  function pend(key: string, commit: (slide: number, base: string) => void, cancelFn: () => void): void {
    if (pending && pending.key !== key) flushPending();
    if (pending) cancel(pending.timer);
    const slide = pending?.slide ?? current?.index ?? -1;
    const base = pending?.base ?? shell.getText();
    const p: { key: string; slide: number; base: string; timer: number | null; commit(): void; cancel(): void } = {
      key,
      slide,
      base,
      timer: null,
      commit: () => { cancel(p.timer); commit(slide, base); if (redrawLater) { redrawLater = false; refresh(); } },
      cancel: () => { cancel(p.timer); cancelFn(); if (redrawLater) { redrawLater = false; refresh(); } },
    };
    pending = p;
    p.timer = later(() => { if (pending === p) { pending = null; p.commit(); } }, NUDGE_COMMIT_MS);
  }

  /* ── dividers: drag and keys ── */
  function dividerInfo(d: HTMLElement): { k: number; i: number; path: number[]; node: Extract<LayoutNode, { kind: 'split' }>; rect: NonNullable<StageGeometry['parts']>['splits'][number] } | null {
    const c = current;
    const parts = geom?.parts;
    if (!c || !parts) return null;
    const k = Number(d.getAttribute('data-split'));
    const i = Number(d.getAttribute('data-i'));
    const s = splitsOf(c.slide.layout)[k];
    const rect = parts.splits[k];
    if (!s || !rect) return null;
    return { k, i, path: s.path, node: s.node, rect };
  }
  const trackCss = (tracks: readonly string[]): string => tracks.map((t) => (/^\d+(\.\d+)?$/.test(t.trim()) ? `${t}fr` : t)).join(' ');
  /** The bubble's words for a divider's tracks: the pair's ratio, and the whole split when it has more tracks. */
  const ratioWords = (tracks: readonly string[], i: number): [string, string] => {
    const r = pairRatio(tracks, i);
    return [r ? `${r[0]} : ${r[1]}` : `${tracks[i]} / ${tracks[i + 1]}`, tracks.length > 2 ? tracks.join(' / ') : ''];
  };
  function showBubble(text: string, sub: string, x: number, y: number): void {
    bubble.replaceChildren(doc.createTextNode(text));
    if (sub) { const s = el(doc, 'small'); s.textContent = sub; bubble.append(s); }
    bubble.hidden = false;
    const pr = (host.pane() ?? ui).getBoundingClientRect();
    Object.assign(bubble.style, { left: `${x - pr.left}px`, top: `${y - pr.top}px` });
  }
  function dragDivider(d: HTMLElement, e: PointerEvent): void {
    const info = dividerInfo(d);
    if (!info || !current) return;
    if (shell.isReadOnly()) { say('The document is read-only.', 'warn'); return; }
    e.preventDefault();
    d.classList.add('is-dragging');
    d.focus({ preventScroll: true });
    // bound to this slide and this text: written there, or not at all (round B, OPS-2)
    const slide = current.index;
    const base = shell.getText();
    const vertical = info.node.dir === 'col';
    const a = info.rect.kids[info.i];
    const b = info.rect.kids[info.i + 1];
    const start = vertical ? a.x : a.y;
    const end = vertical ? b.x + b.w : b.y + b.h;
    const baseStyle = d.style[vertical ? 'left' : 'top'];
    let tracks: string[] | null = null;
    let raf = 0;
    let lastEv: PointerEvent | null = null;
    const stageBox = (): DOMRect => stage.getBoundingClientRect();
    const frame = (): void => {
      raf = 0;
      const ev = lastEv;
      if (!ev) return;
      const sr = stageBox();
      const p = ((vertical ? ev.clientX - sr.left : ev.clientY - sr.top) / stageRect.scale);
      const f = Math.min(0.95, Math.max(0.05, (p - start) / Math.max(1, end - start)));
      // two tracks: a simple ratio; three or more: the whole split in small whole numbers, the other dividers kept (round B, OPS-4)
      const next = snapTracks(info.node.tracks, info.i, f);
      const pr = pairRatio(next, info.i);
      const share = pr ? pr[0] / (pr[0] + pr[1]) : 0.5;
      const hit = parseFloat(d.style[vertical ? 'width' : 'height']) || 10;
      d.style[vertical ? 'left' : 'top'] = `${(start + share * (end - start)) * stageRect.scale - hit / 2}px`;
      const [w1, w2] = ratioWords(next, info.i);
      showBubble(w1, w2, ev.clientX, ev.clientY);
      if (!tracks || tracks.join('/') !== next.join('/')) host.preview({ splits: [{ index: info.k, dir: info.node.dir, css: trackCss(next) }] });
      tracks = next;
    };
    const move = (ev: PointerEvent): void => { lastEv = ev; if (!raf) raf = win.requestAnimationFrame(frame); };
    const end_ = (_ev: PointerEvent, commit: boolean): void => {
      if (raf) { win.cancelAnimationFrame(raf); frame(); }
      d.classList.remove('is-dragging');
      bubble.hidden = true;
      if (commit && tracks && tracks.join('/') !== info.node.tracks.join('/')) {
        if (run({ type: 'tracks', path: info.path, tracks }, slide, base)) focusKey(`div:${info.path.join('.')}:${info.i}`);
      } else {
        d.style[vertical ? 'left' : 'top'] = baseStyle;
        host.preview({ reset: true });
      }
    };
    stage.classList.add('is-dragging');
    hold(e, vertical ? 'col-resize' : 'row-resize', { move, end: (ev, c) => { stage.classList.remove('is-dragging'); end_(ev, c); } });
  }
  function keyDivider(d: HTMLElement, e: KeyboardEvent): boolean {
    const info = dividerInfo(d);
    if (!info) return false;
    const vertical = info.node.dir === 'col';
    const back = vertical ? 'ArrowLeft' : 'ArrowUp';
    const fwd = vertical ? 'ArrowRight' : 'ArrowDown';
    if (e.key === 'Enter') { flushPending(); return true; }
    if (e.key !== back && e.key !== fwd) return false;
    // from the pending tracks (a run of keys), else the text's
    const cur = (d as HTMLElement & { __tracks?: string[] }).__tracks ?? info.node.tracks;
    const tracks = stepTracks(cur, info.i, e.key === fwd ? 1 : -1);
    (d as HTMLElement & { __tracks?: string[] }).__tracks = tracks;
    host.preview({ splits: [{ index: info.k, dir: info.node.dir, css: trackCss(tracks) }] });
    const r = d.getBoundingClientRect();
    const [w1, w2] = ratioWords(tracks, info.i);
    showBubble(w1, w2, r.left + r.width / 2, r.top + r.height / 2);
    const pr = pairRatio(tracks, info.i);
    d.setAttribute('aria-valuetext', pr ? `${pr[0]} to ${pr[1]}` : tracks.join(' / '));
    if (pr) d.setAttribute('aria-valuenow', String(Math.round((100 * pr[0]) / (pr[0] + pr[1]))));
    const path = info.path;
    pend(`div:${path.join('.')}:${info.i}`, (slide, base) => {
      bubble.hidden = true;
      delete (d as HTMLElement & { __tracks?: string[] }).__tracks;
      if (tracks.join('/') !== info.node.tracks.join('/') && run({ type: 'tracks', path, tracks }, slide, base)) focusKey(`div:${path.join('.')}:${info.i}`);
    }, () => { bubble.hidden = true; delete (d as HTMLElement & { __tracks?: string[] }).__tracks; host.preview({ reset: true }); });
    return true;
  }

  /* ── floats: drag, handles, keys ── */
  /** A float's box as the stage draws it (the frame's rectangle, in % of the slide) — data, the seed of an em axis only. */
  function floatShown(k: number): FloatBox | null {
    const r = geom?.parts?.floats[k];
    const size = host.slideSize();
    return r && size.width > 0 && size.height > 0 ? { left: (r.x / size.width) * 100, top: (r.y / size.height) * 100, w: (r.w / size.width) * 100, h: (r.h / size.height) * 100 } : null;
  }
  /** Where a move or resize starts: the TEXT's values where they are in % or px, the stage's for the rest (round B, OPS-3). */
  function floatText(k: number): FloatBox | null {
    const f = current?.slide.floats[k];
    return f && current ? floatStart(f.geom, current.deck.config.ratio, floatShown(k)) : null;
  }
  /** On the slide, at least 1 % of a 1 % box; a move's steps are whole % (a float written in whole % stays so). */
  const clampBox = (b: FloatBox): FloatBox => {
    const w = Math.max(1, Math.min(100, b.w));
    const h = Math.max(1, Math.min(100, b.h));
    return { left: Math.max(-w + 4, Math.min(96, b.left)), top: Math.max(-h + 4, Math.min(96, b.top)), w, h };
  };
  const r1 = (x: number): number => Math.round(x * 10) / 10;
  /** The keys of a box that changed (only those are written: a horizontal move writes left, never top). */
  const changedKeys = (a: FloatBox, b: FloatBox): Partial<FloatBox> => {
    const out: Partial<FloatBox> = {};
    for (const key of ['left', 'top', 'w', 'h'] as const) if (Math.abs(a[key] - b[key]) > 1e-6) out[key] = r1(b[key]);
    return out;
  };
  function showFloatGhost(fEl: HTMLElement, b: FloatBox): void {
    place(fEl, { x: (b.left / 100) * stageRect.w, y: (b.top / 100) * stageRect.h, w: (b.w / 100) * stageRect.w, h: (b.h / 100) * stageRect.h });
  }
  let lastTap: { k: number; t: number } | null = null;
  function dragFloat(fEl: HTMLElement, e: PointerEvent, handle: string | null): void {
    const k = Number(fEl.getAttribute('data-float'));
    const b0 = floatText(k);
    if (!b0 || !current) return;
    e.preventDefault();
    selectFloat(k);
    fEl.focus({ preventScroll: true });
    if (shell.isReadOnly()) { say('The document is read-only.', 'warn'); return; }
    const slide = current.index;
    const base = shell.getText();
    const from = floatShown(k) ?? undefined;
    const x0 = e.clientX;
    const y0 = e.clientY;
    const style = fEl.getAttribute('style');
    let box: FloatBox = b0;
    let moved = false;
    let raf = 0;
    let lastEv: PointerEvent | null = null;
    const frame = (): void => {
      raf = 0;
      const ev = lastEv;
      if (!ev) return;
      // whole-% steps from where it starts
      const dx = Math.round(((ev.clientX - x0) / stageRect.w) * 100);
      const dy = Math.round(((ev.clientY - y0) / stageRect.h) * 100);
      if (!moved && Math.abs(ev.clientX - x0) + Math.abs(ev.clientY - y0) < 3) return;
      moved = true;
      const b = { ...b0 };
      if (!handle) { b.left += dx; b.top += dy; }
      else {
        if (handle.includes('w')) { b.left += dx; b.w -= dx; }
        if (handle.includes('e')) b.w += dx;
        if (handle.includes('n')) { b.top += dy; b.h -= dy; }
        if (handle.includes('s')) b.h += dy;
      }
      box = clampBox(b);
      showFloatGhost(fEl, box);
      showBubble(handle ? `${r1(box.w)} % × ${r1(box.h)} %` : `${r1(box.left)} %, ${r1(box.top)} %`, handle ? '' : 'left, top', ev.clientX, ev.clientY);
      host.preview({ floats: [{ index: k, ...box }] });
    };
    const move = (ev: PointerEvent): void => { lastEv = ev; if (!raf) raf = win.requestAnimationFrame(frame); };
    const finish = (_ev: PointerEvent, commit: boolean): void => {
      // the last position the pointer reached
      if (raf) { win.cancelAnimationFrame(raf); frame(); }
      bubble.hidden = true;
      if (commit && !moved) {
        // a second press without a move: the float's text in the editor (the catcher took the dblclick)
        const now = Date.now();
        if (lastTap && lastTap.k === k && now - lastTap.t < 450) { lastTap = null; selectFloat(k, true); } else lastTap = { k, t: now };
      }
      const changed = changedKeys(b0, box);
      if (commit && moved && Object.keys(changed).length > 0) {
        if (run({ type: 'float-geom', index: k, box: changed, ...(from ? { from } : {}) }, slide, base)) focusKey(`float:${k}`);
        else if (style === null) fEl.removeAttribute('style'); else fEl.setAttribute('style', style);
      } else {
        if (style === null) fEl.removeAttribute('style'); else fEl.setAttribute('style', style);
        if (moved) host.preview({ reset: true });
      }
    };
    hold(e, handle ? `${handle}-resize` : 'move', { move, end: finish });
  }
  function keyFloat(fEl: HTMLElement, e: KeyboardEvent): boolean {
    const k = Number(fEl.getAttribute('data-float'));
    if (e.key === 'Enter') { flushPending(); selectFloat(k, true); return true; }
    if (e.key === ' ') { flushPending(); selectFloat(k); return true; }
    if (e.key === 'Delete' || e.key === 'Backspace') { if (run({ type: 'float-delete', index: k })) { sel = null; drawBar(); } return true; }
    if (e.key === ']') { if (run({ type: 'float-z', index: k, dir: 'forward' })) focusKey(`float:${k}`); return true; }
    if (e.key === '[') { if (run({ type: 'float-z', index: k, dir: 'backward' })) focusKey(`float:${k}`); return true; }
    const dx = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
    const dy = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
    if (!dx && !dy) return false;
    const step = e.shiftKey ? 5 : 1;
    type Run = { b0: FloatBox; box: FloatBox; from?: FloatBox };
    const own = fEl as HTMLElement & { __run?: Run };
    if (!own.__run) { const b0 = floatText(k); if (!b0) return true; const from = floatShown(k); own.__run = { b0, box: b0, ...(from ? { from } : {}) }; }
    const run0 = own.__run;
    const cur = run0.box;
    const resize = e.altKey;
    const b = clampBox(resize ? { ...cur, w: cur.w + dx * step, h: cur.h + dy * step } : { ...cur, left: cur.left + dx * step, top: cur.top + dy * step });
    run0.box = b;
    showFloatGhost(fEl, b);
    host.preview({ floats: [{ index: k, ...b }] });
    say(resize ? `Float ${k + 1}: ${r1(b.w)} % × ${r1(b.h)} %` : `Float ${k + 1}: ${r1(b.left)} %, ${r1(b.top)} %`);
    pend(`float:${k}`, (slide, base) => {
      delete own.__run;
      const changed = changedKeys(run0.b0, run0.box);
      if (Object.keys(changed).length > 0 && run({ type: 'float-geom', index: k, box: changed, ...(run0.from ? { from: run0.from } : {}) }, slide, base)) focusKey(`float:${k}`);
    }, () => {
      delete own.__run;
      host.preview({ reset: true });
      drawStage();
    });
    return true;
  }

  /* ── boxes: keys, swap by drag ── */
  /** The box next to a box on one side (the nearest whose span overlaps on the other axis). */
  function neighbour(name: string, dir: 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown'): string | null {
    const regions = regionRects;
    const a = regions.find((r) => r.name === name);
    if (!a) return null;
    let best: string | null = null;
    let bd = Infinity;
    for (const r of regions) {
      if (r.name === name) continue;
      const ok = dir === 'ArrowLeft' ? r.x + r.w <= a.x + 2 && r.y < a.y + a.h && a.y < r.y + r.h
        : dir === 'ArrowRight' ? r.x >= a.x + a.w - 2 && r.y < a.y + a.h && a.y < r.y + r.h
        : dir === 'ArrowUp' ? r.y + r.h <= a.y + 2 && r.x < a.x + a.w && a.x < r.x + r.w
        : r.y >= a.y + a.h - 2 && r.x < a.x + a.w && a.x < r.x + r.w;
      if (!ok) continue;
      const dist = Math.abs(r.x + r.w / 2 - (a.x + a.w / 2)) + Math.abs(r.y + r.h / 2 - (a.y + a.h / 2));
      if (dist < bd) { bd = dist; best = r.name; }
    }
    return best;
  }
  function keyBox(b: HTMLElement, e: KeyboardEvent): boolean {
    const kind = b.getAttribute('data-kind');
    const name = b.getAttribute('data-box') ?? '';
    if (kind === 'title') { if (e.key === 'Enter') { selectTitle(true); return true; } if (e.key === ' ') { selectTitle(); return true; } return false; }
    if (kind === 'footer') { if (e.key === 'Enter') { selectFooter(true); return true; } return false; }
    if (kind === 'template') { if (e.key === 'Enter') { selectTemplateBody(true); return true; } if (e.key === ' ') { selectTemplateBody(); return true; } return false; }
    if (e.key === 'Enter') { selectBox(name, true); return true; }
    if (e.key === ' ') { selectBox(name); return true; }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      const names = leaves(current!.slide.layout);
      const at = names.indexOf(name);
      if (run({ type: 'delete-box', box: name })) { const n = leaves(current!.slide.layout); const next = n[Math.max(0, Math.min(at - 1, n.length - 1))] ?? n[0]; if (next) { sel = { kind: 'box', name: next }; drawBar(); markSelection(); focusKey(`region:${next}`); } }
      return true;
    }
    if (e.key === 'F2') { renamePop(name, b); return true; }
    if (!e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'c' || e.key === 'C' || e.key === 'r' || e.key === 'R')) {
      if (run({ type: 'split', box: name, dir: e.key.toLowerCase() === 'c' ? 'col' : 'row' })) focusKey(`region:${name}`);
      return true;
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const n = neighbour(name, e.key);
      if (!n) { say(`No box ${e.key === 'ArrowLeft' ? 'left of' : e.key === 'ArrowRight' ? 'right of' : e.key === 'ArrowUp' ? 'above' : 'below'} ${name}.`); return true; }
      if (e.altKey) {
        const op: LayoutOp = e.shiftKey ? { type: 'move-content', from: name, to: n } : { type: 'swap', a: name, b: n };
        if (run(op)) { sel = { kind: 'box', name: n }; drawBar(); markSelection(); focusKey(`region:${n}`); }
        return true;
      }
      sel = { kind: 'box', name: n };
      selectBox(n);
      focusKey(`region:${n}`);
      return true;
    }
    return false;
  }
  /** Drag a box's name tag onto another box: swap their text (Alt: move it there). */
  function dragTag(b: HTMLElement, e: PointerEvent): void {
    const name = b.getAttribute('data-box') ?? '';
    e.preventDefault();
    const slide = current?.index;
    const base = shell.getText();
    let target: string | null = null;
    let moved = false;
    const x0 = e.clientX;
    const y0 = e.clientY;
    const over = (ev: PointerEvent): string | null => {
      for (const o of Array.from(stage.querySelectorAll<HTMLElement>('.orz-lg-box--region'))) {
        const r = o.getBoundingClientRect();
        if (ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom) return o.getAttribute('data-box');
      }
      return null;
    };
    const move = (ev: PointerEvent): void => {
      if (!moved && Math.abs(ev.clientX - x0) + Math.abs(ev.clientY - y0) < 5) return;
      moved = true;
      const t = over(ev);
      target = t && t !== name ? t : null;
      stage.querySelectorAll('.is-target').forEach((x) => x.classList.remove('is-target'));
      if (target) stage.querySelector(`.orz-lg-box--region[data-box="${esc(target)}"]`)?.classList.add('is-target');
      showBubble(target ? `${ev.altKey ? 'Move the text to' : 'Swap with'} ${target}` : `Drop on a box to swap the text of ${name}`, ev.altKey ? '' : 'Alt: move', ev.clientX, ev.clientY);
    };
    const finish = (ev: PointerEvent, commit: boolean): void => {
      bubble.hidden = true;
      stage.querySelectorAll('.is-target').forEach((x) => x.classList.remove('is-target'));
      if (!moved) { if (commit) selectBox(name); return; }
      if (commit && target) run(ev.altKey ? { type: 'move-content', from: name, to: target } : { type: 'swap', a: name, b: target }, slide, base);
    };
    hold(e, 'grabbing', { move, end: finish });
  }

  /* ── filmstrip: click, keys, drag ── */
  function dragSlide(item: HTMLElement, e: PointerEvent): void {
    const from = Number(item.getAttribute('data-slide'));
    const n = current?.deck.slides.length ?? 0;
    if (!(n > 1)) return;
    e.preventDefault();
    const base = shell.getText();
    const horiz = stripAxis === 'x';
    const pos = (ev: { clientX: number; clientY: number }): number => (horiz ? ev.clientX : ev.clientY);
    const h = stepOf();
    const ghost = item.cloneNode(true) as HTMLElement;
    ghost.classList.add('orz-lg-ghost');
    ghost.removeAttribute('id');
    ghost.setAttribute('aria-hidden', 'true');
    const drop = el(doc, 'div', 'orz-lg-drop', { 'aria-hidden': 'true' });
    let slot = from;
    let started = false;
    const p0 = pos(e);
    let lastP = p0;
    let scrollRaf = 0;
    const edgeStart = (): number => { const r = stripScroll.getBoundingClientRect(); return horiz ? r.left : r.top; };
    const edgeEnd = (): number => { const r = stripScroll.getBoundingClientRect(); return horiz ? r.right : r.bottom; };
    const slotAt = (p: number): number => Math.max(0, Math.min(n, Math.round((p - edgeStart() + scrollPos() - 4) / h)));
    const show = (): void => {
      const y = lastP - edgeStart() + scrollPos();
      ghost.style[horiz ? 'left' : 'top'] = `${y - (h - 6) / 2}px`;
      slot = slotAt(lastP);
      drop.style[horiz ? 'left' : 'top'] = `${4 + slot * h - 2}px`;
      if (!ghost.isConnected) stripInner.append(ghost);
      if (!drop.isConnected) stripInner.append(drop);
    };
    /** Scroll while the pointer is near an edge: speed by depth into the edge zone, by time (any frame rate). */
    let lastT = 0;
    const autoscroll = (now: number): void => {
      scrollRaf = 0;
      if (!started) return;
      const dt = lastT ? Math.min(250, now - lastT) : 16;
      lastT = now;
      const edge = 40;
      const a = edgeStart();
      const b = edgeEnd();
      const depth = lastP < a + edge ? -(a + edge - lastP) : lastP > b - edge ? lastP - (b - edge) : 0;
      if (depth === 0) { lastT = 0; return; }
      const speed = Math.sign(depth) * Math.min(1.6, 0.15 + Math.abs(depth) / 30); // px per ms
      setScrollPos(scrollPos() + speed * dt);
      drawStrip();
      show();
      scrollRaf = win.requestAnimationFrame(autoscroll);
    };
    const move = (ev: PointerEvent): void => {
      lastP = pos(ev);
      if (!started && Math.abs(lastP - p0) < 4) return;
      started = true;
      show();
      if (!scrollRaf) scrollRaf = win.requestAnimationFrame(autoscroll);
    };
    const finish = (_ev: PointerEvent, commit: boolean): void => {
      if (scrollRaf) win.cancelAnimationFrame(scrollRaf);
      ghost.remove();
      drop.remove();
      if (!started) { if (commit) go(from); return; }
      const to = slot > from ? slot - 1 : slot;
      if (commit && to !== from) run({ type: 'slide-move', to }, from, base);
      else drawStrip(true);
    };
    hold(e, 'grabbing', { move, end: finish });
  }

  /* ── wiring (trusted events only) ── */
  listen<MouseEvent>(bar, 'click', (e) => {
    if (!e.isTrusted) return;
    const b = (e.target as HTMLElement).closest('button');
    if (!b || b.disabled) return;
    const act = b.getAttribute('data-act') ?? '';
    const box = sel?.kind === 'box' ? sel.name : null;
    const fl = sel?.kind === 'float' ? sel.index : null;
    if (act === 'strip') { setStrip(!stripOn); return; }
    if (act.startsWith('preset-')) { run({ type: 'preset', preset: act.slice(7) as PresetChoice }); return; }
    if (act === 'split-col' && box) { if (run({ type: 'split', box, dir: 'col' })) focusKey(`region:${box}`); return; }
    if (act === 'split-row' && box) { if (run({ type: 'split', box, dir: 'row' })) focusKey(`region:${box}`); return; }
    if (act === 'rename' && box) { renamePop(box, b); return; }
    if (act === 'swap' && box) { boxMenu('swap', box, b); return; }
    if (act === 'move' && box) { boxMenu('move', box, b); return; }
    if (act === 'delete-box' && box) { if (run({ type: 'delete-box', box })) { sel = null; drawBar(); } return; }
    if (act === 'float-add') {
      const r = run(newFloat());
      // the float the op made (its number from the op: notes or a footer may come first — round B, OPS-6)
      const n = r?.target && 'float' in r.target ? r.target.float : null;
      if (n !== null) { sel = { kind: 'float', index: n }; drawBar(); focusKey(`float:${n}`); }
      return;
    }
    if (act === 'float-forward' && fl !== null) { if (run({ type: 'float-z', index: fl, dir: 'forward' })) focusKey(`float:${fl}`); return; }
    if (act === 'float-backward' && fl !== null) { if (run({ type: 'float-z', index: fl, dir: 'backward' })) focusKey(`float:${fl}`); return; }
    if (act === 'float-delete' && fl !== null) { if (run({ type: 'float-delete', index: fl })) { sel = null; drawBar(); } return; }
    if (act === 'options') { optionsPop(b); return; }
    if (act === 'notes' || act === 'footer') {
      const c = current;
      if (!c) return;
      const has = act === 'notes' ? c.map.notes : c.map.footer;
      if (has) { shell.select(has.from, has.to, { scroll: true }); shell.focus(); return; }
      if (run({ type: 'ensure-region', name: act })) shell.focus();
      return;
    }
  });
  listen<MouseEvent>(status, 'click', (e) => {
    if (!e.isTrusted) return;
    // a refusal cut to two lines: the whole of it, a click away (round B, GUI-8)
    if ((e.target as HTMLElement).closest('.orz-lg-msg') && msg.getAttribute('data-tone') === 'warn' && msg.scrollHeight > msg.clientHeight + 1) {
      openPop(msg, (p) => { const t = el(doc, 'p', 'orz-lg-full'); t.textContent = lastStatus; const close = btn('Close', '', { data: 'msg-close' }); close.addEventListener('click', () => closePop()); p.append(t, close); }, 'The whole message');
      return;
    }
    const b = (e.target as HTMLElement).closest('button');
    const act = b?.getAttribute('data-act');
    if (act === 'undo') history('undo');
    if (act === 'redo') history('redo');
    if (act === 'keys' && b) keysPop(b);
  });
  /**
   * A new float's place (round B, GUI-2): where it covers none of the slide's text and pictures (the stage's
   * ink) and no other float — the emptiest place, bottom right first; with no free place, offset and said.
   * Data from the frame only SEEDS the place the reader then sees (and moves).
   */
  function newFloat(): LayoutOp {
    const parts = geom?.current ? geom.parts : null;
    const size = host.slideSize();
    if (!parts || !(size.width > 0)) return { type: 'float-add' };
    const pc = (r: Rect): FloatBox => ({ left: (r.x / size.width) * 100, top: (r.y / size.height) * 100, w: (r.w / size.width) * 100, h: (r.h / size.height) * 100 });
    const placed = placeFloat(parts.floats.map(pc), { w: 30, h: 22 }, parts.ink.map(pc));
    return { type: 'float-add', box: { left: placed.left, top: placed.top, w: placed.w, h: placed.h }, covers: placed.covers };
  }
  listen<MouseEvent>(strip, 'click', (e) => {
    if (!e.isTrusted) return;
    const b = (e.target as HTMLElement).closest('button');
    const act = b?.getAttribute('data-act');
    if (act === 'slide-add') run({ type: 'slide-add' });
    if (act === 'slide-duplicate') run({ type: 'slide-duplicate' });
    if (act === 'slide-delete') run({ type: 'slide-delete' });
    if (act === 'strip-hide') { setStrip(false); stripBtn.focus(); }
  });
  listen<PointerEvent>(stripScroll, 'pointerdown', (e) => {
    if (!e.isTrusted || e.button !== 0) return;
    const item = (e.target as HTMLElement).closest('.orz-lg-item') as HTMLElement | null;
    if (!item) return;
    const onGrip = !!(e.target as HTMLElement).closest('.orz-lg-item-grip');
    // a mouse drags a row from anywhere; a finger from the grip (elsewhere it scrolls)
    if (onGrip || e.pointerType === 'mouse') { flushPending(); dragSlide(item, e); }
    else listenOnce(item, 'click', () => go(Number(item.getAttribute('data-slide'))));
  });
  const listenOnce = (t: HTMLElement, type: string, fn: () => void): void => {
    const h = (ev: Event): void => { t.removeEventListener(type, h); if (ev.isTrusted) fn(); };
    t.addEventListener(type, h);
  };
  listen<KeyboardEvent>(stripScroll, 'keydown', (e) => {
    if (!e.isTrusted || !current) return;
    const i = current.index;
    const n = current.deck.slides.length;
    let to = -1;
    // a row under the slide: Left / Right too
    const prev = e.key === 'ArrowUp' || (stripAxis === 'x' && e.key === 'ArrowLeft');
    const next = e.key === 'ArrowDown' || (stripAxis === 'x' && e.key === 'ArrowRight');
    if (prev && e.altKey) { e.preventDefault(); if (i > 0) run({ type: 'slide-move', to: i - 1 }, i); return; }
    if (next && e.altKey) { e.preventDefault(); if (i < n - 1) run({ type: 'slide-move', to: i + 1 }, i); return; }
    if (prev) to = i - 1;
    if (next) to = i + 1;
    if (e.key === 'Home') to = 0;
    if (e.key === 'End') to = n - 1;
    if (e.key === 'PageUp') to = i - Math.max(1, Math.floor(viewLen() / stepOf()));
    if (e.key === 'PageDown') to = i + Math.max(1, Math.floor(viewLen() / stepOf()));
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); run({ type: 'slide-delete' }, i); return; }
    if (e.key === 'Enter') { e.preventDefault(); (stage.querySelector('.orz-lg-box, .orz-lg-float') as HTMLElement | null)?.focus(); return; }
    if (to !== -1) { e.preventDefault(); go(Math.max(0, Math.min(n - 1, to))); }
  });
  listen<Event>(stripScroll, 'scroll', () => drawStrip(), { passive: true });

  listen<PointerEvent>(stage, 'pointerdown', (e) => {
    if (!e.isTrusted || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const t = e.target as HTMLElement;
    closePop();
    const d = t.closest('.orz-lg-div') as HTMLElement | null;
    if (d) { flushPending(); dragDivider(d, e); return; }
    const f = t.closest('.orz-lg-float') as HTMLElement | null;
    if (f) { flushPending(); dragFloat(f, e, t.getAttribute('data-h')); return; }
    const tag = t.closest('.orz-lg-tag') as HTMLElement | null;
    const b = t.closest('.orz-lg-box--region') as HTMLElement | null;
    if (tag && b && current && leaves(current.slide.layout).length > 1) { flushPending(); dragTag(b, e); }
  });
  listen<MouseEvent>(stage, 'click', (e) => {
    if (!e.isTrusted) return;
    const t = e.target as HTMLElement;
    const v = t.closest('.orz-lg-variant') as HTMLElement | null;
    if (v) { run({ type: 'variant', v: Number(v.getAttribute('data-variant')) }); return; }
    if (t.closest('.orz-lg-tag') && t.closest('.orz-lg-box--region')) return; // the tag's own pointer handling selects
    const b = t.closest('.orz-lg-box') as HTMLElement | null;
    if (!b) return;
    const kind = b.getAttribute('data-kind');
    if (kind === 'title') selectTitle();
    else if (kind === 'footer') selectFooter();
    else if (kind === 'template') selectTemplateBody();
    else selectBox(b.getAttribute('data-box') ?? '');
  });
  listen<MouseEvent>(stage, 'dblclick', (e) => {
    if (!e.isTrusted) return;
    const t = e.target as HTMLElement;
    const f = t.closest('.orz-lg-float') as HTMLElement | null;
    if (f) { selectFloat(Number(f.getAttribute('data-float')), true); return; }
    const b = t.closest('.orz-lg-box') as HTMLElement | null;
    if (!b) return;
    const kind = b.getAttribute('data-kind');
    if (kind === 'title') selectTitle(true);
    else if (kind === 'footer') selectFooter(true);
    else if (kind === 'template') selectTemplateBody(true);
    else selectBox(b.getAttribute('data-box') ?? '', true);
  });
  listen<KeyboardEvent>(ui, 'keydown', (e) => {
    if (!e.isTrusted) return;
    const t = e.target as HTMLElement;
    const mod = e.metaKey || e.ctrlKey;
    if (t.tagName === 'INPUT' || t.tagName === 'SELECT') { if (e.key === 'Escape') { e.preventDefault(); closePop(); } return; }
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); history(e.shiftKey ? 'redo' : 'undo'); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); history('redo'); return; }
    if (e.key === 'Escape') {
      if (drag) { e.preventDefault(); drag.cancel(); return; }
      if (pending) { e.preventDefault(); cancelPending(); return; }
      if (pop) { e.preventDefault(); closePop(); return; }
      if (sel) { e.preventDefault(); sel = null; drawBar(); markSelection(); return; }
      return;
    }
    if (e.key === '?' && !mod) { e.preventDefault(); keysPop(bKeys); return; }
    if ((e.key === 'PageUp' || e.key === 'PageDown') && current && !t.closest('.orz-lg-strip')) { e.preventDefault(); go(current.index + (e.key === 'PageUp' ? -1 : 1)); return; }
    if (mod) return;
    let handled = false;
    if (t.classList.contains('orz-lg-div')) handled = keyDivider(t, e);
    else if (t.classList.contains('orz-lg-float')) handled = keyFloat(t, e);
    else if (t.classList.contains('orz-lg-box')) handled = keyBox(t, e);
    if (handled) { e.preventDefault(); e.stopPropagation(); }
  });
  listen<FocusEvent>(ui, 'focusin', (e) => {
    const t = e.target as HTMLElement;
    if (t.classList?.contains('orz-lg-float')) { const k = Number(t.getAttribute('data-float')); if (!(sel?.kind === 'float' && sel.index === k)) { sel = { kind: 'float', index: k }; drawBar(); markSelection(); } }
    if (t.classList?.contains('orz-lg-box--region')) { const n = t.getAttribute('data-box') ?? ''; if (!(sel?.kind === 'box' && sel.name === n)) { sel = { kind: 'box', name: n }; drawBar(); markSelection(); } }
  });
  listen<FocusEvent>(ui, 'focusout', (e) => {
    // a run of keys is written when the focus leaves what it changes
    const to = e.relatedTarget as Node | null;
    if (pending && !(to && ui.contains(to) && ((to as HTMLElement).classList?.contains('orz-lg-float') || (to as HTMLElement).classList?.contains('orz-lg-div')))) flushPending();
  });
  // a click outside a popover closes it
  listen<PointerEvent>(root as unknown as EventTarget, 'pointerdown', (e) => { if (pop && !e.composedPath().includes(pop)) closePop(); }, { capture: true });
  // the caret moves: the box it is in is marked
  offs.push(shell.on('selection', (ev) => {
    // the caret went to another slide: a run of keys is written to ITS slide now (round B, OPS-2)
    if (pending && host.slide()?.index !== pending.slide) flushPending();
    const c = current;
    if (!c || textDirty) return;
    const at = (ev as { from?: number } | undefined)?.from;
    if (typeof at !== 'number') return;
    const p = partAt(c.map, at);
    stage.querySelectorAll('.is-cursor').forEach((x) => x.classList.remove('is-cursor'));
    if (p && 'box' in p) stage.querySelector(`.orz-lg-box--region[data-box="${esc(p.box)}"], .orz-lg-box--template`)?.classList.add('is-cursor');
    if (p && 'float' in p) stage.querySelector(`.orz-lg-float[data-float="${p.float}"]`)?.classList.add('is-cursor');
  }));
  // the pane's size: the stage moves with it (the frame computes the same place)
  const RO = (win as unknown as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
  let ro: ResizeObserver | null = null;
  if (RO) {
    ro = new RO(() => { if (!destroyed) { measureInsets(); drawStage(); drawStrip(true); } });
    const watch = (): void => { const p = host.pane(); if (p) ro!.observe(p); ro!.observe(bar); };
    watch();
  }
  offs.push(() => ro?.disconnect());

  say(host.engine?.() === 'textarea'
    ? 'Basic editing (the code editor did not load): the rest of the deck is not dimmed — the slide\'s text is brought into view. Click a box to select its text; ? lists the keys.'
    : 'Click a box to select its text; drag a divider, a float or a slide; ? lists the keys.');
  refresh();
  // the frame may not exist yet (first render): try again shortly
  if (!ui.isConnected) later(refresh, 200);

  const api: LayoutGuiApi = {
    state: () => ({
      slide: current?.index ?? -1,
      total: current?.deck.slides.length ?? 0,
      selection: sel,
      boxes: Array.from(stage.querySelectorAll<HTMLElement>('.orz-lg-box--region, .orz-lg-box--template')).map((b) => b.getAttribute('data-box') ?? ''),
      floats: stage.querySelectorAll('.orz-lg-float').length,
      dividers: stage.querySelectorAll('.orz-lg-div').length,
      stage: { ...stageRect },
      insets: { ...insets },
      status: lastStatus,
      template: current?.slide.kind === 'template' ? current.slide.template ?? null : null,
      blocked: current?.blocked ?? null,
      stale: stage.classList.contains('is-stale'),
      strip: stripOn ? Array.from(stripInner.querySelectorAll<HTMLElement>('.orz-lg-item:not(.orz-lg-ghost)')).map((x) => Number(x.getAttribute('data-slide'))) : [],
      stripAxis: stripOn ? stripAxis : null,
      dragging: drag !== null,
      pending: pending !== null,
    }),
    run: (op) => run(op) !== null,
  };

  return {
    refresh,
    api,
    stale() {
      if (destroyed) return;
      textDirty = true;
      stage.classList.add('is-stale');
    },
    destroy() {
      if (destroyed) return;
      flushPending();
      drag?.cancel();
      destroyed = true;
      for (const off of offs.splice(0)) { try { off(); } catch { /* gone */ } }
      for (const id of timers) win.clearTimeout(id);
      timers.clear();
      closePop();
      ui.remove();
    },
  };
}
