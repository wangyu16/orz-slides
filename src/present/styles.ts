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
 * carries this attribute until its `load` or `error` event (round A2,
 * A2-ENG-2): while one does, the fit does not settle and print waits — a
 * `<style>` whose imports are pending has no font faces yet, so the fonts
 * alone report "loaded".
 */
export const STYLE_LOADING = 'data-orz-loading';

/** The sheet a mark waits for (a style element's load names no sheet). */
const loadingSheet = new WeakMap<HTMLStyleElement, CSSStyleSheet | null>();

/** Put (or replace) a `<style id>` in the head; `nonce` stamped when given. */
export function ensureStyle(doc: Document, id: string, css: string, attrs: Record<string, string> = {}): HTMLStyleElement {
  let el = doc.getElementById(id) as HTMLStyleElement | null;
  if (!el || el.tagName !== 'STYLE') {
    el = doc.createElement('style');
    el.id = id;
    const me = el;
    // only the CURRENT sheet's load ends the wait (Chrome also fires one for the sheet it replaced)
    const done = (): void => { if (loadingSheet.get(me) === me.sheet) me.removeAttribute(STYLE_LOADING); };
    el.textContent = css;
    el.addEventListener('load', done);
    el.addEventListener('error', done);
    if (/@import\b/i.test(css)) el.setAttribute(STYLE_LOADING, '');
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    (doc.head ?? doc.documentElement).appendChild(el);
    loadingSheet.set(el, el.sheet);
    return el;
  }
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (el.textContent !== css) {
    if (/@import\b/i.test(css)) el.setAttribute(STYLE_LOADING, '');
    else el.removeAttribute(STYLE_LOADING);
    el.textContent = css;
    loadingSheet.set(el, el.sheet);
  }
  return el;
}

/** Resolves when no engine `<style>` is loading its imports any more (at most `ms`; a failed import counts as done). */
export function stylesReady(doc: Document, ms: number): Promise<void> {
  const pending = (): boolean => doc.querySelector(`style[${STYLE_LOADING}]`) !== null;
  if (!pending()) return Promise.resolve();
  return new Promise((resolve) => {
    const win = doc.defaultView;
    let timer = 0;
    // the element's own listener (target phase) clears the mark after this capture listener ran
    const check = (): void => { Promise.resolve().then(() => { if (!pending()) finish(); }); };
    const finish = (): void => {
      doc.removeEventListener('load', check, true);
      doc.removeEventListener('error', check, true);
      if (timer) win?.clearTimeout(timer);
      resolve();
    };
    doc.addEventListener('load', check, true);
    doc.addEventListener('error', check, true);
    timer = win ? win.setTimeout(finish, ms) : 0;
  });
}

/** The page's engine styles: reveal's core, the deck structure and the theme of `themeId`. */
export function installStyles(doc: Document, themeId: string): string {
  ensureStyle(doc, 'orz-reveal-css', REVEAL_CSS);
  ensureStyle(doc, 'orz-deck-css', DECK_CSS);
  const t = themeStylesheet(themeId);
  ensureStyle(doc, 'orz-slide-theme', t.css, { 'data-theme': themeId, 'data-theme-css': t.id });
  return t.id;
}
