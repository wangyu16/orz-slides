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
 * - `theme`: what 0.x SHOWED — the deck block's, else the 0.x file's
 *   default (its CLI `--theme`), else 0.x's implicit `paper`, written
 *   explicitly; the dropped 0.x themes map to their successors (executive →
 *   sky, poppy → sticker, sage → orchard), a theme 0.x did not have (it
 *   showed paper) becomes `paper`; a format-1 header keeps its own theme
 *   (and none stays none);
 * - every other deck block is consumed (it fills only keys still missing),
 *   marker spellings 0.x read are normalised, markers a raw HTML block or an
 *   unclosed fence swallowed are repaired (closed-loop round A);
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
import { normalizeMarker, parseDeck, REPAIR_CODES, RUN_ON_OPENER, scanMarkers } from './deck/parse.js';
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
  /**
   * The 0.x file's facts (its `<title>`, `#orz-meta`, and the theme its
   * config showed — the CLI's `--theme`), when the text comes from a file.
   */
  file?: Pick<LegacyFile, 'title' | 'meta'> & { defaultTheme?: string | null };
}

/** A value the header can hold as a single line (FC-18 §9). */
const writable = (v: string): boolean => v.trim() !== '' && !/[\r\n\u0000]/.test(v) && !v.includes('}}');

/** Apply text edits (non-overlapping), from the last to the first. */
function applyEdits(text: string, edits: ReadonlyArray<{ from: number; to: number; insert: string }>): string {
  let out = text;
  for (const e of [...edits].sort((a, b) => b.from - a.from)) out = out.slice(0, e.from) + e.insert + out.slice(e.to);
  return out;
}

/** The keys of a deck block, and the ones 0.x ignored. */
function deckBlockKeys(content: string): { keys: Record<string, string>; ignored: string[] } {
  const inner = content.replace(/^[ \t]*<!--\s*deck\b/, '').replace(/-->[\s\S]*$/, '');
  const keys: Record<string, string> = {};
  const ignored: string[] = [];
  for (const line of inner.split('\n')) {
    const kv = /^\s*([A-Za-z_][\w-]*)\s*:\s*(.*?)\s*$/.exec(line);
    if (!kv || kv[2] === '') continue;
    const key = kv[1].toLowerCase();
    if ((DECK_KEYS as readonly string[]).includes(key)) keys[key] = kv[2];
    else ignored.push(key);
  }
  return { keys, ignored };
}

/** A theme as 1.0 writes it: a dropped 0.x theme's successor, a slide theme (or alias) as is, else null. */
function themeFor(id: string): { theme: string; dropped: boolean } | null {
  if (Object.prototype.hasOwnProperty.call(DROPPED_THEMES, id)) return { theme: DROPPED_THEMES[id], dropped: true };
  return resolveTheme(id) ? { theme: id, dropped: false } : null;
}

/** The 0-based line of an offset. */
function lineOf(text: string, at: number): number {
  return (text.slice(0, at).match(/\r\n|\r|\n/g) ?? []).length;
}

/**
 * Line numbers of the text being upgraded back to the ORIGINAL text's (notes
 * cite the lines the author wrote): every edit that removes or inserts whole
 * lines is recorded, in order, and undone when a line is reported.
 */
class LineMap {
  private edits: Array<{ at: number; delta: number }> = [];
  /** `count` lines removed at 0-based line `at` of the current text. */
  remove(at: number, count: number): void { if (count > 0) this.edits.push({ at, delta: -count }); }
  /** One line inserted at 0-based line `at` of the current text. */
  insert(at: number): void { this.edits.push({ at, delta: 1 }); }
  /** The original 1-based line of the current 1-based `line`. */
  original(line: number): number {
    let l = line - 1;
    for (let i = this.edits.length - 1; i >= 0; i--) {
      const e = this.edits[i];
      if (e.delta > 0 && l > e.at) l -= e.delta;
      else if (e.delta < 0 && l >= e.at) l -= e.delta;
    }
    return l + 1;
  }
}

/**
 * Repair the markers a block swallowed (closed-loop rounds A and A2): apply
 * the hygiene lints' own quick fixes (`REPAIR_CODES`: a raw HTML block's
 * blank line; the closer of a fence, container, `$$` block or HTML block
 * left open) until none is left. Each pass applies the fixes that cannot
 * interact — blank lines before markers in HTML blocks whose rest opens no
 * construct — else the first fix alone (closing one block may show the
 * next), and must make at least one more marker line a marker: a pass that
 * makes no progress is undone and the loop stops (the lint stays for the
 * author). At most one pass per marker line of the text.
 */
