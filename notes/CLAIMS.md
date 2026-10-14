# orz-slides claims registry

Each claim is one sentence that is true or false about this package, bound to
an oracle that decides which. A test proves a claim by carrying its id in its
title (`[P.1] …`, or in its `describe` title). `tests/claims.test.ts` fails if
a claim here has no test, or a test names a claim that is not here — an
unverified claim is red (the pattern of orz-markdown's, orz-mdhtml's and
orz-paged's `tests/claims.test.ts`).

A known gap is kept as a **probe**: `it.fails('[ID] …')`, a strict expected
failure that turns red the day it starts passing, so the fix has to promote it.

Oracles: **scenario** (behaviour end to end), **conformance** (code obeys a
rule), **corpus** (runs over the shared golden corpus,
`orz-markdown/tests/carrier-corpus/slides`, read from the installed package),
**property** (a seeded generator, many cases), **real** (runs in real Chrome
through playwright-core, channel `chrome`), **unit** (a pure module). A
**real** test skips when Chrome is not installed; such a run does not verify
that claim.

Binding specs: orz-markdown `spec/FC-18-text-format-1.md` (text format 1,
§5.1 slides keys, §7.2 slides body grammar, §8.1 title chain, the laws),
`spec/FC-19-editor-component.md`, `spec/carrier-app.md` (§3 the seam, §7 the
slides kind), `spec/conformance.md`; the family plan `../docs/REBUILD.md` §3c
(owner decisions 1–6 and the approved plan).

Rebuild status: steps 1 (base), 2 (format-1 parser + isomorphic
assembler), 3 (the engine: the read view, present, print) and 4 (the 14
themes) on branch `rebuild/1.0`; closed-loop rounds A and A2 (after step 4)
applied — their record is notes/closed-loop.md.

## B — base (rebuild step 1)

| ID | Claim | Oracle |
|---|---|---|
| B.1 | The package depends on orz-markdown `^2.3.0` installed from the registry — or, until orz-markdown 2.4.0 is published, linked to the prepared 2.4.0 checkout (KIT LINK, as orz-paged did with 2.3.0) — and reveal.js pinned exactly, and builds without shims or aliases: no `build/shims`, no `path-browserify`, no injected `process`, no `package.json` walk; versions come from `orz-markdown/version` and `src/version.ts`. | conformance |
| B.2 | The copied 0.x shell is gone — `assets/app.js`, `src/template.ts`, `src/browser-entry.ts`, the 0.x parser, CLI and library — and the sources hold no save, host or update code of their own: the bundle boots the kit's `carrier/app` with the slides kind (`startCarrier(SLIDES_KIND)`). | conformance |
| B.3 | There is one slide theme list (`src/themes.ts`): the 14 themes of owner decision 5 (10 derived, 4 updated), default `orchard`, the orz-markdown ids of the 10 derived themes accepted as aliases (and `light-academic-1`, `beige-decent-1` — Manuscript and Trade Book, dropped in favour of Paper — as aliases of `paper`), the dropped 0.x ids (`executive`, `poppy`, `sage`) not themes. | conformance |
| B.4 | `VERSION` (src/version.ts, the shell version every file records) equals the package version, and `orz-slides-browser` is versioned in lockstep. | conformance |
| B.5 | The test setup is orz-paged's: vitest projects `main`, `chrome` (every file that launches Chrome, one at a time) and `conformance`, playwright-core real-Chrome tests that skip without Chrome, and this live claims registry. | conformance |
| B.6 | `prepublishOnly` builds and tests before any publish; the `release` script that published the CLI before the browser package is gone (STATUS D-15). | conformance |

## P — the format-1 parser (rebuild step 2; FC-18 §7.2)

| ID | Claim | Oracle |
|---|---|---|
| P.1 | Slide and region markers are recognised only as top-level HTML-comment blocks found by the kit's token scanner (the orz-markdown parser's tokens): never inside a fence, indented code, a code span, a list, a blockquote, a container or a multi-line directive; up to three spaces of indentation; any line ending. Every slides corpus text gives its manifest `slideCount` (`markers-in-code`: exactly 5). | corpus, unit |
| P.2 | Every slide, marker, title, region source, float and lint carries its exact span in the text (offsets and 1-based lines, for LF, CR LF and CR texts), so tools can rewrite marker lines only. | unit |
| P.3 | The deck config is the FC-18 header only: `title theme ratio author footer transition` and the Q3 keys `slide_numbers`, `progress`, `section_numbers`, resolved (theme aliases, defaults orchard / 16:9 / yes / yes / the theme's numbering); nothing else is a config source. | unit |
| P.4 | A `<!-- deck … -->` block in a format-1 text renders nothing, is never a config source, and is the lint `deck-block` (error, `next: upgrade`), wherever it stands — in `readDocument` the kit's lint (orz-markdown 2.4.0), once per block. | unit |
| P.5 | The Q3 keys are in the kit's registry (orz-markdown 2.4.0; no `unknown-key`, `readDocument().settings` has them); their values, `ratio` (`16:9` / `4:3`) and `transition` are checked by the carrier's value lint `invalid-value` (warnings, FC-18 §5.1), added after the kit's lints through `readDocument({ tokens, lint })` with the text parsed once. | unit |
| P.6 | Text before the first slide marker is kept (the deck's `preamble` span) and noticed (`text-before-first-slide`, a warning); a text with content and no marker is `no-slides`. | unit |
| P.7 | Slide options are validated: `bg t fit class id template v here` (quoted values) and the bare `step`; an unknown `key=value` is `unknown-option` (an error, never a layout name); a bad value is `invalid-option` (fit, transition, template, a variant out of the template's range or without a template, `here` off an outline, an id with spaces); a repeated option is `duplicate-option`; option tokens are kept as written. | unit |
| P.8 | Layouts as in 0.x — presets with optional ratios and raw `row`/`col` splits — expand in the parser; an unknown layout word is `unknown-layout`, a preset ratio of the wrong track count, a `quad` ratio or a bad track size is `layout-tracks`, a malformed split `bad-split`, a region named twice in a split `duplicate-region`, a reserved name in a split `reserved-region`, a layout on a template slide `layout-on-template`. | unit |
| P.9 | Leading text fills the layout's first leaf; `<!-- @name -->` blocks fill their regions; `@notes`, `@footer` and `@float` (geometry checked) are kept apart; a template slide has the one region `body`. | unit |
| P.10 | The owner's decided errors (decision 6): a region marked twice is `duplicate-region` and a region filled both by the slide's leading text and by its own marker is `region-twice`; neither loses text (the contents are joined in order); a region the layout lacks is `unknown-region`; attributes on a non-float region are `ignored-attrs`; text after a marker on its line is `marker-not-alone`. | unit |
| P.11 | Heading rules of a normal slide (0.x): its first content — in the leading text or the first grid region — is one h2, the title (inline Markdown kept, lifted out of its region), else `no-title` (a WARNING: image-only slides are normal; coordinator default 2026-10-13); an h1 is `h1-on-slide` and another h2 `second-h2`; headings in code and in the speaker notes do not count, author comments are not content. | unit |
| P.12 | Every slides corpus text reads without any lint and with its manifest title. | corpus |
| P.13 | Marker hygiene (rounds A, A2, A3): the split rule is unchanged (markers only as top-level comment blocks), but a marker line the grammar does not read is never silent — ONE terminator-aware mechanism over every level-0 block that holds a marker line after its first: an HTML block of CommonMark type 6/7 (it ends at a blank line) is `marker-in-html` (error, quick fix: the blank line); a construct that runs on to a terminator of its own — a fence of any length and character, a container of any length, `$$` math, an HTML block of types 1–5 (`<pre>`, `<script>`, `<style>`, `<textarea>`, an open `<!--`, `<?`, `<!X`, `<![CDATA[`) — is `unclosed-fence` / `unclosed-container` / `unclosed-math` / `unclosed-html` (error) when never closed, closed by a marker's own `-->`, or closed by mistake (a later block of its kind after a slide marker; a slide marker in a container or a `$$` block), a warning for a bare fence holding a slide marker (two fences left open pair up); the quick fix inserts the construct's OWN closer before its first marker line, in the text's line ending, and applying it removes the lint and makes a marker line a marker; a fence or raw-text block closed on purpose may show markers — a container's own marker lines are those outside the code blocks nested in it, and its closer is the line after its token (round A3, A3-FMT-1: a closed callout showing a fenced marker was a false error); a `<pre>`/`<script>`/`<style>` closed by ANOTHER raw-text tag, or holding another raw-text opener after a slide marker, was closed by mistake (A3-FMT-2); a comment holding a marker line was always closed by a marker, a multi-line one included (A3-FMT-4); a lint that only follows from an earlier block closed by mistake (a block of its kind opened after that block's closing line, before the next marker; a type-6/7 HTML block's later marker lines) carries no fix, so the quick fixes commute — applied first-first, last-first or in random order they reach the same deck (property over 600 random decks × LF / CR LF / CR; A3-FMT-3); a short comment that reads like a marker (`<!-- notes -->`, `<!-- @ notes -->`, `<!-- Slide -->`) is `marker-lookalike` (warning); anything 0.x read after a region name (`@notes:`, `@notes:private`, `@notes(speaker)`, `@notes!`) is the marker, noticed (`marker-punctuation`); none fires on the corpus. | unit |
| P.14 | Parse cost (round A): `parseDeck` is linear in the text — 500 slides parse (tokens given) under 50 ms, 2000 slides under 8 × that (before: 402 → 5851 ms) — and memoised by text (the read view, its title/lang, the renderer and the lint parse a text once; the result is frozen). | unit |

## G — the layout grammar and the canonical serialiser (rebuild step 2)

| ID | Claim | Oracle |
|---|---|---|
| G.1 | The presets expand to their documented regions (`2col` left/right, `3col` left/mid/right, `2row` top/bottom, `main-side` main/side 2/1, `quad` tl/tr/bl/br with no ratio); an explicit default ratio is the same tree. | unit |
| G.2 | A split with one child whose track is a plain fr size is that child (`col 1 { main }` is the leaf `main`); any other one-child split stays. | unit |
| G.3 | The serialiser writes the canonical marker text of a tree (owner decision 6): `''` for the single `body`, the preset when the tree equals one (its ratio only when not the default), otherwise the raw split; a one-box slide whose box is not `body` as a one-track split. | unit |
| G.4 | Round-trip property (seeded, 600 random trees of every shape and track kind): `serialiseLayout(tree)` parses back — alone and as a slide marker with options — to exactly the tree, with no problem, and serialising again gives the same text. | property |
| G.5 | The D-47 guard (seeded, 120 random decks): markers written inside fences, indented code, directives, list items and code spans never split a slide — every deck has exactly its real slides, each with its own title and layout. | property |

## A — the isomorphic assembler (rebuild step 2; FC-18 §2, §8)

| ID | Claim | Oracle |
|---|---|---|
| A.1 | Round trip: `extract(assemble(T, o)).text === T` for every slides corpus text (the D-46 reproduction and `markers-in-code` included) and hazard text (CR LF, CR, BOM, `</script`, a deck block, a marker in a fence, a very long line, …), inline and cdn, with and without includes; kind `slides`, format 1, this shell version, the delivery and the includes as given. | corpus |
| A.2 | Determinism: the same bytes on every call and after a fresh module load; the isomorphic modules read no clock, randomness, environment or Node built-in. | corpus, conformance |
| A.3 | Idempotence: `assemble(extract(F).text, o) === F`. | corpus |
| A.4 | Mixed line endings are stored in the first line break's style (`storedText`); NUL, a lone surrogate, header `format: 2`, a missing or script-unsafe inline engine and an unknown delivery are refused. | unit |
| A.5 | The text-derived parts are the kit's `assembleEnvelope` (one `#orz-src` island, `#orz-shell`, `#orz-meta`, the FC-18 §8.1 slides title); the 0.x `#orz-deck`, `text/orz-slides` and `__ORZ_SLIDES__` are gone from the shell; the shell parts depend only on the options and the header's theme and ratio. | corpus |
| A.6 | The Node library inlines this release's engine, verified against its `release.json`: the very bytes of the browser build (`browser/` and `dist/`), so Node and the browser write the same file. | conformance |
| A.7 | `readDocument` agrees with the manifest for every slides corpus text (kind, derived title, header facts and keys) and takes the kind from the options, the file name, the header's `carrier`, else `slides`. | corpus |

## N — new documents (FC-18 §3, §10)

| ID | Claim | Oracle |
|---|---|---|
| N.1 | `newDocument()` writes a header first with `carrier: slides` and a freshly minted `uid` (`doc-` + 16 base36), then a title slide and a normal slide; it is lint-clean (header and body). | unit |
| N.2 | `newDocument({ title, theme, ratio, uid })` writes them (the title also as the title slide's heading, Markdown-escaped) and refuses an unknown theme or ratio and a malformed uid. | unit |

## U — 0.x files and texts (rebuild step 2; `upgrade`)

| ID | Claim | Oracle |
|---|---|---|
| U.1 | `readLegacy` reads a 0.x file (the kit's `readLegacyIsland` with the island `#orz-deck` / `text/orz-slides`, orz-markdown 2.4.0) — fixtures made by the published 0.7.1, 0.8.0, 0.8.2 and 0.8.5 CLIs (cdn, and one inline 0.8.5 file) — giving the `#orz-deck` source exactly as the `.md` it was made from (`<\/script` restored), its version, delivery, generator and `<title>`; a format-1 file and other HTML are not 0.x files. | scenario |
| U.2 | `upgradeText` turns a 0.x text into format 1: the deck block's keys become the header (with `carrier: slides` and a uid; 0.x's implicit `paper` written explicitly), the block is removed with the blank lines after it, the rest of the text is unchanged and lint-clean. | scenario |
| U.3 | A `{{nyml kind: meta}}` block before the deck block (0.x read neither) becomes one header with the deck block's keys (they win a clash, said); the dropped theme is mapped; no other text is lost; text before the first slide stays (noticed). | scenario |
| U.4 | `upgradeText` changes a format-1 text only by adding `carrier`/`uid` — its body is never repaired or respelled, a stray deck block beside its header or not (round A3, A3-FMT-5); the dropped 0.x themes map to their successors (executive → sky, poppy → sticker, sage → orchard; an unknown one → paper); beside a format-1 header a stray deck block fills only the keys the header lacks. | unit |
| U.5 | `upgrade` turns every 0.x fixture into a format-1 file of this shell whose text is the upgraded source and has no lint error; upgrading the result again re-assembles it unchanged; anything else is refused. | scenario |
| U.6 | Upgrade keeps what 0.x SHOWED (rounds A, A2): the theme is the deck block's, else the 0.x file's (its CLI `--theme`), else paper — never paper written into a format-1 text without a theme; every deck block is consumed (a later one fills only missing keys); markers a block swallowed are repaired FIRST with the hygiene lints' own fixes (0.x split at every marker line) — a pass applies only fixes that cannot interact, must turn the marker line each fix targets into a marker (else it stops, the lint left for the author) and runs at most once per marker line — then marker spellings 0.x read are normalised (`@notes:`, `@notes:private`, `col 1 / 2` at every depth of a split, a float's `key = value`, `BG=`; a non-integer float `z` and a `fit=` value 0.x ignored dropped; a slide marker's `key = value`, which 0.x did not read, stays); a `v=` the template has no variant for is dropped (0.x showed the first look); a leading BOM stays; the text's line ending is kept; upgrade is idempotent; each change has a note citing the ORIGINAL line. | unit, scenario |
| U.7 | The upgrade report: every 0.x deck — the fixtures, a synthetic 0.x corpus of the shapes round A2 found, and, when the sibling checkouts are present, every 0.x `*.slides.html` of the family — upgrades to a text whose `parseDeck` agrees with the FROZEN 0.8.5 parser (`tests/fixtures/legacy/parser-0.8.5`) on slides (aligned by their markers), titles, notes, footers, floats, regions, layouts, variants, options and theme, but for the registered decisions (deck block applied wherever it stood; a region filled twice joined, owner decision 6; a marker inside code or another block no longer splits, D-47 — accepted only for the slide that holds that block, only when no hygiene lint calls it left open, and only when that block can show a marker on purpose: a fence, indented code, a plugin block, a list or a blockquote, never an HTML block, a `$$` block or a container — round A3); a deck 0.x read without an error has none after upgrade. | corpus |

## E — engine pieces kept from 0.x (reworked in rebuild step 3)

| ID | Claim | Oracle |
|---|---|---|
| E.1 | `renderLayout` turns a layout tree into nested CSS-grid DOM with one empty `.orz-region` per leaf (0.x behaviour kept). | unit |
| E.2 | `renderSlide` / `renderDeck` turn a parsed deck into reveal `<section>`s in the 1.0 DOM contract (docs/dom-contract.md): the top slot `.orz-head`, the frame (title band, content grid, or the template box), floats, the bottom slot `.orz-chrome` (footer, section, number, bar) and the notes; every box that can overflow (title band, region, template box, float) is an `.orz-box`; the deck footer is not on the title page; a `bg` naming an image is `data-background-image`, else a colour. | unit |

## D — the deck plan (rebuild step 3; Q3, Q4)

| ID | Claim | Oracle |
|---|---|---|
| D.1 | Every slide is numbered `n` of `total`, with `--progress` = (n − 1) / (total − 1) (1 for a one-slide deck) on its section. | unit |
| D.2 | Sections are numbered automatically: each `template=section` slide opens the next one; every slide belongs to the last section opened at or before it (none before the first) and knows its title (the plain text of the section's heading). | unit |
| D.3 | The section label follows the header's `section_numbers` — `plain` 1, `roman` I, `01` 01, `none` nothing — else the theme's default (Paper: roman, the others: 01). | unit |
| D.4 | An outline marks the top-level item of the next section after it (an outline before section k marks item k; none after the last section) as `li.orz-here` with `aria-current="step"`; `here=N` overrides it, `here=0` marks none; a nested item is never the marked one. | unit |
| D.5 | The header keys decide the bottom slot: `slide_numbers: no` drops the number, `progress: no` the bar; the section label and title are in the bottom slot, the top slot holds the deck title and the section title; a section template carries its label (`data-sec`). | unit |

## F — fit (rebuild step 3; STATUS D-46)

| ID | Claim | Oracle |
|---|---|---|
| F.1 | Every box of every slide of every slides corpus deck (offline) fits, or is scaled (`--fit-scale`, `data-scale` ≥ the floor 0.6), or carries `data-clipped`: no content lies outside its box, or outside an element within it that clips, unless the box says so — no silent clipping. | real |
| F.2 | D-46: a long title on title v2 (and v1) stays inside the slide — the template page is a bounded, fitted box; nothing spills past either edge. | real |
| F.3 | Fit works on both axes: a table wider than the slide is scaled to the floor and then marked clipped; dense text is scaled; a big picture takes its column's room; `fit=off` is not scaled but marked when cut; `fit=scroll` scrolls (`data-scroll`), never marked; a long section title is scaled into the page. | real |
| F.4 | Fit runs on the visible slide only (after a render only the first slide is fitted); the sample deck (math, code, a table, a picture, a float, a molecule, a chart, a diagram) holds F.1 offline. | real |
| F.5 | The fit SETTLES (round A, ENG-1/ENG-2): once the engine says the current slide is settled, no box has content outside it unless it says `data-clipped`, and fitting again changes nothing — on first visits with charts drawn when their slide shows, with Present toggled, after a theme and ratio switch, on a direct jump to a Mermaid diagram, and on Stationery's math slide while its webfonts arrive late — under CPU throttling (CDP). | real |
| F.6 | Settled is a contract: `data-fit-settled` on the section, the `orz-fitted` event on the deck root and `engine.settled()` come after the fonts, the content libraries, the slide's images and stylesheets — a theme `<style>`'s `@import`ed webfont CSS included (round A2, A2-ENG-2: marked `data-orz-loading` until its own sheet loads; print waits for it too) — and a frame with nothing to refit, never on the first provisional pass; `data-fit-settled="timeout"` only after 10 s of one settle CYCLE, which begins when a slide shows and whenever a settled slide is unsettled (round A2, A2-ENG-1: a refit 10 s into a slide said `timeout` at once, with the stale scale); one ResizeObserver over the slide's box contents, a MutationObserver for what is drawn into them and a `<details>` toggle drive the refits — the resize watch never stops (round A3, A3-ENG-1: the A2 mute dropped a spoiler opened later): a refit a resize caused that the fit decides the same (every box within 0.01, the same clipping) leaves the slide as it was, and after two such refits the next resize refit is debounced (250 ms), never dropped; a chart's canvas follows its frame in CSS at the chart's own aspect ratio, so a trial scale is what will be drawn and an idle chart slide is idle — no canvas resize over 3 s, under 4 % of the main thread (A3-ENG-3: 520 ↔ 521 px forever); readiness of a theme's `@import` is read from its own sheet, and a theme change replaces the `<style>` (A3-ENG-2: the replaced sheet's `load` ended the wait); a webfont CSS or font request that never answers is waited for once, at most 5 s, never per slide, print or copy, and the slide refits when it arrives (A3-ENG-4). | real |
| F.7 | Fit is cheap (rounds A and A2, ENG-7, ENG-9, A2-ENG-6): a first fit guesses √(overflow ratio), learns the exponent from the last two measurements when the guess still overflows (a secant in log space; content that does not reflow scales as s¹) and brackets the answer — at most 8 measured trials for EVERY box of the sample and stress decks (the round-A bound of 6 was exceeded: 7–8 on the stress deck, now ≤ 5 there; 10 before round A) — and a refit of an unchanged slide starts from the box's last scale for that theme and size (at most 3); clipping descendants are read once a fit; `data-scale` is `1` when the scale rounds to 1. | real |

## K — the read view: keys, fragments, presenter tools (rebuild step 3; Q1)

| ID | Claim | Oracle |
|---|---|---|
| K.1 | Keys reach the deck only through the kit's `onKey`: → ↓ PageDown Space next, ← ↑ PageUp Shift+Space previous, End / Home; reveal.js's own keyboard, controls, progress bar and slide number are off; with the editor open the keys are the editor's. | real |
| K.2 | Fragments: a `step` slide reveals its blocks (each item of a top-level list, every other block) one key at a time, in order across regions, then moves on; `{{attrs[.fragment]}}` fragments work too; going to a slide starts it with no fragment shown. | real |
| K.3 | Overview: `o` opens it, Escape and Enter close it, the arrows choose the slide; the pencil's list offers it. | real |
| K.4 | The speaker view (`s`, or the pencil's list) opens its own window — current and next slide, the speaker notes, the position, the wall clock and the timer — and keys pressed there drive the deck. | real |
| K.5 | Present (the bar action, or `f`) shows the deck alone, full screen where the browser allows it, with the kit's chrome hidden; the keys still drive the deck; leaving brings the chrome back. | real |
| K.6 | The timer (`t`) shows the wall clock and the elapsed time over the deck; `t` again hides it. | real |
| K.7 | Content is drawn when its slide becomes visible: the molecule at its box's size (not a fixed 250 × 180 canvas), the chart at its box's width with the theme's `--chart-font-size` (orz-markdown 2.4.0 reads it; deck default 18), the diagram with whole labels (SVG labels in a deck: `--mm-labels: svg`) — the kit draws a slide's content when reveal lays it out — needs the network. | real |
| K.8 | Online (webfonts, KaTeX, the libraries) no box of the sample deck is clipped, and every box reports its scale. | real |
| K.9 | The speaker view's slides are static copies made by the print pipeline (round A, ENG-5/6/8): charts and molecules drawn (frozen images, never blank canvases) in Current and Next, every copy fitted (the next slide too, never shown before), and the page's stylesheets synced into its window on every update (a Theme switch shows there); built LAZILY (round A2, A2-ENG-3) — the current and next slides first, the rest one slide per idle period, nearest first, kept per render, theme and size — so opening it on an 80-slide chart deck runs no task over 1 s (5–12 s before) and keys answer while it builds; media never autoplay off their slide (`data-autoplay`) or in a copy (A2-ENG-7). | real |

## C — the chrome slots and templates on screen (rebuild step 3)

| ID | Claim | Oracle |
|---|---|---|
| C.1 | The bottom slot shows n / total, the footer, the section, and a progress bar whose width follows `--progress`; `slide_numbers: no` / `progress: no` remove number and bar, `section_numbers: roman` labels sections I, II …; the top slot holds the deck and section titles. | real |
| C.2 | The outline's current item is marked on screen (automatic, or `here=N`), styled apart by the theme. | real |
| C.3 | The closing template lifts a lone `{{qr}}` into its own slot (`.orz-qr-slot`, its `data-md` breadcrumb kept; the paragraph it leaves tidied); with two codes nothing moves. | real |

## T — themes in the engine (rebuild steps 3–4)

| ID | Claim | Oracle |
|---|---|---|
| T.1 | The read view's theme is the engine's stylesheet (`#orz-slide-theme`, the header theme's own: all 14 are built); the shell's head links no theme; slides render at the logical size — 1280 × 720 for 16:9, 960 × 720 for 4:3 — and a Ratio or Theme setting re-presents the deck. | real |
| T.2 | `assets/themes/<id>.css` is exactly what scripts/build-themes.ts makes from the installed orz-markdown for each of the 14 themes — a derived theme: orz-markdown common.css + its source theme adapted to a slide (Notebook also keeps the source's screen notebook, scoped to a region's body) + layers/slide-scale.css + its layer; an updated theme: layers/content.css + its layer; the engine bundle carries reveal.js's core CSS, deck.css and the 14 themes, so inline and cdn files style the same. | conformance |
| T.3 | Every theme on the sample deck (online): no silent clipping (the fit oracle) and no box clipped at all — the dense slide is scaled, the title, section and closing pages fit unscaled decoration included; and on the STRESS deck (round A: every variant, a long footer, a 16-row table, 18 bullets, wide code, h3–h6, callouts, a task list, sequence and gantt diagrams, a 10-slice pie, a three-row split, math in a title) at 16:9 and 4:3: no silent clipping. | real |
| T.4 | Every text of the chrome slots (running head, footer, section, slide number) is at least 20 px at the logical 1280 × 720, in every theme. | real |
| T.5 | Contrast, from what is drawn (the background sampled with the text hidden): body ink ≥ 4.5 : 1 and the title band and the title page's title ≥ 3 : 1, in every theme. | real |
| T.6 | (rounds A and A2, TK-2, TK-5, A2-TH-6/7/8: and on the stress deck, six chart colours apart for every reader — `--chart-1…6`, CIE76 ΔE ≥ 18 for every pair and ≥ 10 under protan, deutan and tritan simulation — a 10-slice pie of ten slices ΔE ≥ 10 apart (the kit's palette past its end, orz-markdown M.39), and gantt charts — a short plan, a semester and a multi-year grant in half a slide — drawn at their region's width, their axis labels apart, the year shown across years, axis text ≥ 11 logical px, no today line (orz-markdown M.40)) The chart and the diagram are drawn with the theme's tokens — tick colour `--chart-text`, first series `--chart-1`, font size `--chart-font-size` (≥ 18), node fill `--mm-node`; the dark themes (Inscription, Copper, Nocturne, Chalk, Neon) draw them dark-native (light ink and labels, dark nodes, no light panel), the light themes in dark ink. | real |
| T.7 | D-46: the long title stays inside the slide, fitted and not clipped, on the title pages (v2 and v1) of the corpus deck in every theme. | real |
| T.8 | The Theme setting switches the theme: its own stylesheet, its section labels (Paper roman, the others 01), its colours and colour scheme, and the chart redrawn in its tokens. | real |
| T.10 | Template variants (rounds A and A2, TK-1, A2-TH-3/5): every variant of every template (title v1–v6, section v1–v4, outline v1–v3, closing v1–v3; docs/dom-contract.md §7) has a look of its own in every theme — each pair of a template's variants differs on ≥ 0.75 % of the slide's pixels with the same text — the cover pages' ink reads on the cover (≥ 4.5 : 1), and every chrome text on a cover page reads on what is behind it (its own surface, else the cover; ≥ 4.5 : 1). | real |
| T.11 | The chrome-slot oracle (rounds A and A2, TK-4, A2-TH-2/4/11/12): on the stress deck at 16:9 and 4:3, every text of the running head and the bottom slot lies inside its slot and the slide, or is explicitly ellipsized (one line, overflow hidden, `text-overflow: ellipsis`) — a long footer ends in an ellipsis in every theme, its full text in its `title` and the footer `data-clipped`; and on every slide no visible text overprints another, and no placed `::before`/`::after` text (a section number, a label) lies over a text; no template page of the stress deck (an 8-item outline, a long title v6, a long subtitle beside title v4's band) is clipped. | real |
| T.12 | A theme that writes on a ruled slide (Notebook, `--orz-grid`) starts every region that reports scale 1 on one of the slide's lines — the second and third rows of a row split included, titled or not, at 16:9 and 4:3 (rounds A and A2, TK-3, A2-TH-9: a row the line pad pushed to 0.995 dropped the pad while it said `1`); a region fit shrank says so and is a sheet with its own ruling. | real |
| T.13 | The theme contract checks itself (rounds A and A2): `scripts/build-themes.ts` (build and `--check`) fails when a theme lacks the variant tokens, six chart colours or the diagram tokens, deck.css lacks a rule for a template variant (template and variant in ONE compound) or the one-line footer, or a layer lets the footer wrap (any rule that reaches the footer's text and outranks deck.css's), a box stop clipping or the title band overflow across — and on VALUES (A2-TH-14): each chart colour a colour, pairwise ΔE ≥ 18 and ≥ 10 for protan, deutan and tritan readers, the accent and cover inks ≥ 4.5 : 1 on them; it would have caught TK-1, TK-4, TK-5 and every A2-TH-14 mutation. | conformance |
| T.14 | A slide's `bg=` shows on every slide in every theme (round A2, A2-TH-1: reveal copies a section's classes onto its background layer, so deck.css's `.orz-slide` box laid the copies out one under the other — every `bg=` after the first slide was off screen — and five themes' pages covered it): the slide's page steps aside, reveal's background layer is on screen in the colour, and no deck.css or theme rule styles a background copy (its position, padding, margin, border, shadow, image, filter and pseudo-elements are reveal's). | real |
| T.9 | The header settings (the pencil's list and the editor's toolbar) are Theme (the 14), Ratio, Slide numbers, Progress bar and Section numbers, each reading its value from the header; Section numbers' "Theme default" removes the key (the theme decides) and names the theme's style. | unit |

## Q — print (rebuild step 3; Q8)

| ID | Claim | Oracle |
|---|---|---|
| Q.1 | The print document has one slide per page at the slide's size (16:9: 1280 × 720 px, 4:3: 960 × 720), every fragment shown, every box fitted, slide backgrounds on the slides, and no script; the page's print stage is removed afterwards. | real |
| Q.2 | "With notes": one page per slide, the slide over its speaker notes (pages 1280 × 1240 px). | real |
| Q.4 | Print never cuts silently (rounds A and A2: ENG-3/ENG-4, A2-ENG-4/5): on paper nothing scrolls — a `fit=scroll` slide is fitted — and long speaker notes are set smaller to the floor; every cut (a box past the floor, `fit=off`, notes) carries the same visible notice on its page (`.orz-print-cut`) and print names the cut slides to the reader (`printHtml().cut`, `notify`); images load eagerly (a `loading="lazy"` one on a slide never shown is fitted with, not after a 10 s wait without); a `{{youtube}}` player is sized like a picture (the largest 16:9 player in the room its box leaves; em-sized inside a container) and on paper and in the speaker's copies is a still of the same size with the video's address — no live player, nothing cut (round A3, A3-ENG-5). | real |
| Q.3 | Print is the action with id `print`: Cmd/Ctrl+P in the read view prints the print document in the kit's sandboxed frame (`allow-scripts allow-modals`), never the page; Print with notes is in the pencil's list. | real |

## R — the assembled file in real Chrome

| ID | Claim | Oracle |
|---|---|---|
| R.1 | Every slides corpus deck, assembled inline and opened offline over `file:`, boots on the kit's `carrier/app`: `OrzCarrier` is the slides carrier of this version (formats [1]), the read view is the deck (one slide per marker) and the fallback line is gone, the page title is the derived title, the pencil handle is there, no page error. | real |
| R.2 | Edit mounts the kit's editor on the exact text, clean, and hides the deck; leaving shows it again, and it follows a header setting (Theme). | real |

## H — the carrier conformance harness (FC-19 §6)

| ID | Claim | Oracle |
|---|---|---|
| H.1 | orz-markdown's carrier conformance harness runs against the real carrier from step 1 — all 46 checks, no skips, a `next` build — and the carrier is conformant (45 passed; `C.update.from-previous` not applicable: `firstRelease`), with the deck read view of step 3; the editing modes and themes of later steps must keep it so. | real |
| H.2 | The conformance target is the real carrier: the library's engine and manifest (the browser build's bytes), its `assemble` and `newDocument`, a `next` build that differs only by its version, `firstRelease` (0.x files get `upgrade`, not an in-file update). | conformance |
