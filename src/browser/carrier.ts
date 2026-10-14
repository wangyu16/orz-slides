/**
 * The orz-slides browser API (FC-19 §2): what `globalThis.OrzCarrier` holds
 * in the IIFE bundle and what the ESM build exports — `kind`, `version`,
 * `formats`, `assemble`, `extract`, `readDocument`, `mountEditor`,
 * `renderPreview`.
 *
 * KIND-SPECIFIC (slides): `mountEditor` wraps the kit's `createEditorShell`
 * (orz-markdown `carrier/editor`, FC-19 §8) with the slides renderer (REBUILD
 * STEP 1–2: the flattened deck; step 5 adds the slide dividers and the live
 * view of the caret's slide), the header's theme in the preview
 * (`followPresentation`), and the slides settings (theme, ratio) in the
 * toolbar (`attachSettings`, orz-markdown `carrier/app`); `assemble` is the
 * isomorphic assembler of
 * src/assemble.ts — the same function the Node library runs, so Node and the
 * browser write the same bytes (FC-18 law 2).
 */
import { extract as kitExtract, type DocumentInfo, type Extracted, type HeaderChange } from 'orz-markdown/carrier';
import { attachAiMenu, attachSettings, captureEngineSource, followPresentation, type EngineSource, type StandaloneContext } from 'orz-markdown/carrier/app';
import { createEditorShell, type EditorHooks, type EditorShell } from 'orz-markdown/carrier/editor';
import type { PreferenceStore } from 'orz-markdown/carrier/shell';
import { assemble as assembleSync, cdnBundleUrl, FORMATS, readDocument as slidesReadDocument, type AssembleOptions } from '../assemble.js';
import { presentationOf, shellHead } from '../presentation.js';
import { VERSION } from '../version.js';
import { attachSlidesTools, type SlidesTools } from './slides/editor.js';
import { createLayoutGui } from './slides/layout-gui.js';
import { renderFlat } from './slides/flat.js';
import { slidesFrameDocument, slidesPreviewPresentation, type FrameTheme } from './slides/frame.js';
import type { SlideLayoutGui } from './slides/per-slide.js';
import { activeReadView } from './slides/read-view.js';
import { renderSlides } from './slides/render.js';
import { SLIDES_SETTINGS } from './slides/settings.js';

export const kind = 'slides' as const;
export const version: string = VERSION;
export const formats: number[] = [...FORMATS];

export type { DocumentInfo, Extracted, HeaderChange, EditorHooks, PreferenceStore };

/**
 * The engine an inline assembly writes when no `engineSource` is given. The
 * IIFE entry sets the bundle's own captured script (`captureEngineSource()`,
 * synchronously at its start); the ESM build captures nothing (an app's own
 * script is not the engine), so it fetches this release's IIFE from jsDelivr.
 */
let engine: Pick<EngineSource, 'inline' | 'get'> = captureEngineSource({ currentScript: null });

/** Use a captured engine source (the IIFE entry). */
export function useEngineSource(e: Pick<EngineSource, 'inline' | 'get'>): void {
  engine = e;
}

/**
 * Assemble the `.slides.html` file of a text (FC-19 §2, FC-18 §8): the same bytes
 * as the Node library's `assemble` for the same options. `delivery` defaults to
 * `inline`; an inline file carries `engineSource` — by default this bundle's
 * own text (inline at once; fetched from its URL when loaded by URL or as
 * ESM). `includes` go into `#orz-includes` as given. Rejects what the Node
 * `assemble` throws for.
 */
export function assemble(text: string, options: AssembleOptions = {}): Promise<string> {
  try {
    if ((options.delivery ?? 'inline') === 'inline' && options.engineSource === undefined) {
      const own = engine.inline;
      if (own === null) return engine.get(cdnBundleUrl()).then((src) => assembleSync(text, { ...options, engineSource: src }));
      return Promise.resolve(assembleSync(text, { ...options, engineSource: own }));
    }
    return Promise.resolve(assembleSync(text, options));
  } catch (e) {
    return Promise.reject(e);
  }
}

/** The text of an assembled file (the kit's `extract`), or null for HTML that is not one. */
export function extract(html: string): Extracted | null {
  return kitExtract(html);
}

/** The header and derived facts of a slides text, without rendering (the kit's `readDocument`, kind `slides`, with this carrier's themes, header values and body lints — the Node library's `readDocument`). */
export function readDocument(text: string): DocumentInfo {
  return slidesReadDocument(text, { kind: 'slides' });
}

/** Options of {@link renderPreview}. */
export interface RenderPreviewOptions {
  /** An include `includes` lacks → text or null (the app's trust policy): a URL, or a file include's path as written. Unresolved includes render a quiet "Included file not available" note. */
  fetchInclude?(target: string): Promise<string | null>;
  /** Resolved includes (`extract(html).includes`): target as written → text. */
  includes?: Readonly<Record<string, string>>;
  /** `false`: links as written; default `true` (links to text twins point at their `.html` form). */
  twinLinks?: boolean;
  /**
   * `true`: a whole HTML document (theme, KaTeX and highlight.js stylesheets of
   * the header's theme stylesheets, the flattened deck) for a sandboxed iframe's
   * `srcdoc` — the engine adds no script, but the document's own raw HTML is
   * kept as written (scripts included): show it only in a sandboxed frame.
   * Default `false`: the article's inner HTML.
   */
  document?: boolean;
}

