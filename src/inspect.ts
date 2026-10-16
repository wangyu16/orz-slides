/**
 * `inspect`: a JSON-able diagnosis of a text or a file, for agents and tools
 * (REBUILD §3c step 7; the shape of orz-mdhtml's and orz-paged's): what it
 * is, which format and shell, its identity, the deck settings and lints,
 * whether it is an orz-slides 0.x file or text — and then what upgrade would
 * change compared with what 0.8.5 showed (the upgrade report) — and what to
 * do.
 *
 * Isomorphic and deterministic: no Node built-ins, no clock, no randomness.
 * The layout report (`inspect --layout`: fit scale and clipping per slide
 * and box, in real Chrome) is Node only: src/layout-report.ts.
 *
 * The kind-independent core — telling HTML from a text, the structure checks,
 * the twin check, the SHA-256 — is orz-markdown's (`orz-markdown/carrier`);
 * this module keeps the report's shape, the 0.x reader and the advice.
 */
import { assembledStructure, generatorOf, kindFromFilename, looksHtml, readHeader, sha256, shellWord as sh, twinCheck as kitTwinCheck, type Kind, type Lint } from 'orz-markdown/carrier';
import { compareSemver } from 'orz-markdown/carrier/shell';
import { cdnBundleUrl, extract, FORMATS, readDocument } from './assemble.js';
import { parseDeck, scanMarkers } from './deck/parse.js';
import { readLegacy, upgradeText } from './legacy.js';
import { presentationOf } from './presentation.js';
import { reportNotes, upgradeReport, type UpgradeReport } from './upgrade-report.js';
import { VERSION } from './version.js';

/** The report {@link inspect} returns (plain JSON data). */
export interface InspectReport {
  /** This tool: the shell it writes and the text formats it reads and writes. */
  tool: { name: 'orz-slides'; version: string; formats: number[] };
  /**
   * `text` (a text twin or any Markdown), `assembled` (a format-1 file),
   * `legacy` (an orz-slides 0.x file), `html` (HTML that is neither).
   */
  input: 'text' | 'assembled' | 'legacy' | 'html';
  /** The document kind (`md`, `slides`, `paged`); `null` when there is no document. */
  kind: Kind | null;
  /** The text format; `null` when there is no format-1 document (0.x files are pre-format). */
  format: number | null;
  /** Whether this tool may assemble, edit and save it (kind `slides`, a format it writes, not a 0.x file). */
  writable: boolean;
  /** The assembled file's markers (`#orz-shell`, generator meta), and how its shell compares to this tool's. */
  shell: { version: string; generator: string | null; delivery: string; relation: 'same' | 'older' | 'newer' | 'unknown' } | null;
  /**
   * What a 0.x file holds: its version, generator, delivery, `<title>`,
   * `#orz-meta` keys, the theme its config showed first (its CLI `--theme`)
   * and its `<!-- deck -->` blocks (`top`: the first thing in the source, as
   * 0.x read it; `body`: later — 0.x did not read it, upgrade applies it;
   * `none`). Also set for a 0.x TEXT (input `text` holding a deck block).
   */
  legacy: { version: string | null; generator: string | null; delivery: 'inline' | 'cdn' | null; title: string | null; metaKeys: string[]; defaultTheme: string | null; deckBlock: 'top' | 'body' | 'none'; deckBlocks: number } | null;
  /** The header `uid` when valid (FC-18 §10). */
  uid: string | null;
  /** The derived title (FC-18 §8.1). For a 0.x input: as `upgrade` would write it. */
  title: string | null;
  /** The header `theme`, when set. For a 0.x input: the theme `upgrade` writes (what 0.x showed). */
  theme: string | null;
  /** The slide theme the deck shows (an alias resolved; the default `orchard` when none or unknown). */
  themeEffective: string | null;
  /** The slide ratio the deck shows (`16:9` or `4:3`). */
  ratio: string | null;
  /** The number of slides (format 1: one per slide marker). */
  slides: number | null;
  /** The header: present, legacy form (`meta`, `meta+document`), keys in source order. */
  header: { present: boolean; legacy: null | 'meta' | 'meta+document'; keys: string[] } | null;
  /** The slides settings the header resolves (FC-18 §5.1: the kit's `readDocument` `settings`). */
  settings: Record<string, string>;
  /** Number of resolved includes stored in `#orz-includes` (0 for a text). */
  includes: number;
  /**
   * The SHA-256 (hex) of the text the input holds — a text's exact UTF-8
   * bytes, the text inside an assembled or 0.x file — or null: the CLI's
   * `--replaces` token.
   */
  sha256: string | null;
  /** The text's lints: the kit's header lint, then the deck's (src/deck/parse.ts), each with its line. */
  lint: Lint[];
  /** What to do next, in plain sentences (commands included). */
  advice: string[];
  /** An assembled file's structure (island and document closed, the engine); `null` otherwise. */
  checks: { island: 'closed' | 'unclosed'; end: 'closed' | 'unclosed'; engine: 'same' | 'different' | 'unverified' | 'cdn' | 'missing' } | null;
  /** The sibling twin (`x.slides.md` ↔ `x.slides.html`), when the caller passed it. */
  twin: { name: string; holds: 'same' | 'different' | 'none'; newer: 'input' | 'twin' | 'same-time' | 'unknown'; sha256: string | null; earlier?: 'git-head' | 'git-index' | 'git-log' | 'cache' } | null;
  /**
   * For a 0.x input: what `upgrade` changes compared with what orz-slides
   * 0.8.5 showed (the frozen 0.8.5 parser against `parseDeck` of the
   * upgraded text, src/upgrade-report.ts) — `unexplained` (should be empty)
   * and `accepted` (a registered decision explains it). Also summed up in
   * `notes`. `null` otherwise.
   */
  upgrade: UpgradeReport | null;
  /** Things found but not understood, and the upgrade report's lines; nothing was changed because of them. */
  notes: string[];
}

