/**
 * Legacy orz-slides 0.x files and texts (experimental, before text format 1):
 * reading them and upgrading them to a format-1 text and file. As for
 * orz-mdhtml and orz-paged (REBUILD §3a decision 1, §3c): no compatibility
 * shim — `upgrade` (and, in rebuild step 7, `inspect`) are the way forward.
 *
 * A 0.x file (written by 0.x `src/template.ts` + `assets/app.js`, 0.1–0.8.5):
 * - the deck source in `<script type="text/orz-slides" id="orz-deck">`,
 *   written as `"\n" + source + "\n"` with every `</script` (any case) as
 *   `<\/script`; the in-file save wrote the same (`writeDeck`);
 * - the generator meta says `orz-slides` (no version); the config is
 *   `window.__ORZ_SLIDES__ = {…}` (`version`, a random `docId`, the default
 *   theme, …); no `#orz-shell`;
 * - `<title>`: the deck block's `title:`, else the CLI's `--title`, else the
 *   input's file name (the library's: `Untitled`).
 *
 * The island is read by the kit's `readLegacyIsland` with this writer's
 * island (orz-markdown 2.4.0: `{ id: 'orz-deck', type: 'text/orz-slides' }`).
 *
 * A 0.x TEXT → format 1 ({@link upgradeText}):
 * - the `<!-- deck … -->` block (the first top-level one before the first
 *   slide; 0.x read it only when it was the very first thing in the source)
 *   becomes header keys — `title theme ratio author footer transition` —
 *   and is removed (with the blank lines after it); its other keys, which
 *   0.x ignored, are dropped with a note;
 * - a leading `{{nyml kind: meta}}` block (which 0.x slides never read) is
 *   the legacy header: merged into one `kind: document` header
 *   (`normalizeHeader`); the deck block's keys win a clash (it was the
 *   deck's config), with a note; beside a format-1 header (a text already
 *   upgraded by hand) the header's keys win — the deck block never applied;
 * - `theme`: the dropped 0.x themes map to their successors (executive →
 *   sky, poppy → sticker, sage → orchard), 0.x's implicit `paper` is written
 *   explicitly, a theme 0.x did not have (it showed paper) becomes `paper`;
 * - `carrier: slides` and a `uid` are added; everything else is kept as
 *   written, text before the first slide included (now a lint notice).
 *
 * Isomorphic: no Node built-ins, no clock; randomness only through `mintUid`
 * when no uid is injected.
 */
import { editHeader, extract, mintUid, normalizeHeader, readHeader, readLegacyIsland, UID_PATTERN, type HeaderChange } from 'orz-markdown/carrier';
import { compareSemver } from 'orz-markdown/carrier/shell';
import type { DocMeta } from 'orz-markdown/doc-meta';
import { assemble, readDocument, type AssembleOptions } from './assemble.js';
import { scanMarkers } from './deck/parse.js';
import { DROPPED_THEMES, resolveTheme } from './themes.js';
import { VERSION } from './version.js';

/** What {@link readLegacy} reads from a 0.x file. */
export interface LegacyFile {
  /** The deck source: the island with `<\/script` restored to `</script`, without the writer's wrapping line breaks. */
  text: string;
  /** Whether the island had the 0.x writer's `\n…\n` wrapper. */
  wrapped: boolean;
  /** How many `<\/script` the island held (restored in `text`). */
  scriptEscapes: number;
  /** The generator meta (`orz-slides`), if any. */
  generator: string | null;
  /** The 0.x version, from the config's `version`. */
  version: string | null;
  /** `inline` / `cdn` from the engine script (`data-orz-asset="engine"`), if found. */
  delivery: 'inline' | 'cdn' | null;
  /** The `<title>` text (entities decoded, trimmed), if any. */
  title: string | null;
  /** DocMeta from `#orz-meta`, if any (written by the 0.x library only). */
  meta: DocMeta | null;
  /** The config's default theme (what the file showed first). */
  defaultTheme: string | null;
  /** Things found but not understood (reported, never acted on). */
  notes: string[];
}

/**
 * Read a legacy orz-slides 0.x file; `null` when `html` is not one (no
 * `#orz-deck` island, a format-1 `#orz-shell`, or neither the `orz-slides`
 * generator nor the `__ORZ_SLIDES__` config).
 */
