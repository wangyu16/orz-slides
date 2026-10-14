/**
 * The engine's stylesheets (bundled as text, src/present/virtual.d.ts) and
 * how a page gets them: one `<style>` per part, ids `orz-reveal-css`,
 * `orz-deck-css` and `orz-slide-theme` (swapped when the header's theme
 * changes).
 *
 * All 14 themes are built (rebuild step 4, scripts/build-themes.ts); an id
 * the build lacks would show in the default theme's stylesheet
 * (`data-theme-css` says which).
 */
import { DECK_CSS, REVEAL_CSS, THEME_CSS } from 'orz-slides:themes';
import { DEFAULT_THEME } from '../themes.js';

export { DECK_CSS, REVEAL_CSS };

/** The stylesheet a theme is shown in (its own, else the default theme's) and its id. */
export function themeStylesheet(id: string): { id: string; css: string } {
  if (Object.prototype.hasOwnProperty.call(THEME_CSS, id)) return { id, css: THEME_CSS[id] };
  return { id: DEFAULT_THEME, css: THEME_CSS[DEFAULT_THEME] ?? '' };
}

/** The ids of the themes that have their own stylesheet in this build. */
export const BUILT_THEMES: readonly string[] = Object.freeze(Object.keys(THEME_CSS));

/**
 * A `<style>` whose `@import`s (a theme's webfont CSS) are still loading
 * carries this attribute (round A2, A2-ENG-2): while one does, the fit does
 * not settle and print waits — a `<style>` whose imports are pending has no
 * font faces yet, so the fonts alone report "loaded".
 *
 * Readiness is read from the sheet itself (round A3, A3-ENG-2): a style is
 * loading while its sheet holds an `@import` whose sheet is not there yet
 * (`CSSImportRule.styleSheet === null`); a `load` or `error` event only says
 * when to look again. A theme change REPLACES the element (Chrome fires a
 * `load` for the sheet a `textContent` change replaced: it ended the wait
 * at once). And the wait is bounded (A3-ENG-4): a mark older than
 * {@link FONT_WAIT_MS} is a stalled request (a captive portal, a filter
 * that never answers) — dropped, so it is paid once per theme load, never
 * per slide, print or copy; the fit runs again when the sheet does load.
 */
export const STYLE_LOADING = 'data-orz-loading';

/** How long a theme's webfont CSS, or the fonts themselves, are waited for at most (once, not per slide). */
export const FONT_WAIT_MS = 5000;

/** When each marked style was marked (its wait's start). */
const markedAt = new WeakMap<HTMLStyleElement, number>();

/** True while a style's own sheet has an `@import` not yet loaded. */
function importsPending(el: HTMLStyleElement): boolean {
  let rules: CSSRuleList | null = null;
  try { rules = el.sheet?.cssRules ?? null; } catch { return false; }
  if (!rules) return /@import\b/i.test(el.textContent ?? '');
  for (let i = 0; i < rules.length; i++) {
    const r = rules[i] as CSSRule & { styleSheet?: CSSStyleSheet | null; href?: string };
    if (r.constructor?.name === 'CSSImportRule' || r.type === 3) { if (r.styleSheet == null) return true; }
    else break; // @import rules come first
  }
  return false;
}

/** Drop a mark whose sheet is in (or whose wait ran out); true when it is still loading. */
function stillLoading(el: HTMLStyleElement, now: number): boolean {
  if (!el.hasAttribute(STYLE_LOADING)) return false;
  if (!importsPending(el) || now - (markedAt.get(el) ?? now) >= FONT_WAIT_MS) { el.removeAttribute(STYLE_LOADING); return false; }
  return true;
}

/** True while an engine `<style>`'s imports are loading (within their bounded wait). */
export function stylesPending(doc: Document): boolean {
  const now = Date.now();
  let any = false;
  for (const el of Array.from(doc.querySelectorAll<HTMLStyleElement>(`style[${STYLE_LOADING}]`))) if (stillLoading(el, now)) any = true;
  return any;
}

function mark(el: HTMLStyleElement, css: string): void {
  if (/@import\b/i.test(css)) { el.setAttribute(STYLE_LOADING, ''); markedAt.set(el, Date.now()); }
  else el.removeAttribute(STYLE_LOADING);
}

