/**
 * The isomorphic assembler of orz-slides (FC-18 text format 1, kind `slides`).
 *
 * One module for every caller — the Node library, the CLI, the browser bundle
 * (FC-19 §2 `assemble` / `extract` / `readDocument`), "New document", "Save
 * as new copy", the quiet update and the starters — so Node and the browser
 * write the same bytes (FC-18 law 2). Mirrors orz-mdhtml's and orz-paged's
 * src/assemble.ts.
 *
 * The envelope (doctype, `<html lang data-orz-kind>`, generator, `<title>`,
 * head metadata, `#orz-meta`, `#orz-shell`, the agent banner, the ONE
 * `#orz-src` island and `#orz-includes`) is the kit's `assembleEnvelope`;
 * this module adds only the shell parts. `name.slides.md` ↔
 * `name.slides.html` (the kit's `twinName`); 0.x's `#orz-deck` island,
 * `text/orz-slides` and `__ORZ_SLIDES__` retire (src/legacy.ts reads them).
 *
 * Rules: no Node built-ins, no clock, no randomness (except `newDocument`'s
 * `mintUid`, a creation tool, FC-18 §10), no environment reads.
 */
import {
  assembleEnvelope,
  editHeader,
  kindFromFilename,
  lintHeader,
  mintUid,
  readDocument as readKitDocument,
  readHeader,
  storedText as kitStoredText,
  UID_PATTERN,
  type DocumentInfo,
  type HeaderChange,
  type Kind,
  type Lint,
  type ShellParts,
} from 'orz-markdown/carrier';
import { bundleUrl, isScriptSafe } from 'orz-markdown/carrier/shell';
import { headerLint, RATIOS } from './deck/config.js';
import { deckTokens, parseDeck } from './deck/parse.js';
import { presentationOf, readViewMarkup, shellHead, type Presentation } from './presentation.js';
import { isThemeId, THEME_VALUES } from './themes.js';
import { VERSION } from './version.js';

export { extract } from 'orz-markdown/carrier';
export type { Extracted, DocumentInfo, Kind } from 'orz-markdown/carrier';

/** The browser bundle's file name inside `orz-slides-browser` (its `release.json` `bundle.path`). */
export const BUNDLE_FILE = 'orz-slides.browser.js';

/** The text formats this shell reads and writes (FC-18 §8.4). */
export const FORMATS: readonly number[] = Object.freeze([1]);

/** The id of the chrome's mount point (the kit's app renders its shadow root there). */
export const CHROME_MOUNT_ID = 'orz-chrome';

/** The jsDelivr URL of the browser bundle of a release (the URL the quiet update derives, spec/shell-runtime.md §6). */
export function cdnBundleUrl(version: string = VERSION): string {
  return bundleUrl({ kind: 'slides', version, bundle: { path: BUNDLE_FILE, integrity: '' } });
}

const KINDS: readonly string[] = ['md', 'slides', 'paged'];

/**
 * Read a document's facts from its text (FC-19 §2 `readDocument`): the kit's
 * `readDocument` with this carrier's default kind (`opts.kind`, else the file
 * name's, else the header's `carrier`, else `slides`). For kind `slides` the
 * lint is the kit's header lint against this carrier's themes
 * (`unknown-theme`) and its `deck-block` (marked `next: upgrade`), then the
 * carrier's lints (orz-markdown 2.4.0 `readDocument({ tokens, lint })`: the
 * text is parsed once): the header values (src/deck/config.ts:
 * `invalid-value`) and the body's lints of `parseDeck`
 * (`text-before-first-slide`, slide options, regions, headings —
 * src/deck/parse.ts), each with its line.
 */
export function readDocument(text: string, opts: { kind?: Kind; filename?: string } = {}): DocumentInfo {
  const carrier = readHeader(text)?.fields['carrier']?.trim();
  const kind: Kind =
    opts.kind ??
    (opts.filename !== undefined ? kindFromFilename(opts.filename) : null) ??
    (carrier !== undefined && KINDS.includes(carrier) ? (carrier as Kind) : 'slides');
  if (kind !== 'slides') return readKitDocument(text, { kind });
  const tokens = deckTokens(text);
  const info = readKitDocument(text, {
    kind,
    themes: THEME_VALUES,
    tokens,
    // the carrier's lints after the kit's: header values, then the body (the kit reports deck-block itself)
    lint: ({ header }) => [...headerLint(text, header), ...parseDeck(text, tokens).lint.filter((l) => l.code !== 'deck-block')],
  });
  // the kit's deck-block says what resolves it: upgrade
  return { ...info, lint: info.lint.map((l) => (l.code === 'deck-block' ? { ...l, next: 'upgrade' } as Lint : l)) };
}

/** Options of {@link assemble} (FC-18 §8.2, FC-19 §2). */
export interface AssembleOptions {
  /** `inline` (default, FD-02) inlines the engine; `cdn` loads it from jsDelivr. */
  delivery?: 'inline' | 'cdn';
  /**
   * The exact text of the browser bundle, inlined for `delivery: 'inline'`
   * (required there: this module reads no files; the Node library and the
   * browser bundle supply it). Must be script-safe (the bundle rule,
   * spec/shell-runtime.md §6).
   */
  engineSource?: string;
  /** Resolved includes, stored in `#orz-includes` exactly as given (FC-18 §8.3, D4). */
  includes?: Record<string, string>;
}

