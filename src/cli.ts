#!/usr/bin/env node
/**
 * The orz-slides CLI (FC-10; REBUILD §3c step 7, the shape of orz-mdhtml
 * 1.0's and orz-paged 1.0's): text twins (`x.slides.md`) and their
 * self-editing slide decks (`x.slides.html`, FC-18 text format 1, kind
 * `slides`).
 *
 *   orz-slides new [file.slides.md] [--template id] [--title T] [--theme id] [--ratio R] [--html] [--cdn]
 *   orz-slides assemble <file.slides.md> [-o out] [--cdn] [--resolve-includes | --no-includes] [--replaces sha256]   (also: orz-slides <file.slides.md>)
 *   orz-slides extract <file.slides.html> [-o out] [--replaces sha256]
 *   orz-slides upgrade <old.slides.html | old.md> [-o out] [--text out.slides.md | --no-text] [--cdn | --inline]
 *   orz-slides inspect <file> [--layout [--offline]] [--json]
 *   orz-slides themes | templates
 *
 * Inline delivery is the default (FD-02); `--cdn` loads the engine from
 * jsDelivr (web publishing). Content — title, theme, ratio, footer,
 * metadata — comes only from the text's header: `assemble` has no content
 * options (STATUS D-07). Every command takes `--json` (one JSON object on
 * stdout, for agents; a failure has a stable `reason` code and, where
 * useful, `next`), `--help`; exit status 0 = done, 1 = refused or failed,
 * 2 = usage. Files are never overwritten when that could lose work (see
 * `--force`).
 *
 * A plain Markdown text `x.md` (the 0.x habit, `orz-slides deck.md`)
 * assembles to `x.slides.html` as well; its twin by name is `x.slides.md`.
 * A 0.x TEXT (one holding a `<!-- deck -->` block) is refused by `assemble`
 * with `next: upgrade x.md`, which writes its format-1 text.
 *
 * The rules every carrier's CLI shares — the overwrite guards, the known
 * states (git and the pair records under `$XDG_CACHE_HOME/orz-slides`), the
 * backups, atomic writes, includes, the reason codes and `next` — are
 * orz-markdown's CLI core (`orz-markdown/carrier/node`) bound to this tool;
 * this file holds the commands, their wording and the slides extras (deck
 * templates, 0.x texts, the upgrade report, `inspect --layout`).
 */