/** Put (or replace) a `<style id>` in the head; `nonce` stamped when given. */
export function ensureStyle(doc: Document, id: string, css: string, attrs: Record<string, string> = {}): HTMLStyleElement {
  const old = doc.getElementById(id) as HTMLStyleElement | null;
  if (old && old.tagName === 'STYLE' && old.textContent === css) {
    for (const [k, v] of Object.entries(attrs)) old.setAttribute(k, v);
    return old;
  }
  // a new element for new content: its load and error events are its own sheet's (A3-ENG-2)
  const el = doc.createElement('style');
  el.id = id;
  const look = (): void => { stillLoading(el, Date.now()); };
  el.addEventListener('load', look);
  el.addEventListener('error', look);
  if (old) for (const a of Array.from(old.attributes)) if (a.name !== 'id' && a.name !== STYLE_LOADING) el.setAttribute(a.name, a.value);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.textContent = css;
  mark(el, css);
  if (old) old.replaceWith(el);
  else (doc.head ?? doc.documentElement).appendChild(el);
  return el;
}

/** Resolves when no engine `<style>` is loading its imports any more (each waited for at most {@link FONT_WAIT_MS} from its mark; a failed import counts as done). */
export function stylesReady(doc: Document): Promise<void> {
  if (!stylesPending(doc)) return Promise.resolve();
  return new Promise((resolve) => {
    const win = doc.defaultView;
    let timer = 0;
    const check = (): void => { Promise.resolve().then(() => { if (!stylesPending(doc)) finish(); }); };
    const finish = (): void => {
      doc.removeEventListener('load', check, true);
      doc.removeEventListener('error', check, true);
      if (timer) win?.clearInterval(timer);
      resolve();
    };
    doc.addEventListener('load', check, true);
    doc.addEventListener('error', check, true);
    // the bound: a stalled mark expires (stylesPending drops it)
    timer = win ? win.setInterval(check, 250) : 0;
  });
}

/** When the document's fonts were first seen loading (null: not loading now). */
const fontsLoadingSince = new WeakMap<Document, number>();

/**
 * True when the fonts are in — or have been loading for longer than
 * {@link FONT_WAIT_MS} (a stalled font request: waited for once; the
 * engine fits again on `loadingdone`).
 */
export function fontsSettled(doc: Document): boolean {
  const fonts = (doc as Document & { fonts?: FontFaceSet }).fonts;
  if (!fonts || fonts.status === 'loaded') { fontsLoadingSince.delete(doc); return true; }
  const now = Date.now();
  const since = fontsLoadingSince.get(doc);
  if (since === undefined) { fontsLoadingSince.set(doc, now); return false; }
  return now - since >= FONT_WAIT_MS;
}

/** Resolves when {@link fontsSettled}: `fonts.ready`, capped by what is left of the bounded wait. */
export async function fontsReady(doc: Document): Promise<void> {
  const fonts = (doc as Document & { fonts?: FontFaceSet }).fonts;
  if (fontsSettled(doc) || !fonts) return;
  const left = Math.max(0, FONT_WAIT_MS - (Date.now() - (fontsLoadingSince.get(doc) ?? Date.now())));
  await Promise.race([fonts.ready.then(() => undefined, () => undefined), new Promise<void>((r) => setTimeout(r, left + 20))]);
}

/**
 * True when what print is about to use is not all in: the fonts still
 * loading, an engine `<style>` still waiting for its `@import` (a theme's
 * webfont CSS), or a `<link>` stylesheet without its sheet — after the
 * bounded waits ({@link FONT_WAIT_MS}) gave up on them. Print goes ahead
 * (the bound is registered, closed-loop round A3) and says so (rebuild step
 * 5: the notice of round A4's improvement list).
 */
export function stylesLate(doc: Document): boolean {
  const fonts = (doc as Document & { fonts?: FontFaceSet }).fonts;
  if (fonts && fonts.status !== 'loaded') return true;
  for (const el of Array.from(doc.querySelectorAll<HTMLStyleElement>('style[id^="orz-"]'))) if (importsPending(el)) return true;
  for (const l of Array.from(doc.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'))) if (l.media !== 'not all' && !l.sheet) return true;
  return false;
}

/** The page's engine styles: reveal's core, the deck structure and the theme of `themeId`. */
export function installStyles(doc: Document, themeId: string): string {
  ensureStyle(doc, 'orz-reveal-css', REVEAL_CSS);
  ensureStyle(doc, 'orz-deck-css', DECK_CSS);
  const t = themeStylesheet(themeId);
  ensureStyle(doc, 'orz-slide-theme', t.css, { 'data-theme': themeId, 'data-theme-css': t.id });
  return t.id;
}
