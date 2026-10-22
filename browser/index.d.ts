/**
 * Types of `orz-slides-browser` (FC-19 §2–4): the IIFE's `globalThis.OrzCarrier`
 * and the ES module's named exports have this shape. Self-contained (no
 * dependency on orz-markdown's types); the full definitions live in
 * orz-markdown `carrier/editor` (FC-19 §8) and in orz-slides' sources
 * (`src/types.ts`, `src/layout-ops.ts`).
 */

export type Kind = 'md' | 'slides' | 'paged';
export type EditorMode = 'split' | 'editor' | 'preview';
export type HeaderChange = string | null | { multiline: string };
export type Ratio = '16:9' | '4:3';

export interface AssembleOptions {
  /** `inline` (default) inlines the engine; `cdn` loads it from jsDelivr. */
  delivery?: 'inline' | 'cdn';
  /** The exact text of `orz-slides.browser.js` for an inline file (default: this bundle's own text; the ES module fetches it from jsDelivr). */
  engineSource?: string;
  /** Resolved includes stored in `#orz-includes` exactly as given. */
  includes?: Record<string, string>;
}

export interface Extracted {
  text: string;
  kind: Kind;
  format: number;
  shell: string;
  delivery: string;
  includes?: Record<string, string>;
  /**
   * (1.1) An orz-slides 0.x file: `text` is what the Node `upgrade` writes (the deck block, title, metadata and the
   * theme 0.x showed moved into one header; a fresh uid when it had none), `shell` is ''; what was converted.
   */
  legacy?: { version: string | null; notes: string[] };
}

export interface Lint { level: 'error' | 'warning' | 'info'; code: string; message: string; line?: number; from?: number; to?: number; next?: string }

export interface DocumentInfo {
  kind: Kind;
  format: number;
  header: { start: number; end: number; fields: Record<string, string>; keys: string[] } | null;
  meta: Record<string, unknown> & { title?: string; author?: string; uid?: string; keywords?: string[] };
  theme?: string;
  lang: string;
  /** The slides settings: `ratio`, `footer`, `transition`, `slide_numbers`, `progress`, `section_numbers` (as written; `slide_numbers` / `progress` default `yes`). */
  settings: Record<string, string>;
  hostKeys: Record<string, string>;
  title: string;
  /** The header's lints and the deck's (slide markers, regions, options, headings), with lines. */
  lint: Lint[];
}

export interface TextRange { from: number; to: number }
export interface AiOperation { id: string; title: string; selection: boolean }

export interface EditorHooks {
  /** App host: persist the text (absent: the standalone save). */
  save?(text: string): Promise<void>;
  ai?: { operations: AiOperation[]; request(op: string, ctx: { text: string; selection?: TextRange }): Promise<{ proposed: string }> };
  /** An include `includes` lacks: a URL, or a file include's path as written (your trust policy); null = not available. */
  fetchInclude?(target: string): Promise<string | null>;
  /** A relative `src` in the preview and the live slide, synchronously: the URL to load. */
  resolveAsset?(path: string): string;
  uploadAsset?(file: File): Promise<string>;
  resolveLink?(href: string): string;
  mintUid?(): Promise<string>;
}

export interface PreferenceStore {
  get(key: string): unknown;
  set(key: string, value: unknown): boolean;
  remove(key: string): void;
  all(): Record<string, unknown>;
}

export interface EditorOptions {
  text: string;
  kind?: 'slides';
  readOnly?: boolean;
  mode?: EditorMode;
  chrome?: 'full' | 'compact' | 'none';
  hooks?: EditorHooks;
  preferences?: PreferenceStore;
  /** FC-19 §3 `nonce`: your CSP nonce, stamped on the preview frame's and CodeMirror's scripts and styles (FC-19 §8.4). */
  nonce?: string;
  /** FC-19 §3 `includes`: resolved includes for the preview (target as written → text), read before `hooks.fetchInclude`; without `hooks.save` also stored in a saved file. */
  includes?: Record<string, string>;
  /** FC-19 §3 `fileName`: the suggested file name of saves without `hooks.save` (picker and download), e.g. `talk.slides.html`; default `document.slides.html`. */
  fileName?: string;
}

export type SaveVia = 'hook' | 'host' | 'file' | 'download';
export type SaveOutcome = { ok: true; via: SaveVia } | { ok: false; via?: SaveVia | 'served-notice'; error: string; cancelled?: boolean; conflict?: boolean };
export type AiOutcome = { ok: true; op: string } | { ok: false; error: string };
/** An AI proposal awaiting the reader's review (`proposeAi`); only the editor that made it can apply it (`applyAi`). */
export interface AiProposal {
  readonly op: string;
  readonly proposed: string;
  readonly range: Readonly<TextRange>;
  readonly original: string;
  readonly passage: boolean;
}
export type AiProposalOutcome = { ok: true; op: string; proposal: AiProposal } | { ok: false; error: string };
export type UploadOutcome = { ok: true; inserted: string[] } | { ok: false; inserted: string[]; error: string };