import { existsSync, statSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { kindFromFilename, looksHtml, readHeader, twinName, type Lint } from 'orz-markdown/carrier';
import {
  assembleArgs, backup, carrierNode, CliError, emit, includePlan, mtime, readMaybe, readText, replacesToken, reportFailure, sh, sha256, writeOut,
  EXIT_OK, EXIT_USAGE, type AssembleCall, type Io, type KnownState, type Next, type Risk,
} from 'orz-markdown/carrier/node';
import { compareSemver } from 'orz-markdown/carrier/shell';
import { storedText } from './assemble.js';
import { presentationOf } from './presentation.js';
import { textKindOf } from './inspect.js';
import { findChrome, layoutAdvice, layoutReport, type LayoutReport } from './layout-report.js';
import {
  assemble, extract, inspect, newDocument, readDocument, readLegacy, reportNotes, upgrade, upgradeReport, upgradeText, upgradeTextName,
  DEFAULT_TEMPLATE, DEFAULT_THEME, ORZ_MARKDOWN_VERSION, RATIOS, TEMPLATES, THEMES, VERSION, type InspectReport, type UpgradeReport,
} from './lib.js';

export type { Reason } from 'orz-markdown/carrier/node';

/** The kit's CLI core, bound to this tool (its name, kind, cache folder `orz-slides`, text twins `.slides.md`, its 0.x reader). */
const NODE = carrierNode({ name: 'orz-slides', kind: 'slides', readLegacy, storedText });

// ── help ────────────────────────────────────────────────────────────────────

const USAGE = `orz-slides ${VERSION} — slide decks written in Markdown that present, edit and save themselves.
A deck is its text twin (x.slides.md); its self-editing file (x.slides.html) is assembled from it.

Usage:
  orz-slides new [file.slides.md] [--template id] [--title T] [--theme id] [--ratio 16:9|4:3] [--html] [--cdn]
  orz-slides assemble <file.slides.md> [-o out.slides.html] [--cdn] [--resolve-includes | --no-includes] [--replaces sha256]
  orz-slides <file.slides.md> [-o out.slides.html] [--cdn]          same as assemble
  orz-slides extract <file.slides.html> [-o out.slides.md] [--replaces sha256]
  orz-slides upgrade <old.slides.html> [-o out.slides.html] [--text out.slides.md | --no-text] [--cdn | --inline]
  orz-slides upgrade <old.md> [-o out.slides.md]                    a 0.x text (with a <!-- deck --> block)
  orz-slides inspect <file> [--layout [--offline]] [--json]
  orz-slides themes
  orz-slides templates

Commands:
  new        write a new text twin from a deck template (header with a fresh uid); --html also
             assembles it; without a file the text goes to stdout
  assemble   write the .slides.html of a text twin (x.slides.md -> x.slides.html); inline by default;
             keeps the includes the existing file holds
  extract    write the exact text twin of a .slides.html (x.slides.html -> x.slides.md), also of a
             file saved in the browser
  upgrade    turn an old file (0.x, or an older 1.x shell) into a file of this version, in place by
             default, and write its text twin (x.slides.md) unless --no-text; or turn a 0.x text
             (deck.md) into a format-1 text (deck.slides.md)
  inspect    diagnose a text or a file: kind, format, shell, delivery, uid, slides, lint, advice;
             for a 0.x deck what upgrade changes; --layout renders it in Chrome and reports per
             slide and box the fit scale and clipping
  themes     list the slide theme ids a header may name
  templates  list the deck templates (new --template)

Options:
  -o, --out <path>  output path ("-" = stdout for assemble and extract)
  --cdn             load the engine from jsDelivr (small files, for the web); default: inline
  --inline          the default delivery: the engine inside the file (no engine download)
  --force           overwrite even when that could lose work (see below); the replaced
                    file is kept as <file>~ (or <file>~1, ~2, ... — a backup is never replaced)
  --replaces <sha>  (assemble, extract) replace an existing, different output only if its
                    text has this SHA-256 (the "sha256" inspect, extract, assemble and
                    upgrade print) — works with no cache, no git, in a shallow clone
  --json            print one JSON object (the result, or {"ok": false, "error", "reason",
                    "next"}) for agents
  -h, --help        help (also: orz-slides <command> --help)
  -v, --version     the version

Content (title, theme, ratio, footer, transition, metadata) comes only from the text's
{{nyml}} header; assemble has no content options (0.x --theme and --title: see
\`orz-slides new --help\` and \`orz-slides upgrade --help\`).
Without --force nothing is overwritten that could hold other work: an output that is
not an orz file, a .slides.html (or -o output) that holds a different text than the one
assembled, an x.slides.md that differs from the text extracted (unless the text replaced
is a known state: what orz-slides itself last wrote or read for the pair, a committed,
staged or recent version of the twin in git, or the text whose SHA-256 --replaces
gives; an x.slides.md is replaced as a known state only when it and the file's text
carry the same uid), a file made by a newer orz-slides, another document (upgrade -o),
or (new) any existing file. The robust way: pass the sha256 the last command printed
as --replaces.
Before editing x.slides.md, \`orz-slides inspect x.slides.md\` says whether x.slides.html
holds other work (saved in the browser); \`orz-slides extract x.slides.html -o
x.browser.slides.md\` brings it out for a merge.
Exit status: 0 done, 1 refused or failed, 2 usage error.`;

const HELP: Record<string, string> = {
  new: `orz-slides new [file.slides.md] [--template id] [--title T] [--theme id] [--ratio 16:9|4:3] [--html] [--cdn] [--force] [--json]

Writes a new format-1 text twin from a deck template: its header (kind: document,
carrier: slides, a fresh uid, the given title/theme/ratio), then the template's starter
slides. Without a file the text is printed to stdout. --html also writes its assembled
file (file.slides.html; --cdn for a small web file). Refuses to overwrite an existing
file unless --force, which keeps each replaced file as <file>~. A text twin's name ends
in .slides.md.
Templates (default ${DEFAULT_TEMPLATE}; \`orz-slides templates\` describes them): ${TEMPLATES.map((t) => t.id).join(', ')}.
Themes (default ${DEFAULT_THEME}; \`orz-slides themes\` describes them): ${THEMES.map((t) => t.id).join(', ')}.
Ratios: ${RATIOS.join(', ')} (default 16:9).
(0.x: \`orz-slides deck.md --theme <id> --title <T>\` is now a header in the text:
\`orz-slides upgrade deck.md\` writes deck.slides.md with one, or \`orz-slides new
deck.slides.md --theme <id> --title <T>\` starts a new deck.)`,
  assemble: `orz-slides assemble <file.slides.md> [-o out.slides.html] [--cdn] [--resolve-includes | --no-includes] [--replaces <sha256>] [--force] [--json]
orz-slides <file.slides.md> [-o out.slides.html] [--cdn] [--force] [--json]

Writes the self-editing deck of a text twin: x.slides.md -> x.slides.html (FC-18 §3), the
text stored exactly (line endings, BOM); -o writes it elsewhere (missing folders are
created). Delivery: --inline (this release's engine inside the file) or --cdn (loads it
from jsDelivr); without either, an existing output keeps its delivery, a new one is
inline. Everything about the deck — title, theme, ratio, footer, slide numbers,
progress, section numbers, transition, metadata — comes from the text's header; there
are no content options. A plain Markdown text (x.md) assembles to x.slides.html too.
A 0.x text (one holding a <!-- deck --> block, which format 1 does not read) is
refused (legacy-file): \`orz-slides upgrade x.md\` writes its format-1 text first.

Includes ({{md part.md}}, {{md https://…}}): a file shows an include only from the
record it holds (#orz-includes). The record of the existing output is kept (for the
directives the text still has); --no-includes drops it. --resolve-includes reads the
file includes from the text's folder (never outside it) and records them; a recorded file
include whose file has changed since is a warning (--json: "stale"). A directive left
unresolved shows an "Included file not available" note in the deck; each one is reported
once, as a warning, with why (--json: "unresolved": [{ target, kind, reason }]).

Replacing the output (x.slides.html, or the -o path; no --force needed) when it holds:
  - the same text, or
  - the text orz-slides itself last wrote into it or read out of it for this pair
    (assemble, extract, new --html, upgrade; recorded by hash in
    $XDG_CACHE_HOME/orz-slides or ~/.cache/orz-slides), or
  - (x.slides.html only) an earlier state of x.slides.md in git: its last commit, its staged
    version or one of its 20 most recent commits (git log -- x.slides.md), when x.slides.md is
    tracked. A shallow checkout (CI's default --depth 1) knows only the last commit: use
    --replaces there, or
  - with --replaces <sha256>: exactly the text with that SHA-256 — the "sha256" that
    inspect, extract, assemble and upgrade print (works with no cache, no git, in a
    shallow clone). With --replaces, any other text is refused.
So the normal loop — edit x.slides.md, assemble, edit, assemble — needs no --force, with or
without -o. Refuses (unless --force) to replace an output that is not an orz file
(not-orz); a 0.x file (\`orz-slides upgrade x.slides.html --text x.browser.slides.md\`, merge,
then assemble with the sha256 upgrade printed as --replaces); a file made by a newer
orz-slides (use \`npx orz-slides@latest\`); or an output holding any other text — it may
hold work saved in the browser (twin-differs; for -o: output-differs, another text or
another document): \`orz-slides extract x.slides.html -o x.browser.slides.md\`, merge that into
x.slides.md, then the assemble command the refusal names (your arguments and --replaces).
When only the file changed (x.slides.md is what orz-slides last synced) and both texts
carry the same uid, the refusal names plain \`orz-slides extract x.slides.html\`. An output
holding another document (another uid) is refused with no next: choose another -o path.
When x.slides.md has everything, --force replaces it and keeps the old file as
x.slides.html~ (or ~1, ~2, ...).`,
  extract: `orz-slides extract <file.slides.html> [-o out.slides.md] [--replaces <sha256>] [--force] [--json]

Writes the exact text twin of an assembled deck: x.slides.html -> x.slides.md, byte for byte
the text that was assembled (CR LF and BOM kept) — also of a deck saved in the browser
(its Save writes the same file; a page saved with the browser's "Save Page As" keeps
the text too). A 0.x file (before text format 1) is refused: use \`orz-slides upgrade
<file>\`, which writes its format-1 text twin. Warns when the file was cut off (the
text may be incomplete).

Replaces an existing x.slides.md (or -o output) that holds a different text (no --force
needed) only when it is a known state AND x.slides.md and the file's text carry the same
uid (the same document) — so no edit made to it is lost, whichever file is newer:
  - exactly the text orz-slides last wrote or read for this pair (unchanged since, line
    endings included), while this pair is the last orz-slides synced the file with, or
  - (x.slides.md, the file's own twin, only) its last commit, its staged version or one of
    its 20 most recent commits in git (a full clone; in a shallow checkout use --replaces),
    or
  - with --replaces <sha256>: exactly the x.slides.md with that SHA-256 (\`sha256sum
    x.slides.md\`, or the "sha256" of \`orz-slides inspect x.slides.md --json\`); with
    --replaces, nothing else counts.
Never (without --force) when x.slides.md holds another document (another uid): output-differs.
Otherwise it refuses (x.slides.md may hold edits the file lacks): extract to another name,
\`orz-slides extract x.slides.html -o x.browser.slides.md\`, and merge the two into x.slides.md.
--force replaces it anyway and keeps the old text as x.slides.md~ (or ~1, ~2, ...). An empty
file is reported as empty (damaged), not extracted.`,
  upgrade: `orz-slides upgrade <old.slides.html> [-o out.slides.html] [--text out.slides.md | --no-text] [--cdn | --inline] [--force] [--json]
orz-slides upgrade <old.md> [-o out.slides.md] [--force] [--json]

A FILE: turns an orz-slides file into a file of this version. A 0.x file: its deck source
is kept; its <!-- deck --> block (wherever it was) and a kind: meta block become one
format-1 header at the top (with carrier: slides and a uid), with the theme 0.x SHOWED
written explicitly — the deck block's, else the file's own (its CLI --theme), else 0.x's
implicit paper; the dropped 0.x themes map to their successors (executive -> sky,
poppy -> sticker, sage -> orchard) — and the 0.x file's metadata (#orz-meta) and title
move into it; markers a block swallowed are repaired and 0.x marker spellings
normalised, each with a note. A format-1 file: re-assembled with this shell, text and
includes unchanged. Writes the file in place (or to -o) and its text twin (twin of the
output, or --text; --no-text skips it). Keeps the old file's delivery (--cdn / --inline
to choose). Also repairs a damaged shell or engine (the text must be intact).
The upgrade report (--json "report", and the notes): what the upgraded deck shows
compared with what orz-slides 0.8.5 showed — slides, titles, regions, layouts, notes,
footers, floats, slide options, theme — the differences a registered decision explains
("accepted") and any other ("unexplained", which should be empty).
Refuses (unless --force) a file whose shell is newer than this tool (a downgrade), a
file cut off inside its text (#orz-src not closed: the text may be incomplete), -o onto
another document, and an existing text twin that differs (unless it is a known state,
as for extract): for a 0.x file next to its own text, \`--text x.browser.slides.md\` and
merge. --force keeps each replaced file as <file>~.

A TEXT (a 0.x deck source, deck.md, or any slides text holding a <!-- deck --> block):
writes its format-1 text — the same header rules (a format-1 header's own keys win over
a deck block beside it) — to deck.slides.md (a .slides.md is upgraded in place, the old
text kept as <file>~), or -o. An existing, different output is refused unless --force.
Then \`orz-slides assemble deck.slides.md\`.`,
  inspect: `orz-slides inspect <file> [--layout [--offline]] [--json]

Diagnoses a text twin, an assembled deck, a 0.x file or text, or any HTML: kind, text
format, shell version and how it compares to this tool, delivery, uid, title, theme (as
written and as shown), ratio, the number of slides, header keys and settings, includes,
lint (header and deck, with lines), the file's structure (island, end, engine), the SHA-256
of the text it holds (the --replaces token), whether its sibling twin (x.slides.md <->
x.slides.html) holds the same text and which is newer, advice (the commands to run) and,
for a 0.x deck, the upgrade report (what upgrade changes against what 0.8.5 showed).
--layout renders the deck (its text, assembled with this release's engine) in an
installed Chrome — headless, a fresh profile — shows every slide, lets its fit settle,
and reports per slide and box the fit scale (1 = unscaled, the floor 0.6) and whether
its content is cut (clipped), and whether the footer is cut: an agent's overflow check.
Online by default (math, diagrams, charts and webfonts load from the web as for the
audience); --offline blocks every host. Chrome is looked for at its usual places, or
ORZ_SLIDES_CHROME names it; without one --layout is refused (no-browser).
Human-readable by default; --json prints the report object (with "layout").`,
  themes: `orz-slides themes [--json]

Lists the slide theme ids a header's \`theme\` key may name, with a line on each and
whether it is light or dark (the default is marked). The orz-markdown theme ids are
accepted as aliases of the themes derived from them.`,
  templates: `orz-slides templates [--json]

Lists the deck templates \`orz-slides new --template <id>\` takes (the default is marked).`,
};

// ── arguments ───────────────────────────────────────────────────────────────

type Spec = Record<string, 'value' | 'flag'>;

interface Parsed {
  positional: string[];
  values: Record<string, string>;
  flags: Set<string>;
}

const COMMON: Spec = { '--json': 'flag', '--help': 'flag', '-h': 'flag', '--force': 'flag' };
const ALIASES: Record<string, string> = { '-o': '--out', '-h': '--help' };
const SPECS: Record<string, Spec> = {
  new: { ...COMMON, '--template': 'value', '--title': 'value', '--theme': 'value', '--ratio': 'value', '--html': 'flag', '--cdn': 'flag', '--inline': 'flag' },
  assemble: { ...COMMON, '--out': 'value', '-o': 'value', '--cdn': 'flag', '--inline': 'flag', '--resolve-includes': 'flag', '--no-includes': 'flag', '--replaces': 'value' },
  extract: { ...COMMON, '--out': 'value', '-o': 'value', '--replaces': 'value' },
  upgrade: { ...COMMON, '--out': 'value', '-o': 'value', '--text': 'value', '--no-text': 'flag', '--cdn': 'flag', '--inline': 'flag' },
  inspect: { ...COMMON, '--layout': 'flag', '--offline': 'flag' },
  themes: { ...COMMON },
  templates: { ...COMMON },
};
/** Options of 0.x `orz-slides <file.md>` (and header keys) that set content: removed, the header holds it (D-07). */
const CONTENT_OPTIONS = ['--theme', '--title', '--ratio', '--author', '--footer', '--transition', '--uid', '--lang'];

function parse(command: string, argv: string[]): Parsed {
  const spec = SPECS[command];
  const out: Parsed = { positional: [], values: {}, flags: new Set() };
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i];
    if (raw === '--') { out.positional.push(...argv.slice(i + 1)); break; }
    if (!raw.startsWith('-') || raw === '-') { out.positional.push(raw); continue; }
    const eq = raw.startsWith('--') ? raw.indexOf('=') : -1;
    const name = eq > 0 ? raw.slice(0, eq) : raw;
    const kind = spec[name];
    const key = ALIASES[name] ?? name;
    if (!kind) {
      if (command === 'assemble' && CONTENT_OPTIONS.includes(name)) {
        const what = name.slice(2);
        throw new CliError(
          `${name} is not an assemble option: since 1.0 the ${what} comes from the text itself. `
          + `Put \`${what}: …\` in the {{nyml}} header at the top of the text (a 0.x deck: \`orz-slides upgrade <deck.md>\` writes its format-1 text with a header${['--title', '--theme', '--ratio'].includes(name) ? `; a new deck: \`orz-slides new <file.slides.md> ${name} …\`` : ''}), then assemble again.`,
          EXIT_USAGE,
        );
      }
      if (command === 'assemble' && name === '--template') {
        throw new CliError('--template is not an assemble option: a deck template starts a NEW text — `orz-slides new <file.slides.md> --template <id>` (`orz-slides templates` lists them); a slide\'s own template page is its marker option (`<!-- slide template=title -->`)', EXIT_USAGE);
      }
      throw new CliError(`unknown option ${name} for \`orz-slides ${command}\` (see \`orz-slides ${command} --help\`)`, EXIT_USAGE);
    }
    if (kind === 'flag') {
      if (eq > 0) throw new CliError(`${name} takes no value`, EXIT_USAGE);
      out.flags.add(key);
    } else {
      const value = eq > 0 ? raw.slice(eq + 1) : argv[++i];
      if (value === undefined || (eq < 0 && value.startsWith('-') && value !== '-')) throw new CliError(`${name} needs a value`, EXIT_USAGE);
      out.values[key] = value;
    }
  }
  if (out.flags.has('--cdn') && out.flags.has('--inline')) throw new CliError('--cdn and --inline exclude each other', EXIT_USAGE);
  return out;
}

