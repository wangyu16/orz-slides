# Changelog

All notable changes to **orz-slides** are recorded here. Versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed

- Single-slide editing (the layout GUI): a double-click on a box always writes in it (D-86) — selecting a box no
  longer moves the slide under the pointer (the box toolbar keeps its place), and a double press is told from the
  two presses on the same spot, so the second one can no longer land beside the box and leave the focus on the
  stage, where typed letters were the single-letter shortcuts (C, R) and wrecked the layout.
- An empty box (or float, or the notes and footer added from the toolbar) gets a line of its own under its
  marker and the caret goes there — never on the marker line, where typed text was lost (D-87, D-99). New layout
  ops `open` and `open-float` (library, ES module, `OrzCarrier.layout`).
- On a phone or in the Preview mode, the double-click shows the editor (one pane: Editor) with the caret in the
  box (D-102).
- The status "This slide's layout cannot change until its text is fixed" goes once the text is valid (D-99).
- `==highlight==` reads in Neon and Chalk: light ink on the tint over the dark slide (it was dark brown, 1.2 : 1;
  D-98). A `--mark-ink` token in the updated themes' content layer.
- The editor of a deck file has **Present** in its toolbar: it leaves editing (the text kept, as Done keeps it) and
  presents from the caret's slide (D-88).
- CLI: `assemble` refuses a text with no slide marker (plain Markdown named or headed as a deck), which made a
  deck with no slides (D-89): reason `invalid-text`, with `next: new <name>.slides.md --template talk` when that
  name is free; never split on headings (that would put slide breaks the author did not write into the text);
  `--force` assembles it as it is.
- CLI: `extract x.slides.html -o x.browser.slides.md` again, when that output still holds exactly what an earlier
  extract wrote there, rewrites it — also after an `assemble` of x.slides.md synced the file in between (it was
  refused with words that were false); an `-o` output with edits of its own is `output-differs` (D-70).
- CLI: `inspect` advises from the state it just checked: a 0.x text left beside its upgraded file is pointed at
  the new text twin instead of an `assemble` that is refused (D-71); "makes its .slides.html" becomes "holds this
  text (up to date)" when it does, and `--layout` is not advised after `--layout` (D-72); `inspect --layout`
  hints "shorten it or split the slide" for a box shrunk below 85 % that is not cut (D-73).
- CLI: `upgrade` prints its conversion notes as notes (stdout; `--json`: `notes` only), not as warnings (D-75).
- CLI: a 0.x content option to `assemble` (`--theme paper`) names the header line to write and gives a `next`
  (`upgrade` for a 0.x or headerless text, `new … --theme …` for a deck that does not exist yet) (D-76).
- CLI: `… -o - | head` ends quietly when the reader closes the pipe (EPIPE), with no Node stack (D-77).
- CLI: orz-slides' own messages say what to run in user words — "made before orz-slides 1.0", "the header", "pass
  it as --replaces to replace this file later without --force" — instead of "FC-18 header", "text format 1", "no
  compatibility shim" and "--replaces takes it" (codes stay in `reason`; D-91, this package's part); a lint error
  at `assemble` is called an error, as `inspect` calls it (D-94).
- CLI help: the `assemble` synopses list `[--cdn | --inline]` (D-107).
- Library: `assemble()` refuses a 0.x deck text (a `<!-- deck -->` block) as the CLI does — an error with
  `code: 'legacy-file'`; `{ legacy: 'as-is' }` assembles it unconverted (D-112).
- Browser package: `extract()` of an orz-slides 0.x file gives the text `upgrade` writes (title, metadata, the
  theme 0.x showed in the header), with `legacy: { version, notes }`, so a host app needs no server for old
  files; the Node library exports the same as `extractLegacy()` (D-111).

### Release tooling

- Publishing no longer re-runs the 2–3 h suite: `npm run test:release` runs
  it once on the release commit and writes a green-run stamp
  (`.release/green.json`, git-ignored); both `prepublishOnly`s run the family
  release gate (`scripts/release-check.ts`, now shared by every orz package,
  facts in `release.config.json`; it also checks the bundled kit and the
  release manifest) and the stamp check, in seconds. New scripts `test:fast`,
  `test:changed`, `test:release`. Development tooling only; nothing shipped
  changes.