export function readLegacy(html: string): LegacyFile | null {
  const island = readLegacyIsland(html, { generator: /^orz-slides(\s|$)/, config: '__ORZ_SLIDES__', island: { id: 'orz-deck', type: 'text/orz-slides' } });
  if (!island) return null;
  const notes = [...island.notes];
  if (island.scriptEscapes > 0) notes.push(`the source held ${island.scriptEscapes} \`<\\/script\` (the 0.x writer's escape of \`</script\`): restored to \`</script\``);
  if (island.configError) notes.push('the 0.x config (window.__ORZ_SLIDES__) is not readable JSON');
  const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
  return {
    text: island.text,
    wrapped: island.wrapped,
    scriptEscapes: island.scriptEscapes,
    generator: island.generator,
    version: str(island.config['version']),
    delivery: island.delivery,
    title: island.title || null,
    meta: island.meta,
    defaultTheme: str(island.config['defaultTheme']),
    notes,
  };
}

/* ─────────────────────────── a 0.x text → format 1 ─────────────────────────── */

/** The keys a 0.x deck block had (DeckConfig 0.x). */
const DECK_KEYS = ['title', 'theme', 'ratio', 'author', 'footer', 'transition'] as const;

/** What {@link upgradeText} did. */
export interface TextUpgrade {
  /** The format-1 text. */
  text: string;
  /** Header keys written, with their values. */
  moved: Record<string, string>;
  notes: string[];
}

/** Options of {@link upgradeText}. */
export interface UpgradeTextOptions {
  /** The uid to write when the text has no valid one (tests); default: minted. */
  uid?: string;
  /** The 0.x file's facts (its `<title>`, `#orz-meta`), when the text comes from a file. */
  file?: Pick<LegacyFile, 'title' | 'meta'>;
}

/** A value the header can hold as a single line (FC-18 §9). */
const writable = (v: string): boolean => v.trim() !== '' && !/[\r\n\u0000]/.test(v) && !v.includes('}}');

/**
 * Upgrade a 0.x deck text (or any slides text that still holds a
 * `<!-- deck -->` block) to text format 1 — see the module comment. A text
 * that is already format 1 without a deck block comes back with only
 * `carrier` and `uid` added when missing.
 */