/** Options of {@link inspect}. */
export interface InspectOptions {
  /** The input's file name: decides the kind of a text (FC-18 §3) and names it in the advice. */
  filename?: string;
  /** The sibling twin's content and which was modified last (the CLI reads it; this module reads no files). */
  twin?: { name: string; content: string; newer?: 'input' | 'twin' | 'same-time' | 'unknown'; earlier?: 'git-head' | 'git-index' | 'git-log' | 'cache' | null };
  /** This release's browser bundle (the Node library passes it): an inline file of this shell version is compared with it (`checks.engine`). */
  engineSource?: string;
}

/** `x.slides.md` → `x.browser.slides.md` (where a file's other text goes for a merge). */
export const browserName = (textName: string): string => `${textName.replace(/\.slides\.md$/i, '').replace(/\.md$/i, '')}.browser.slides.md`;

const CARRIER: Record<Kind, string> = { md: 'orz-mdhtml', slides: 'orz-slides', paged: 'orz-paged' };

/** A uid for inspect's in-memory upgrade (deterministic; never shown: the report names the input's own uid). */
const PLACEHOLDER_UID = 'doc-0000000000000000';

/** Where a text's deck blocks are: the first one first in the source (0.x read it), later, or none. */
function deckBlocks(text: string): { deckBlock: 'top' | 'body' | 'none'; deckBlocks: number } {
  const blocks = scanMarkers(text).filter((m) => m.type === 'deck');
  if (blocks.length === 0) return { deckBlock: 'none', deckBlocks: 0 };
  const top = text.slice(0, blocks[0].span.from).replace(/^﻿/, '').trim() === '';
  return { deckBlock: top ? 'top' : 'body', deckBlocks: blocks.length };
}

/** The upgrade report of a 0.x text and its upgraded text, or null with a note when the frozen parser fails on it. */
function reportOf(legacyText: string, upgraded: string, shownTheme: string | null, notes: string[]): UpgradeReport | null {
  try {
    const r = upgradeReport(legacyText, upgraded, shownTheme ?? '');
    notes.push(...reportNotes(r));
    return r;
  } catch (e) {
    notes.push(`upgrade report: the 0.8.5 parser could not read this text (${(e as Error).message}); no comparison`);
    return null;
  }
}