export interface EditorEvents {
  /** `label`: the undo step's name of an `applyEdits` edit (a layout op). */
  change: { text: string; label?: string };
  dirty: { dirty: boolean };
  selection: { from: number; to: number };
  save: { text: string; via: SaveVia };
  error: { source: 'save' | 'render' | 'adapter' | 'format' | 'hook'; message: string; error: unknown };
  /** The reader's Cmd/Ctrl+P in the editor or its preview: with a listener the browser's print is prevented and the listener decides. */
  print: { source: 'preview' | 'editor' };
}

/** A lint of the deck as the editor shows it (with its quick fix, when it has one). */
export interface SlideLint extends Lint { fix?: { from: number; to: number; insert: string; label: string } }

/** The live slide's fit report: per box its scale (1 = unscaled, floor 0.6) and whether its content is cut. */
export interface FitReport {
  index: number;
  boxes: Array<{ kind: string; name: string; scale: number; clipped: boolean; x: number; y: number; w: number; h: number }>;
  footerCut: boolean;
  scrolls: boolean;
}

/** orz-slides' tools of a mounted editor (`editor.slides`). */
export interface SlidesTools {
  /** The caret's slide (0-based). */
  caretSlide(): number;
  /** The deck's lints as last computed (after a typing pause). */
  lints(): readonly SlideLint[];
  /** Compute the lints now. */
  refreshLints(): readonly SlideLint[];
  /** Apply a lint's quick fix (one undoable edit); false when there is none any more. */
  applyFix(lint: { code: string; line?: number }): boolean;
  /** The live slide card in the preview's corner: open, or folded to a small tab (a reader preference). */
  isLive(): boolean;
  setLive(on: boolean): void;
  /** Single-slide editing (the card enlarged into the layout GUI over the slide), or the flattened preview. */
  isPerSlide(): boolean;
  setPerSlide(on: boolean): void;
  /** The live slide's last fit report, or null before one. */
  lastFit(): FitReport | null;
  /** How many slides have a fit report for their current text. */
  fitCoverage(): { checked: number; total: number };
}

export interface Editor {
  getText(): string;
  setText(text: string, options?: { resetHistory?: boolean }): void;
  setHeader(changes: Record<string, HeaderChange>): void;
  /** Apply several replacements (exact offsets, sorted, not overlapping) as ONE undoable edit — e.g. an `applyOp` result's `edits`. */
  applyEdits(edits: ReadonlyArray<{ from: number; to: number; insert: string }>, options?: { label?: string }): boolean;
  /** Select a range of the text (`scroll`: bring it into view). */
  select(from: number, to: number, options?: { scroll?: boolean }): void;
  /** The selection in exact offsets, or null. */
  getSelection(): { from: number; to: number } | null;
  /** Dim (or fold) the text outside a range (a slide); `null` shows everything again. */
  setFocusRange(from: number | null, to?: number, options?: { mode?: 'dim' | 'fold' }): void;
  /** Light the lines the ranges touch for a moment (what a tool just changed). */
  flash(ranges: ReadonlyArray<{ from: number; to: number }>, options?: { ms?: number }): void;
  undo(): boolean;
  redo(): boolean;
  isDirty(): boolean;
  markSaved(): void;
  save(): Promise<SaveOutcome>;
  setMode(mode: EditorMode): void;
  getMode(): EditorMode;
  focus(): void;
  on<E extends keyof EditorEvents>(event: E, fn: (e: EditorEvents[E]) => void): () => void;
  destroy(): void;
  requestAi(op: string, options?: { selection?: boolean }): Promise<AiOutcome>;
  proposeAi(op: string, options?: { selection?: boolean }): Promise<AiProposalOutcome>;
  applyAi(proposal: AiProposal, options?: { proposed?: string }): AiOutcome;
  uploadAssets(files: ArrayLike<File>): Promise<UploadOutcome>;
  ensureUid(): Promise<string>;
  setReadOnly(readOnly: boolean): void;
  isReadOnly(): boolean;
  refreshPreview(options?: { includes?: Record<string, string> | null }): Promise<void>;
  readonly ready: Promise<{ engine: string; error?: unknown }>;
  /** orz-slides' own tools: the caret's slide, lints and quick fixes, the live card, single-slide editing. */
  readonly slides: SlidesTools;
}

