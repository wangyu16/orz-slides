/**
 * App-side print of a deck (1.1, STATUS D-114; FC-19 §4 `print` event, §8.5
 * "Printing the document"): what an embedding app calls when the reader
 * presses Cmd/Ctrl+P in the editor or its preview —
 *
 *   editor.on('print', () => OrzCarrier.printDeck(editor.getText(), { nonce }));
 *
 * It prints the same document as the assembled file's Print (and Print with
 * notes): one slide per page at the slide's logical size, every fragment
 * shown, each slide fitted as on screen, cuts marked (src/present/print.ts).
 * That document is measured, so it is built in a hidden same-origin frame of
 * the app's page that carries the engine's stylesheets (stamped with the
 * app's nonce: the frame inherits the page's policy) — never in the app's
 * own document, whose styles it would touch — and then printed with the
 * kit's `printDocument` (a hidden `srcdoc` frame sandboxed `allow-scripts
 * allow-modals`; the app's page is never printed). The print document holds
 * no script; its `<style>` elements carry the nonce.
 */
import type { TwinNaming } from 'orz-markdown/carrier';
import { printDocument } from 'orz-markdown/carrier/editor';
import { readDocument } from '../../assemble.js';
import { presentationOf } from '../../presentation.js';
import { PREVIEW_CDN } from 'orz-markdown/preview-frame';
import { buildPrintDocument, cutMessage } from '../../present/print.js';
import { DECK_CSS, ensureStyle, REVEAL_CSS, themeStylesheet } from '../../present/styles.js';

/** Options of {@link printDeck}. */
export interface PrintDeckOptions {
  /** Each page: the slide over its speaker notes ("Print with notes"). Default `false`. */
  notes?: boolean;
  /** Resolved includes (target as written → text), as the editor's `includes`. */
  includes?: Readonly<Record<string, string>>;
  /** An include `includes` lacks (a URL): text or null — the app's trust policy. */
  fetchInclude?(target: string): Promise<string | null>;
  /** The host's twin-link naming (FC-18 §8.2) for links to text twins; default the family names. */
  twinLinks?: TwinNaming;
  /** The app's CSP nonce: stamped on the stylesheets of the measuring frame and of the print document, and on the print frame's script. */
  nonce?: string;
  /** The app's page (default `globalThis.document`). */
  document?: Document;
  /** How long the print frame waits for the document's fonts (ms; the kit's `printDocument` default otherwise). */
  readyTimeoutMs?: number;
  /** Told what print had to cut (a slide past the fit floor, notes past their page), in the reader's words; nothing when nothing was cut. */
  onCut?(message: string): void;
}

/** The nonce attribute value, or null for none. */
const nonceOf = (n: unknown): string | null => (typeof n === 'string' && n !== '' ? n : null);

/** The print document's `<style>` elements, stamped with a nonce (a `srcdoc` frame inherits the app's policy). */
export function stampStyles(html: string, nonce: string | null): string {
  if (nonce === null) return html;
  const v = nonce.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return html.replace(/<style>/g, `<style nonce="${v}">`);
}

/**
 * Build the print document of a slides text in an app's page (see the module
 * comment): the whole HTML document, its page count and size, and what was
 * cut. The measuring frame is removed before it resolves.
 */
export async function deckPrintDocument(text: string, options: PrintDeckOptions = {}): Promise<{ html: string; pages: number; width: number; height: number; cut: string }> {
  if (typeof text !== 'string') throw new TypeError('orz-slides: printDeck needs the text (a string)');
  const doc = options.document ?? (globalThis as unknown as { document?: Document }).document;
  if (!doc?.body) throw new Error('orz-slides: printDeck needs a page with a <body>');
  const nonce = nonceOf(options.nonce);
  const p = presentationOf(text);
  const info = readDocument(text, { kind: 'slides' });
  // a hidden same-origin frame with the engine's stylesheets: the deck is laid out, fitted and frozen there
  const frame = doc.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.setAttribute('tabindex', '-1');
  frame.setAttribute('data-orz-slides-print-stage', '');
  frame.style.cssText = 'position:fixed;left:-20000px;top:0;width:1400px;height:900px;border:0;visibility:hidden;pointer-events:none;';
  doc.body.appendChild(frame);
  try {
    const fdoc = frame.contentDocument;
    if (!fdoc) throw new Error('orz-slides: printDeck could not open its measuring frame');
    if (!fdoc.body) {
      fdoc.open();
      fdoc.write('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>');
      fdoc.close();
    }
    fdoc.documentElement.lang = info.lang;
    const attrs: Record<string, string> = nonce !== null ? { nonce } : {};
    ensureStyle(fdoc, 'orz-reveal-css', REVEAL_CSS, attrs);
    ensureStyle(fdoc, 'orz-deck-css', DECK_CSS, attrs);
    const t = themeStylesheet(p.theme.id);
    ensureStyle(fdoc, 'orz-slide-theme', t.css, { ...attrs, 'data-theme': p.theme.id, 'data-theme-css': t.id });
    // KaTeX's and highlight.js's stylesheets, as the read view and the print document link them (formulas measure the same)
    for (const href of [PREVIEW_CDN.katexCss, p.theme.scheme === 'dark' ? PREVIEW_CDN.hljsDarkCss : PREVIEW_CDN.hljsLightCss]) {
      const l = fdoc.createElement('link');
      l.rel = 'stylesheet';
      l.href = href;
      if (nonce !== null) l.setAttribute('nonce', nonce);
      fdoc.head.appendChild(l);
    }
    const built = await buildPrintDocument(fdoc, text, {
      ...(options.includes ? { includes: options.includes } : {}),
      ...(options.fetchInclude ? { fetchInclude: options.fetchInclude } : {}),
      ...(options.twinLinks ? { twinLinks: options.twinLinks } : {}),
      notes: options.notes === true,
      lang: info.lang,
      title: info.title,
    });
    return { html: stampStyles(built.html, nonce), pages: built.pages, width: built.width, height: built.height, cut: cutMessage(built.cut) };
  } finally {
    frame.remove();
  }
}

/** One app-side print at a time per page: a second request while one prints opens no second dialog. */
const printing = new WeakSet<object>();

/**
 * Print a slides text from an app's page (see the module comment): resolves
 * `true` once the print dialog was shown, `false` when the print frame said
 * nothing in time or a print of this page is still running. Rejects when the
 * document cannot be built.
 */
export async function printDeck(text: string, options: PrintDeckOptions = {}): Promise<boolean> {
  const doc = options.document ?? (globalThis as unknown as { document?: Document }).document;
  const key = (doc ?? globalThis) as object;
  if (printing.has(key)) return false;
  printing.add(key);
  try {
    const d = await deckPrintDocument(text, options);
    if (d.cut) options.onCut?.(d.cut);
    const nonce = nonceOf(options.nonce);
    return await printDocument(d.html, {
      ...(doc ? { document: doc as never } : {}),
      ...(nonce !== null ? { nonce } : {}),
      ...(typeof options.readyTimeoutMs === 'number' ? { readyTimeoutMs: options.readyTimeoutMs } : {}),
      title: options.notes ? 'Print slides with notes' : 'Print slides',
    });
  } finally {
    printing.delete(key);
  }
}