export function upgradeText(source: string, options: UpgradeTextOptions = {}): TextUpgrade {
  const notes: string[] = [];
  let text = source;
  // 1. the deck block: the first top-level one before the first slide marker
  const markers = scanMarkers(text);
  const firstSlide = markers.find((m) => m.type === 'slide');
  const block = markers.find((m) => m.type === 'deck' && (!firstSlide || m.span.from < firstSlide.span.from));
  const deck: Record<string, string> = {};
  if (block) {
    const effective = text.slice(0, block.span.from).replace(/^﻿/, '').trim() === '';
    if (!effective) notes.push('0.x did not read this deck block (it was not the first thing in the source, so 0.x showed the paper theme and no footer); upgrade applies it as written');
    const inner = block.content.replace(/^[ \t]*<!--\s*deck\b/, '').replace(/-->[\s\S]*$/, '');
    const ignored: string[] = [];
    for (const line of inner.split('\n')) {
      const kv = /^\s*([A-Za-z_][\w-]*)\s*:\s*(.*?)\s*$/.exec(line);
      if (!kv) continue;
      const key = kv[1].toLowerCase();
      if (kv[2] === '') continue;
      if ((DECK_KEYS as readonly string[]).includes(key)) deck[key] = kv[2];
      else ignored.push(key);
    }
    if (ignored.length > 0) notes.push(`deck block keys 0.x ignored were dropped: ${ignored.join(', ')}`);
    // remove the block's lines and the blank lines after it
    let end = block.span.to;
    const rest = /^(?:\r\n|\n|\r)?(?:[ \t]*(?:\r\n|\n|\r))*/.exec(text.slice(end));
    end += rest ? rest[0].length : 0;
    // keep the line break that ends the line before the block
    text = text.slice(0, block.span.from) + text.slice(end);
  }
  const laterBlocks = scanMarkers(text).filter((m) => m.type === 'deck');
  if (laterBlocks.length > 0) notes.push(`${laterBlocks.length} more <!-- deck --> block${laterBlocks.length === 1 ? '' : 's'} inside the slides (0.x ignored them) kept as written: lint deck-block`);

  // 2. a leading legacy kind: meta header becomes the format-1 header
  const before = readHeader(text);
  // a format-1 header is the deck's config (a deck block beside it rendered nothing): its keys win; a legacy
  // meta header was never read by 0.x slides: the deck block's keys win
  const deckWins = !before || before.legacy !== null;
  if (before?.legacy) {
    text = normalizeHeader(text);
    notes.push(`the leading {{nyml kind: meta}} block (0.x slides never read it) is now the header (kind: document)`);
  }
  const header = readHeader(text);
  const has = (k: string): boolean => !!header && Object.prototype.hasOwnProperty.call(header.fields, k);
  const current = (k: string): string | undefined => (header && has(k) ? header.fields[k].trim() : undefined);

  // 3. the header changes
  const changes: Array<[string, string]> = [];
  const set = (key: string, value: string, what: string, override = false): void => {
    if (!writable(value)) { notes.push(`${what} not moved into the header: the value cannot be a single header line`); return; }
    if (changes.some(([k]) => k === key)) return;
    const was = current(key);
    if (was !== undefined && !override) return;
    if (was !== undefined && was !== value.trim()) notes.push(`${key}: ${JSON.stringify(value)} (${what}) replaces the header's ${JSON.stringify(was)}${what.startsWith('the deck block') ? ' (the deck block was the deck\'s config; 0.x slides never read a meta block)' : ''}`);
    if (was !== undefined && was === value.trim()) return;
    changes.push([key, value]);
  };
  if (!has('carrier')) set('carrier', 'slides', 'carrier');
  else if (current('carrier') !== 'slides') notes.push(`the header says carrier: ${current('carrier')}; kept`);
  if (!has('uid') || !UID_PATTERN.test(current('uid') ?? '')) {
    const own = options.file?.meta?.uid;
    const valid = typeof own === 'string' && UID_PATTERN.test(own.trim());
    if (has('uid')) notes.push(`the header's uid ${JSON.stringify(current('uid'))} is not a valid uid (doc-[0-9a-z]{10,32}); a new uid was written`);
    set('uid', valid ? own!.trim() : (options.uid ?? mintUid()), 'uid', true);
  }
  for (const key of ['title', 'author', 'footer', 'transition', 'ratio'] as const) {
    if (deck[key] === undefined) continue;
    if (!deckWins && current(key) !== undefined) {
      if (current(key) !== deck[key]) notes.push(`${key}: the header's ${JSON.stringify(current(key))} is kept (the deck block's ${JSON.stringify(deck[key])} never applied to a format-1 text)`);
      continue;
    }
    set(key, deck[key], `the deck block's ${key}`, true);
  }
  // theme: what 0.x showed, with the dropped themes' successors
  const written = deckWins ? (deck['theme'] ?? current('theme')) : (current('theme') ?? deck['theme']);
  if (!deckWins && deck['theme'] !== undefined && current('theme') !== undefined && deck['theme'] !== current('theme')) notes.push(`theme: the header's ${JSON.stringify(current('theme'))} is kept (the deck block's ${JSON.stringify(deck['theme'])} never applied to a format-1 text)`);
  let theme: string;
  if (written === undefined || written === '') {
    theme = 'paper';
    notes.push('theme: paper written explicitly (0.x showed paper when no theme was given; the 1.0 default is orchard)');
  } else if (Object.prototype.hasOwnProperty.call(DROPPED_THEMES, written)) {
    theme = DROPPED_THEMES[written];
    notes.push(`theme: the 0.x theme ${written} was dropped in 1.0; its successor ${theme} is written`);
  } else if (resolveTheme(written)) {
    theme = written;
  } else {
    theme = 'paper';
    notes.push(`theme: ${JSON.stringify(written)} is not a slide theme (0.x showed paper for it); paper is written`);
  }
  set('theme', theme, 'theme', true);

  // the 0.x file's #orz-meta (the 0.x library's host metadata) for keys still missing
  const meta = options.file?.meta ?? {};
  const addMeta = (key: string, value: string | undefined): void => { if (value !== undefined && value.trim() !== '' && !has(key) && !changes.some(([k]) => k === key)) set(key, value, `#orz-meta ${key}`); };
  addMeta('title', meta.title);
  addMeta('author', meta.author);
  addMeta('description', meta.description);
  addMeta('date', meta.date);
  addMeta('keywords', Array.isArray(meta.keywords) ? meta.keywords.join(', ') : undefined);
  addMeta('source', meta.source);
  addMeta('license', meta.license?.spdx);
  addMeta('license_name', meta.license?.name);
  addMeta('license_url', meta.license?.url);

  const moved: Record<string, string> = {};
  const record: Record<string, HeaderChange> = {};
  for (const [k, v] of changes) {
    record[k] = v;
    moved[k] = v;
  }
  text = editHeader(text, record);
  // 4. the 0.x <title> (the CLI's --title, by default the file name) only when the text derives no title of its own
  const fileTitle = options.file?.title;
  if (fileTitle && fileTitle !== 'Untitled' && !readHeader(text)?.fields['title']) {
    const derived = readDocument(text, { kind: 'slides' }).title;
    if (derived === 'Untitled' && writable(fileTitle)) {
      text = editHeader(text, { title: fileTitle });
      moved['title'] = fileTitle;
      notes.push(`title: the 0.x <title> ${JSON.stringify(fileTitle)} (the CLI's --title, by default the file name) is written`);
    } else if (derived !== fileTitle) {
      notes.push(`the 0.x <title> ${JSON.stringify(fileTitle)} was not moved: the text's own title is ${JSON.stringify(derived)}`);
    }
  }
  return { text, moved, notes };
}