const one = (p: Parsed, what: string, command: string): string => {
  if (p.positional.length === 0) throw new CliError(`\`orz-slides ${command}\` needs ${what} (see \`orz-slides ${command} --help\`)`, EXIT_USAGE);
  if (p.positional.length > 1) throw new CliError(`\`orz-slides ${command}\` takes one ${what}, got ${p.positional.length}: ${p.positional.join(' ')}`, EXIT_USAGE);
  return p.positional[0];
};

/** The text twin name for a template id or a 0.x name (`talk` → `talk.slides.md`, `deck.md` → `deck.slides.md`). */
const slidesTextName = (name: string): string => (/\.slides\.md$/i.test(name) ? name : `${name.replace(/\.(md|markdown)$/i, '')}.slides.md`);

// ── files ───────────────────────────────────────────────────────────────────

/**
 * The file a text assembles to by default: the twin of `x.slides.md`
 * (`x.slides.html`, FC-18 §3), and for a plain Markdown text `x.md` (the 0.x
 * habit) `x.slides.html` too; null for any other name (`-o` names it).
 */
function outputOf(name: string): string | null {
  if (/\.slides\.md$/i.test(name)) return twinName(name);
  if (/\.md$/i.test(name) && kindFromFilename(name) === 'md') return name.replace(/\.md$/i, '.slides.html');
  return null;
}

/** The user's own `assemble` options (output, delivery, includes), repeated by every suggested command. */
const callOf = (p: Parsed): AssembleCall => ({
  ...(p.values['--out'] !== undefined ? { out: p.values['--out'] } : {}),
  ...(p.flags.has('--cdn') ? { delivery: 'cdn' as const } : p.flags.has('--inline') ? { delivery: 'inline' as const } : {}),
  resolveIncludes: p.flags.has('--resolve-includes'),
  noIncludes: p.flags.has('--no-includes'),
});

/** `orz-slides <command> <args…>` for a message (the same words as `next`). */
const commandLine = (n: Next): string => NODE.commandLine(n);

const lintLine = (l: Lint): string => `${l.message} (${l.code}${l.line ? `, line ${l.line}` : ''})`;
const errors = (lint: Lint[]): string[] => lint.filter((l) => l.level === 'error').map(lintLine);
const warnings = (lint: Lint[]): string[] => lint.filter((l) => l.level === 'warning').map(lintLine);

const delivery = (p: Parsed, fallback: 'inline' | 'cdn' = 'inline'): 'inline' | 'cdn' => (p.flags.has('--cdn') ? 'cdn' : p.flags.has('--inline') ? 'inline' : fallback);

/** The library's error message without its prefix, as a CliError with the kit's reason. */
const libError = (file: string, e: unknown, prefix: RegExp = /^orz-slides: /): CliError => {
  const message = (e as Error).message.replace(prefix, '');
  return new CliError(`${file}: ${message}`, NODE.libReason(message));
};

// ── commands ────────────────────────────────────────────────────────────────