/**
 * Read-only HTML of a text for an app (thumbnails, read views): the article's
 * inner HTML (or, with `document: true`, a whole HTML document with the
 * header's stylesheets and no engine script). Either way the document's own
 * raw HTML is kept as written — scripts included (orz-markdown M.21:
 * documents come from trusted sources): show it in a sandboxed frame.
 */
export async function renderPreview(text: string, options: RenderPreviewOptions = {}): Promise<string> {
  const inner = await renderSlides(text, {
    ...(options.fetchInclude ? { fetchInclude: options.fetchInclude } : {}),
    ...(options.includes ? { includes: options.includes } : {}),
    ...(options.twinLinks === false ? { twinLinks: false } : {}),
  });
  if (!options.document) return inner;
  const p = presentationOf(text);
  const info = readDocument(text);
  const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return `<!doctype html>\n<html lang="${esc(info.lang)}">\n<head>\n<meta charset="utf-8">\n<title>${esc(info.title)}</title>\n${shellHead(p)}\n</head>\n<body>\n<article class="markdown-body">${inner}</article>\n</body>\n</html>\n`;
}

// ── mountEditor ─────────────────────────────────────────────────────────────

/** FC-19 §3 `EditorOptions` (the kit's `KindEditorOptions`, kind `slides`). */
export interface EditorOptions {
  /** The document (FC-18), exact. */
  text: string;
  /** Always `slides` for this carrier (accepted for FC-19 compatibility). */
  kind?: 'slides';
  readOnly?: boolean;
  mode?: 'split' | 'editor' | 'preview';
  /** `full` (labels), `compact` (icons), `none` (no toolbar: the app drives the API). */
  chrome?: 'full' | 'compact' | 'none';
  hooks?: EditorHooks;
  /** Reader preferences (FC-18 §6); default: localStorage, namespaced by the header uid. */
  preferences?: PreferenceStore;
  /**
   * FC-19 §3 `nonce` (FC-19 §8.4 CSP recipe): a CSP nonce stamped on the
   * preview frame's scripts and styles and on CodeMirror's script and
   * style elements. Needed under a nonce-based `script-src`.
   */
  nonce?: string;
  /**
   * FC-19 §3 `includes` (orz-markdown 2.2.0): resolved includes the app hands
   * the renderer (target as written → text), like an assembled file's
   * `#orz-includes`; the preview reads an include here first, then asks
   * `hooks.fetchInclude` (a URL, or a file include's path as written). Without
   * `hooks.save` they also go into the file a save writes.
   */
  includes?: Record<string, string>;
  /**
   * FC-19 §3 `fileName` (orz-markdown 2.2.0): the suggested name of this
   * editor's saves when it has no `hooks.save` (the picker's name and the
   * download's), e.g. `deck.slides.html`. Default `document.slides.html`. An editor
   * mounted on an assembled file saves under the file's own name.
   */
  fileName?: string;
}

/**
 * The Editor of FC-19 §4 (the kit's editor shell, which implements it) —
 * among others `ready` (the engine is final) and `refreshPreview({ includes })`
 * (a new include record for the preview; an app whose includes changed) — and
 * `slides`, this carrier's tools (rebuild step 5, src/browser/slides/editor.ts:
 * the caret's slide, the lints and their quick fixes, the live view, the
 * per-slide mode's entry point).
 */
export type Editor = EditorShell & { readonly slides: SlidesTools };

/** What the flattened preview holds while the per-slide mode shows the stage (it is hidden then). */
const STAGE_FLAT = '<p data-src-line="0"></p>';

/** Carrier-internal mount options (not FC-19): the per-slide mode's layout GUI (default: src/browser/slides/layout-gui.ts; `null`: none). */
export interface SlidesMountExtras {
  layoutGui?: SlideLayoutGui | null;
}

/**
 * Mount the slides editor (FC-19 §3–4) in `element`: the kit's editor shell with
 * the flattened slides preview (src/browser/slides/render.ts), the header's
 * theme in the preview (it follows header edits), and the slides
 * settings in its toolbar (spec/carrier-app.md §3.2).
 *
 * With `hooks.save` the app owns persistence (FC-19 §8.5 app host). Without it
 * the standalone save runs: on an assembled file (`ctx`, given by the kit's
 * app) through the file's own saver, host connection, delivery and includes;
 * elsewhere an inline assembly through the File System Access picker or a
 * download.
 */