/* ─────────────────────────── upgrade a file ─────────────────────────── */

/** What {@link upgrade} gives. */
export interface UpgradeResult {
  /** The format-1 text twin. */
  text: string;
  /** Its assembly with this shell. */
  html: string;
  /** `legacy` (a 0.x file) or `format-1` (already format 1: re-assembled with this shell). */
  from: 'legacy' | 'format-1';
  /** The 0.x version, for a legacy file. */
  version: string | null;
  /** Header keys this upgrade wrote, with their values. */
  moved: Record<string, string>;
  /** What was found, changed or not moved, and why. */
  notes: string[];
}

/** Options of {@link upgrade}: the assembly's, and a uid to use instead of minting one (tests). */
export interface UpgradeOptions extends AssembleOptions {
  uid?: string;
  /** Re-assemble a format-1 file whose shell is NEWER than this tool (a downgrade). Default `false`: refused. */
  downgrade?: boolean;
}

/**
 * Upgrade an orz-slides file to text format 1 with this shell: a 0.x file
 * becomes a format-1 text ({@link upgradeText} of its `#orz-deck` source,
 * with its `<title>` and `#orz-meta`) and that text's file; a format-1 file
 * is re-assembled with its text and includes unchanged. Throws for anything
 * else (another kind, a newer format, a newer shell without `downgrade`).
 */
export function upgrade(html: string, options: UpgradeOptions = {}): UpgradeResult {
  const { uid, downgrade, ...assembleOptions } = options;
  const legacy = readLegacy(html);
  if (!legacy) {
    const ex = extract(html);
    if (!ex || ex.shell === '') throw new Error('orz-slides upgrade: not an orz-slides file (no 0.x #orz-deck island and no format-1 #orz-src/#orz-shell)');
    if (ex.kind !== 'slides') throw new Error(`orz-slides upgrade: an orz-${ex.kind === 'md' ? 'mdhtml' : ex.kind} file; use orz-${ex.kind === 'md' ? 'mdhtml' : ex.kind}`);
    if (ex.format > 1) throw new Error(`orz-slides upgrade: text format ${ex.format} is newer than this tool writes (format 1)`);
    if (!downgrade && compareSemver(ex.shell, VERSION) === 1) {
      throw new Error(`orz-slides upgrade: the file's shell (orz-slides ${ex.shell}) is newer than this tool (${VERSION}); upgrading would downgrade it`);
    }
    const includes = assembleOptions.includes ?? ex.includes;
    return { text: ex.text, html: assemble(ex.text, { ...assembleOptions, ...(includes ? { includes } : {}) }), from: 'format-1', version: null, moved: {}, notes: [] };
  }
  const up = upgradeText(legacy.text, { ...(uid !== undefined ? { uid } : {}), file: { title: legacy.title, meta: legacy.meta } });
  return { text: up.text, html: assemble(up.text, assembleOptions), from: 'legacy', version: legacy.version, moved: up.moved, notes: [...legacy.notes, ...up.notes] };
}
