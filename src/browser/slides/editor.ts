/**
 * KIND-SPECIFIC (slides): what editing mode (a), whole deck, adds to the
 * kit's editor shell (REBUILD §3c owner decision 1(a), plan step 5) — the
 * trusted page's half; the frame's half is src/browser/slides/live-frame.ts.
 *
 * - **The live view** of the caret's slide, pinned in the preview frame:
 *   after a pause in typing ({@link LIVE_PAUSE_MS}; a caret move alone,
 *   {@link CARET_PAUSE_MS}) the caret's slide is rendered HERE from the text
 *   (src/render-slide.ts with the deck plan — the engine's DOM) and posted
 *   to the frame as data (`orz-slides-live`); the frame draws, fits and
 *   reports it (`orz-slides-fit`). Never per keystroke: a key only moves a
 *   timer. On by default; the reader's preference `liveSlide` (stored in the
 *   document's preference namespace) hides it — the toolbar's **Live
 *   slide** toggle.
 * - **Lints** in the toolbar (**Issues**, with their count): the kit's
 *   header lints and the deck's (`readDocument`: parseDeck's, its
 *   marker-hygiene quick fixes included), and the two the live view finds
 *   (the closed-loop items left to step 5): `cut-on-paper` — a slide whose
 *   box is still too big at the fit floor, or `fit=off` and overflowing (on
 *   paper nothing scrolls: a `fit=scroll` slide counts as fitted) — and
 *   `footer-cut`, a footer ellipsized to its one line. Both come from the
 *   live view's fit reports, remembered per slide content, theme, ratio
 *   and footer, so a slide is checked once it has been shown at the caret;
 *   recomputed after a pause, never blocking typing. A lint's **Show**
 *   selects its text; **Fix** applies its quick fix through `applyEdits`
 *   (ONE undo step), recomputed on the current text first (a stale fix is
 *   never applied).
 * - **This slide** (the per-slide mode's entry point; rebuild step 6 seam):
 *   the same text editor with the text outside the caret's slide dimmed
 *   (`setFocusRange`, one history for both modes, Q6) and the live view as
 *   the stage; the layout GUI is a {@link SlideLayoutGui} (src/browser/slides/
 *   per-slide.ts) attached to the stage — none in step 5.
 * - **Read view ↔ edit view** keep the slide: the editor opens with the
 *   caret on the slide the read view showed (`startSlide`), and leaving
 *   reports the caret's slide (`onLeave`), which the read view goes to.
 */
import { md, prepareSources } from 'orz-markdown';
import { readHeader } from 'orz-markdown/carrier';
import { installCss, WIDGET_CSS, button } from 'orz-markdown/carrier/app';
import { includeRecordEnv, rewriteAssetUrls, type EditorShell } from 'orz-markdown/carrier/editor';
import { createPreferenceStore, showToast, type PreferenceSpec, type PreferenceStore } from 'orz-markdown/carrier/shell';
import { readDocument } from '../../assemble.js';
import { parseDeck, TEMPLATES } from '../../deck/parse.js';
import { planDeck } from '../../deck/plan.js';
import { presentationOf, slideSize } from '../../presentation.js';
import { renderSlide, type Renderer } from '../../render-slide.js';
import type { Deck, Slide, SlideLint } from '../../types.js';
import type { SlideLayoutGui, StageGeometry, StageHost, StageParts, StagePreview } from './per-slide.js';
import type { Rect, StageInsets } from './stage-geometry.js';

/** The pause in typing after which the live view and the lints follow the text (ms). */
export const LIVE_PAUSE_MS = 450;
/** A caret move without typing: the live view follows after this (ms). */
export const CARET_PAUSE_MS = 90;
/** Idle fit checks (round B, B-ED-3): after this long without typing, one slide at a time, this far apart (ms), at most this many per editor. */
export const CHECK_IDLE_MS = 1200;
export const CHECK_GAP_MS = 120;
export const CHECK_BUDGET = 2000;

export interface SlidesToolsOptions {
  /** Resolved includes (the file's `#orz-includes`, or the app's `includes`). */
  includes?: Readonly<Record<string, string>>;
  fetchInclude?(target: string): Promise<string | null>;
  resolveAsset?(path: string): string;
  /** Icon-only toolbar (`chrome: 'compact'`). */
  iconOnly?: boolean;
  /** The read view's slide (0-based): the caret starts there. */
  startSlide?: number;
  /** Leaving: the caret's slide (0-based), for the read view. */
  onLeave?(slide: number): void;
  /** Step 6: the layout GUI the per-slide mode attaches to its stage. */
  layoutGui?: SlideLayoutGui | null;
  /** The per-slide mode turned on or off (the carrier skips the hidden flattened preview's render meanwhile). */
  onPerSlide?(on: boolean): void;
}

/** A fit report of the live view (data from the frame; validated). */
export interface FitReport {
  boxes: Array<{ kind: string; name: string; scale: number; clipped: boolean; x: number; y: number; w: number; h: number }>;
  footerCut: boolean;
  scrolls: boolean;
  /** The parts the per-slide overlay places itself over (step 6). */
  parts: StageParts | null;
}

/** A frame-reported rectangle, validated: finite numbers, clamped to a sane range (data, never trusted). */
function rectOf(v: unknown): Rect | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const n = (x: unknown): number => (typeof x === 'number' && Number.isFinite(x) ? Math.max(-4000, Math.min(4000, x)) : 0);
  return { x: n(o.x), y: n(o.y), w: Math.max(0, n(o.w)), h: Math.max(0, n(o.h)) };
}