export function mountEditor(element: HTMLElement, options: EditorOptions, standalone?: StandaloneContext, extras: SlidesMountExtras = {}): Editor {
  if (!element || typeof element !== 'object') throw new TypeError('orz-slides: mountEditor needs an element');
  if (!options || typeof options.text !== 'string') throw new TypeError('orz-slides: options.text must be a string');
  const appHooks: EditorHooks = options.hooks ?? {};
  const isApp = typeof appHooks.save === 'function';
  const ctx = isApp ? undefined : standalone;

  // the AI hook: the app's, or the file's host (the kit's app then adds the AI menu itself)
  const ai = appHooks.ai ?? ctx?.ai;
  const fetchInclude = appHooks.fetchInclude ?? ctx?.fetchInclude;
  const hooks: EditorHooks = { ...appHooks, ...(ai ? { ai } : {}), ...(fetchInclude ? { fetchInclude } : {}) };
  const preferences = options.preferences ?? ctx?.preferences;
  // the frame is written for the header's theme (followPresentation rebuilds it when the theme changes)
  const theme: FrameTheme = { id: presentationOf(options.text).theme.id };
  const present = (text: string) => slidesPreviewPresentation(text, theme);
  // an editor mounted on the page's own file keeps the read view's slide (and gives it back on leaving)
  const view = ctx ? activeReadView() : null;
  const startSlide = view ? view.engine.index() : undefined;

  let perSlideNow = false;
  const shell = createEditorShell(element as never, {
    text: options.text,
    // the per-slide mode hides the flattened flow (the stage fills the pane): it is not rendered then, so an op
    // on a long deck costs no full re-render (rebuild step 6); leaving the mode renders it again
    render: (text, rc) => (perSlideNow ? STAGE_FLAT : renderFlat(text, rc)),
    kind: 'slides',
    formats: [...FORMATS],
    ...(options.mode ? { mode: options.mode } : {}),
    ...(options.readOnly ? { readOnly: true } : {}),
    ...(options.chrome ? { chrome: options.chrome } : {}),
    ...(preferences ? { preferences } : {}),
    ...(options.nonce ? { nonce: options.nonce } : {}),
    ...(ctx?.adapter ? { adapter: ctx.adapter } : {}),
    hooks,
    ...(isApp ? {
      ...(options.includes ? { includes: options.includes } : {}),
      ...(typeof options.fileName === 'string' && options.fileName !== '' ? { fileName: options.fileName } : {}),
    } : ctx ? {
      assemble: ctx.assemble,
      fileName: ctx.fileName,
      saver: ctx.saver,
      ...(ctx.host ? { host: ctx.host } : {}),
      ...(ctx.includes ? { includes: ctx.includes } : {}),
      ...(ctx.openedHtml ? { openedHtml: ctx.openedHtml } : {}),
      standalone: ctx.standalone,
    } : {
      // no hooks.save and no file: an inline file of the text (with the app's includes), through the picker or a download
      assemble: (t: string, o?: { includes?: Record<string, string> }) => assemble(t, { ...(o?.includes ? { includes: o.includes } : {}) }),
      ...(options.includes ? { includes: options.includes } : {}),
      ...(typeof options.fileName === 'string' && options.fileName !== '' ? { fileName: options.fileName } : {}),
    }),
    preview: { ...present(options.text), frameDocument: (parts) => slidesFrameDocument(parts, theme) },
  });

  // the carrier's tools in the toolbar (FC-19 §1: the same tools for every host)
  const iconOnly = options.chrome === 'compact';
  const settings = attachSettings(shell, SLIDES_SETTINGS, { iconOnly });
  // an app's own AI hook gets the AI menu here — also in an editor mounted on a file, unless the
  // file's host offers AI (then the kit's app adds the host's menu to this editor itself)
  const appAi = appHooks.ai;
  const aiMenu = appAi && !ctx?.ai ? attachAiMenu(shell, { operations: () => (Array.isArray(appAi.operations) ? appAi.operations : []), iconOnly }) : null;
  // the preview follows the header's theme
  const unfollow = followPresentation(shell, present);
  // the slides tools: the live view, the lints, the per-slide mode's entry point, the slide kept across modes
  const includes = isApp ? options.includes : ctx?.includes;
  const tools = attachSlidesTools(shell, {
    ...(includes ? { includes } : {}),
    ...(fetchInclude ? { fetchInclude } : {}),
    ...(appHooks.resolveAsset ? { resolveAsset: appHooks.resolveAsset } : {}),
    iconOnly,
    ...(startSlide !== undefined ? { startSlide } : {}),
    ...(view ? { onLeave: (i: number) => view.goTo(i) } : {}),
    layoutGui: extras.layoutGui === undefined ? createLayoutGui() : extras.layoutGui,
    onPerSlide: (on: boolean) => { perSlideNow = on; void shell.refreshPreview(); },
  });

  const destroy = shell.destroy.bind(shell);
  shell.destroy = () => {
    tools.destroy();
    unfollow();
    settings.destroy();
    aiMenu?.destroy();
    destroy();
  };
  return Object.assign(shell, { slides: tools }) as Editor;
}

/** Re-exported for apps: the header edit the pickers apply (FC-18 §9). */
export { editHeader } from 'orz-markdown/carrier';