export interface RenderPreviewOptions {
  fetchInclude?(target: string): Promise<string | null>;
  includes?: Readonly<Record<string, string>>;
  twinLinks?: boolean;
  /**
   * A whole HTML document (the header's slide theme and the flattened
   * preview's styles inline, KaTeX and highlight.js stylesheets linked, the
   * deck flattened into one flow with a divider per slide; no engine script)
   * instead of the flattened deck's HTML. Either way the document's own raw HTML is
   * kept as written — show it in a sandboxed frame.
   */
  document?: boolean;
  /**
   * With `document: true`: a CSP nonce stamped on the document's `<style>`
   * elements (a `srcdoc` frame inherits the app's policy). The engine adds no
   * script; the document's own raw HTML is not stamped.
   */
  nonce?: string;
}

/** A slide theme (`THEMES`). */
export interface SlideTheme {
  id: string;
  name: string;
  scheme: 'light' | 'dark';
  /** The orz-markdown theme it is derived from, or null (an updated 0.x theme). */
  derivedFrom: string | null;
  sectionNumbers: 'plain' | 'roman' | '01' | 'none';
  description: string;
}

/** A deck template (`TEMPLATES`, `newDocument({ template })`). */
export interface TemplateInfo { id: string; label: string; description: string }

/** A layout op of the per-slide editor (orz-slides `src/layout-ops.ts`); boxes are region names, floats are counted in slide order. */
export type LayoutOp =
  | { type: 'split'; box: string; dir: 'row' | 'col' }
  | { type: 'delete-box'; box: string }
  | { type: 'tracks'; path: number[]; tracks: string[] }
  | { type: 'preset'; preset: 'single' | '2col' | '3col' | '2row' | 'main-side' | 'quad' }
  | { type: 'rename'; box: string; to: string }
  | { type: 'swap'; a: string; b: string }
  | { type: 'move-content'; from: string; to: string }
  | { type: 'ensure-region'; name: string }
  /** (1.1) An empty box (a region, `notes` or `footer`) made ready to write in: a place and an empty line under its marker; `select` is that line. */
  | { type: 'open'; name: string }
  /** (1.1) The same for an empty float. */
  | { type: 'open-float'; index: number }
  | { type: 'float-add'; box?: { left: number; top: number; w: number; h: number }; covers?: boolean }
  | { type: 'float-geom'; index: number; box: Partial<{ left: number; top: number; w: number; h: number }>; from?: { left: number; top: number; w: number; h: number } }
  | { type: 'float-delete'; index: number }
  | { type: 'float-z'; index: number; dir: 'forward' | 'backward' }
  | { type: 'variant'; v: number }
  | { type: 'options'; set: { fit?: 'fit' | 'scroll' | 'off' | null; bg?: string | null; transition?: string | null; step?: boolean } }
  | { type: 'slide-add'; after?: boolean }
  | { type: 'slide-duplicate' }
  | { type: 'slide-delete' }
  | { type: 'slide-move'; to: number };

export interface TextEdit { from: number; to: number; insert: string }

/** What a layout op does to the text: minimal edits on marker lines (a deleted box's block moves to its neighbour). */
export interface OpResult {
  edits: TextEdit[];
  text: string;
  label: string;
  slide: number;
  select?: TextRange;
  changed: TextRange[];
}

/** Where each part of a slide is in the text. */
export interface SlideMap {
  index: number;
  kind: 'normal' | 'template';
  boxes: Array<{ name: string; range: TextRange | null; marker: TextRange | null; empty: boolean }>;
  title: TextRange | null;
  floats: Array<{ range: TextRange; marker: TextRange; box: { left: number; top: number; w: number; h: number }; z: number | undefined; empty: boolean; exact: boolean }>;
  notes: TextRange | null;
  footer: TextRange | null;
  marker: TextRange;
  span: TextRange;
}

/** The parsed deck (format 1, FC-18 §7.2); the full type is orz-slides' `Deck` (`src/types.ts`). */
export interface Deck {
  config: { title?: string; theme: string; themeAsWritten?: string; ratio: Ratio; author?: string; footer?: string; transition?: string; slideNumbers: boolean; progress: boolean; sectionNumbers: 'plain' | 'roman' | '01' | 'none' | null };
  slides: Array<{ index: number; kind: 'normal' | 'template'; template?: 'title' | 'section' | 'outline' | 'closing'; title?: string; layoutSpec: string; regions: Array<{ name: string; markdown: string }>; notes?: string; footer?: string; span: TextRange } & Record<string, unknown>>;
  preamble: TextRange | null;
  lint: SlideLint[];
}