/** The frame's parts report, validated (bounded lists, rectangles, names as short strings). */
function partsOf(v: unknown): StageParts | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const list = (x: unknown): unknown[] => (Array.isArray(x) ? x.slice(0, 64) : []);
  return {
    regions: list(o.regions).map((r) => ({ ...rectOf(r)!, name: String((r as { name?: unknown })?.name ?? '').slice(0, 64), empty: (r as { empty?: unknown })?.empty === true })).filter((r) => r.x !== undefined),
    splits: list(o.splits).map((r) => ({ ...rectOf(r)!, dir: (r as { dir?: unknown })?.dir === 'row' ? 'row' as const : 'col' as const, kids: list((r as { kids?: unknown })?.kids).map((k) => rectOf(k) ?? { x: 0, y: 0, w: 0, h: 0 }) })).filter((r) => r.x !== undefined),
    title: rectOf(o.title),
    content: rectOf(o.content),
    template: rectOf(o.template),
    footer: rectOf(o.footer),
    floats: list(o.floats).map((r) => rectOf(r) ?? { x: 0, y: 0, w: 0, h: 0 }),
    ink: (Array.isArray(o.ink) ? o.ink.slice(0, 400) : []).map((r) => rectOf(r)).filter((r): r is Rect => r !== null && r.w > 0 && r.h > 0),
  };
}

export interface SlidesTools {
  /** The caret's slide (0-based; 0 before the first). */
  caretSlide(): number;
  /** The lints shown now (the last computed). */
  lints(): readonly SlideLint[];
  /** Compute the lints now (tests; the panel does it after a pause). */
  refreshLints(): readonly SlideLint[];
  /** Apply a lint's quick fix (recomputed on the current text); false when there is none any more. */
  applyFix(lint: Pick<SlideLint, 'code' | 'line'>): boolean;
  /** The live view: shown (the reader preference) or not. */
  isLive(): boolean;
  setLive(on: boolean): void;
  /** The per-slide mode (step 6 seam). */
  isPerSlide(): boolean;
  setPerSlide(on: boolean): void;
  /** The live view's last fit report for the caret's slide (null before one). */
  lastFit(): (FitReport & { index: number }) | null;
  /** The attached layout GUI's test handle (per-slide mode on, the default GUI), else null. */
  layoutGui(): unknown;
  /** Post the caret's slide now (tests). */
  syncLive(): Promise<void>;
  /** How many of the deck's slides have a fit report for their current text (the live view's or an idle check's). */
  fitCoverage(): { checked: number; total: number };
  destroy(): void;
}

const isBoolean = (v: unknown): v is boolean => typeof v === 'boolean';
const SLIDES_PREFERENCES = { liveSlide: { default: true, valid: isBoolean } as PreferenceSpec<boolean> };

/** A short, stable hash (FNV-1a, 32 bit) of a string, as hex. */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16);
}

/** The slide that holds an offset (0-based; the first for the text before it; -1 with no slides). */
export function slideIndexAt(deck: Deck, offset: number): number {
  const s = deck.slides;
  if (s.length === 0) return -1;
  let lo = 0;
  let hi = s.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (s[mid].span.from <= offset) lo = mid; else hi = mid - 1;
  }
  return lo;
}

/** Where the caret goes on a slide: the start of its title, else the end of its marker line. */
export function caretOf(slide: Slide): number {
  return slide.titleSpan ? slide.titleSpan.from : slide.marker.to;
}

/** What the fit lints are remembered by: the slide's text, the theme, the ratio and the deck footer (the header's part read once per text). */
let fitHead: { text: string; head: string } | null = null;
const fitKeyOf = (text: string, slide: Slide): string => {
  if (fitHead?.text !== text) {
    const p = presentationOf(text);
    fitHead = { text, head: `${p.theme.id}|${p.ratio}|${hash(readHeader(text)?.fields['footer'] ?? '')}` };
  }
  return `${fitHead.head}|${hash(slide.raw)}`;
};