/** Inspect a text or a `.slides.html` file (any version). `filename`, when given, decides the kind of a text (FC-18 §3). */
export function inspect(input: string, options: InspectOptions = {}): InspectReport {
  const report: InspectReport = {
    tool: { name: 'orz-slides', version: VERSION, formats: [...FORMATS] },
    input: 'text',
    kind: null,
    format: null,
    writable: false,
    shell: null,
    legacy: null,
    uid: null,
    title: null,
    theme: null,
    themeEffective: null,
    ratio: null,
    slides: null,
    header: null,
    settings: {},
    includes: 0,
    sha256: null,
    lint: [],
    advice: [],
    checks: null,
    twin: null,
    upgrade: null,
    notes: [],
  };
  let text: string;
  let legacyText: string | null = null;
  let kind: Kind | undefined;
  const html = looksHtml(input);
  const self = sh(options.filename ?? (html ? 'file.slides.html' : 'file.slides.md'));
  if (!html && input.trim() === '' && options.filename !== undefined && /\.html?$/i.test(options.filename)) {
    report.input = 'html';
    report.advice.push(`the file is empty (${input.length === 0 ? 'no bytes' : 'only white space'}): a damaged or unfinished file, it holds no text — recover the text from its text twin or a backup, then assemble again`);
    return report;
  }
  if (html) {
    const legacy = readLegacy(input);
    if (legacy) {
      report.input = 'legacy';
      report.legacy = {
        version: legacy.version,
        generator: legacy.generator,
        delivery: legacy.delivery,
        title: legacy.title,
        metaKeys: legacy.meta ? Object.keys(legacy.meta) : [],
        defaultTheme: legacy.defaultTheme,
        ...deckBlocks(legacy.text),
      };
      report.notes.push(...legacy.notes);
      const up = upgradeText(legacy.text, { uid: PLACEHOLDER_UID, file: { title: legacy.title, meta: legacy.meta, defaultTheme: legacy.defaultTheme } });
      report.upgrade = reportOf(legacy.text, up.text, legacy.defaultTheme, report.notes);
      const twinText = options.twin && !looksHtml(options.twin.content) ? options.twin : null;
      const what = 'its <!-- deck --> block and metadata become one FC-18 header (with the theme 0.x showed), and the slides are kept';
      if (twinText) {
        const other = sh(browserName(twinText.name));
        report.advice.push(`orz-slides ${legacy.version ?? '0.x'} file (before text format 1; no compatibility shim) next to the text ${twinText.name}: run \`orz-slides upgrade ${self} --text ${other}\` — it writes this file's format-1 text (${what}) to ${browserName(twinText.name)} and re-assembles this file from it; then compare it with ${twinText.name}, merge what you keep into ${twinText.name} (keep the new header), and \`orz-slides assemble ${sh(twinText.name)}\``);
      } else {
        report.advice.push(`orz-slides ${legacy.version ?? '0.x'} file (before text format 1; no compatibility shim): run \`orz-slides upgrade ${self}\` for its format-1 text twin and a file of this version; ${what}`);
      }
      if (report.upgrade && report.upgrade.unexplained.length > 0) report.advice.push(`the upgraded deck differs from what 0.x showed in ${report.upgrade.unexplained.length} place${report.upgrade.unexplained.length === 1 ? '' : 's'} no decision explains (see notes): check those slides after upgrading`);
      legacyText = legacy.text;
      text = up.text;
      kind = 'slides';
    } else {
      const ex = extract(input);
      if (!ex) {
        report.input = 'html';
        report.advice.push('an HTML file without an #orz-src island: not an orz document; nothing to extract');
        return report;
      }
      if (ex.shell === '') {
        report.input = 'html';
        report.notes.push('an #orz-src island without #orz-shell and without orz-slides 0.x markers: an unknown writer');
        report.advice.push('`orz-slides extract` reads the island as format 1 would; check the text before relying on it');
        return report;
      }
      report.input = 'assembled';
      const cmp = ex.kind === 'slides' ? compareSemver(ex.shell, VERSION) : null;
      const relation = cmp === -1 ? 'older' : cmp === 0 ? 'same' : cmp === 1 ? 'newer' : 'unknown';
      report.shell = { version: ex.shell, generator: generatorOf(input), delivery: ex.delivery, relation };
      report.includes = ex.includes ? Object.keys(ex.includes).length : 0;
      if (ex.kind === 'slides') report.checks = assembledStructure(input, { shell: ex.shell, delivery: ex.delivery, version: VERSION, bundleUrl: cdnBundleUrl, ...(options.engineSource !== undefined ? { engineSource: options.engineSource } : {}) });
      if (report.checks) {
        const c = report.checks;
        const recovered = sh(`${(options.filename ?? 'file.slides.html').replace(/\.slides\.html$/i, '').replace(/\.html?$/i, '')}.recovered.slides.md`);
        if (c.island === 'unclosed') report.advice.push(`the #orz-src island is not closed (the file was cut off): the text may be incomplete — recover what you can: \`orz-slides extract ${self} -o ${recovered}\`, compare it with the text twin or a backup, and keep the complete text; do not re-assemble or upgrade this file from it`);
        else if (c.end === 'unclosed') report.advice.push(`the file does not end with </html> (cut off or damaged): its text is complete, but the page may not work; \`orz-slides upgrade ${self}\` re-assembles it`);
        if (c.island === 'closed' && (c.engine === 'different' || c.engine === 'missing')) report.advice.push(`the inline engine is ${c.engine === 'missing' ? 'missing' : `not orz-slides ${ex.shell}'s release bundle (altered or cut)`}: \`orz-slides upgrade ${self}\` re-assembles the file with this release's engine; the text does not change`);
        if (c.engine === 'unverified' && ex.delivery === 'inline' && relation !== 'same') report.notes.push(`the inline engine was not verified: this tool holds the bundle of ${VERSION}, the file's shell is ${ex.shell}`);
      }
      if (ex.kind === 'slides') {
        if (relation === 'older' && report.checks?.island !== 'unclosed') report.advice.push(`made by orz-slides ${ex.shell}, older than this tool (${VERSION}): \`orz-slides upgrade ${self}\` re-assembles it with the newest shell; the text does not change`);
        if (relation === 'newer') report.advice.push(`made by a newer orz-slides (${ex.shell}) than this tool (${VERSION}): re-assembling here would write an older shell; use \`npx orz-slides@latest\``);
      }
      text = ex.text;
      kind = ex.kind;
    }
  } else {
    text = input;
    kind = options.filename ? (kindFromFilename(options.filename) ?? undefined) : undefined;
    // a plain x.md is kind md by its name (FC-18 §3) — unless it is a deck: a header naming its carrier decides, else
    // slide markers or a 0.x <!-- deck --> block (`orz-slides deck.md`, the 0.x habit, assembles it as a deck too)
    if (kind === 'md' && /\.(md|markdown)$/i.test(options.filename ?? '')) {
      const carrier = readHeader(text)?.fields['carrier']?.trim();
      kind = carrier === 'md' || carrier === 'slides' || carrier === 'paged' ? carrier : scanMarkers(text).some((m) => m.type === 'deck' || m.type === 'slide') ? 'slides' : 'md';
    }
  }

  // the text the input holds (a 0.x file: its source; the facts below read it as `upgrade` would write it)
  report.sha256 = sha256(legacyText ?? text);
  const doc = readDocument(text, kind ? { kind } : {});
  report.kind = doc.kind;
  report.format = report.input === 'legacy' ? null : doc.format;
  report.uid = report.input === 'legacy' ? (doc.meta.uid && doc.meta.uid !== PLACEHOLDER_UID ? doc.meta.uid : null) : doc.meta.uid ?? null;
  report.title = doc.title;
  report.theme = doc.theme ?? null;
  report.header = report.input === 'legacy' ? null : doc.header ? { present: true, legacy: doc.header.legacy, keys: [...doc.header.keys] } : { present: false, legacy: null, keys: [] };
  report.settings = doc.kind === 'slides' ? { ...doc.settings } : {};
  report.lint = doc.lint;
  const newer = doc.format > Math.max(...FORMATS);
  if (doc.kind === 'slides' && !newer) {
    const p = presentationOf(text);
    report.themeEffective = p.theme.id;
    report.ratio = p.ratio;
    report.slides = parseDeck(text).slides.length;
  }
  report.writable = doc.kind === 'slides' && !newer && report.input !== 'legacy' && report.shell?.relation !== 'newer' && report.checks?.island !== 'unclosed';

  if (doc.kind !== 'slides') report.advice.push(`an orz ${doc.kind} document: use ${CARRIER[doc.kind]} (\`npx ${CARRIER[doc.kind]}\`)`);
  if (newer) report.advice.push(`text format ${doc.format} is newer than this tool reads and writes (format ${FORMATS.join(', ')}): read-only here; use a newer orz-slides (\`npx orz-slides@latest\`)`);

  // a 0.x TEXT: a <!-- deck --> block (the kit's deck-block lint, next: upgrade)
  const deckBlockLint = report.input !== 'legacy' && doc.kind === 'slides' && doc.lint.some((l) => l.code === 'deck-block');
  if (deckBlockLint) {
    const header = readHeader(text);
    const zeroX = !header || header.legacy !== null;
    report.legacy = { version: null, generator: null, delivery: null, title: null, metaKeys: [], defaultTheme: null, ...deckBlocks(text) };
    const out = report.input === 'text' ? upgradeTextName(options.filename ?? 'file.slides.md') : null;
    if (report.input === 'text') {
      if (zeroX) {
        const up = upgradeText(text, { uid: PLACEHOLDER_UID });
        report.upgrade = reportOf(text, up.text, null, report.notes);
      }
      report.advice.push(`${zeroX ? 'an orz-slides 0.x text' : 'a <!-- deck --> block in a format-1 text'}: format 1 reads the deck's title, theme, ratio and footer only from the header, so the block shows nothing — \`orz-slides upgrade ${self}\` moves it into the header${out && out !== (options.filename ?? '') ? ` and writes ${out}` : ' (in place; the old text is kept as a backup)'}`);
    } else {
      report.advice.push('the text holds a <!-- deck --> block, which format 1 does not read: extract the text, then `orz-slides upgrade` it');
    }
  }
  const errors = doc.lint.filter((l) => l.level === 'error' && l.code !== 'deck-block');
  if (errors.length > 0 && report.input !== 'legacy') report.advice.push(`fix the lint errors in the text (${[...new Set(errors.map((l) => l.code))].join(', ')}): the deck may not show what the text says until then`);
  if (report.input !== 'legacy' && doc.header?.legacy) report.advice.push('the header is a legacy `kind: meta` block (or a meta + settings pair): the first header edit (any tool) merges it into one `kind: document` header; nothing to do by hand');

  if (options.twin && (report.input === 'text' || report.input === 'assembled') && doc.kind === 'slides') {
    report.twin = kitTwinCheck(report.input, text, { name: options.twin.name, content: options.twin.content, ...(options.twin.newer ? { newer: options.twin.newer } : {}) }, { kind: 'slides', readLegacy });
    const t = report.twin;
    const tn = sh(t.name);
    const twinLegacy = report.input === 'text' && looksHtml(options.twin.content) && readLegacy(options.twin.content) !== null;
    if (t.holds === 'different' && twinLegacy) {
      report.advice.push(`${t.name} is an orz-slides 0.x file holding a different text than this text twin: \`orz-slides upgrade ${tn} --text ${sh(browserName(options.filename ?? 'file.slides.md'))}\` gives its format-1 text; compare and merge that into ${options.filename ?? 'this text'}, then \`orz-slides assemble ${self} --replaces <sha256>\` with the sha256 upgrade printed (the text ${t.name} then holds)`);
    } else if (t.holds === 'different' && options.twin.earlier) {
      const source = { 'git-head': 'its last commit', 'git-index': 'its staged version', 'git-log': 'one of its recent commits', cache: 'what orz-slides last wrote there' }[options.twin.earlier];
      t.earlier = options.twin.earlier;
      if (report.input === 'text') report.advice.push(`${t.name} holds an earlier text of this text twin (${source}): \`orz-slides assemble ${self}\` replaces it, no --force needed`);
      else report.advice.push(`this file holds an earlier text of ${t.name} (${source}): \`orz-slides assemble ${tn}\` replaces it, no --force needed`);
    } else if (t.holds === 'different') {
      const newerNote = t.newer === 'twin' ? `, and ${t.name} was modified later` : t.newer === 'input' ? '; this file was modified later' : '';
      if (report.input === 'text') {
        report.advice.push(`${t.name} holds a different text than this text twin${newerNote}. If it has changes this text lacks (saved in the browser), bring them in first: \`orz-slides extract ${tn} -o ${sh(browserName(options.filename ?? 'file.slides.md'))}\` and merge; when this text has everything, \`orz-slides assemble ${self} --replaces ${t.sha256}\``);
      } else {
        report.advice.push(`the text twin ${t.name} holds a different text than this file${newerNote}. If this file has changes the twin lacks (saved in the browser), \`orz-slides extract ${self} -o ${sh(browserName(t.name))}\` and merge them into ${t.name}; then \`orz-slides assemble ${tn} --replaces ${report.sha256}\``);
      }
    } else if (t.holds === 'none' && report.input === 'text') {
      report.advice.push(`${t.name} exists but is not an orz file: \`orz-slides assemble\` will not replace it without --force`);
    }
  }
  if (report.input === 'text' && doc.kind === 'slides' && !newer && !deckBlockLint && report.twin?.holds !== 'different') report.advice.push(`a deck text: \`orz-slides assemble ${self}\` makes its .slides.html; \`orz-slides inspect ${self} --layout\` checks in Chrome that every box fits`);
  if (report.input === 'text' && doc.kind === 'slides' && !doc.header && !deckBlockLint && (report.slides ?? 0) > 0) report.notes.push('no header: the deck shows the default theme (orchard) — an orz-slides 0.x deck showed paper; `orz-slides upgrade` writes a header with the theme 0.x showed, a carrier and a uid');
  return report;
}

/**
 * The text `upgrade` writes for a text input (`upgrade x.md`): a `.slides.md`
 * name is upgraded in place; a plain `x.md` (0.x's habit) becomes
 * `x.slides.md`; null for any other name (`-o` names it).
 */
export function upgradeTextName(name: string): string | null {
  if (/\.slides\.md$/i.test(name)) return name;
  if (/\.(md|markdown)$/i.test(name)) return name.replace(/\.(md|markdown)$/i, '.slides.md');
  return null;
}
