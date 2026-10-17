# orz-slides

**Markdown that edits itself — as a slide deck.**

A deck is its **text twin** — `talk.slides.md`, Markdown with a small header
and comment markers that start slides and split them into boxes — and its
**self-editing file** `talk.slides.html`, one HTML page that presents the deck
in any browser (keys, overview, speaker view, timer, full screen), edits
itself — the whole deck as text beside a live preview, or one slide at a time
with a layout editor —, saves back in place and prints one slide per page.
The file is always `assemble(text)`: the text inside it is the deck;
everything else is a shell that can be regenerated. Built on the carrier kit
of [orz-markdown](https://www.npmjs.com/package/orz-markdown) (orz text format
1) and [reveal.js](https://revealjs.com) 5.2.1 for the deck mechanics.

The deck sibling of [orz-mdhtml](https://www.npmjs.com/package/orz-mdhtml) (a
continuous, themed web page) and [orz-paged](https://www.npmjs.com/package/orz-paged)
(print pages): the same text twin, pencil, editor, saves, quiet update, host
protocols, CLI and agent workflow; what slides adds is slides.

## What a 1.0 `.slides.html` is

- **The text twin inside.** The exact text (BOM and line endings kept) rides
  in the file's `<script type="text/markdown" id="orz-src">` island.
  `orz-slides extract` gives it back byte for byte; an agent banner at the top
  of `<body>` tells tools how to read it.
- **The deck, in the page.** Every slide at its logical size — 1280 × 720
  (16:9) or 960 × 720 (4:3) — scaled to the window, on the theme's surround.
  → ↓ Space PageDown next, ← ↑ PageUp previous, Home / End; **O** the
  overview, **S** the speaker view (its own window: current and next slide,
  notes, clock and timer), **T** the timer, **F** Present. A slide's
  `step` option reveals its points one at a time.
- **Nothing is cut silently.** Every box — regions, titles, template pages,
  floats — shrinks its content to fit, down to 60 %; past that the box is
  marked clipped, and the editor and `orz-slides inspect --layout` say so.
- **One quiet control.** A small pencil at the bottom-left. Click it to edit;
  hover it (tap it on a touch screen, or Tab to it and press ArrowUp) for the
  list — **Edit, Present, Print, Print with notes, Speaker view, Overview,
  Save, Download a copy, New document, Save as new copy**, the settings
  **Theme, Ratio, Slide numbers, Progress bar, Section numbers**, and, when
  there is one, the update. A dot on the pencil means unsaved changes.
- **Settings are the deck's.** Theme, ratio, slide numbers, progress and
  section numbering live in the text's header: choosing one from the pencil's
  list (or the editor's bar) writes the header — one undoable edit, unsaved
  until you Save — and the deck follows.
- **Edit, two ways.** The pencil (or Cmd/Ctrl+E) opens the editor:
  - **the whole deck** — CodeMirror beside a **flattened** preview (every
    slide's content in order, a thin divider per slide with its number,
    title and layout, regions labelled, notes and footers set apart), and in
    its corner the **live slide card**: the slide under the caret as it
    presents, with a badge (*fits*, *shrunk to 80%*, *footer cut*, *cut on
    paper*). Issues lists the deck's lints with quick fixes. Fold the card to
    a tab when it is in the way.
  - **one slide at a time** — the card's **Edit** (Cmd/Ctrl+Shift+Enter)
    enlarges it into the layout editor over the slide: split a box into rows
    or columns, delete a box (its content moves to the neighbour), drag a
    divider (it snaps to simple ratios), choose a preset, rename or swap
    boxes, add, move, resize and layer floats, choose a template page's look,
    set the slide's options, notes and footer; a filmstrip adds, duplicates,
    deletes and reorders slides (drag, or Alt+Up/Down). Click a box to edit
    its Markdown. Touch and keyboard work (`?` lists the keys). Every change
    rewrites only the marker lines of the text — one undo step each, one
    history for both ways. **Done** goes back to the deck, on the slide you
    were editing. The bar ends, quietly, with the orz seal
    (https://markdown.orz.how) and this tool's GitHub link.
- **Print.** *Print* prints one slide per page at the slide's size, every
  step shown; *Print with notes* puts each slide over its speaker notes.
  Choose *Save as PDF* in the print dialog for a PDF. What does not fit on
  paper is marked on its page and said.
- **Save, New, Copy.** **Save** (Cmd/Ctrl+S) writes `assemble(text)` — never
  the rendered deck — back to the file. A save never silently overwrites a
  file that changed on disk since the page opened it: it asks — *Replace it*
  or *Download a copy instead*. *New document* and *Save as new copy* make a
  fresh file with this version's shell. The page asks before it closes with
  unsaved changes.
- **A quiet update.** A local file checks, at most once a day, whether a newer
  release of its engine exists; if so, the pencil gets a small dot and its list
  offers *Update to x.y.z*. *Update now* re-assembles the same text with the
  new release (its bundle verified by SHA-384) and saves it; nothing changes
  until the reader asks. Served pages, framed pages and pages with a host
  never check.

Everything inside a box is orz-markdown — math, code, Mermaid diagrams,
chemistry (SMILES), charts, QR codes, tables, callouts, columns, tabs.

## A deck

```markdown
{{nyml
kind: document
carrier: slides
uid: doc-7kq2m9x4p1r8s3t5
title: Controlled Radical Polymerization
author: Yu Wang
theme: orchard
ratio: 16:9
footer: CHEM 512 · RAFT
}}

<!-- slide template=title -->
# Controlled Radical Polymerization
## How RAFT keeps every chain growing together
Yu Wang · October 2026

<!-- slide 2col 3/2 -->
## Results at a glance
<!-- @left -->
- Dispersity below **1.2** in every run
- Molecular weight grows linearly with conversion
<!-- @right -->
{{chart
type: line
labels: 10, 30, 50, 70
series: Mn = 4, 11, 19, 27
}}
<!-- @notes -->
Lead with dispersity; the linear growth is the point.
```

- **The header** (`{{nyml kind: document}}` at the very top) is the deck's
  config — `title`, `theme`, `ratio` (`16:9` / `4:3`), `author`, `footer`,
  `transition`, `slide_numbers`, `progress`, `section_numbers` — and the only
  one.
- **`<!-- slide … -->`** starts a slide: a layout (a preset — `2col`, `3col`,
  `2row`, `main-side`, `quad`, with an optional ratio such as `3/2` — or a
  split of your own, `row auto/1 { head; col 1/1 { a; b } }`), a template
  page (`template=title|section|outline|closing`, `v=N` for its look) and
  options (`step`, `fit=`, `bg=`, `t=`, `class=`, `id=`, `here=`).
- **`<!-- @name -->`** fills a box; the leading `##` of a normal slide is its
  title. `<!-- @notes -->` (speaker notes), `<!-- @footer -->` (this slide's
  footer) and `<!-- @float left=60% top=10% w=35% h=40% -->` (an overlay) are
  the reserved markers. Markers count only as top-level lines: one inside a
  code fence or a list is text.

Examples (each text twin with its file): [`examples/starter.slides.md`](examples/starter.slides.md)
→ [`starter.slides.html`](examples/starter.slides.html) (a tour of every
kind of slide; inline — it opens and presents offline in system fonts, as
it holds no formula, code, diagram or chart: those load their styles and
libraries from CDNs, see **Delivery**),
[`examples/raft.slides.md`](examples/raft.slides.md) →
[`raft.slides.html`](examples/raft.slides.html) (a chemistry lecture: formulas,
charts, molecules, diagrams), [`examples/talk.slides.md`](examples/talk.slides.md)
→ [`talk.slides.html`](examples/talk.slides.html) (the skeleton of a talk,
Nocturne), [`examples/demo.slides.md`](examples/demo.slides.md) →
[`demo.slides.html`](examples/demo.slides.html) (the 0.x demo, upgraded).
The last three are small cdn files for the web.

## Themes and templates

Fourteen **slide themes** (`orz-slides themes`), light and dark, each
carrying the components only decks have (title band, title, section, outline
and closing pages, slide number, progress, footer, fragments, regions,
floats). Ten are derived from orz-markdown's themes — **Orchard** (the
default), **Sky**, **Stationery**, **Preprint**, **Small Press**,
**Notebook** (a ruled exercise book), **Sticker**, and the dark
**Inscription**, **Copper**, **Nocturne** —; four come from 0.x, updated:
**Architect** (a drafting sheet), **Chalk** (a chalkboard, dark), **Neon** (an
instrument panel, dark) and **Paper** (a finely printed book). Dark themes
draw charts and diagrams on dark. The themes ship inside the engine, so a
`--cdn` file styles exactly like an inline one. The orz-markdown theme ids
(`light-neat-3`, …) are accepted as aliases.

Three **deck templates** for `orz-slides new` (`orz-slides templates`):
`starter` (a tour of every kind of slide; the default), `talk` (title,
outline, three sections, closing) and `minimal` (a title page and one slide).
The file's *New document* starts from `minimal`.

## Install

Node 20.16 or newer. Run the CLI with `npx` (nothing to install) or install
it:

```bash
npx orz-slides@1 new talk.slides.md --title "RAFT in five minutes" --theme nocturne   # a new text twin
npx orz-slides@1 talk.slides.md                                                         # → talk.slides.html
npm i -g orz-slides@1                                                                   # or: the orz-slides command
```

For a web app, the browser engine and editor component:
`npm i orz-slides-browser@1` (see [In web apps](#in-web-apps)).

## The CLI

```
orz-slides new [file.slides.md] [--template id] [--title T] [--theme id] [--ratio 16:9|4:3] [--html] [--cdn]
orz-slides assemble <file.slides.md> [-o out.slides.html] [--cdn] [--resolve-includes | --no-includes] [--replaces sha256]   (also: orz-slides <file.slides.md>)
orz-slides extract <file.slides.html> [-o out.slides.md] [--replaces sha256]
orz-slides upgrade <old.slides.html> [-o out.slides.html] [--text out.slides.md | --no-text] [--cdn | --inline]
orz-slides upgrade <old.md> [-o out.slides.md]          (a 0.x deck source)
orz-slides inspect <file> [--layout [--offline]] [--json]
orz-slides themes
orz-slides templates
```

| Command | What it does |
|---|---|
| `new` | writes a new text twin from a deck template: its header (`kind: document`, `carrier: slides`, a fresh `uid`, the given `--title`, `--theme`, `--ratio`), then the template's slides (default `starter`). `--html` also assembles it; without a file name the text goes to stdout. A slides text twin's name ends in `.slides.md`. |
| `assemble` | writes `x.slides.html` (or the `-o` path; missing folders are created) from `x.slides.md` (exact text in, the same bytes every time). A plain Markdown deck `x.md` assembles to `x.slides.html` too. Keeps the delivery and the includes the existing file holds (`--cdn` / `--inline` choose the delivery); `--resolve-includes` reads file includes from the text's folder. Lints are reported as warnings with their lines; the file is still written. A 0.x text (a `<!-- deck -->` block) is refused with `upgrade` as the next step. |
| `extract` | writes the exact text twin of an assembled file (`x.slides.html` → `x.slides.md`) — also of a page the browser saved — and reports its includes. Replaces an existing, different `x.slides.md` only when it is a known state (below) and the file does not hold an earlier state of it (then `assemble` is named: the text is the newer side). A 0.x file is refused with the advice to run `upgrade`; a file cut off inside its text gives a warning and never replaces another text without `--force` (`extract x.slides.html -o x.recovered.slides.md`). |
| `upgrade` | turns a 0.x file (or a file of an older 1.x shell) into a file of this version, in place by default, and writes its text twin unless `--no-text`; keeps the file's delivery unless `--cdn` / `--inline`; repairs a damaged engine. Given a 0.x **text** (`deck.md`), writes its format-1 text (`deck.slides.md`). Either way with an upgrade report: what the upgraded deck shows against what 0.8.5 showed (`--json` `report`). Refuses (unless `--force`) to downgrade a newer shell or to upgrade a file cut off inside its text. A 0.x file upgraded in place is kept as `old.slides.html~`. |
| `inspect` | diagnoses a text or a file of any version: kind, text format, shell version and how it compares to this tool, delivery, uid, title, theme (as written and as shown), ratio, number of slides, header keys and settings, includes, lint with lines, the file's structure (cut off? engine intact?), the SHA-256 of the text it holds, whether the sibling twin holds the same text and which is newer, advice in plain sentences naming the files, and for a 0.x deck what `upgrade` changes. **`--layout`** renders the deck in the installed Chrome (headless) and reports per slide and box the fit scale and whether its content is cut — an agent's overflow check (`--offline` blocks every host; without Chrome: refused, `no-browser`; `ORZ_SLIDES_CHROME` names a Chrome). |
| `themes` | lists the slide theme ids a header may name, light or dark, the default marked. |
| `templates` | lists the deck templates, the default marked. |

**Delivery.** Files are **inline** by default: the browser engine (with
reveal.js and the 14 themes) is inside the file (about 2.2 MB), so it opens
and presents without fetching the engine. `--cdn` writes a small file that
loads the engine from
`https://cdn.jsdelivr.net/npm/orz-slides-browser@<version>/orz-slides.browser.js`
(the file's own version) — for decks you publish on the web. Either way the
themes' webfonts, KaTeX's and highlight.js's styles, the content libraries
(Mermaid, SMILES, Chart.js) and the editor (CodeMirror) load from CDNs: a
deck with formulas, diagrams or charts, and editing, need a network
connection the first time. Without one the deck still presents (system
fonts; the drawings wait), and fit settles again when late fonts arrive.

**For scripts and agents.** Every command takes `--json` (one JSON object on
stdout), `--help` and `--force`. Exit status: 0 done, 1 refused or failed, 2
usage error. `assemble` has no content options (`--theme`, `--title`,
`--ratio`, `--footer` are refused with the header named). Nothing that could
hold other work is overwritten without `--force`: an output that is not an
orz file, a `.slides.html` that holds a different text than the one being
assembled (it may hold work saved in the browser), an `x.slides.md` that
differs from the text being extracted, unless what is replaced is a known
state (below); a file made by a newer orz-slides; another document; or (for
`new`) any existing file. With `--force` the replaced file is kept as
`<file>~` (or `<file>~1`, `~2`, … — a backup is never overwritten). Files are
replaced through a temporary file and a rename, keeping their mode; a
symbolic link stays a link. Every command prints the `sha256` of the text it
wrote or read (`--json`: `sha256`).

**Known states.** `orz-slides assemble x.slides.md` replaces `x.slides.html`
(or the `-o` output) without `--force` when the file holds the same text, or
an earlier state of `x.slides.md` the CLI can prove — never a file cut off
inside its text, which holds an incomplete text, not browser work: `assemble
x.slides.md --replaces <its sha256>` repairs it; `orz-slides extract`
replaces `x.slides.md` when it is a known state and the file is not an
earlier one. Known are: a committed
version of the twin in git (HEAD, staged, or one of its 20 most recent
commits; a shallow clone knows only HEAD); the text `orz-slides` itself last
wrote or read for that pair (records in `$XDG_CACHE_HOME/orz-slides/`, else
`~/.cache/orz-slides/`); and **`--replaces <sha256>`** — a portable
compare-and-swap for agents in a fresh sandbox: `inspect --json` prints
`sha256` (the text a file holds) and `twin.sha256`; `assemble x.slides.md
--replaces <h>` replaces `x.slides.html` only while its text has hash `h`. A
text is replaced as a known state only when both texts carry the same `uid`.

**Refusals, for machines.** A `--json` failure is
`{ "ok": false, "command", "error", "reason", "next"?, "exitCode" }`. `reason`
is a stable code (`bad-usage`, `no-such-file`, `unreadable`, `not-utf8`,
`exists`, `not-orz`, `twin-differs`, `output-differs`, `replaces-mismatch`,
`legacy-file`, `newer-shell`, `newer-format`, `unclosed-island`,
`other-kind`, `assembled-input`, `invalid-text`, `no-browser`,
`engine-unavailable`, `write-failed`, `failed`); `next` (when one command
resolves it) is `{ "command", "args" }` — run `orz-slides <command> <args…>`
verbatim: it is built from your own arguments and names a copy
(`x.browser.slides.md`, …) that does not exist yet.

**Editing an existing deck (the safe loop).** Before you edit
`x.slides.md`, run `orz-slides inspect x.slides.md`: if it says
`x.slides.html` holds a different text (and not an earlier text of
`x.slides.md`), someone saved in the browser — `orz-slides extract
x.slides.html -o x.browser.slides.md`, merge it into `x.slides.md`, then
`orz-slides assemble x.slides.md --replaces <twin.sha256>`.

## The library

```ts
import { assemble, extract, readDocument, newDocument, inspect, inspectLayout, upgrade, upgradeText, parseDeck, applyOp, THEMES } from 'orz-slides';

const text = newDocument({ template: 'talk', title: 'RAFT in five minutes', theme: 'nocturne' });
const html = assemble(text);                     // inline (this release's engine); { delivery: 'cdn' } for the web
extract(html)?.text === text;                    // true: the exact text back
readDocument(text).title;                        // 'RAFT in five minutes' (header and derived facts, no rendering)
parseDeck(text).slides.length;                   // the deck: slides, regions, notes, lints
applyOp(text, 3, { type: 'split', box: 'body', dir: 'col' }).text;   // a layout op on slide 4 (0-based; slides 1–3 of 'talk' are template pages): minimal edits on marker lines
inspect(html).advice;                            // what to do next, for any version
await inspectLayout(text);                       // per slide and box: fit scale and clipping (installed Chrome)
upgrade(oldHtml);                                // { text, html, from, version, moved, notes } for a 0.x file (upgradeReport: what changed)
```

Exports (types included): `assemble`, `extract`, `readDocument`,
`newDocument`, `storedText`, `upgrade`, `upgradeText`, `readLegacy`,
`inspect`, `inspectLayout`, `findChrome`, `layoutAdvice`, `upgradeReport`,
`reportNotes`, `parseDeck`, `scanMarkers`, `planDeck`, `deckConfig`, the
layout ops (`applyOp`, `applyEdits`, `slideMap`, `partAt`, `blockingProblem`,
`placeFloat`, `presetOf`, `snapTracks`, `stepTracks`, `LayoutOpError`,
`PRESET_CHOICES`, `SLIDE_SIZE`), `TEMPLATES`, `DEFAULT_TEMPLATE`, `THEMES`,
`DEFAULT_THEME`, `DROPPED_THEMES`, `resolveTheme`, `isThemeId`, `sha256`,
`engineSource`, `VERSION`, `ORZ_MARKDOWN_VERSION`. The Node library writes
the same bytes as the browser engine's `OrzCarrier.assemble` for the same
text and options; an inline assembly carries this release's engine (checked
against its `release.json`). Includes (`{{md part.md}}`, `{{md https://…}}`)
are shown by a file only from its `#orz-includes` record: pass them resolved
as `assemble(text, { includes })`.

## In web apps

The editor every `.slides.html` carries is also a component for web apps:
[`orz-slides-browser`](browser/README.md) (`npm i orz-slides-browser@1`; ES
module or a plain `<script>` that sets `globalThis.OrzCarrier`). An app
mounts any number of editors — each with the flattened preview, the live
slide card and single-slide editing in a sandboxed frame — keeps the text
wherever it likes through its own hooks (save, AI with a review step,
includes, assets, links, ids), works under a nonce Content-Security-Policy,
can run the layout operations itself (`applyOp` → `editor.applyEdits`), and
assembles `.slides.html` files only when it needs one. See
[docs/embedding.md](docs/embedding.md) (shipped in both packages) and the
working example in [`examples/webapp/`](examples/webapp/).

A platform that shows assembled files in an iframe speaks the host protocols
(`orz-host-save@1`, `orz-host-ai@1`, `orz-host-include@1`; canonical spec:
orz-markdown `spec/host-protocols.md`, see [PROTOCOL.md](PROTOCOL.md)).

## With an AI agent

- **Every file explains itself.** The agent banner (an HTML comment before
  the `#orz-src` island) says where the text is, how to unescape it, and links
  the agent skill.
- **The skill.** [`orz-slides-skills/SKILL.md`](orz-slides-skills/SKILL.md)
  (shipped in the package; also at
  `https://cdn.jsdelivr.net/npm/orz-slides@1/orz-slides-skills/SKILL.md`) tells
  an agent how to create, edit, extract, inspect and upgrade decks, the
  header keys, the slide grammar, templates and themes, and how much fits in
  a box (capacity budgets measured at 1280 × 720 in all 14 themes). For
  Claude Code, copy `orz-slides-skills/` into `~/.claude/skills/orz-slides/`.
- **The loop.** Edit the text twin, never the HTML; `orz-slides assemble`
  again; `orz-slides inspect --layout x.slides.md --json` to check that every
  box fits. When unsure what a file is, `orz-slides inspect --json <file>` and
  follow its `advice`; an old file or text gets `orz-slides upgrade`.

## Browser support

| | Chromium (Chrome, Edge, …) | Firefox, Safari |
|---|---|---|
| Present, overview, speaker view, timer, themes | yes | yes |
| Print (and Save as PDF from the print dialog) | yes | yes |
| Edit (both ways), settings | yes | yes |
| Save in place (File System Access API) | yes | — Save downloads the file instead |
| Download a copy | download | download |
| New document, Save as new copy | file picker | download |
| Quiet update | saved in place | downloaded |

Only writing to a file on disk needs Chromium's File System Access API;
everything else works in every modern browser. A printed PDF is the
browser's own (Chromium gives the most faithful result). A page served over
http(s) is never saved in place: Save says to use *Download a copy*.

## Migrating from 0.x

The 0.x files and deck sources (orz-slides up to 0.8.5) predate text format
1; 1.0 does not open them as they are. Upgrade each once:

```bash
npx orz-slides@1 inspect old.slides.html        # what it is, and what upgrade changes
npx orz-slides@1 upgrade old.slides.html        # → old.slides.html (format 1, the 0.x file kept as old.slides.html~) and old.slides.md (its text twin)
npx orz-slides@1 upgrade old.slides.html --text old.browser.slides.md   # when old.slides.md exists: then merge
npx orz-slides@1 upgrade deck.md                # a 0.x deck source → deck.slides.md (format 1)
```

`upgrade` keeps the deck: its `<!-- deck … -->` block (wherever 0.x found it)
and a `{{nyml kind: meta}}` block become ONE header at the top (with
`carrier: slides` and a `uid`), the 0.x file's `#orz-meta` metadata and title
move into it, and the theme the deck showed is written explicitly — the
deck block's, else the file's own `--theme`, else 0.x's implicit `paper`;
`executive`, `poppy` and `sage` become `sky`, `sticker` and `orchard`. Marker
spellings 0.x tolerated are normalised and markers a block swallowed are
repaired, each with a note. The upgrade report lists every difference against
what 0.8.5 showed (slides, titles, regions, layouts, notes, footers, floats,
options, theme), each explained. The slides are now 1280 × 720: content
sized for 0.x's 960 × 540 has more room, and fit shrinks what still does not
fit. The 0.x API (`buildSlidesHtml`) and CLI forms (`--theme`, `--title` on a
deck) are gone: content lives in the header.

A 0.x file opened in its own editor offers "Framework 1.0.0 available" (the newest release's number): that
in-file update cannot move a 0.x deck to format 1 — it ends with "Update
failed — check your connection" and changes nothing. Dismiss it and run
`orz-slides upgrade` as above.

## Versions

> **Release status.** 1.0.0 (2026-10-17) is the rebuild on text format 1;
> it depends on `orz-markdown ^2.4.0`. The 0.x line (up to 0.8.5) is
> described in [Migrating from 0.x](#migrating-from-0x).

Two packages, released together with the same version: `orz-slides` (the CLI
and the Node library) and `orz-slides-browser` (the browser engine and editor
component). **Each file carries its own shell**: the version that assembled
it is recorded in the file (`#orz-shell`, `<meta name="generator">`) and keeps
working whatever is installed later; the text format (format 1) is the only
contract between files, tools and apps. `inspect` says when a file's shell is
older or newer than the tool, and the quiet update (or `upgrade`) moves a file
to a newer shell without touching its text. reveal.js is pinned at 5.2.1
(behind one engine module).

## Security — treat these files as programs

A `.slides.html` is executable HTML: opening one runs the engine inside it
and, because Markdown may contain raw HTML, anything in the content. Open and
edit files only from sources you trust; a file cannot prove its own
integrity. The quiet update only fetches from the hard-coded jsDelivr package
of this engine, checks the bundle's SHA-384 from the release manifest, and
runs nothing until the reader clicks *Update now*. In the editor, the deck's
own scripts run only in the sandboxed preview frame, and the layout editor
takes its operations only from the reader's own input in the trusted page.

## Development

See [CLAUDE.md](CLAUDE.md) for the architecture, commands and conventions,
[CHANGELOG.md](CHANGELOG.md) for releases, [notes/CLAIMS.md](notes/CLAIMS.md)
for what the tests prove, [docs/dom-contract.md](docs/dom-contract.md) for the
slide DOM and theme contract, and [archive/](archive/) for the 0.x design.

## License

MIT