const PANEL_CSS = `
.orz-slides-lint { position: relative; display: inline-flex; }
.orz-slides-lint__count { min-width: 1.4em; padding: 0 .4em; border-radius: 99px; font-size: var(--orz-chrome-text-xs); font-weight: 600; text-align: center; background: var(--orz-chrome-hover); }
.orz-slides-lint[data-level="error"] .orz-slides-lint__count { background: oklch(58% 0.19 27); color: #fff; }
.orz-slides-lint[data-level="warning"] .orz-slides-lint__count { background: oklch(78% 0.15 75); color: #241a00; }
.orz-slides-lint__panel {
  position: absolute; z-index: var(--orz-chrome-z); top: calc(100% + 6px); left: 0; width: min(440px, 80vw);
  max-height: min(60vh, 420px); overflow: auto; padding: var(--orz-chrome-space-2);
  border: 1px solid var(--orz-chrome-border); border-radius: var(--orz-chrome-radius-m);
  background: var(--orz-chrome-surface); color: var(--orz-chrome-fg); box-shadow: var(--orz-chrome-shadow);
}
.orz-slides-lint__empty { padding: var(--orz-chrome-space-3); color: var(--orz-chrome-muted); }
.orz-slides-lint__cover { padding: var(--orz-chrome-space-2) var(--orz-chrome-space-3); font-size: var(--orz-chrome-text-xs); color: var(--orz-chrome-muted); border-bottom: 1px solid var(--orz-chrome-border); }
.orz-slides-lint__item { display: grid; grid-template-columns: auto 1fr; gap: 2px var(--orz-chrome-space-3); padding: var(--orz-chrome-space-2) var(--orz-chrome-space-3); border-radius: var(--orz-chrome-radius-s); }
.orz-slides-lint__item:hover { background: var(--orz-chrome-hover); }
.orz-slides-lint__dot { width: 8px; height: 8px; margin-top: 6px; border-radius: 50%; background: oklch(78% 0.15 75); }
.orz-slides-lint__item[data-level="error"] .orz-slides-lint__dot { background: oklch(58% 0.19 27); }
.orz-slides-lint__item[data-level="info"] .orz-slides-lint__dot { background: var(--orz-chrome-muted); }
.orz-slides-lint__msg { font-size: var(--orz-chrome-text-sm); line-height: 1.45; }
.orz-slides-lint__where { color: var(--orz-chrome-muted); font-size: var(--orz-chrome-text-xs); }
.orz-slides-lint__acts { grid-column: 2; display: flex; gap: var(--orz-chrome-space-2); margin-top: 2px; }
.orz-slides-lint__acts .orz-btn { min-height: 24px; padding: 0 var(--orz-chrome-space-3); font-size: var(--orz-chrome-text-xs); border: 1px solid var(--orz-chrome-border); }
.orz-slides-lint__acts .orz-btn[data-fix] { border-color: var(--orz-chrome-accent); color: var(--orz-chrome-accent); }
.orz-slides-toggle[aria-pressed="true"] { color: var(--orz-chrome-accent); border-color: var(--orz-chrome-accent); }
`;

