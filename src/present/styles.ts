/**
 * The engine's stylesheets (bundled as text, src/present/virtual.d.ts) and
 * how a page gets them: one `<style>` per part, ids `orz-reveal-css`,
 * `orz-deck-css` and `orz-slide-theme` (swapped when the header's theme
 * changes).
 *
 * REBUILD STEP 3: one theme is built (Orchard); every other theme id is
 * shown in Orchard's stylesheet (a stand-in, `data-theme-css` says which)
 * until rebuild step 4 builds the other 13.
 */
import { DECK_CSS, REVEAL_CSS, THEME_CSS } from 'orz-slides:themes';
import { DEFAULT_THEME } from '../themes.js';

export { DECK_CSS, REVEAL_CSS };

/** The stylesheet a theme is shown in (its own, else the stand-in) and its id. */
export function themeStylesheet(id: string): { id: string; css: string } {
  if (Object.prototype.hasOwnProperty.call(THEME_CSS, id)) return { id, css: THEME_CSS[id] };
  return { id: DEFAULT_THEME, css: THEME_CSS[DEFAULT_THEME] ?? '' };
}

/** The ids of the themes that have their own stylesheet in this build. */
export const BUILT_THEMES: readonly string[] = Object.freeze(Object.keys(THEME_CSS));

/** Put (or replace) a `<style id>` in the head; `nonce` stamped when given. */
export function ensureStyle(doc: Document, id: string, css: string, attrs: Record<string, string> = {}): HTMLStyleElement {
  let el = doc.getElementById(id) as HTMLStyleElement | null;
  if (!el || el.tagName !== 'STYLE') {
    el = doc.createElement('style');
    el.id = id;
    (doc.head ?? doc.documentElement).appendChild(el);
  }
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (el.textContent !== css) el.textContent = css;
  return el;
}

/** The page's engine styles: reveal's core, the deck structure and the theme of `themeId`. */
export function installStyles(doc: Document, themeId: string): string {
  ensureStyle(doc, 'orz-reveal-css', REVEAL_CSS);
  ensureStyle(doc, 'orz-deck-css', DECK_CSS);
  const t = themeStylesheet(themeId);
  ensureStyle(doc, 'orz-slide-theme', t.css, { 'data-theme': themeId, 'data-theme-css': t.id });
  return t.id;
}