/**
 * Assemble the `.slides.html` file of a text (FC-18 §8): the kit's envelope
 * with kind `slides`, shell version {@link VERSION}, and the shell parts — in
 * `<head>` the viewport, colour scheme and the header's theme stylesheets
 * (non-blocking); in `<body>` the read view (`#orz-view` / `#orz-doc` with a
 * quiet fallback line), the chrome mount point and the engine (`#orz-engine`,
 * inline or from jsDelivr).
 *
 * Deterministic. Throws for a text the envelope refuses (NUL, a lone
 * surrogate, a header `format` above 1), an unknown delivery, a missing or
 * script-unsafe `engineSource` for inline delivery.
 */
export function assemble(text: string, options: AssembleOptions = {}): string {
  return assembleEnvelope(text, shellParts(options, presentationOf(text)));
}

/** The shell parts {@link assemble} hands to the kit's `assembleEnvelope` (they depend on the options and the presentation only). */
export function shellParts(options: AssembleOptions = {}, presentation: Presentation = presentationOf('')): ShellParts {
  const delivery = options.delivery ?? 'inline';
  let engine: string;
  if (delivery === 'inline') {
    const src = options.engineSource;
    if (typeof src !== 'string' || src === '') throw new Error('orz-slides: inline delivery needs the engine source (options.engineSource)');
    if (!isScriptSafe(src)) throw new Error('orz-slides: the engine source is not script-safe (it holds <script, </script or a CR)');
    engine = `<script id="orz-engine">${src}</script>`;
  } else if (delivery === 'cdn') {
    engine = `<script id="orz-engine" src="${cdnBundleUrl()}"></script>`;
  } else {
    throw new Error(`orz-slides: unknown delivery ${JSON.stringify(String(delivery))}`);
  }
  const includes = options.includes && Object.keys(options.includes).length > 0 ? options.includes : undefined;
  return {
    kind: 'slides',
    shellVersion: VERSION,
    delivery,
    headHtml: shellHead(presentation, { deferred: true }),
    bodyHtml: `${readViewMarkup(presentation, delivery)}\n<div id="${CHROME_MOUNT_ID}"></div>\n${engine}`,
    ...(includes ? { includes } : {}),
  };
}

/**
 * The text a file assembled from `text` holds: `extract(assemble(text)).text`
 * — `text` itself, except that mixed line endings are stored as one style
 * (FC-18 §8.2). A text the envelope refuses is returned as it is.
 */
export function storedText(text: string): string {
  return kitStoredText(text, 'slides');
}

/* ─────────────────────────── newDocument ─────────────────────────── */

/**
 * A plain title as Markdown inline text that renders back to exactly that
 * text: every character the parser would read as syntax is backslash-escaped
 * (orz-paged's `markdownLiteral`).
 */
export function markdownLiteral(text: string): string {
  return text.replace(/[\\`*_[\]<>!~^=+${}&|#"']|-(?=-)|\.(?=\.)|\((?=(?:c|r|tm|p)\))|:(?=[\w+-]+:)/gi, '\\$&');
}

/** Options of {@link newDocument}: header values of the new text (FC-18 §5.1). */
export interface NewDocumentOptions {
  /** The header `title` (also the title slide's heading). */
  title?: string;
  /** A slide theme id or alias (src/themes.ts). */
  theme?: string;
  /** `16:9` or `4:3`. */
  ratio?: string;
  /** The document id; minted with the kit's `mintUid` when absent (tests inject one). */
  uid?: string;
}

/**
 * A new format-1 `slides` text (FC-18 §3, §7.2, §10): a header with
 * `carrier: slides` and a fresh `uid` (then the given `title` / `theme` /
 * `ratio`), a title slide and one normal slide. Lint-clean. Pure apart from
 * `mintUid` when no `uid` is given.
 */
export function newDocument(options: NewDocumentOptions = {}): string {
  const { title, theme, ratio } = options;
  if (theme !== undefined && !isThemeId(theme)) throw new Error(`orz-slides: unknown theme ${JSON.stringify(theme)}`);
  if (ratio !== undefined && !(RATIOS as readonly string[]).includes(ratio)) throw new Error(`orz-slides: unknown ratio ${JSON.stringify(ratio)} (${RATIOS.join(' or ')})`);
  const uid = options.uid ?? mintUid();
  if (!UID_PATTERN.test(uid)) throw new Error(`orz-slides: malformed uid ${JSON.stringify(uid)} (doc- and 10 to 32 of [0-9a-z])`);
  const named = title !== undefined && title.trim() !== '';
  const heading = named ? markdownLiteral(title.trim()) : 'Untitled deck';
  const body = `<!-- slide template=title -->\n# ${heading}\n## A subtitle\nYour name · the date\n\n<!-- slide -->\n## First slide\n\n- A point\n- Another point\n`;
  const changes: Record<string, HeaderChange> = { carrier: 'slides', uid };
  if (named) changes['title'] = title;
  if (theme !== undefined) changes['theme'] = theme;
  if (ratio !== undefined) changes['ratio'] = ratio;
  const text = editHeader(body, changes);
  const errors = lintHeader(text, { kind: 'slides', themes: THEME_VALUES }).filter((l) => l.level === 'error');
  if (errors.length > 0) throw new Error(`orz-slides: the new header is not valid: ${errors.map((l) => `${l.code} (${l.message})`).join('; ')}`);
  return text;
}