/** Attach the slides tools to a mounted editor shell (see the module comment). */
export function attachSlidesTools(shell: EditorShell, o: SlidesToolsOptions = {}): SlidesTools {
  const toolbar = shell.toolbar as unknown as HTMLElement | null;
  const doc = (toolbar?.ownerDocument ?? (globalThis as unknown as { document?: Document }).document) as Document;
  const win = doc?.defaultView ?? (globalThis as unknown as Window);
  const root = shell.root as unknown as ShadowRoot;
  let destroyed = false;
  const offs: Array<() => void> = [];
  const timers = new Set<number>();
  const later = (fn: () => void, ms: number): number => { const id = win.setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); return id; };
  const cancel = (id: number | null): void => { if (id !== null) { win.clearTimeout(id); timers.delete(id); } };

  // the reader preference (the document's namespace: its header uid)
  const uid = readHeader(shell.getText())?.fields['uid']?.trim();
  let prefs: PreferenceStore<typeof SLIDES_PREFERENCES> | null = null;
  try { prefs = createPreferenceStore(uid, undefined, SLIDES_PREFERENCES); } catch { prefs = null; }
  let live = prefs ? prefs.get('liveSlide') !== false : true;
  let perSlide = false;

  // ── the caret ──
  const initial = shell.getText();
  let caret = 0;
  {
    const deck = parseDeck(initial);
    const i = typeof o.startSlide === 'number' && Number.isFinite(o.startSlide) ? Math.max(0, Math.min(deck.slides.length - 1, Math.floor(o.startSlide))) : -1;
    if (i >= 0 && deck.slides[i]) {
      caret = caretOf(deck.slides[i]);
      shell.select(caret, caret, { scroll: true });
      // CodeMirror may load after the mount: the caret goes there again once it has
      void shell.ready.then(() => { if (!destroyed && caret === caretOf(parseDeck(initial).slides[i])) shell.select(caret, caret, { scroll: true }); });
    }
  }
  const caretSlide = (): number => Math.max(0, slideIndexAt(parseDeck(shell.getText()), caret));
  /** The editor's engine: 'textarea' when CodeMirror did not load (no dimming, no flash: B-ED-5). */
  let engine = 'codemirror6';
  void shell.ready.then((r) => { engine = r.engine; }).catch(() => undefined);
  /** The text the caret was last read against (a change that maps it moves it: B-ED-2). */
  let caretText = initial;

  // ── the live view ──
  let lastTyping = -Infinity;
  let liveTimer: number | null = null;
  let posted: { key: string; index: number; fitKey: string } | null = null;
  /** What a posted key is the fit of (`check`: an idle check, not the live view). */
  const postedFitKeys = new Map<string, { fitKey: string; index: number; check?: boolean }>();
  const fits = new Map<string, FitReport>();
  let last: (FitReport & { index: number; fitKey: string }) | null = null;
  let sourceCache: { text: string; source: Promise<string> } | null = null;
  const env = (): Record<string, unknown> => ({ ...includeRecordEnv(o.includes ?? {}), orzTwinLinks: true });

  /** The text the live slide renders from: URL includes resolved as the engine resolves them (rare; cached per text). */
  const sourceOf = (text: string): Promise<string> => {
    if (!/\{\{[^}\n]*[a-z][a-z0-9+.-]*:\/\//i.test(text)) return Promise.resolve(text);
    if (sourceCache?.text === text) return sourceCache.source;
    const rec = o.includes;
    const fetcher = async (url: string): Promise<string | null> => {
      if (o.fetchInclude) { try { const t = await o.fetchInclude(url); if (typeof t === 'string') return t; } catch { /* the record */ } }
      return rec && Object.prototype.hasOwnProperty.call(rec, url) && typeof rec[url] === 'string' ? rec[url] : null;
    };
    const source = prepareSources(text, { fetcher, includeEnv: env() as never }).catch(() => text);
    sourceCache = { text, source };
    return source;
  };

  let postTries = 0;
  /** The stage the GUI asked for (insets; a template's variant thumbnails). */
  let stageAsk: { insets: StageInsets; variants: boolean } = { insets: { top: 0, right: 0, bottom: 0, left: 0 }, variants: false };
  let variantHtml: Array<{ v: number; html: string }> = [];
  const message = (slide: unknown): Record<string, unknown> => ({ type: 'orz-slides-live', show: live, stage: perSlide, ...(perSlide ? { layout: { insets: stageAsk.insets, variants: stageAsk.variants ? variantHtml : [] } } : {}), ...(slide ? { slide } : {}) });
  const post = (m: Record<string, unknown>): void => {
    if (destroyed) return;
    if (shell.preview.post(m)) { postTries = 0; return; }
    // the frame is not ready yet (or is being rebuilt): again shortly
    if (postTries++ < 100) later(() => post(m), 100);
  };

  async function syncLive(force = false): Promise<void> {
    liveTimer = null;
    if (destroyed) return;
    const text = shell.getText();
    const deck = parseDeck(text);
    const i = slideIndexAt(deck, caret);
    if (perSlide) focusSlide(deck, i);
    if (!live && !perSlide) { post(message(null)); return; }
    if (i < 0) { post(message(null)); return; }
    const source = await sourceOf(text);
    if (destroyed || shell.getText() !== text) return;
    const d = source === text ? deck : parseDeck(source);
    const slide = d.slides[Math.min(i, d.slides.length - 1)];
    if (!slide) return;
    const p = presentationOf(text);
    const size = slideSize(p.ratio);
    const plans = planDeck(d, p.theme.sectionNumbers);
    const renderOne = (sl: Slide): string => {
      let h = renderSlide(sl, plans[slide.index], md as unknown as Renderer, d.config, { env: env(), themeNumbers: p.theme.sectionNumbers });
      if (o.resolveAsset) { const ra = o.resolveAsset; h = rewriteAssetUrls(h, (path) => ra(path)); }
      return h;
    };
    const html = renderOne(slide);
    // a template on the stage: its looks, for the variant picker's thumbnails (the same slide with each v=)
    variantHtml = perSlide && stageAsk.variants && slide.kind === 'template' && slide.template
      ? Array.from({ length: TEMPLATES[slide.template] }, (_, k) => ({ v: k + 1, html: renderOne({ ...slide, templateVariant: k + 1 === 1 ? undefined : k + 1 } as Slide) }))
      : [];
    const key = `${p.theme.id}|${p.ratio}|${hash(html)}`;
    const fitKey = fitKeyOf(text, deck.slides[i] ?? slide);
    postedFitKeys.set(key, { fitKey, index: i });
    if (!force && posted && posted.key === key && posted.index === i) {
      // the same picture for a changed text (an empty notes block, a comment): its fit report holds for it too
      if (posted.fitKey !== fitKey) {
        const r = fits.get(posted.fitKey);
        posted.fitKey = fitKey;
        if (r) { fits.set(fitKey, r); last = { ...r, index: i, fitKey }; layout?.refresh(); }
      }
      post(message(null));
      return;
    }
    posted = { key, index: i, fitKey };
    post(message({ key, html, theme: p.theme.id, scheme: p.theme.scheme, width: size.width, height: size.height, index: i, total: deck.slides.length }));
  }
  const scheduleLive = (ms: number): void => {
    cancel(liveTimer);
    liveTimer = later(() => { void syncLive(); }, ms);
  };

  // the frame's reports: data only (a document script can forge them — at worst a badge or a lint)
  offs.push(shell.preview.on('orz-slides-live-ready', () => { posted = null; scheduleLive(0); }));
  offs.push(shell.preview.on('orz-slides-fit', (m: unknown) => {
    const d = m as { key?: unknown; boxes?: unknown; footerCut?: unknown; scrolls?: unknown } | null;
    if (!d || typeof d.key !== 'string' || !Array.isArray(d.boxes)) return;
    const at = postedFitKeys.get(d.key);
    if (!at) return;
    const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    const boxes = d.boxes.slice(0, 64).map((b: { kind?: unknown; name?: unknown; scale?: unknown; clipped?: unknown; x?: unknown; y?: unknown; w?: unknown; h?: unknown }) => ({
      kind: String(b?.kind ?? '').slice(0, 16), name: String(b?.name ?? '').slice(0, 64), scale: Math.max(0, Math.min(1, num(b?.scale) || 1)), clipped: b?.clipped === true,
      x: num(b?.x), y: num(b?.y), w: num(b?.w), h: num(b?.h),
    }));
    const r: FitReport = { boxes, footerCut: d.footerCut === true, scrolls: d.scrolls === true, parts: at.check ? null : partsOf((d as { parts?: unknown }).parts) };
    // an idle check's report: the slide's fit for the lints and the filmstrip (never the stage's geometry)
    if (at.check) {
      if (!fits.has(at.fitKey)) fits.set(at.fitKey, r);
      postedFitKeys.delete(d.key);
      if (checking?.key === d.key) { checking = null; scheduleCheck(CHECK_GAP_MS); }
      layout?.refresh();
      scheduleLints(150);
      return;
    }
    fits.set(at.fitKey, r);
    last = { ...r, index: at.index, fitKey: at.fitKey };
    layout?.refresh();
    scheduleLints(150);
  }));

  // ── idle fit checks (round B, B-ED-3): the slides the caret has not shown, one at a time, while the reader pauses ──
  let checkTimer: number | null = null;
  let checking: { key: string } | null = null;
  let checks = 0;
  const scheduleCheck = (ms: number): void => { cancel(checkTimer); checkTimer = later(() => { void checkNext(); }, ms); };
  async function checkNext(): Promise<void> {
    checkTimer = null;
    if (destroyed || checking || checks >= CHECK_BUDGET) return;
    const idle = Date.now() - lastTyping;
    if (idle < CHECK_IDLE_MS) { scheduleCheck(CHECK_IDLE_MS - idle); return; }
    // not while the reader drags or runs keys on the stage (the check draws in the same frame)
    const g = (layoutApi as { state?(): { dragging: boolean; pending: boolean } } | null)?.state?.();
    if (g && (g.dragging || g.pending)) { scheduleCheck(CHECK_IDLE_MS); return; }
    const text = shell.getText();
    const deck = parseDeck(text);
    if (deck.slides.length === 0) return;
    // the nearest slide to the caret without a report for its current text
    const c = Math.max(0, slideIndexAt(deck, caret));
    let i = -1;
    for (let k = 0; k < deck.slides.length && i < 0; k++) {
      for (const j of k === 0 ? [c] : [c + k, c - k]) if (j >= 0 && j < deck.slides.length && i < 0 && !fits.has(fitKeyOf(text, deck.slides[j]))) i = j;
    }
    if (i < 0) return;
    const source = await sourceOf(text);
    if (destroyed || shell.getText() !== text) { scheduleCheck(CHECK_GAP_MS); return; }
    const d = source === text ? deck : parseDeck(source);
    const slide = d.slides[i];
    if (!slide) return;
    const p = presentationOf(text);
    const size = slideSize(p.ratio);
    const plans = planDeck(d, p.theme.sectionNumbers);
    let html = renderSlide(slide, plans[i], md as unknown as Renderer, d.config, { env: env(), themeNumbers: p.theme.sectionNumbers });
    if (o.resolveAsset) { const ra = o.resolveAsset; html = rewriteAssetUrls(html, (path) => ra(path)); }
    const key = `check|${p.theme.id}|${p.ratio}|${hash(html)}|${i}`;
    postedFitKeys.set(key, { fitKey: fitKeyOf(text, deck.slides[i]), index: i, check: true });
    checking = { key };
    checks++;
    shell.preview.post({ type: 'orz-slides-check', key, html, theme: p.theme.id, scheme: p.theme.scheme, width: size.width, height: size.height, index: i });
    // a frame that never answers (rebuilt, gone): the next one after a while
    later(() => { if (checking?.key === key) { checking = null; postedFitKeys.delete(key); scheduleCheck(CHECK_IDLE_MS); } }, 4000);
  }

  // ── the lints ──
  let lints: SlideLint[] = [];
  let lintTimer: number | null = null;
  /** The slides of a text with a fit report for their current text. */
  function checkedCount(text: string, deck: Deck): number {
    let n = 0;
    for (const s of deck.slides) if (fits.has(fitKeyOf(text, s))) n++;
    return n;
  }
  function fitLints(text: string, deck: Deck): SlideLint[] {
    const out: SlideLint[] = [];
    /** The deck footer (the header's `footer`) cut: one lint for every slide it is cut on. */
    const deckFooterCut: Slide[] = [];
    for (const s of deck.slides) {
      const r = fits.get(fitKeyOf(text, s));
      if (!r) continue;
      const at = { line: s.marker.line, from: s.marker.from, to: s.marker.to };
      const cut = r.boxes.filter((b) => b.clipped);
      if (cut.length > 0) {
        const names = [...new Set(cut.map((b) => (b.kind === 'region' ? b.name : b.kind)))].join(', ');
        const off = s.options.fit === 'off';
        out.push({ level: 'warning', code: 'cut-on-paper', message: off
          ? `slide ${s.index + 1} is fit=off and its ${names} overflow${cut.length === 1 ? 's' : ''}: it is cut on screen and on paper — shorten it, split it, or let it fit`
          : `slide ${s.index + 1} will be cut on paper: its ${names} still overflow${cut.length === 1 ? 's' : ''} at the smallest size (60%) — shorten it or split it into more slides`, ...at });
      }
      if (r.footerCut) {
        if (s.footer !== undefined) out.push({ level: 'warning', code: 'footer-cut', message: `the footer of slide ${s.index + 1} (its @footer) is cut to one line, shown with "…": shorten it`, ...at });
        else deckFooterCut.push(s);
      }
    }
    if (deckFooterCut.length > 0) {
      const n = deckFooterCut.map((s) => s.index + 1);
      const list = n.length === 1 ? `slide ${n[0]}` : `slides ${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`;
      const s = deckFooterCut[0];
      const unchecked = deck.slides.length - checkedCount(text, deck);
      out.push({ level: 'warning', code: 'footer-cut', message: `the deck footer (the header's footer) is cut to one line, shown with "…", on ${list}${unchecked > 0 ? ` (${unchecked} slide${unchecked === 1 ? '' : 's'} not checked yet)` : ''}: shorten it`, line: s.marker.line, from: s.marker.from, to: s.marker.to });
    }
    return out;
  }
  function computeLints(): SlideLint[] {
    const text = shell.getText();
    let base: SlideLint[] = [];
    try { base = readDocument(text, { kind: 'slides' }).lint as SlideLint[]; } catch { base = []; }
    const all = [...base, ...fitLints(text, parseDeck(text))];
    all.sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
    return all;
  }
  function refreshLints(): readonly SlideLint[] {
    lintTimer = null;
    if (destroyed) return lints;
    lints = computeLints();
    drawLintButton();
    if (panel) drawPanel();
    return lints;
  }
  const scheduleLints = (ms: number): void => { cancel(lintTimer); lintTimer = later(() => { refreshLints(); }, ms); };

  function applyFix(l: Pick<SlideLint, 'code' | 'line'>): boolean {
    if (destroyed || shell.isReadOnly()) return false;
    const now = computeLints();
    const f = now.find((x) => x.code === l.code && x.line === l.line && x.fix);
    if (!f?.fix) return false;
    try {
      if (!shell.applyEdits([{ from: f.fix.from, to: f.fix.to, insert: f.fix.insert }], { label: f.fix.label })) return false;
    } catch (e) {
      showToast(root as never, `Could not apply the fix: ${e instanceof Error ? e.message : String(e)}`, { tone: 'error' });
      return false;
    }
    refreshLints();
    return true;
  }

  // ── the toolbar: Issues, Live slide, This slide ──
  let lintWrap: HTMLElement | null = null;
  let lintBtn: HTMLElement | null = null;
  let lintCount: HTMLElement | null = null;
  let panel: HTMLElement | null = null;
  let liveBtn: HTMLElement | null = null;
  let slideBtn: HTMLElement | null = null;
  const onOutside = (e: Event): void => { if (panel && lintWrap && !e.composedPath().includes(lintWrap)) closePanel(); };
  function closePanel(): void {
    if (!panel) return;
    panel.remove();
    panel = null;
    lintBtn?.setAttribute('aria-expanded', 'false');
    win.removeEventListener('pointerdown', onOutside, true);
  }
  function drawLintButton(): void {
    if (!lintWrap || !lintCount || !lintBtn) return;
    const errors = lints.filter((l) => l.level === 'error').length;
    lintCount.textContent = String(lints.length);
    lintWrap.setAttribute('data-level', errors > 0 ? 'error' : lints.length > 0 ? 'warning' : 'none');
    lintBtn.setAttribute('aria-label', lints.length === 0 ? 'Issues: none' : `Issues: ${lints.length}${errors ? ` (${errors} error${errors === 1 ? '' : 's'})` : ''}`);
  }
  function drawPanel(): void {
    if (!panel) return;
    panel.replaceChildren();
    // what the fit lints cover: the slides with a fit report (the caret's, and the ones checked in idle time)
    const text = shell.getText();
    const deck = parseDeck(text);
    const total = deck.slides.length;
    const checked = checkedCount(text, deck);
    if (checked < total) {
      const c = doc.createElement('div');
      c.className = 'orz-slides-lint__cover';
      c.setAttribute('data-orz-fit-coverage', `${checked}/${total}`);
      c.textContent = `Fit (cut on paper, a cut footer) checked on ${checked} of ${total} slides — the rest are checked while you pause.`;
      panel.append(c);
    }
    if (lints.length === 0) {
      const p = doc.createElement('div');
      p.className = 'orz-slides-lint__empty';
      p.textContent = checked < total ? `No issues on the slides checked so far.` : 'No issues in this deck.';
      panel.append(p);
      return;
    }
    for (const l of lints) {
      const item = doc.createElement('div');
      item.className = 'orz-slides-lint__item';
      item.setAttribute('role', 'listitem');
      item.setAttribute('data-level', l.level);
      item.setAttribute('data-code', l.code);
      const dot = doc.createElement('span');
      dot.className = 'orz-slides-lint__dot';
      const msg = doc.createElement('div');
      msg.className = 'orz-slides-lint__msg';
      const where = doc.createElement('div');
      where.className = 'orz-slides-lint__where';
      where.textContent = `${l.level === 'error' ? 'Error' : l.level === 'warning' ? 'Warning' : 'Note'} · line ${l.line ?? '?'} · ${l.code}`;
      const text = doc.createElement('div');
      text.textContent = l.message;
      msg.append(where, text);
      const acts = doc.createElement('div');
      acts.className = 'orz-slides-lint__acts';
      if (typeof l.from === 'number') {
        const show = button(doc as never, { label: 'Show', variant: 'ghost' }) as unknown as HTMLElement;
        show.addEventListener('click', () => { closePanel(); shell.select(l.from!, Math.max(l.from!, l.to ?? l.from!), { scroll: true }); shell.focus(); });
        acts.append(show);
      }
      if (l.fix) {
        const fix = button(doc as never, { label: `Fix: ${l.fix.label}`, variant: 'ghost' }) as unknown as HTMLElement;
        fix.setAttribute('data-fix', '');
        fix.addEventListener('click', () => { if (!applyFix(l)) showToast(root as never, 'The text changed: the issue has no fix now.', { tone: 'warning' }); });
        acts.append(fix);
      }
      item.append(dot, msg, acts);
      panel.append(item);
    }
  }
  function openPanel(): void {
    if (panel || !lintWrap) return;
    refreshLints();
    panel = doc.createElement('div');
    panel.className = 'orz-slides-lint__panel';
    panel.setAttribute('role', 'list');
    panel.setAttribute('aria-label', 'Issues in this deck');
    drawPanel();
    lintWrap.append(panel);
    lintBtn?.setAttribute('aria-expanded', 'true');
    win.addEventListener('pointerdown', onOutside, true);
  }
  const syncToggles = (): void => {
    liveBtn?.setAttribute('aria-pressed', String(live));
    slideBtn?.setAttribute('aria-pressed', String(perSlide));
  };
  if (toolbar) {
    installCss(root as never, WIDGET_CSS);
    installCss(root as never, PANEL_CSS);
    lintWrap = doc.createElement('span');
    lintWrap.className = 'orz-slides-lint';
    lintBtn = button(doc as never, { label: 'Issues', iconOnly: false }) as unknown as HTMLElement;
    lintBtn.setAttribute('aria-haspopup', 'true');
    lintBtn.setAttribute('aria-expanded', 'false');
    lintBtn.setAttribute('data-orz-slides-lint', '');
    lintCount = doc.createElement('span');
    lintCount.className = 'orz-slides-lint__count';
    lintBtn.append(lintCount);
    lintBtn.addEventListener('click', () => { if (panel) closePanel(); else openPanel(); });
    lintWrap.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Escape' && panel) { e.stopPropagation(); closePanel(); lintBtn?.focus(); } });
    lintWrap.append(lintBtn);
    liveBtn = button(doc as never, { label: 'Live slide', iconOnly: o.iconOnly === true, title: 'Show the slide at the cursor in the preview' }) as unknown as HTMLElement;
    liveBtn.classList.add('orz-slides-toggle');
    liveBtn.setAttribute('data-orz-slides-live', '');
    liveBtn.addEventListener('click', () => setLive(!live));
    slideBtn = button(doc as never, { label: 'This slide', iconOnly: o.iconOnly === true, title: 'Edit the slide at the cursor: the rest of the deck dimmed, the slide as the stage' }) as unknown as HTMLElement;
    slideBtn.classList.add('orz-slides-toggle');
    slideBtn.setAttribute('data-orz-slides-per-slide', '');
    slideBtn.addEventListener('click', () => setPerSlide(!perSlide));
    toolbar.append(lintWrap, liveBtn, slideBtn);
    syncToggles();
    drawLintButton();
  }

  function setLive(on: boolean): void {
    if (destroyed) return;
    live = on === true;
    try { prefs?.set('liveSlide', live); } catch { /* storage refused */ }
    syncToggles();
    posted = null;
    void syncLive(true);
  }

  // ── the per-slide mode (step 6 seam) ──
  let focused: { index: number; from: number; to: number } | null = null;
  let layout: { refresh(): void; destroy(): void } | null = null;
  let layoutApi: unknown = null;
  function focusSlide(deck: Deck, i: number): void {
    const s = i >= 0 ? deck.slides[i] : undefined;
    if (!s) { if (focused) { shell.setFocusRange(null); focused = null; } return; }
    if (focused && focused.index === i && focused.from === s.span.from && focused.to === s.span.to) return;
    const moved = focused?.index !== i;
    focused = { index: i, from: s.span.from, to: s.span.to };
    shell.setFocusRange(s.span.from, s.span.to, { mode: 'dim' });
    // the basic editor dims nothing: the slide's text is brought into view instead (round B, B-ED-5)
    if (engine === 'textarea' && moved) { const at = Math.max(s.span.from, Math.min(s.span.to, caret)); shell.select(at, at, { scroll: true }); }
  }
  /** The frame element and its pane (the kit's preview: `iframe.orz-editor__frame` in the shell's root). KIT GAP: no accessor for the preview pane. */
  const frameEl = (): HTMLIFrameElement | null => (root?.querySelector?.('iframe.orz-editor__frame') as HTMLIFrameElement | null) ?? null;
  /** Fit keys of the slides of one text (the filmstrip asks for many). */
  let fitKeysOf: { text: string; keys: string[] } | null = null;
  const stageHost: StageHost = {
    shell,
    slide: () => { const d = parseDeck(shell.getText()); const i = slideIndexAt(d, caret); return i >= 0 ? { index: i, slide: d.slides[i] } : null; },
    geometry: (): StageGeometry | null => {
      if (!last) return null;
      const text = shell.getText();
      const d = parseDeck(text);
      const i = slideIndexAt(d, caret);
      const current = i === last.index && !!d.slides[i] && fitKeyOf(text, d.slides[i]) === last.fitKey;
      return { index: last.index, boxes: last.boxes.map((b) => ({ ...b })), parts: last.parts, current };
    },
    pane: () => frameEl()?.parentElement ?? null,
    frame: frameEl,
    setStage(a) {
      const n = (v: number): number => (Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0);
      const next = { insets: { top: n(a.insets.top), right: n(a.insets.right), bottom: n(a.insets.bottom), left: n(a.insets.left) }, variants: a.variants === true };
      const same = JSON.stringify(next) === JSON.stringify(stageAsk);
      stageAsk = next;
      if (same || destroyed) return;
      if (perSlide) { posted = null; void syncLive(true); }
    },
    slideSize: () => slideSize(presentationOf(shell.getText()).ratio),
    scheme: () => presentationOf(shell.getText()).theme.scheme,
    engine: () => engine,
    preview(pv: StagePreview) {
      if (!posted || destroyed) return;
      shell.preview.post({ type: 'orz-slides-preview', key: posted.key, ...pv });
    },
    syncNow: () => { cancel(liveTimer); void syncLive(); },
    goTo(i) {
      const d = parseDeck(shell.getText());
      const s = d.slides[Math.max(0, Math.min(d.slides.length - 1, i))];
      if (!s) return;
      const at = caretOf(s);
      caret = at;
      shell.select(at, at, { scroll: true });
      cancel(liveTimer);
      void syncLive();
    },
    fitOf(i) {
      const text = shell.getText();
      if (fitKeysOf?.text !== text) {
        const d = parseDeck(text);
        fitKeysOf = { text, keys: d.slides.map((s) => fitKeyOf(text, s)) };
      }
      const k = fitKeysOf.keys[i];
      const r = k ? fits.get(k) : undefined;
      if (!r) return null;
      return { scale: r.boxes.reduce((m, b) => Math.min(m, b.scale), 1), clipped: r.boxes.some((b) => b.clipped) };
    },
  };
  function setPerSlide(on: boolean): void {
    if (destroyed || on === perSlide) return;
    perSlide = on;
    syncToggles();
    try { o.onPerSlide?.(perSlide); } catch { /* the carrier's */ }
    if (perSlide) {
      layout = o.layoutGui ? o.layoutGui.attach(stageHost) : null;
      layoutApi = (layout as { api?: unknown } | null)?.api ?? null;
    } else {
      layout?.destroy();
      layout = null;
      layoutApi = null;
      stageAsk = { insets: { top: 0, right: 0, bottom: 0, left: 0 }, variants: false };
      focused = null;
      shell.setFocusRange(null);
    }
    posted = null;
    void syncLive(true);
  }

  // ── events ──
  offs.push(shell.on('selection', (e) => {
    caret = e.to;
    caretText = shell.getText();
    // during typing the live view waits for the pause; a caret move alone follows at once
    scheduleLive(Date.now() - lastTyping < LIVE_PAUSE_MS ? LIVE_PAUSE_MS : CARET_PAUSE_MS);
  }));
  /** The layout GUI follows typing at its pause (round B, B-ED-4: a full redraw per key cost 100–300 ms on 300 slides). */
  let layoutTimer: number | null = null;
  offs.push(shell.on('change', (e) => {
    // the caret as the change moved it (a header setting, an AI edit, a reload map it without a selection event: B-ED-2)
    const now = shell.getText();
    const sel = (shell as unknown as { getSelection?(): { from: number; to: number } | null }).getSelection?.();
    if (sel) caret = sel.to;
    else if (now !== caretText) {
      // an older kit: map the caret through the change (the common start and end of the two texts)
      const a = caretText;
      let p0 = 0;
      while (p0 < a.length && p0 < now.length && a.charCodeAt(p0) === now.charCodeAt(p0)) p0++;
      let s0 = 0;
      while (s0 < a.length - p0 && s0 < now.length - p0 && a.charCodeAt(a.length - 1 - s0) === now.charCodeAt(now.length - 1 - s0)) s0++;
      if (caret >= a.length - s0) caret += now.length - a.length;
      else if (caret > p0) caret = Math.min(caret, now.length - s0);
    }
    caretText = now;
    // a layout op (an applyEdits with a label, from the per-slide GUI) shows at once; typing waits for the pause
    const op = perSlide && typeof e?.label === 'string';
    if (!op) lastTyping = Date.now();
    scheduleLive(op ? 0 : LIVE_PAUSE_MS);
    scheduleLints(LIVE_PAUSE_MS + 150);
    scheduleCheck(CHECK_IDLE_MS);
    if (!layout) return;
    cancel(layoutTimer);
    if (op) { layoutTimer = null; layout.refresh(); return; }
    // typing: the stage is marked stale at once (nothing on it acts on an old text), redrawn at the pause
    (layout as { stale?(): void }).stale?.();
    layoutTimer = later(() => { layoutTimer = null; layout?.refresh(); }, LIVE_PAUSE_MS);
  }));
  scheduleLive(0);
  scheduleLints(300);
  scheduleCheck(CHECK_IDLE_MS);

  return {
    caretSlide,
    lints: () => lints,
    refreshLints,
    applyFix,
    isLive: () => live,
    setLive,
    isPerSlide: () => perSlide,
    setPerSlide,
    lastFit: () => (last ? { ...last, boxes: last.boxes.map((b) => ({ ...b })) } : null),
    layoutGui: () => layoutApi,
    syncLive: () => syncLive(true),
    fitCoverage: () => { const text = shell.getText(); const d = parseDeck(text); return { checked: checkedCount(text, d), total: d.slides.length }; },
    destroy() {
      if (destroyed) return;
      try { o.onLeave?.(caretSlide()); } catch { /* the read view's */ }
      destroyed = true;
      layout?.destroy();
      layout = null;
      for (const off of offs.splice(0)) { try { off(); } catch { /* gone */ } }
      for (const id of timers) win.clearTimeout(id);
      timers.clear();
      closePanel();
      lintWrap?.remove();
      liveBtn?.remove();
      slideBtn?.remove();
    },
  };
}