export declare const kind: 'slides';
export declare const version: string;
export declare const formats: number[];
export declare function assemble(text: string, options?: AssembleOptions): Promise<string>;
export declare function extract(html: string): Extracted | null;
export declare function readDocument(text: string): DocumentInfo;
export declare function renderPreview(text: string, options?: RenderPreviewOptions): Promise<string>;
export declare function mountEditor(element: HTMLElement, options: EditorOptions): Editor;
export declare function editHeader(text: string, changes: Readonly<Record<string, HeaderChange>>): string;
/** The 14 slide themes a header `theme` may name. */
export declare const THEMES: readonly SlideTheme[];
export declare const DEFAULT_THEME: string;
/** The deck templates (`starter`, `talk`, `minimal`). */
export declare const TEMPLATES: readonly TemplateInfo[];
export declare const TEMPLATE_IDS: readonly string[];
export declare const DEFAULT_TEMPLATE: string;
/** A new format-1 slides text from a deck template (`carrier: slides`, a fresh `uid` unless given). Throws for an unknown template, theme or ratio. */
export declare function newDocument(options?: { template?: string; title?: string; theme?: string; ratio?: Ratio; uid?: string }): string;
/** Parse a slides text (format 1): the deck, its slides and lints. */
export declare function parseDeck(text: string): Deck;
/** One layout op on slide `index` (0-based) → the minimal text edits; throws `LayoutOpError` when the op cannot apply (the text unchanged). */
export declare function applyOp(text: string, index: number, op: LayoutOp): OpResult;
/** Apply sorted, non-overlapping edits to a text. */
export declare function applyEdits(text: string, edits: readonly TextEdit[]): string;
/** Where each part of slide `index` is in the text, or null. */
export declare function slideMap(text: string, index: number): SlideMap | null;
export declare class LayoutOpError extends Error { readonly code: 'no-slide' | 'no-box' | 'only-box' | 'bad-name' | 'template' | 'normal' | 'blocked' | 'no-float' | 'no-change' | 'bad-value' | 'only-slide' | 'unsafe' }
/** The layout choices of the per-slide editor (`single` and the presets). */
export declare const PRESET_CHOICES: readonly string[];
/** The logical slide size per ratio (16:9 → 1280 × 720, 4:3 → 960 × 720). */
export declare const SLIDE_SIZE: Readonly<Record<Ratio, { width: number; height: number }>>;

/** How a save from an assembled file's page went. */
export interface StandaloneSaveOutcome { ok: boolean; via?: string; error?: string; cancelled?: boolean }

/**
 * The page-side handle of an assembled `.slides.html` that booted (orz-markdown
 * `carrier/app` `CarrierApp`; `OrzCarrier.standalone`). Not part of FC-19:
 * tests, the conformance driver and scripts in a file's own page use it.
 */
export interface StandaloneFile {
  getText(): string;
  isDirty(): boolean;
  edit(): Editor;
  leave(): Promise<void>;
  editor(): Editor | null;
  setSetting(changes: Record<string, HeaderChange>): void;
  undo(): boolean;
  redo(): boolean;
  save(): Promise<StandaloneSaveOutcome>;
  download(): Promise<StandaloneSaveOutcome>;
  newDocument(options?: { text?: string; name?: string }): Promise<StandaloneSaveOutcome>;
  saveAsCopy(): Promise<StandaloneSaveOutcome>;
  toast(message: string, tone?: 'info' | 'success' | 'warning' | 'error'): void;
  readonly updating: boolean;
  readonly ready: Promise<void>;
  /** The handle's list of operations (the pencil's: Edit, Present, Print, Print with notes, Speaker view, Overview, Save, …, the settings). */
  readonly menu: { open(): void; close(): void; isOpen(): boolean };
}

/** `OrzCarrier.layout`: the format-1 parser and the per-slide editor's pure layout ops (also exported by name from the ES module). */
export interface LayoutApi {
  parseDeck: typeof parseDeck;
  applyOp: typeof applyOp;
  applyEdits: typeof applyEdits;
  slideMap: typeof slideMap;
  LayoutOpError: typeof LayoutOpError;
  PRESET_CHOICES: typeof PRESET_CHOICES;
  SLIDE_SIZE: typeof SLIDE_SIZE;
}

export interface OrzCarrierApi {
  kind: 'slides';
  version: string;
  formats: number[];
  assemble: typeof assemble;
  extract: typeof extract;
  readDocument: typeof readDocument;
  mountEditor: typeof mountEditor;
  renderPreview: typeof renderPreview;
  /** orz-slides' extension: the parser and the layout ops. */
  layout: LayoutApi;
  /** The booted file's handle in an assembled `.slides.html` (the IIFE only); null elsewhere. Not in the ES module's `OrzCarrier`. */
  readonly standalone?: StandaloneFile | null;
}
export declare const OrzCarrier: OrzCarrierApi;

declare global {
  // eslint-disable-next-line no-var
  var OrzCarrier: OrzCarrierApi | undefined;
}