function repairHidden(source: string, notes: string[], lines: LineMap): string {
  let text = source;
  const budget = (text.match(/^ {0,3}<!--\s*(?:slide\b|@[A-Za-z0-9_-])/gm) ?? []).length + 1;
  for (let pass = 0; pass < budget; pass++) {
    const fixes = parseDeck(text).lint.filter((l) => l.fix && REPAIR_CODES.has(l.code));
    if (fixes.length === 0) break;
    const batch: typeof fixes = [];
    for (const l of fixes) {
      if (l.code !== 'marker-in-html') break;
      // the rest of its HTML block (up to the next blank line) must open nothing that runs on
      const rest = text.slice(l.fix!.from).split(/\r\n|\r|\n/);
      let safe = true;
      for (let k = 1; k < rest.length && rest[k].trim() !== ''; k++) if (RUN_ON_OPENER.test(rest[k])) { safe = false; break; }
      if (!safe) break;
      batch.push(l);
    }
    if (batch.length === 0) batch.push(fixes[0]);
    // progress: every fix makes the marker line it was inserted before a marker (A2-FMT-1: a fix that does not
    // take is never applied again and again)
    const takes = (b: typeof fixes): string | null => {
      const next = applyEdits(text, b.map((l) => l.fix!));
      const real = new Set(scanMarkers(next).map((m) => m.span.from));
      let shift = 0;
      for (const l of [...b].sort((x, y) => x.fix!.from - y.fix!.from)) {
        shift += l.fix!.insert.length;
        if (!real.has(l.fix!.from + shift)) return null;
      }
      return next;
    };
    let next = takes(batch);
    if (next === null && batch.length > 1) { batch.splice(1); next = takes(batch); }
    if (next === null) {
      notes.push(`line ${lines.original(batch[0].line ?? 1)}: ${batch[0].code} could not be repaired (its fix showed no marker); left for the author`);
      break;
    }
    for (const l of [...batch].sort((x, y) => y.fix!.from - x.fix!.from)) {
      notes.push(l.code === 'marker-in-html'
        ? `line ${lines.original(lineOf(text, l.fix!.from) + 1)}: a blank line added before the marker (it was inside a raw HTML block; 0.x read it)`
        : `line ${lines.original(l.line ?? 1)}: the ${l.code === 'unclosed-fence' ? 'code fence' : l.code === 'unclosed-container' ? 'container' : l.code === 'unclosed-math' ? '$$ math block' : 'HTML block'} left open was closed before the next marker (0.x ended it there)`);
      lines.insert(lineOf(text, l.fix!.from));
    }
    text = next;
  }
  return text;
}

/**
 * Upgrade a 0.x deck text (or any slides text that still holds a
 * `<!-- deck -->` block) to text format 1 — see the module comment. A text
 * that is already format 1 comes back with only `carrier` and `uid` added
 * when missing (and a stray deck block's keys moved into its header): its
 * body is never repaired or respelled (round A3, A3-FMT-5).
 *
 * Besides the header, what 0.x read and format 1 does not is rewritten so
 * the deck shows what 0.x showed (closed-loop round A): every deck block is
 * consumed (FMT-4), marker spellings are normalised (`normalizeMarker`:
 * FMT-6, FMT-7), a marker hidden in a raw HTML block gets its blank line
 * and a fence or `:::` container left open is closed before the next marker
 * (0.x split at every marker line: FMT-1, FMT-5), each with a note.
 */