- A file that fails in the stamp run is re-run alone with only its failed
  tests (`vitest -t` on their exact names; up to 2 tries); a suite-level
  failure (a hook, the file itself, a failed suite no failed test explains)
  re-runs the whole file. The stamp records which, per try.

<a id="100"></a>

## [1.0.0] — 2026-10-17

A rebuild on the orz-markdown carrier kit (orz text format 1), the shape of
orz-mdhtml 1.0 and orz-paged 1.0 with slides added (family plan
`docs/REBUILD.md` §3c). Requires `orz-markdown ^2.4.0` (FC-18 2.4.0 slides
keys, FC-19 `applyEdits` / `select` / `setFocusRange` / `flash` /
`getSelection`); reveal.js pinned at 5.2.1; released together with
`orz-slides-browser` 1.0.0.

### Breaking

- The 0.x files, Node API and CLI shape are replaced. 0.x files are not
  opened as they are: `orz-slides upgrade old.slides.html` writes a format-1
  file and its text twin, and `orz-slides upgrade deck.md` a 0.x deck source
  as a format-1 text — the `<!-- deck … -->` block (wherever it stood) and a
  `kind: meta` block become one `{{nyml}}` header at the top with `carrier:
  slides` and a `uid`; the theme 0.x showed is written explicitly; marker
  spellings 0.x tolerated are normalised; every difference against what 0.8.5
  showed is listed in the upgrade report (`--json` `report`, nothing
  unexplained for the 0.7.1–0.8.5 fixtures). `orz-slides inspect` says what
  any file or text is and what to do.
- The header is the deck config, and the only one: a `<!-- deck … -->` block
  in a format-1 text renders nothing (lint `deck-block`, error, `next:
  upgrade`); `assemble` refuses a 0.x text (`legacy-file`).
- The logical slide is 1280 × 720 (16:9) or 960 × 720 (4:3) — no longer
  960 × 540; theme sizes are one set of numbers.
- Removed: `buildSlidesHtml` and the 0.x library API (FC-09), the 0.x
  in-file runtime (`assets/app.js`, the per-slide pop-out editor, the
  morphdom preview, the auto-hiding deck bar, `window.orzslides`), the
  `#orz-deck` / `text/orz-slides` island and `__ORZ_SLIDES__`, `build/shims`
  and `path-browserify`, the `release` script (D-15: `prepublishOnly` in each
  package, the browser package first), the presentation-only export and
  vertical sub-slides; the 0.x CLI forms `orz-slides deck.md --theme … --title
  …` (content comes only from the header: refused with the header or `new`
  named; D-07).
- Node 20.16 or later (`engines`; 0.8.5 declared none).
- `buildSlidesHtml({ markdown, theme, title })` is gone: write the deck's
  text with a header (`upgradeText(markdown)` turns a 0.x deck source into
  one; `newDocument({ template, title, theme, ratio })` starts one), then
  `assemble(text)`.
- Themes: 14 slide themes replace the 7. Derived from orz-markdown's themes:
  Orchard (the default), Sky, Stationery, Preprint, Small Press, Notebook,
  Sticker, Inscription, Copper, Nocturne; updated from 0.x: Architect, Chalk,
  Neon, Paper. Executive, Poppy and Sage are dropped (`upgrade` maps them to
  Sky, Sticker and Orchard); `light-academic-1` and `beige-decent-1` alias
  Paper; the orz-markdown ids alias their derived themes.

### The new file

- A deck is its **text twin** `x.slides.md` and its **self-editing file**
  `x.slides.html` = `assemble(text)`: the exact text in the `#orz-src`
  island (BOM and line endings kept), an agent banner, `#orz-shell`
  (`kind`, `format`, `shell`, `delivery`), `<meta name="generator"
  content="orz-slides 1.0.0">`, `#orz-includes` for resolved includes. Node
  and the browser write the same bytes (FC-18 law 2); `extract` gives the
  text back byte for byte, also from a page the browser saved.