function cmdNew(p: Parsed, o: Io): void {
  if (p.positional.length > 1) throw new CliError(`\`orz-slides new\` takes at most one file, got ${p.positional.length}`, EXIT_USAGE);
  const file = p.positional[0];
  const force = p.flags.has('--force');
  let text: string;
  try {
    text = newDocument({
      ...(p.values['--template'] !== undefined ? { template: p.values['--template'] } : {}),
      ...(p.values['--title'] !== undefined ? { title: p.values['--title'] } : {}),
      ...(p.values['--theme'] !== undefined ? { theme: p.values['--theme'] } : {}),
      ...(p.values['--ratio'] !== undefined ? { ratio: p.values['--ratio'] } : {}),
    });
  } catch (e) {
    const m = (e as Error).message.replace(/^orz-slides: /, '');
    throw new CliError(`${m}${/unknown theme/.test(m) ? ` (themes: ${THEMES.map((t) => t.id).join(', ')}; \`orz-slides themes\` describes them)` : /unknown template/.test(m) ? '; `orz-slides templates` describes them' : ''}`, EXIT_USAGE);
  }
  const info = readDocument(text, { kind: 'slides' });
  const pres = presentationOf(text);
  const facts = { kind: 'slides', format: info.format, uid: info.meta.uid ?? null, title: info.title, theme: info.theme ?? null, themeEffective: pres.theme.id, ratio: pres.ratio, template: p.values['--template'] ?? DEFAULT_TEMPLATE, sha256: sha256(text) };
  if (!file) {
    if (p.flags.has('--html')) throw new CliError('--html needs a file name (orz-slides new talk.slides.md --html)', EXIT_USAGE);
    if (o.json) emit(o, { command: 'new', file: null, html: null, ...facts, text });
    else process.stdout.write(text);
    return;
  }
  const path = resolve(file);
  const k = kindFromFilename(path);
  if (k !== 'slides' || !/\.slides\.md$/i.test(path)) {
    throw new CliError(k === 'paged' ? `${file} names an orz paged document: use orz-paged` : `${file}: a slides text twin's name ends in .slides.md (e.g. ${slidesTextName(basename(file).replace(/\.html?$/i, '').replace(/\.slides$/i, ''))})`, EXIT_USAGE);
  }
  const htmlPath = p.flags.has('--html') ? twinName(path)! : null;
  const present = [path, htmlPath].filter((f): f is string => f !== null && existsSync(f));
  if (!force && present.length > 0) throw new CliError(`${present[0]} already exists; not overwritten (pass --force to replace it; the old file is kept as ${present[0]}~)`, 'exists');
  let html: string | null = null;
  try { html = htmlPath ? assemble(text, { delivery: delivery(p) }) : null; } catch (e) { throw libError(file, e); }
  // --force: every file replaced is kept as <file>~ first (nothing is written if a copy fails)
  const backups = present.map((f) => backup(f, o));
  writeOut(path, text);
  o.say(`Wrote ${path} (template ${facts.template})`);
  if (htmlPath && html !== null) {
    writeOut(htmlPath, html);
    NODE.rememberPair(path, htmlPath, storedText(text), text, o, { command: 'assemble', sha: sha256(storedText(text)) });
    o.say(`Wrote ${htmlPath} (${delivery(p)})`);
  }
  emit(o, { command: 'new', file: path, html: htmlPath, ...facts, ...(htmlPath ? { delivery: delivery(p), shell: VERSION } : {}), backups });
}

function cmdAssemble(p: Parsed, o: Io): void {
  const file = one(p, 'a text file (file.slides.md)', 'assemble');
  const input = resolve(file);
  const kind = kindFromFilename(input);
  if (kind === 'paged') throw new CliError(`${file} is an orz paged text: use orz-paged`, 'other-kind');
  const resolveFlag = p.flags.has('--resolve-includes');
  if (resolveFlag && p.flags.has('--no-includes')) throw new CliError('--resolve-includes and --no-includes exclude each other', EXIT_USAGE);
  const token = replacesToken(p.values['--replaces']);
  const text = readText(input);
  if (looksHtml(text) && NODE.documentTextOf(text) !== null) {
    // a 0.x file: extract refuses it (legacy-file); upgrade writes its format-1 text twin (CLI-7)
    if (readLegacy(text) !== null) throw new CliError(`${file} is an orz-slides 0.x file, not a text: \`orz-slides upgrade ${sh(file)}\` writes its format-1 text twin and makes it a file of this version; then edit and assemble that text`, 'assembled-input', { command: 'upgrade', args: [file] });
    throw new CliError(`${file} is an assembled file, not a text: \`orz-slides extract ${sh(file)}\` gives its text; \`orz-slides upgrade ${sh(file)}\` re-assembles it with this version`, 'assembled-input', { command: 'extract', args: [file] });
  }
  const outArg = p.values['--out'];
  const toStdout = outArg === '-';
  if (toStdout && o.json) throw new CliError('-o - (stdout) and --json exclude each other', EXIT_USAGE);
  const out = toStdout ? null : outArg !== undefined ? resolve(outArg) : outputOf(input);
  if (!toStdout && out === null) throw new CliError(`cannot name the output of ${file} (a text twin's name ends in .slides.md, or a Markdown text's in .md): pass -o out.slides.html`, EXIT_USAGE);
  if (out === input) throw new CliError('the output would overwrite the input', EXIT_USAGE);
  // the kind, as inspect decides it (CLI-8): the header's carrier whatever the name, else the name, else slide markers
  const declared = textKindOf(text, file);
  if (declared !== 'slides' && !p.flags.has('--force')) {
    const tool = declared === 'md' ? 'orz-mdhtml' : `orz-${declared}`;
    const why = readHeader(text)?.fields['carrier'] !== undefined ? `the header says carrier: ${declared}` : 'it has no slide markers (`<!-- slide -->`) and no `carrier: slides` in a header: an orz md document';
    throw new CliError(`${file}: ${why}; use ${tool} (to make it a deck: put \`carrier: slides\` in its header, or start slides with \`<!-- slide -->\`; --force assembles it as a deck as it is)`, 'other-kind');
  }
  const info = readDocument(text, { kind: 'slides' });
  if (info.format > 1) throw new CliError(`${file}: text format ${info.format} is newer than this tool writes (format 1); use a newer orz-slides (\`npx ${commandLine({ command: 'assemble', args: assembleArgs(callOf(p), file) }).replace(/^orz-slides /, 'orz-slides@latest ')}\`)`, 'newer-format');
  const force = p.flags.has('--force');
  // a 0.x text: its <!-- deck --> block (title, theme, ratio, footer) is not read in format 1 — upgrade it first
  const deckBlock = info.lint.find((l) => l.code === 'deck-block');
  if (deckBlock && !force) {
    const zeroX = (() => { const h = readHeader(text); return !h || h.legacy !== null; })();
    throw new CliError(`${file} holds a <!-- deck --> block (line ${deckBlock.line ?? '?'})${zeroX ? ' — an orz-slides 0.x text' : ''}: format 1 reads the deck's title, theme, ratio and footer only from the header, so the block would show nothing. \`${commandLine({ command: 'upgrade', args: [file] })}\` moves it into the header (and writes ${upgradeTextName(file) ?? 'the format-1 text'}${upgradeTextName(file) === file ? ', the old text kept as a backup' : ''}); then assemble that. --force assembles it as it is`, 'legacy-file', { command: 'upgrade', args: [file] });
  }

  // the existing output: may it be replaced, and which includes and delivery does it hold?
  const exists = out !== null && existsSync(out);
  const existing = exists ? readMaybe(out!) : null;
  const names = { input: NODE.shown(input, file), out: out === null ? '-' : NODE.shown(out, outArg ?? outputOf(file) ?? undefined), twin: out !== null && out === outputOf(input) };
  const check = exists ? NODE.assembledOutputCheck({ input, out: out!, text, names, token, call: callOf(p) }, existing) : { risk: null, earlier: null };
  const prior = existing !== null && looksHtml(existing) ? extract(existing) : null;
  const priorLegacy = existing !== null && looksHtml(existing) && prior === null ? readLegacy(existing) : null;
  // the delivery: as asked (--cdn / --inline), else the existing file's (as upgrade and browser saves keep it), else inline
  const d = delivery(p, prior?.delivery === 'cdn' || priorLegacy?.delivery === 'cdn' ? 'cdn' : 'inline');
  // a file made by a newer orz-slides: re-assembling here would downgrade its shell (as upgrade refuses)
  const newerShell = prior && prior.kind === 'slides' && prior.shell && compareSemver(prior.shell, VERSION) === 1 ? prior.shell : null;
  const shellRisk: Risk | null = newerShell === null ? null : {
    message: `${names.out} was made by a newer orz-slides (${newerShell}) than this tool (${VERSION}): assembling here would replace its shell with an older one; not replaced. Use \`npx ${commandLine({ command: 'assemble', args: assembleArgs(callOf(p), names.input) }).replace(/^orz-slides /, 'orz-slides@latest ')}\` (or pass --force: the old file is kept as ${names.out}~)`,
    reason: 'newer-shell',
  };
  // a newer shell first: any assemble here would downgrade it, so a twin refusal's --replaces could not help (CLI-6)
  if (!force) for (const r of [shellRisk, check.risk]) if (r !== null) throw new CliError(r.message, r.reason, r.next);

  // includes (FC-18 §8.3): the existing file's record kept for the directives the text still has; --resolve-includes
  // reads file includes from the text's folder; stale records and unresolved directives are named (the kit's plan)
  const plan = includePlan(text, {
    folder: dirname(input),
    held: prior?.includes ?? null,
    keep: !p.flags.has('--no-includes'),
    resolve: resolveFlag,
    outName: names.out,
    resolveCommand: commandLine({ command: 'assemble', args: assembleArgs(callOf(p), names.input, ['--resolve-includes']) }),
  });
  for (const w of plan.warnings) o.warn(w);
  const { includes, resolved, unresolved, stale } = plan;

  let html: string;
  try { html = assemble(text, { delivery: d, ...(Object.keys(includes).length ? { includes } : {}) }); } catch (e) { throw libError(file, e); }
  for (const w of errors(info.lint)) o.warn(w);
  for (const w of warnings(info.lint)) o.warn(w);
  if (toStdout) { process.stdout.write(html); return; }
  const backedUp = check.risk !== null || shellRisk !== null ? backup(out!, o) : null;
  if (shellRisk !== null) o.warn(`${names.out} had a newer shell (orz-slides ${newerShell}); --force re-assembled it with this older one (${VERSION})`);
  writeOut(out!, html);
  const stored = storedText(text);
  const hash = sha256(stored);
  NODE.rememberPair(input, out!, stored, text, o, { command: 'assemble', sha: hash });
  const n = Object.keys(includes).length;
  const pres = presentationOf(text);
  o.say(`Wrote ${out} (${d}${!p.flags.has('--cdn') && !p.flags.has('--inline') && prior !== null ? ' as before' : ''}, orz-slides ${VERSION}${n ? `, ${n} include${n === 1 ? '' : 's'}` : ''})`);
  if (check.earlier !== null) o.say(`  (it held ${check.earlier === 'token' ? 'the text whose SHA-256 --replaces gave' : `an earlier text of ${basename(input)}: ${NODE.earlierSource[check.earlier]}`})`);
  o.say(`  sha256 ${hash} (the text it holds; --replaces takes it)`);
  emit(o, { command: 'assemble', input, output: out, kind: 'slides', format: info.format, shell: VERSION, delivery: d, uid: info.meta.uid ?? null, title: info.title, theme: info.theme ?? null, themeEffective: pres.theme.id, ratio: pres.ratio, includes: n, resolved, unresolved, stale, backup: backedUp, replaced: check.earlier, sha256: hash, bytes: Buffer.byteLength(html, 'utf8') });
}

function cmdExtract(p: Parsed, o: Io): void {
  const file = one(p, 'an assembled file (file.slides.html)', 'extract');
  const input = resolve(file);
  const token = replacesToken(p.values['--replaces']);
  const html = readText(input);
  const outArg = p.values['--out'];
  const legacy = readLegacy(html);
  const ex = legacy ? null : extract(html);
  if (legacy) {
    // upgrade writes the text twin of the file unless --text: next to an existing text, to another name (then merge)
    const textTarget = outArg !== undefined && outArg !== '-' ? outArg : twinName(file) ?? undefined;
    const taken = textTarget !== undefined && existsSync(resolve(textTarget));
    const textArgs = textTarget === undefined ? [] : taken ? ['--text', NODE.otherName(textTarget)] : outArg !== undefined && outArg !== '-' ? ['--text', outArg] : [];
    const next: Next = { command: 'upgrade', args: [file, ...textArgs] };
    throw new CliError(`${file} is an orz-slides ${legacy.version ?? '0.x'} file (before text format 1): run \`${commandLine(next)}\` — it writes the format-1 text${taken ? ` to ${textArgs[1]} (${textTarget} exists: compare and merge the two)` : ' twin'} (the deck source, its <!-- deck --> block and metadata moved into the header) and a file of this version`, 'legacy-file', next);
  }
  if (!ex) {
    if (html.trim() === '') throw new CliError(`${file} is empty (${statSync(input).size} bytes): a damaged or unfinished file, it holds no text to extract — look for its text twin or a backup (${file}~)`, 'not-orz');
    throw new CliError(`${file} holds no orz document (no #orz-src island); \`orz-slides inspect ${sh(file)}\` says what it is`, 'not-orz', { command: 'inspect', args: [file] });
  }
  if (ex.shell === '') o.warn(`${file} has an #orz-src island but no #orz-shell: an unknown writer; the island was read as format 1 would be — check the text`);
  else if (inspect(html).checks?.island === 'unclosed') o.warn(`${file} was cut off: its #orz-src island is not closed, so the text may be incomplete — compare it with a backup before relying on it`);
  const toStdout = outArg === '-';
  if (toStdout && o.json) throw new CliError('-o - (stdout) and --json exclude each other', EXIT_USAGE);
  if (toStdout) { process.stdout.write(ex.text); return; }
  const out = outArg !== undefined ? resolve(outArg) : twinName(input);
  if (out === null) throw new CliError(`cannot name the text twin of ${file} (an assembled file's name ends in .slides.html): pass -o out.slides.md`, EXIT_USAGE);
  if (out === input) throw new CliError('the output would overwrite the input', EXIT_USAGE);
  const names = { out: NODE.shown(out, outArg ?? twinName(file) ?? undefined), file };
  const other = NODE.otherName(names.out);
  const outArgs = outArg !== undefined ? ['-o', outArg] : [];
  const check = NODE.textOutputCheck({ out, text: ex.text, file: input, names, token, uid: NODE.uidOf(ex.text), advice: (h) => {
    const pull: Next = { command: 'extract', args: [file, '-o', other] };
    return {
      message: `If ${names.out} has edits of its own, extract to another name and merge the two: \`${commandLine(pull)}\`.${h ? ` When ${names.out} holds no edit you want to keep, \`${commandLine({ command: 'extract', args: [file, ...outArgs, '--replaces', h] })}\` replaces it while it still holds that text;` : ''} --force replaces it anyway (the old text is kept as ${names.out}~)`,
      next: pull,
    };
  } });
  const backedUp = NODE.guard(out, check.risk, p.flags.has('--force'), o);
  writeOut(out, ex.text);
  const hash = sha256(ex.text);
  NODE.rememberPair(out, input, ex.text, ex.text, o, { command: 'extract', sha: hash });
  const info = readDocument(ex.text, { kind: ex.kind });
  o.say(`Wrote ${out} (${ex.kind}, text format ${ex.format}, from orz-${ex.kind === 'md' ? 'mdhtml' : ex.kind} ${ex.shell || 'unknown'})`);
  if (check.earlier !== null) o.say(`  (${names.out} held ${check.earlier === 'token' ? 'the text whose SHA-256 --replaces gave' : `a known state: ${NODE.earlierSource[check.earlier]}`})`);
  o.say(`  sha256 ${hash} (of the text; --replaces takes it)`);
  emit(o, { command: 'extract', input, output: out, kind: ex.kind, format: ex.format, shell: ex.shell || null, delivery: ex.delivery || null, uid: info.meta.uid ?? null, title: info.title, includes: ex.includes ? Object.keys(ex.includes).length : 0, backup: backedUp, replaced: check.earlier, sha256: hash, bytes: Buffer.byteLength(ex.text, 'utf8') });
}

/** The report's lines and object for a 0.x deck, or null when the frozen 0.8.5 parser cannot read it (a note says so). */
function reportFor(legacyText: string, upgraded: string, shownTheme: string | null): { report: UpgradeReport | null; notes: string[] } {
  try {
    const report = upgradeReport(legacyText, upgraded, shownTheme ?? '');
    return { report, notes: reportNotes(report) };
  } catch (e) {
    return { report: null, notes: [`upgrade report: the 0.8.5 parser could not read this text (${(e as Error).message}); no comparison`] };
  }
}

function cmdUpgrade(p: Parsed, o: Io): void {
  const file = one(p, 'a file (old.slides.html) or a 0.x text (old.md)', 'upgrade');
  const input = resolve(file);
  const content = readText(input);
  if (!looksHtml(content)) { upgradeTextCommand(p, o, file, input, content); return; }
  const html = content;
  const legacy = readLegacy(html);
  const ex = legacy ? null : extract(html);
  const oldDelivery: 'inline' | 'cdn' = legacy ? (legacy.delivery ?? 'inline') : ex?.delivery === 'cdn' ? 'cdn' : 'inline';
  const d = delivery(p, oldDelivery);
  const force = p.flags.has('--force');
  const out = p.values['--out'] !== undefined ? resolve(p.values['--out']) : input;
  const outName = NODE.shown(out, p.values['--out'] ?? file);
  // a newer shell (a downgrade) and a file cut off inside its text: refused unless --force
  const newerShell = ex && ex.kind === 'slides' && ex.shell && compareSemver(ex.shell, VERSION) === 1 ? ex.shell : null;
  if (newerShell !== null && !force) {
    throw new CliError(`${file}: the file's shell (orz-slides ${newerShell}) is newer than this tool (${VERSION}); upgrading would downgrade it. Use \`npx orz-slides@latest upgrade ${file}\`, or pass --force to re-assemble it with this older shell anyway (the old file is kept as ${outName}~)`, 'newer-shell');
  }
  const cut = ex !== null && ex.kind === 'slides' && ex.shell !== '' && inspect(html).checks?.island === 'unclosed';
  const recovered = `${file.replace(/\.slides\.html$/i, '').replace(/\.html?$/i, '')}.recovered.slides.md`;
  if (cut && !force) {
    throw new CliError(`${file} was cut off inside its text (#orz-src is not closed): the text may be incomplete, and upgrading would make that the file's whole text; not upgraded. Recover what you can: \`orz-slides extract ${file} -o ${recovered}\`, compare it with the text twin or a backup; --force upgrades it anyway (the old file is kept as ${outName}~)`, 'unclosed-island', { command: 'extract', args: [file, '-o', recovered] });
  }
  let r: ReturnType<typeof upgrade>;
  try { r = upgrade(html, { delivery: d, ...(force ? { downgrade: true } : {}) }); } catch (e) { throw libError(file, e, /^orz-slides( upgrade)?: /); }
  if (p.flags.has('--no-text') && p.values['--text'] !== undefined) throw new CliError('--text and --no-text exclude each other', EXIT_USAGE);
  const textOut = p.flags.has('--no-text') ? null : p.values['--text'] !== undefined ? resolve(p.values['--text']) : twinName(out);
  if (!p.flags.has('--no-text') && textOut === null) throw new CliError(`cannot name the text twin of ${out}: pass --text out.slides.md (or --no-text)`, EXIT_USAGE);
  if (textOut === out || textOut === input) throw new CliError('the text twin would overwrite the file', EXIT_USAGE);
  // check every output before writing any
  let outRisk: Risk | null = null;
  if (out !== input && existsSync(out)) {
    const existing = readMaybe(out);
    const held = existing !== null && looksHtml(existing) ? NODE.documentTextOf(existing) : null;
    if (held === null) outRisk = { message: `${outName} exists and is not an orz file; not overwritten (pass --force, or -o another path)`, reason: 'not-orz' };
    else if (held !== r.text) outRisk = { message: `${outName} exists and holds another text; not overwritten (pass --force, or -o another path)`, reason: 'output-differs' };
  }
  const textName = textOut === null ? '' : NODE.shown(textOut, p.values['--text'] ?? twinName(outName) ?? undefined);
  const otherText = NODE.otherName(textName);
  // the upgraded text's uid — unless upgrade minted it for a 0.x file without one (then it says nothing about identity)
  const newUid = NODE.uidOf(r.text);
  const ownUids = legacy ? [NODE.uidOf(legacy.text), legacy.meta?.uid].map((u) => (typeof u === 'string' ? u.trim() : null)) : [newUid];
  const again: Next = { command: 'upgrade', args: [file, ...(p.values['--out'] !== undefined ? ['-o', outName] : []), ...(p.flags.has('--cdn') ? ['--cdn'] : p.flags.has('--inline') ? ['--inline'] : []), '--text', otherText] };
  const textCheck = textOut ? NODE.textOutputCheck({ out: textOut, text: r.text, file: out, names: { out: textName, file: outName }, token: null, uid: newUid !== null && ownUids.includes(newUid) ? newUid : null, advice: () => ({
    message: legacy
      ? `Upgrade to another name instead: \`${commandLine(again)}\`, then compare ${otherText} with ${textName} and merge (keep the new header); or --no-text, or --force (the old text is kept as ${textName}~)`
      : `Pass --text ${otherText} (then merge), --no-text, or --force to replace it (the old text is kept as ${textName}~)`,
    next: again,
  }) }) : { risk: null, earlier: null };
  if (!force) for (const risk of [outRisk, textCheck.risk]) if (risk !== null) throw new CliError(risk.message, risk.reason, risk.next);
  const backups: string[] = [];
  if (out === input && (newerShell !== null || cut)) backups.push(backup(input, o));
  const ob = NODE.guard(out, outRisk, force, o);
  if (ob) backups.push(ob);
  if (textOut) { const tb = NODE.guard(textOut, textCheck.risk, force, o); if (tb) backups.push(tb); }
  if (newerShell !== null) o.warn(`${file} had a newer shell (orz-slides ${newerShell}); --force re-assembled it with this older one (${VERSION})`);
  if (cut) o.warn(`${file} was cut off inside its text; --force upgraded it with the text it holds, which may be incomplete`);
  writeOut(out, r.html);
  const held = extract(r.html)?.text ?? r.text;
  if (textOut) { writeOut(textOut, r.text); NODE.rememberPair(textOut, out, held, r.text, o, { command: 'assemble', sha: sha256(held) }); }
  const rep = legacy ? reportFor(legacy.text, r.text, legacy.defaultTheme) : { report: null, notes: [] };
  const notes = [...r.notes, ...rep.notes];
  for (const n of notes) o.warn(n);
  const info = readDocument(r.text);
  const pres = presentationOf(r.text);
  o.say(`Upgraded ${input}${out !== input ? ` -> ${out}` : ''} (from ${r.from === 'legacy' ? `orz-slides ${legacy?.version ?? '0.x'}` : `orz-slides ${ex?.shell ?? '?'}`} to ${VERSION}, ${d})`);
  if (textOut) o.say(`Wrote ${textOut} (the text twin)`);
  const moved = Object.keys(r.moved);
  if (moved.length > 0) o.say(`Moved into the header: ${moved.map((k) => `${k}: ${r.moved[k]}`).join('; ')}`);
  if (rep.report && rep.report.unexplained.length > 0) o.warn(`the upgraded deck differs from what 0.x showed in ${rep.report.unexplained.length} place${rep.report.unexplained.length === 1 ? '' : 's'} no decision explains (see the notes): check those slides`);
  o.say(`  sha256 ${sha256(held)} (the text the file holds; --replaces takes it)`);
  emit(o, { command: 'upgrade', input, output: out, text: textOut, from: r.from, previous: r.from === 'legacy' ? legacy?.version ?? null : ex?.shell ?? null, shell: VERSION, delivery: d, uid: info.meta.uid ?? null, title: info.title, theme: info.theme ?? null, themeEffective: pres.theme.id, ratio: pres.ratio, slides: inspect(r.text, { filename: 'x.slides.md' }).slides, moved: r.moved, notes, report: rep.report, backups, sha256: sha256(held) });
}

/** `upgrade` of a TEXT: a 0.x deck source (or any slides text with a deck block) → its format-1 text. */
function upgradeTextCommand(p: Parsed, o: Io, file: string, input: string, text: string): void {
  for (const f of ['--text', '--no-text', '--cdn', '--inline']) if (p.flags.has(f) || p.values[f] !== undefined) throw new CliError(`${f} applies to upgrading a file (old.slides.html); ${file} is a text: \`orz-slides upgrade ${sh(file)}\` writes its format-1 text, then \`orz-slides assemble\` it`, EXIT_USAGE);
  const kind = kindFromFilename(input);
  if (kind === 'paged') throw new CliError(`${file} is an orz paged text: use orz-paged`, 'other-kind');
  const force = p.flags.has('--force');
  // the kind as inspect and assemble decide it (CLI-8): a header naming another carrier, or a plain .md without slides
  const declared = textKindOf(text, file);
  if (declared !== 'slides' && !force) {
    const why = readHeader(text)?.fields['carrier'] !== undefined ? `the header says carrier: ${declared}` : 'it has no slide markers (`<!-- slide -->`) and no `carrier: slides` in a header: an orz md document';
    throw new CliError(`${file}: ${why}; use ${declared === 'md' ? 'orz-mdhtml' : `orz-${declared}`} (--force upgrades it as a deck text as it is)`, 'other-kind');
  }
  const info = readDocument(text, { kind: 'slides' });
  if (info.format > 1) throw new CliError(`${file}: text format ${info.format} is newer than this tool writes (format 1); use a newer orz-slides (\`npx orz-slides@latest upgrade ${sh(file)}\`)`, 'newer-format');
  const outArg = p.values['--out'];
  const textName = upgradeTextName(file);
  const out = outArg !== undefined ? resolve(outArg) : textName !== null ? resolve(textName) : null;
  if (out === null) throw new CliError(`cannot name the format-1 text of ${file} (a deck text's name ends in .md): pass -o out.slides.md`, EXIT_USAGE);
  if (!/\.slides\.md$/i.test(out)) throw new CliError(`${outArg ?? out}: a slides text twin's name ends in .slides.md`, EXIT_USAGE);
  const zeroX = (() => { const h = readHeader(text); return !h || h.legacy !== null; })();
  // an output that already holds this text's upgrade (with the uid it was given then) is the same upgrade
  const held = !(out === input) && existsSync(out) ? readMaybe(out) : null;
  const heldUid = held !== null ? NODE.uidOf(held) : null;
  let up: ReturnType<typeof upgradeText>;
  try { up = upgradeText(text, heldUid !== null && NODE.uidOf(text) === null ? { uid: heldUid } : {}); } catch (e) { throw libError(file, e); }
  const changed = up.text !== text;
  const outName = NODE.shown(out, outArg ?? textName ?? undefined);
  const inPlace = out === input;
  // an existing other output that differs: refused unless --force (it may be an earlier upgrade, edited since)
  let risk: Risk | null = null;
  if (!inPlace && existsSync(out)) {
    const existing = readMaybe(out);
    if (existing !== up.text) {
      const alt = NODE.otherName(outName);
      risk = { message: `${outName} exists and holds another text (an earlier upgrade edited since?); not overwritten. Upgrade to another name and compare: \`${commandLine({ command: 'upgrade', args: [file, '-o', alt] })}\`; or --force (the old text is kept as ${outName}~)`, reason: 'output-differs', next: { command: 'upgrade', args: [file, '-o', alt] } };
    }
  }
  if (risk && !force) throw new CliError(risk.message, risk.reason, risk.next);
  const backups: string[] = [];
  const rep = zeroX && changed ? reportFor(text, up.text, null) : { report: null, notes: [] };
  const notes = [...up.notes, ...rep.notes];
  const writes = inPlace ? changed : !(existsSync(out) && readMaybe(out) === up.text);
  if (writes) {
    if (inPlace) backups.push(backup(input, o));
    else { const b = NODE.guard(out, risk, force, o); if (b) backups.push(b); }
    writeOut(out, up.text);
  }
  for (const n of notes) o.warn(n);
  const pres = presentationOf(up.text);
  const after = readDocument(up.text, { kind: 'slides' });
  if (!changed && inPlace) o.say(`${input} is already a format-1 slides text: nothing to upgrade`);
  else o.say(`Upgraded ${input}${inPlace ? '' : ` -> ${out}`} (${zeroX ? 'an orz-slides 0.x text' : 'a <!-- deck --> block moved into the header'}; text format 1)${inPlace && changed ? `; the old text is kept as ${backups[0]}` : ''}`);
  const moved = Object.keys(up.moved);
  if (moved.length > 0) o.say(`Moved into the header: ${moved.map((k) => `${k}: ${up.moved[k]}`).join('; ')}`);
  if (rep.report && rep.report.unexplained.length > 0) o.warn(`the upgraded deck differs from what 0.x showed in ${rep.report.unexplained.length} place${rep.report.unexplained.length === 1 ? '' : 's'} no decision explains (see the notes): check those slides`);
  for (const w of errors(after.lint)) o.warn(w);
  // the 0.x file beside the new text (0.x's layout: deck.md next to the deck.slides.html built from it, CLI-4): built from
  // exactly this source, it is a known state of the pair, so the plain assemble replaces it; built from another text,
  // it is named (assemble would refuse it as a 0.x file holding a different text)
  const sibling = twinName(out);
  const siblingHtml = sibling !== null && existsSync(sibling) ? readMaybe(sibling) : null;
  const siblingLegacy = siblingHtml !== null && looksHtml(siblingHtml) ? readLegacy(siblingHtml) : null;
  const siblingName = sibling !== null ? NODE.shown(sibling, twinName(outName) ?? undefined) : '';
  if (siblingLegacy && siblingHtml !== null) {
    const heldText = NODE.documentTextOf(siblingHtml) ?? siblingLegacy.text;
    if (siblingLegacy.text === text) {
      NODE.rememberPair(out, sibling!, heldText, up.text, o, { command: 'assemble', sha: sha256(heldText) });
      o.say(`  ${siblingName} is the orz-slides ${siblingLegacy.version ?? '0.x'} file built from ${file}: assembling ${outName} replaces it (no --force needed)`);
    } else {
      o.warn(`${siblingName} is an orz-slides ${siblingLegacy.version ?? '0.x'} file holding another text than ${file} (edited in the browser?): \`${commandLine({ command: 'upgrade', args: [siblingName, '--text', NODE.otherName(outName)] })}\` gives its format-1 text; merge what you keep into ${outName}, then \`${commandLine({ command: 'assemble', args: [outName, '--replaces'] })} <sha256>\` with the sha256 that upgrade prints`);
    }
  }
  o.say(`  sha256 ${sha256(up.text)} (of the text); next: ${commandLine({ command: 'assemble', args: [outName] })}`);
  emit(o, { command: 'upgrade', input, output: null, text: out, from: 'text', previous: null, changed, written: writes, shell: VERSION, uid: after.meta.uid ?? null, title: after.title, theme: after.theme ?? null, themeEffective: pres.theme.id, ratio: pres.ratio, slides: inspect(up.text, { filename: 'x.slides.md' }).slides, moved: up.moved, notes, report: rep.report, backups, sha256: sha256(up.text) });
}

function humanInspect(file: string, r: InspectReport, layout: LayoutReport | null): string {
  const rows: Array<[string, string]> = [['file', file]];
  const inputs: Record<InspectReport['input'], string> = { text: 'a text (twin or plain Markdown)', assembled: 'an assembled deck (text format 1)', legacy: 'an orz-slides 0.x file (before text format 1)', html: 'HTML that is not an orz document' };
  rows.push(['input', inputs[r.input]]);
  if (r.kind) rows.push(['kind', `${r.kind}${r.format !== null ? `, text format ${r.format}` : ''}`]);
  if (r.shell) rows.push(['shell', `orz-slides ${r.shell.version} (${r.shell.relation === 'same' ? 'this version' : r.shell.relation === 'older' ? `older than this tool, ${VERSION}` : r.shell.relation === 'newer' ? `newer than this tool, ${VERSION}` : 'unknown'}), ${r.shell.delivery} delivery`]);
  if (r.legacy) {
    const where = { top: 'first in the source (0.x read it)', body: 'later in the source (0.x did not read it; upgrade applies it)', none: 'none' };
    rows.push(['legacy', r.input === 'legacy'
      ? `orz-slides ${r.legacy.version ?? '0.x'}, ${r.legacy.delivery ?? 'unknown'} delivery${r.legacy.defaultTheme ? `, shown with theme ${r.legacy.defaultTheme}` : ''}${r.legacy.metaKeys.length ? `, #orz-meta: ${r.legacy.metaKeys.join(', ')}` : ''}; deck block ${where[r.legacy.deckBlock]}${r.legacy.deckBlocks > 1 ? ` (${r.legacy.deckBlocks} blocks)` : ''}`
      : `a <!-- deck --> block ${where[r.legacy.deckBlock]}${r.legacy.deckBlocks > 1 ? ` (${r.legacy.deckBlocks} blocks)` : ''}`]);
  }
  if (r.kind) {
    rows.push(['uid', r.uid ?? '(none)']);
    rows.push(['title', r.title ?? '']);
    rows.push(['theme', `${r.theme ?? '(none)'}${r.themeEffective && r.themeEffective !== r.theme ? ` (shown: ${r.themeEffective})` : ''}`]);
    if (r.ratio) rows.push(['ratio', r.ratio]);
    if (r.slides !== null) rows.push(['slides', String(r.slides)]);
    const settings = Object.entries(r.settings).filter(([k]) => k !== 'theme' && k !== 'ratio');
    if (settings.length) rows.push(['settings', settings.map(([k, v]) => `${k}: ${v}`).join('; ')]);
    if (r.header) rows.push(['header', r.header.present ? `${r.header.keys.join(', ')}${r.header.legacy ? ` (legacy ${r.header.legacy} block)` : ''}` : '(none)']);
    if (r.input === 'assembled') rows.push(['includes', String(r.includes)]);
    if (r.checks) {
      const engine = { same: 'this release\'s engine', different: 'an engine that is not its release\'s', unverified: 'engine not verified', cdn: 'engine from jsDelivr', missing: 'no engine' }[r.checks.engine];
      const whole = r.checks.island === 'closed' && r.checks.end === 'closed';
      rows.push(['structure', `${whole ? 'complete' : r.checks.island === 'unclosed' ? 'cut off inside the text (#orz-src not closed)' : 'cut off after the text (no </html>)'}, ${engine}`]);
    }
    if (r.sha256) rows.push(['sha256', `${r.sha256} (of the text it holds; --replaces takes it)`]);
    if (r.twin) {
      const when = { input: 'this one is newer', twin: 'the twin is newer', 'same-time': 'same modification time', unknown: '' }[r.twin.newer];
      const earlier = r.twin.earlier ? `, an earlier text of the text twin (${NODE.earlierSource[r.twin.earlier]})` : '';
      rows.push(['twin', `${r.twin.name}: ${r.twin.holds === 'same' ? 'the same text' : r.twin.holds === 'different' ? `a different text${when ? ` (${when})` : ''}${earlier}` : 'not an orz text'}`]);
      if (r.twin.sha256 && r.twin.holds === 'different') rows.push(['twin sha256', r.twin.sha256]);
    }
    rows.push(['writable', r.writable ? 'yes' : 'no']);
    rows.push(['lint', r.lint.length === 0 ? 'clean' : r.lint.map((l) => `${l.level} ${l.code}${l.line ? ` (line ${l.line})` : ''}`).join('; ')]);
    if (r.upgrade) rows.push(['upgrade', r.upgrade.unexplained.length === 0 ? `shows what 0.8.5 showed${r.upgrade.accepted.length ? ` but for ${r.upgrade.accepted.length} registered decision${r.upgrade.accepted.length === 1 ? '' : 's'}` : ''}` : `${r.upgrade.unexplained.length} difference${r.upgrade.unexplained.length === 1 ? '' : 's'} from 0.8.5 no decision explains`]);
  }
  const w = Math.max(...rows.map(([k]) => k.length));
  const lines = rows.map(([k, v]) => `${k.padEnd(w)}  ${v}`);
  if (layout) {
    const s = layout.summary;
    lines.push('', `layout (${layout.browser.product}, ${layout.network}, ${layout.theme}, ${layout.ratio} = ${layout.size.width}×${layout.size.height}): ${s.slides} slides, ${s.boxes} boxes, ${s.scaled} scaled (smallest ${s.minScale}), ${s.clipped} clipped${s.footersClipped ? `, ${s.footersClipped} footer${s.footersClipped === 1 ? '' : 's'} cut` : ''}`);
    for (const sl of layout.slides) {
      const boxes = sl.boxes.map((b) => `${b.box} ${b.scale}${b.clipped ? ' CLIPPED' : ''}${b.scroll ? ' scrolls' : ''}`).join(', ');
      lines.push(`  ${String(sl.slide).padStart(3)}  ${sl.title.length > 40 ? `${sl.title.slice(0, 39)}…` : sl.title}${sl.title ? ': ' : ''}${boxes}${sl.footerClipped ? '; footer CUT' : ''}${sl.settled === 'timeout' ? ' (not settled)' : ''}`);
    }
    if (layout.errors.length) lines.push(`  page errors: ${layout.errors.join('; ')}`);
  }
  const advice = [...r.advice, ...(layout ? layoutAdvice(layout) : [])];
  if (advice.length) lines.push('', 'advice:', ...advice.map((a) => `  - ${a}`));
  if (r.notes.length) lines.push('', 'notes:', ...r.notes.map((n) => `  - ${n}`));
  return lines.join('\n');
}

async function cmdInspect(p: Parsed, o: Io): Promise<void> {
  const file = one(p, 'a file', 'inspect');
  if (p.flags.has('--offline') && !p.flags.has('--layout')) throw new CliError('--offline applies to --layout (orz-slides inspect <file> --layout --offline)', EXIT_USAGE);
  const path = resolve(file);
  // no text twin yet beside its file (CLI-9: the skill's first step): say so, and name the extract that writes it
  if (!existsSync(path) && /\.slides\.md$/i.test(path)) {
    const html = twinName(path);
    if (html !== null && existsSync(html)) {
      const htmlName = twinName(file) ?? basename(html);
      throw new CliError(`${file}: no such file — but ${htmlName} is here: \`orz-slides extract ${sh(htmlName)}\` writes its text twin (exact, byte for byte); \`orz-slides inspect ${sh(htmlName)}\` reports on the file`, 'no-such-file', { command: 'extract', args: [htmlName] });
    }
  }
  const content = readText(path);
  // the sibling twin (x.slides.md <-> x.slides.html; a plain x.md -> x.slides.html): does it hold the same text, and which is newer?
  const sibling = /\.slides\.html$/i.test(path) ? twinName(path) : outputOf(path);
  let twin: { name: string; content: string; newer: 'input' | 'twin' | 'same-time'; earlier?: Exclude<KnownState, 'token'> | null } | undefined;
  if (sibling && sibling !== path && existsSync(sibling)) {
    const c = readMaybe(sibling);
    if (c !== null) {
      const a = mtime(path);
      const b = mtime(sibling);
      twin = { name: (/\.slides\.html$/i.test(file) ? twinName(file) : outputOf(file)) ?? basename(sibling), content: c, newer: a > b ? 'input' : b > a ? 'twin' : 'same-time' };
      // does the .slides.html hold a known earlier state of the text twin (assemble then needs no --force)?
      const [textPath, textContent, htmlPath, htmlContent] = path.endsWith('.slides.html') ? [sibling, c, path, content] : [path, content, sibling, c];
      const held = looksHtml(htmlContent) ? NODE.documentTextOf(htmlContent) : null;
      if (held !== null && !looksHtml(textContent) && readLegacy(htmlContent) === null && held !== storedText(textContent)) twin.earlier = NODE.earlierStateOf(textPath, htmlPath, held);
    }
  }
  // the name as given: advice names runnable paths (inspect sub/x.slides.md → assemble sub/x.slides.md)
  const r = inspect(content, { filename: file, ...(twin ? { twin } : {}) });
  let layout: LayoutReport | null = null;
  if (p.flags.has('--layout')) {
    if (r.input === 'html' || r.kind === null) throw new CliError(`${file} holds no orz slides deck: nothing to lay out`, 'not-orz');
    if (r.kind !== 'slides') throw new CliError(`${file} is an orz ${r.kind} document: use ${r.kind === 'md' ? 'orz-mdhtml' : `orz-${r.kind}`}`, 'other-kind');
    if (r.format !== null && r.format > 1) throw new CliError(`${file}: text format ${r.format} is newer than this tool lays out (format 1); use a newer orz-slides (\`npx orz-slides@latest inspect ${sh(file)} --layout\`)`, 'newer-format');
    // the text laid out: the text itself, the file's text, or a 0.x deck as upgrade would write it
    const legacy = r.input === 'legacy' ? readLegacy(content) : null;
    const text = legacy ? upgradeText(legacy.text, { uid: 'doc-0000000000000000', file: { title: legacy.title, meta: legacy.meta, defaultTheme: legacy.defaultTheme } }).text
      : r.input === 'assembled' ? extract(content)!.text
      : r.legacy ? upgradeText(content, { uid: 'doc-0000000000000000' }).text
      : content;
    if (legacy || r.legacy) r.notes.push('layout: the deck as `orz-slides upgrade` would write it (a 0.x deck), laid out with this release');
    else if (r.input === 'assembled' && r.shell && r.shell.version !== VERSION) r.notes.push(`layout: the file's text laid out with this release (${VERSION}); the file itself carries orz-slides ${r.shell.version}`);
    const chrome = findChrome();
    if (!chrome) throw new CliError(`--layout renders the deck in Chrome, and no Chrome was found (${process.env['ORZ_SLIDES_CHROME'] ? `ORZ_SLIDES_CHROME names ${process.env['ORZ_SLIDES_CHROME']}, which does not exist` : 'looked at its usual places'}): install Google Chrome, or set ORZ_SLIDES_CHROME to a Chrome or Chromium executable; \`orz-slides inspect ${sh(file)}\` without --layout needs no browser`, 'no-browser');
    let html: string;
    try { html = assemble(text); } catch (e) { throw libError(file, e); }
    try {
      layout = await layoutReport(html, text, { chrome, baseDir: dirname(path), offline: p.flags.has('--offline') });
    } catch (e) {
      throw new CliError(`${file}: the layout report failed in ${chrome}: ${(e as Error).message}`, 'failed');
    }
  }
  if (o.json) process.stdout.write(`${JSON.stringify(layout ? { ...r, advice: [...r.advice, ...layoutAdvice(layout)], layout } : r, null, 2)}\n`);
  else process.stdout.write(`${humanInspect(file, r, layout)}\n`);
}

function cmdThemes(p: Parsed, o: Io): void {
  if (p.positional.length) throw new CliError('`orz-slides themes` takes no arguments', EXIT_USAGE);
  if (o.json) { emit(o, { command: 'themes', themes: THEMES.map((t) => ({ id: t.id, name: t.name, scheme: t.scheme, description: t.description, alias: t.derivedFrom, default: t.id === DEFAULT_THEME })) }); return; }
  const w = Math.max(...THEMES.map((t) => t.id.length));
  for (const t of THEMES) o.say(`${t.id.padEnd(w)}  ${t.scheme.padEnd(5)}  ${t.description}${t.id === DEFAULT_THEME ? '  [default]' : ''}`);
}

function cmdTemplates(p: Parsed, o: Io): void {
  if (p.positional.length) throw new CliError('`orz-slides templates` takes no arguments', EXIT_USAGE);
  if (o.json) { emit(o, { command: 'templates', templates: TEMPLATES.map((t) => ({ ...t, default: t.id === DEFAULT_TEMPLATE })) }); return; }
  const w = Math.max(...TEMPLATES.map((t) => t.id.length));
  for (const t of TEMPLATES) o.say(`${t.id.padEnd(w)}  ${t.description}${t.id === DEFAULT_TEMPLATE ? '  [default]' : ''}`);
}

const COMMANDS: Record<string, (p: Parsed, o: Io) => void | Promise<void>> = { new: cmdNew, assemble: cmdAssemble, extract: cmdExtract, upgrade: cmdUpgrade, inspect: cmdInspect, themes: cmdThemes, templates: cmdTemplates };

// ── main ────────────────────────────────────────────────────────────────────

export async function main(argv: string[]): Promise<number> {
  const json = argv.includes('--json');
  let command = 'assemble';
  try {
    const first = argv[0];
    if (first === undefined) { process.stderr.write(`${USAGE}\n`); return EXIT_USAGE; }
    if (first === '-h' || first === '--help' || first === 'help') {
      const topic = first === 'help' ? argv[1] : undefined;
      process.stdout.write(`${topic && HELP[topic] ? HELP[topic] : USAGE}\n`);
      return EXIT_OK;
    }
    if (first === '-v' || first === '--version' || first === 'version') {
      if (json) process.stdout.write(`${JSON.stringify({ name: 'orz-slides', version: VERSION, orzMarkdown: ORZ_MARKDOWN_VERSION, formats: [1] }, null, 2)}\n`);
      else process.stdout.write(`orz-slides ${VERSION} (orz-markdown ${ORZ_MARKDOWN_VERSION}, text format 1)\n`);
      return EXIT_OK;
    }
    let rest = argv;
    if (COMMANDS[first]) { command = first; rest = argv.slice(1); }
    if (rest.includes('--help') || rest.includes('-h')) { process.stdout.write(`${HELP[command]}\n`); return EXIT_OK; }
    const parsed = parse(command, rest);
    await COMMANDS[command](parsed, NODE.io(json));
    return EXIT_OK;
  } catch (e) {
    return reportFailure('orz-slides', command, e, json);
  }
}

process.exitCode = await main(process.argv.slice(2));