export function upgradeText(source: string, options: UpgradeTextOptions = {}): TextUpgrade {
  const notes: string[] = [];
  let text = source;
  const lines = new LineMap();
  const bom = text.startsWith('﻿') ? 1 : 0;
  // 1. the deck blocks: the first one is the deck's config (0.x read it when it was the first thing in the
  //    source; upgrade applies it wherever it stood); a later one fills only the keys still missing
  const before0 = readHeader(text);
  const deckWins = !before0 || before0.legacy !== null;
  const blocks = scanMarkers(text).filter((m) => m.type === 'deck');
  const deck: Record<string, string> = {};
  if (blocks.length > 0) {
    const removals: Array<{ from: number; to: number; insert: string }> = [];
    blocks.forEach((block, k) => {
      const { keys, ignored } = deckBlockKeys(block.content);
      if (k === 0) {
        const effective = text.slice(0, block.span.from).replace(/^﻿/, '').trim() === '';
        if (!effective && deckWins) notes.push('0.x did not read this deck block (it was not the first thing in the source, so 0.x showed the paper theme and no footer); upgrade applies it as written');
        Object.assign(deck, keys);
      } else {
        const filled = Object.keys(keys).filter((key) => deck[key] === undefined);
        for (const key of filled) deck[key] = keys[key];
        notes.push(`the <!-- deck --> block on line ${block.span.line} (0.x ignored it) was removed${filled.length ? `; its ${filled.join(', ')} filled what the first block lacked` : ''}`);
      }
      if (ignored.length > 0) notes.push(`deck block keys 0.x ignored were dropped: ${ignored.join(', ')}`);
      // remove the block's lines and the blank lines after it (a leading BOM stays: FC-18 §3)
      let to = block.span.to;
      const rest = /^(?:\r\n|\n|\r)?(?:[ \t]*(?:\r\n|\n|\r))*/.exec(text.slice(to));
      to += rest ? rest[0].length : 0;
      removals.push({ from: Math.max(block.span.from, bom), to, insert: '' });
    });
    for (const r of [...removals].sort((x, y) => y.from - x.from)) lines.remove(lineOf(text, r.from), text.slice(r.from, r.to).split(/\r\n|\r|\n/).length - 1);
    text = applyEdits(text, removals);
  }

  // 2. markers a block swallowed (0.x split at every marker line), then the marker spellings 0.x read — in that
  //    order, so a marker a repair reveals is normalised too (A2-FMT-8: upgrade is idempotent). Only for a 0.x
  //    text: a format-1 author never relied on 0.x's reading (a fence that SHOWS a marker stays; A3-FMT-5)
  if (deckWins) text = repairHidden(text, notes, lines);
  const rewrites: Array<{ from: number; to: number; insert: string }> = [];
  for (const m of deckWins ? scanMarkers(text) : []) {
    if (m.type === 'deck') continue;
    const n = normalizeMarker(m.content);
    if (!n) continue;
    const eol = /\r\n|\r|\n/.exec(text.slice(m.span.from))?.[0] ?? '\n';
    rewrites.push({ from: m.span.from, to: m.span.to, insert: n.content.replace(/\n/g, eol) });
    for (const x of n.notes) notes.push(`line ${lines.original(m.span.line)}: ${x}`);
  }
  text = applyEdits(text, rewrites);

  // 3. a leading legacy kind: meta header becomes the format-1 header
  const before = readHeader(text);
  // a format-1 header is the deck's config (a deck block beside it rendered nothing): its keys win; a legacy
  // meta header was never read by 0.x slides: the deck block's keys win
  if (before?.legacy) {
    text = normalizeHeader(text);
    notes.push(`the leading {{nyml kind: meta}} block (0.x slides never read it) is now the header (kind: document)`);
  }
  const header = readHeader(text);
  const has = (k: string): boolean => !!header && Object.prototype.hasOwnProperty.call(header.fields, k);
  const current = (k: string): string | undefined => (header && has(k) ? header.fields[k].trim() : undefined);

  // 4. the header changes
  const changes: Array<[string, string]> = [];
  const set = (key: string, value: string, what: string, override = false): void => {
    if (!writable(value)) { notes.push(`${what} not moved into the header: the value cannot be a single header line`); return; }
    if (changes.some(([k]) => k === key)) return;
    const was = current(key);
    if (was !== undefined && !override) return;
    if (was !== undefined && was !== value.trim()) notes.push(`${key}: ${JSON.stringify(value)} (${what}) replaces the header's ${JSON.stringify(was)}${what.startsWith('the deck block') || what.startsWith('what 0.x showed') ? ' (the deck block and the 0.x file were the deck\'s config; 0.x slides never read a meta block)' : ''}`);
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
  // theme: what 0.x SHOWED (FMT-2) — the deck block's, else the 0.x file's (its CLI --theme), else paper —
  // with the dropped themes' successors; a format-1 header keeps its own (none stays none: FMT-3)
  if (deckWins) {
    const fileTheme = options.file?.defaultTheme ?? undefined;
    const shown = deck['theme'] ?? fileTheme;
    const what = deck['theme'] !== undefined ? 'the deck block\'s theme' : 'what 0.x showed (the file\'s --theme)';
    let theme: string;
    if (shown === undefined || shown === '') {
      theme = 'paper';
      notes.push('theme: paper written explicitly (0.x showed paper when no theme was given; the 1.0 default is orchard)');
    } else {
      const t = themeFor(shown);
      if (!t) { theme = 'paper'; notes.push(`theme: ${JSON.stringify(shown)} is not a slide theme (0.x showed paper for it); paper is written`); }
      else {
        theme = t.theme;
        if (t.dropped) notes.push(`theme: the 0.x theme ${shown} was dropped in 1.0; its successor ${theme} is written`);
        else if (deck['theme'] === undefined) notes.push(`theme: ${theme} written (${what})`);
      }
    }
    if (current('theme') !== undefined && current('theme') !== theme && before?.legacy) notes.push(`theme: ${theme} (what 0.x showed) replaces the meta block's ${JSON.stringify(current('theme'))} (0.x slides never read it)`);
    if (current('theme') !== theme) changes.push(['theme', theme]);
  } else if (deck['theme'] !== undefined) {
    if (current('theme') !== undefined) {
      if (current('theme') !== deck['theme']) notes.push(`theme: the header's ${JSON.stringify(current('theme'))} is kept (the deck block's ${JSON.stringify(deck['theme'])} never applied to a format-1 text)`);
    } else {
      const t = themeFor(deck['theme']);
      if (t) { set('theme', t.theme, 'the deck block\'s theme'); if (t.dropped) notes.push(`theme: the 0.x theme ${deck['theme']} was dropped in 1.0; its successor ${t.theme} is written`); }
      else notes.push(`theme: the deck block's ${JSON.stringify(deck['theme'])} is not a slide theme; not written`);
    }
  }

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
  // 5. the 0.x <title> (the CLI's --title, by default the file name) only when the text derives no title of its own
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
  const up = upgradeText(legacy.text, { ...(uid !== undefined ? { uid } : {}), file: { title: legacy.title, meta: legacy.meta, defaultTheme: legacy.defaultTheme } });
  return { text: up.text, html: assemble(up.text, assembleOptions), from: 'legacy', version: legacy.version, moved: up.moved, notes: [...legacy.notes, ...up.notes] };
}