- **The read view is the deck**, through one engine module that owns
  reveal.js (its keyboard, controls, progress and print route off; keys
  through the kit): theme chrome inside the slide (running head, slide
  number, section, progress), sections numbered automatically (`plain`,
  `roman`, `01`), the outline's current item marked (`here=N` overrides),
  the closing page's lone `{{qr}}` in its own slot; **fit on every box, on
  both axes, templates included** — a box shrinks to fit down to 60 %, then
  is marked clipped (`data-scale`, `data-clipped`), never cut silently (D-46:
  a long title-page title no longer spills or is cut); charts, diagrams and
  molecules drawn when their slide is visible, at their box's size, in the
  theme's colours (dark themes draw on dark).
- **The pencil** (the kit's one control): Edit, **Present** (the deck alone,
  full screen), **Print** and **Print with notes** (one slide per page at the
  slide's size, every fragment shown; what paper cuts is marked on the page
  and said), **Speaker view** (S: its own window with current and next slide,
  notes, clock and timer), **Overview** (O), Save, Download a copy, New
  document, Save as new copy, the header settings **Theme, Ratio, Slide
  numbers, Progress bar, Section numbers** (FC-18 2.4.0 keys `slide_numbers`,
  `progress`, `section_numbers`), host protocols and the quiet update
  (re-assembles the same text with the SHA-384-verified bundle; D-53, D-56).
