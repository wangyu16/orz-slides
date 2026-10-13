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

Rebuild status: steps 1 (base) and 2 (format-1 parser + isomorphic
assembler) on branch `rebuild/1.0`. The read view is a stub until step 3.

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
| U.4 | `upgradeText` changes a format-1 text only by adding `carrier`/`uid`; the dropped 0.x themes map to their successors (executive → sky, poppy → sticker, sage → orchard; an unknown one → paper); beside a format-1 header a stray deck block fills only the keys the header lacks. | unit |
| U.5 | `upgrade` turns every 0.x fixture into a format-1 file of this shell whose text is the upgraded source and has no lint error; upgrading the result again re-assembles it unchanged; anything else is refused. | scenario |

## E — engine pieces kept from 0.x (reworked in rebuild step 3)

| ID | Claim | Oracle |
|---|---|---|
| E.1 | `renderLayout` turns a layout tree into nested CSS-grid DOM with one empty `.orz-region` per leaf (0.x behaviour kept). | unit |
| E.2 | `renderSlide` turns a parsed slide into a reveal `<section>` (title band, filled regions, footer, floats, notes) as in 0.x, now from the format-1 parser. | unit |

## R — the assembled file in real Chrome (rebuild steps 1–2: the stub read view)

| ID | Claim | Oracle |
|---|---|---|
| R.1 | Every slides corpus deck, assembled inline and opened offline over `file:`, boots on the kit's `carrier/app`: `OrzCarrier` is the slides carrier of this version (formats [1]), the read view (the step-1 stub: the flattened deck) replaces the fallback line, the page title is the derived title, the pencil handle is there, no page error. | real |
| R.2 | Edit mounts the kit's editor on the exact text, clean; leaving returns to the read view, which follows a header setting (Theme). | real |

## H — the carrier conformance harness (FC-19 §6)

| ID | Claim | Oracle |
|---|---|---|
| H.1 | orz-markdown's carrier conformance harness runs against the real carrier from step 1 — all 46 checks, no skips, a `next` build — and the carrier is conformant (45 passed; `C.update.from-previous` not applicable: `firstRelease`), with the stub read view; the engine, editing modes and themes of later steps must keep it so. | real |
| H.2 | The conformance target is the real carrier: the library's engine and manifest (the browser build's bytes), its `assemble` and `newDocument`, a `next` build that differs only by its version, `firstRelease` (0.x files get `upgrade`, not an in-file update). | conformance |