- **Two ways to edit** (owner decision 1): the **whole deck** — the kit's
  editor with the full text beside a **flattened** preview (a thin divider
  per slide with its number, title and layout, regions labelled, notes and
  footers set apart; scroll sync), the **live slide card** in the corner (the
  caret's slide as it presents, with a fit badge; folds to a tab), deck
  lints with quick fixes; and **single-slide editing** — the card enlarges
  into the layout GUI over the slide: split a box into rows or columns,
  delete a box (its content moves to the neighbour), drag dividers (snapping
  to simple ratios), presets, rename and swap, floats (added where they cover
  nothing, moved, resized, layered), a template's look (`v=`), the slide's
  options, notes and footer, and a filmstrip to add, duplicate, delete and
  reorder slides (drag to reorder, D-58). Every operation rewrites only
  marker lines — one undo step, one history for both modes; the overlay is in
  the trusted page, the stage in the sandboxed frame (D-47: no freeze, no
  drift between the editor's slide and the shown one; a marker in a code
  fence never splits a slide).
- **Saves**: `assemble(text)` in place (Chromium), else a download; a save
  over a file changed on disk asks first; New document and Save as new copy
  assemble with the running shell (D-55).

### CLI and library

- `orz-slides new | assemble | extract | upgrade | inspect [--layout] |
  themes | templates` on the kit's `carrier/node`: inline by default,
  `--cdn` for the web, `--json` with stable reason codes and a `next`
  command for every refusal (each tested verbatim), `--replaces <sha256>`,
  known states (the CLI's pair records, git), backups `<file>~`, atomic
  writes. `inspect --layout` renders a deck in the installed Chrome and
  reports per slide and box the fit scale and clipping (refused with
  `no-browser` without Chrome; `ORZ_SLIDES_CHROME` names a browser,
  `--offline` renders without the network) — an agent's overflow check.
  Every command the CLI names in a `next`, an advice, a warning or a note
  runs as written (tested over a corpus of states).
- Deck templates for `new` (`starter`, `talk`, `minimal`).
- The library exports `assemble`, `extract`, `readDocument`, `newDocument`,
  `upgrade`, `upgradeText`, `inspect`, `inspectLayout`, the upgrade report,
  `parseDeck`, `planDeck` and the per-slide editor's pure layout ops
  (`applyOp`, `applyEdits`, `slideMap`, …) for apps and agents.

### Web apps and agents

- `orz-slides-browser`: the IIFE (`globalThis.OrzCarrier`, FC-19) and an ES
  module build, `index.d.ts`, a `require()` shim that says how to load it,
  `release.json` with the bundle's SHA-384, `scripts/check-release.mjs` as
  its `prepublishOnly`; the bundle obeys the bundle rule (no `<script`, no
  CR, ASCII only). `OrzCarrier.layout` (and the ES module's named exports)
  carry the parser and the layout ops; `renderPreview` gives the flattened
  deck (`document: true` themed, `nonce` for its styles).
- `docs/embedding.md` (shipped in both packages) and `examples/webapp/`: two
  editors on one page with every hook under a nonce CSP with
  `'strict-dynamic'`, tested offline in real Chrome. App-side print of the
  slides is not offered in 1.0 (the `print` event goes to the app).
- The agent skill is rewritten for format 1 (both editing modes, the layout
  GUI, capacity budgets re-measured at 1280 × 720 for all 14 themes,
  `inspect --layout`, `upgrade` of files and texts, recovery, templates).
  `PROTOCOL.md` points to orz-markdown's `spec/host-protocols.md`.

### Quality

- Tests: unit, the shared corpus round trip, CLI scenarios, real Chrome
  (read view, fit, keys, print, themes, both editing modes, the layout GUI's
  round trip over 2500 seeded decks, typing and drag latency, the web app),
  and orz-markdown's carrier conformance harness (46 checks); claims in
  `notes/CLAIMS.md`. Closed-loop rounds A and B (`notes/closed-loop.md`).
- Examples regenerated with this shell (one inline, the rest cdn) and kept
  fresh by a test; the 0.x test decks upgraded to format-1 review decks
  (D-29). The 0.x design documents moved to `archive/`.
- Owner revisions taken in: Notebook's ruled lines are the slide's fixed
  background (no text aligned to them; a shrunk box never changes the page);
  the area around the slide is drawn in every theme (a soft dark tinted to
  the theme in dark themes, the designed light tint in light ones).
- Final closed loop (step 10): heading-only template pages keep their
  decorations inside the page in every theme (no shrink, no cut; Paper's
  drop numeral is sized to its room by the label's length, `data-sec-len`);
  offline, an undrawn diagram shows its source readably; printed
  notes are a sheet of paper in every theme (dark themes' notes were light
  ink on white); floats shrink like every box; uploads an app keeps as
  `blob:` URLs and stored `bg=` pictures show on every editor surface; file
  includes go to the app's `fetchInclude`; a read-only editor's setting
  pickers change nothing; `inspect --layout` is robust to its own cleanup.
- Confirming round (step 10): a file cut off inside its text is never read
  as browser work — `assemble` names `assemble … --replaces` (the repair)
  and `extract` from it never replaces another text without `--force`; an
  `extract` never puts an older text over a newer committed twin; an
  in-place upgrade of a 0.x file keeps `old.slides.html~`; uploads named
  with spaces or non-ASCII letters show on every editor surface, and the
  app's `resolveAsset` is asked for the path its `uploadAsset` returned;
  `blob:` uploads cross into the preview once (ten 4 MB pictures froze the
  editor for seconds per keystroke); the live card shares the shell's
  include cache; long URLs and code lines wrap in every theme (one rule); decorations keep their room
  once a box holds content (Nocturne's QR outline, Notebook's tape, Sticker's
  card, Inscription's frame); Paper's wide drop numerals and Preprint's long
  roman section numbers fit.
- The release gate (`scripts/release-check.ts`, both packages'
  `prepublishOnly`): the `orz-markdown` range must be at least the kit the
  code needs and installed (not linked), the two versions in lockstep, the
  entry dated and the tree committed.

### Known limits

- A 0.x file's own "Framework 1.0.0 available" banner (the newest
  release's number) cannot update it:
  its in-file updater fetches `orz-slides@<latest>/assets/app.js`, which 1.0
  no longer has, so it ends with "Update failed — check your connection" and
  changes nothing (the file keeps working as 0.x). Dismiss it and run
  `orz-slides upgrade old.slides.html` (nothing shipped under that path
  could help: the 0.x updater would inline it into the file and replace its
  working 0.x runtime).
- No app-side print of the slides in `orz-slides-browser` 1.0 (the
  `print` event goes to the app); handouts later.

## [0.8.3] – [0.8.5] — 2026-07-14 – 2026-07-17

Release-process and documentation releases. `orz-slides-browser` is kept in
lockstep with `orz-slides` by the build (0.8.1 and 0.8.2 had been published
without their browser package, so `--cdn` decks made with them loaded a
missing engine and showed an empty page); the README leads with "Markdown
that edits itself"; package metadata (homepage, bugs) updated.

## [0.8.2] — 2026-07-14

### Fixed

- Hosted decks: fragment stepping is off in the editor preview too.

## [0.8.1] — 2026-07-14

### Fixed

- Edit mode reveals every fragment, so navigation goes slide to slide.

<a id="080"></a>

## [0.8.0] — 2026-07-11

### Fixed

- **Mermaid diagram labels now render on first load.** Mermaid used HTML
  (`<foreignObject>`) labels measured via `getBoundingClientRect`, which
  reveal.js's scale-to-fit transform distorted to ~0-size boxes — the diagram
  drew but its text was clipped away until a manual reload. Switched to SVG
  `<text>` labels (`htmlLabels: false`), measured in transform-independent user
  units, and defer rendering a diagram until its slide is actually laid out.

### Added

- **`orz-host-include@1`** — the in-file editor resolves URL-based markdown
  transclusion (`{{md-include https://…}}`) for its preview via a trusted host,
  inlining the fetched markdown into each slide in place (reveal.js state
  preserved). The deck source keeps the directive; a standalone file never
  resolves and never auto-fetches. See PROTOCOL.md.

## [0.7.1] — 2026-07-11

### Security

- Updated build/test tooling to fixed `esbuild ^0.28.1` and `vitest ^4.1.10`
  releases. Runtime dependencies and generated document behavior are unchanged.

### Packaging

- Ship the MIT license in both npm packages and include `PROTOCOL.md` in the CLI
  tarball so installed README links remain valid.

## [0.7.0] — 2026-07-11

### Added

- Portable document metadata. Deck `title:` and `author:` seed standard
  `<head>` tags and an `#orz-meta` JSON island. Programmatic callers can pass
  richer `metadata` to `buildSlidesHtml`; host values win field by field while
  the deck footer and visible content remain unchanged. Requires
  `orz-markdown ^1.4.0`.

## [0.6.1] — 2026-07-09

### Fixed

- **Theme picker now writes into the deck source.** Picking a theme from the
  toolbar dropdown updated the runtime (`data-theme`, the rendered CSS) and the
  CodeMirror editor's syntax theme, but never touched the deck's own leading
  `<!-- deck ... -->` config block — so the pick was DOM-only state, lost the
  moment a host (or the author) read `theme:` from the saved source instead of
  a side channel. `setTheme()` now rewrites (or inserts) the `theme:` line in
  the deck config on every pick — replacing an existing line, adding one to a
  deck block that lacks it, or creating a minimal deck block if the deck had
  none at all — and keeps the open "deck settings" editor buffer in sync. The
  deck is now genuinely self-describing: its own source is always the single,
  correct statement of its current theme, standalone or hosted alike.

## [0.6.0] — 2026-07-09

### Added

- **Page-wide AI assistant (`orz-host-ai@1`).** When an embedding host
  advertises AI operations, the editor now shows an assistant: select text in
  the source editor for an "✦ Improve selection" chip, or use the new sparkle
  button in the toolbar to run an operation on the whole editor buffer (the
  current slide, or the deck config when deck-settings is open). The file sends
  the passage to the host, which returns a suggested replacement the author
  edits and applies. The file owns the UI; the host owns the model and
  governance. No host, no assistant — standalone files are unchanged. Ported
  from orz-mdhtml to match the shared protocol exactly. See `PROTOCOL.md`.
- **Theme in save.** The `orz-host-save` message now carries the file's current
  `theme` id (additive field), so a host can persist the author's theme choice
  (e.g. a course-wide default). Hosts that ignore it are unaffected.

### Docs

- Added `PROTOCOL.md` documenting `orz-host-save@1` (incl. the new `theme`
  field) and `orz-host-ai@1`, mirroring the canonical spec in orz-mdhtml.

## [0.5.0] — 2026-07-08

### Added

- **Embedded agent guide.** Every generated `.slides.html` now carries an
  invisible HTML comment (top of `<body>`) telling an AI agent how to edit it —
  what the file is, where the editable deck source lives (`<script id="orz-deck">`),
  and how to fetch the official orz-slides agent skill
  (`https://cdn.jsdelivr.net/npm/orz-slides/orz-slides-skills/SKILL.md`). Invisible
  to readers; readable by any external AI app opening the file's source, so it can
  edit the deck with the correct layout grammar and a byte-identical round-trip.
