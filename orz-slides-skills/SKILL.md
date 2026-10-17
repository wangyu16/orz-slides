---
name: orz-slides
description: Create, edit, inspect and upgrade orz-slides decks — a Markdown text twin (x.slides.md, orz text format 1, with a {{nyml kind document}} header) and its single-file, self-editing x.slides.html that presents in any browser (reveal.js: keys, overview, speaker view, timer, full screen), edits itself (the whole deck beside a flattened preview with a live slide card, or one slide at a time with a layout editor), saves itself and prints one slide per page. Use when a user wants a slide deck or presentation from notes or Markdown, when you meet a .slides.html (or a 0.x deck.md with a <!-- deck --> block) and need its text, when a deck must be changed, checked for overflow or moved to a newer version, or when a web app should embed the slides editor. Covers the header keys, the slide grammar (slide markers, options, regions, the split grammar and presets, floats, notes, footers, fragments), the template pages, the 14 themes, the deck templates, capacity budgets measured at 1280×720 and the overflow check `inspect --layout`. Edit the text, never the HTML; assemble with the orz-slides CLI.
---

# orz-slides — Markdown that edits itself, as a slide deck

A deck has two forms:

- the **text twin** `x.slides.md` — the deck itself: Markdown (orz-markdown
  syntax) with a header block at the top, then slides started by
  `<!-- slide … -->` lines and split into boxes by `<!-- @name -->` lines;
- the **self-editing file** `x.slides.html` = `assemble(text)` — one HTML page
  holding the exact text in a `#orz-src` island plus a regenerable shell: the
  deck (reveal.js), the pencil with Present and Print, the editor, saves, the
  quiet update.

**Rule: change the text, then assemble. Never edit, restructure or "fix" the
HTML** — everything but the island is regenerated, and a save in the browser
rewrites the whole file from the text. Never serialize the rendered deck.

The CLI is `orz-slides` (Node ≥ 20.16; `npx orz-slides@1 …` needs no install;
this skill is for 1.x). Use `--json` on any command for one machine-readable
object on stdout. Exit codes: 0 done, 1 refused or failed, 2 usage error.
Nothing that could hold other work is overwritten unless you pass `--force` —
when a command refuses, read the error (with `--json`: `reason` and `next`,
below), do not reach for `--force` by reflex.

**The one robust idiom:** pass the `sha256` the last command printed as
`--replaces`. `assemble`, `extract`, `upgrade` and `inspect` print the SHA-256
of the text they wrote or read (`--json`: `sha256`; `inspect`: `twin.sha256`
for the sibling); `assemble x.slides.md --replaces <that sha256>` replaces the
file only while it still holds that text. It works with no cache, no git, in a
shallow clone, in a fresh sandbox.

## Create a deck

```bash
npx orz-slides@1 templates                                    # starter (every kind of slide), talk, minimal
npx orz-slides@1 themes                                       # the 14 themes, light / dark
npx orz-slides@1 new talk.slides.md --template talk --title "RAFT in five minutes" [--theme nocturne] [--ratio 4:3]
# edit talk.slides.md (the grammar below)
npx orz-slides@1 inspect talk.slides.md --layout             # does every box fit? (installed Chrome)
npx orz-slides@1 assemble talk.slides.md                      # → talk.slides.html (inline engine, ~2.2 MB, works as a file)
npx orz-slides@1 assemble talk.slides.md --cdn                # → a small file that loads the engine from jsDelivr (for web pages)
```

`new` writes the template's slides under a header with a fresh `uid`; keep
the `uid` (it keys the reader's preferences and the save handle). `new --html`
writes both files at once; without a file name the text goes to stdout. A
slides text twin's name ends in `.slides.md`; a plain `x.md` that is a deck
(slide markers) also assembles (to `x.slides.html`). `orz-slides x.slides.md`
is short for `assemble`. Writing from scratch is fine too: a header and
slides (below) — but `new` mints the uid for you.

The 0.x form `orz-slides deck.md --theme <id> --title <T>` is gone: title and
theme live in the header. The CLI refuses it and names `new` or the header.

## Edit an existing deck

The `.slides.html` can be edited and saved in a browser (its text, its
layouts in the layout editor, its settings from the pencil's list), so it may
hold work the text twin lacks — even when `x.slides.md` is the newer file.
Always compare first.

1. **Compare before you edit.** `npx orz-slides@1 inspect x.slides.md --json`
   and read `sha256` and `twin`:
   - no `x.slides.md` yet → the command fails with reason `no-such-file` and
     `next` `extract x.slides.html`: run `npx orz-slides@1 extract
     x.slides.html` (exact, byte for byte);
   - `twin.holds: "same"` → go on;
   - `twin.holds: "different"` with `twin.earlier` set → the file holds an
     earlier text of `x.slides.md`; go on (assemble replaces it);
   - `twin.holds: "different"` otherwise → `x.slides.html` holds other
     (browser) edits: `npx orz-slides@1 extract x.slides.html -o
     x.browser.slides.md`, merge its changes into `x.slides.md` (or ask the
     user which to keep), and **note `twin.sha256`**;
   - if `x.slides.md` itself has nothing of its own to keep, `npx orz-slides@1
     extract x.slides.html` replaces it when it is a known state (unchanged
     since the CLI last synced the pair, or committed in git), or `extract
     x.slides.html --replaces <sha256 of x.slides.md>`.
2. Edit `x.slides.md`. Deck settings go in the header, not in the HTML and
   not as CLI options (`assemble` refuses `--title`, `--theme`, `--ratio`,
   `--footer`).
3. Check the fit: `npx orz-slides@1 inspect x.slides.md --layout --json`
   (below); shorten or split what it reports.
4. `npx orz-slides@1 assemble x.slides.md` → `x.slides.html`. No `--force` is
   needed when the file holds an earlier state of `x.slides.md` the CLI can
   prove: what `orz-slides` itself last wrote into it or read out of it (for
   the same pair, `-o` included), or a committed version of `x.slides.md` in
   git (HEAD, staged, or one of its 20 most recent commits; a shallow
   checkout knows only HEAD — use `--replaces` there). **In a fresh sandbox,
   use the token:** `npx orz-slides@1 assemble x.slides.md --replaces
   <twin.sha256>`. If assemble refuses (`twin-differs`), someone saved in the
   browser: do step 1, then run the command the refusal names. Only when
   `x.slides.md` has everything, `npx orz-slides@1 assemble x.slides.md
   --force` (the replaced file is kept as `x.slides.html~`, or `~1`, `~2`…).

Delivery: `assemble` keeps the existing file's delivery unless you pass
`--cdn` or `--inline`; a new file is inline. Inline holds the engine, not
the content libraries: formulas (KaTeX's styles and fonts), code colours,
diagrams, charts, molecules and the themes' webfonts load from CDNs, so a deck
that uses them needs a network connection the first time (offline it presents
in system fonts; an undrawn diagram shows its source). Includes: `assemble` keeps the
includes the old file recorded; `--resolve-includes` reads `{{md part.md}}`
files from the text's folder; each include left unresolved is a warning
(`--json` `unresolved`). Lints are reported as warnings with their lines and
the file is still written — fix errors anyway (an error means something does
not show as written).

## The header (FC-18, kind `slides`) — the deck's config

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
```

- `{{nyml` alone on the first line, `kind: document` next, `}}` alone on the
  last — **at the very top**. It renders nothing. It is the deck's only
  config: a `<!-- deck … -->` block (0.x) renders nothing in format 1 (lint
  `deck-block`, error; `orz-slides upgrade` moves it into the header).
- Deck keys (all optional): `title` (the page title; default the first
  heading), `author`, `theme` (one of the 14 ids below; default `orchard`),
  `ratio` (`16:9` default, or `4:3`), `footer` (inline Markdown on every
  normal slide), `transition` (`none fade slide convex concave zoom`, default
  none), `slide_numbers` (`yes`/`no`, default yes), `progress` (`yes`/`no`,
  default yes), `section_numbers` (`plain` 1 2 3, `roman` I II III, `01`,
  `none`; default the theme's). The theme draws numbers and progress.
- Common keys: `carrier` (`slides`), `uid` (`doc-` + 10–32 of `[0-9a-z]`; do
  not invent or change one), `description`, `date`, `keywords`, `source`,
  `license` / `license_name` / `license_url`, `lang`. Your own tool's keys:
  prefix `x_<tool>_`; unknown keys are kept. A wrong value of a deck key is
  the warning `invalid-value` (the default is used).

## Slides

Every slide starts with a `<!-- slide … -->` line; there is no `---`
separator. **Markers count only as top-level lines** — a marker inside a code
fence, a list, a blockquote, a `{{…}}` block or raw HTML is text (it splits
nothing). Text before the first slide marker is kept but not shown (a lint
notice).

```markdown
<!-- slide -->                              one box (`body`)
<!-- slide 2col 3/2 -->                     a preset with a ratio
<!-- slide row auto/1 { head; col 1/1 { a; b } } -->   a split of your own
<!-- slide template=section -->             a template page
<!-- slide step fit=scroll bg=#0b3d2e t=fade -->      options
```

**Options** (`key=value`, values may be quoted: `class="a b"`; one bare flag):
`step` (reveal the slide's blocks one at a time — each item of a top-level
list, every other top-level block, in order across boxes), `fit=` (`fit`
default: shrink to fit; `scroll`: scroll on screen, fitted on paper; `off`:
no fitting, cut when too long), `bg=` (a colour or an image URL), `t=` (this
slide's transition), `class=`, `id=`, `template=` and `v=` (template pages),
`here=N` (outline pages, below). An unknown option is a lint error. A single
block can be a fragment with `{{attrs[.fragment]}}` after it (not a list
item: use `step`).

**The heading rule.** A normal slide begins with **one `##` title** — it is
lifted into the slide's title band (it spans the slide above every box).
`#` (h1) only on title / section / closing pages; an h1 or a second `##` on a
normal slide is a lint error. `###`–`######` are ordinary headings inside
boxes. A slide without a title is fine (a warning: an image-only slide).

**Boxes** (regions). A layout has named boxes; `<!-- @name -->` (alone on its
line) starts a box's Markdown, which runs to the next marker. Text right
after the title (before any box marker) fills the layout's **first** box, so
a one-box slide needs no box marker. A box name appears at most once (filling
a box twice — leading text and its own marker — is an error); a marker for a
box the layout lacks is an error (its content is not shown). Names are flat
and unique per slide, whatever the nesting.

**Reserved markers** (every slide, not boxes):

| Marker | What |
|---|---|
| `<!-- @notes -->` | speaker notes — never on the slide; in the speaker view (S) and on *Print with notes* |
| `<!-- @footer -->` | this slide's footer, replacing the header's `footer` (which shows on every normal slide; title pages show none) |
| `<!-- @float left=58% top=10% w=36% h=44% -->` | an overlay box over the layout: any of `left right top bottom w h` (`%` of the slide, or `px`, `em`…) and `z=` (stacking; default declaration order). Floats are unnamed: told apart by their order. Use them rarely (a badge, a callout, a logo). |

### The layout grammar

One rule, applied recursively: split a box into **rows** or **columns**;
each cell is a named box or another split.

```
split  := ("row" | "col") tracks "{" item (";" item)* "}"
item   := name | split
tracks := track ("/" track)*        e.g. 2/1 · auto/1 · 30%/1 · 200px/1 · 1/2/1
```

Tracks are fractions (`1`, `2`), `auto` (as tall/wide as its content), `%` or
`px`; their count must match the items. `/` separates tracks; `:` never
appears in a layout.

**Presets** (aliases of splits; an optional ratio in their track count):

| Preset | Is | Boxes | Default ratio |
|---|---|---|---|
| *(none)* | one box | `body` | — |
| `2col [a/b]` | `col a/b { left; right }` | left, right | 1/1 |
| `3col [a/b/c]` | `col … { left; mid; right }` | left, mid, right | 1/1/1 |
| `2row [a/b]` | `row a/b { top; bottom }` | top, bottom | 1/1 |
| `main-side [a/b]` | `col a/b { main; side }` | main, side | 2/1 |
| `quad` | `row 1/1 { col 1/1 { tl; tr }; col 1/1 { bl; br } }` | tl, tr, bl, br | — (no ratio) |

Reach for a preset first; a raw split only for nesting. A layout that equals
a preset is written as the preset by the layout editor.

### Template pages (`template=`)

Structure pages with their own design in every theme; each has one box (its
Markdown) plus notes, footer, floats. `v=N` picks a look.

| Template | Write | Looks |
|---|---|---|
| `title` | `# title`, `## subtitle`, then a byline (name, date, place) | `v=1`–`6` |
| `section` | `# section title`, then a line of meta; numbered automatically (`section_numbers`) | `v=1`–`4` |
| `outline` | an optional `## heading`, then a list of the sections | `v=1`–`3` |
| `closing` | `# thanks`, `## questions?`, contact lines; a lone `{{qr https://…}}` gets its own place | `v=1`–`3` |

The **outline** marks its current item automatically — an outline placed
before the *k*-th section page marks item *k* (an agenda you repeat between
sections) — or `here=N` sets it (`here=0`: none). A layout on a template page
is an error; a `v=` the template lacks too.

### Everything inside a box is orz-markdown

Math (`$…$`, `$$…$$`, `\ce{…}`), code fences, tables, `::: info` callouts,
`:::: cols`, tabs, `{{mermaid …}}`, `{{smiles …}}`, `{{chart …}}`
(`type: bar|line|pie|doughnut`, `labels:`, `series: Name = 1, 2, 3`),
`{{qr …}}`, `{{youtube …}}`, `{{attrs[#id .class]}}`, images
(`![alt](pic.png)`, relative to the deck). Drawings render when their slide
shows, at their box's size, in the theme's colours. The full syntax: the
orz-markdown skill (`node_modules/orz-markdown/orz-markdown-skills/SKILL.md`).

## Capacity — author within the slide

Every box shrinks its content to fit, down to 60 %; past that the box is
**clipped** (cut, marked). Shrinking is a safety net, not a licence: text at
60 % is hard to read from the back of a room. Write within these budgets —
the most that fits **unscaled** in a 1280 × 720 (16:9) slide with a title, in
the tightest of the 14 themes (the roomiest in brackets), measured in Chrome
with the themes' webfonts:

| Box (16:9, a titled slide) | Fits unscaled (tightest theme · roomiest) | Cut only past |
|---|---|---|
| One box (`body`): bullets of ~9 words | **8** (11) | 14 |
| One box: a paragraph | **~110 words** (170) | ~220 words |
| One box: code lines of ~40 characters | **10** (16) | 20 |
| One box: table rows, 4 short columns | **7** (9) | 12 |
| A `2col` column: bullets of ~7 words | **4** (6) | 12 |
| A `2col` column: a paragraph | **~50 words** (80) | ~140 words |
| A `3col` column: bullets of ~5 words | **4** (5) | 10 |
| A `quad` cell: bullets of ~5 words | **3** (5) | 6 |
| `main-side`: `main`, bullets of ~9 words | **4** (7) | 12 |
| `main-side`: `side`, bullets of ~5 words | **4** (5) | 10 |
| The slide title (`##`) | **~6 words** on one line in the tightest theme (Notebook; most take 10+) | wraps; cut past ~10 words in the tightest |
| A title page's `#` | 20+ words (it wraps, never cut) | — |

Tightest themes: Inscription (large serif capitals) for bullets, Nocturne,
Stationery and Copper for prose, Sky for code; the roomiest are the plain
sans themes. Write to the bold number and the deck fits in every theme — a
reader may switch themes.

For `4:3` (960 × 720) the boxes are 25 % narrower and lines wrap sooner:
one box ~4 bullets of ~9 words in the tightest theme (10 in the roomiest), a
paragraph ~70 words, code and table rows as for 16:9 (10 and 7); a `2col`
column ~2 bullets (5) or ~30 words; `3col`, `main-side` side ~2 short
bullets; a `quad` cell barely one or two (Inscription shrinks even those);
a slide title ~4 words on one line in Notebook. Prefer 16:9, or fewer and
shorter points, for 4:3 decks.
Rules of thumb: **prefer splitting a slide into two over crowding one**; one
primary visual (figure, chart, diagram, table) per box; a bullet ≤ ~10 words,
one level of nesting; a slide title ≤ ~8 words (a longer one wraps onto a
second line and takes room from the boxes); a title page's `#` ≤ ~8 words.

**Check, don't guess:** `npx orz-slides@1 inspect x.slides.md --layout --json`
renders the deck in the installed Chrome (headless) and reports, per slide
and box (`title`, a box's name, `template`, `float 1`…), `scale` (1 =
unscaled; 0.6 = the floor) and `clipped`, whether the footer is cut, and
`summary` (`scaled`, `clipped`, `minScale`) plus `advice` for every clipped
box. Aim for `clipped: 0` and no scale below ~0.85. `--offline` blocks the
network (fallback fonts: numbers shift a little); without Chrome it is
refused (`no-browser`; set `ORZ_SLIDES_CHROME` to a Chrome binary).

## Themes

`theme:` takes one of 14 (`orz-slides themes`); dark themes draw charts and
diagrams on dark:

| id | Look |
|---|---|
| `orchard` (default) | off-white page, calm green, Bricolage Grotesque headings |
| `sky` | airy near-white, sky and teal tints, Figtree |
| `stationery` | warm paper, teal ink, Epilogue over Literata |
| `preprint` | a crisp journal page: Fira Sans over Vollkorn, one navy accent |
| `small-press` | linen stock, Josefin Sans over Cardo, bottle green |
| `notebook` | a ruled school exercise book, slips stuck on the page |
| `sticker` | a dot-grid sketchbook with outlined stickers, Chewy and Patrick Hand |
| `inscription` (dark) | deep navy, Cinzel capitals over Source Serif 4 |
| `copper` (dark) | teal-black, Sora over Vollkorn, copper and violet |
| `nocturne` (dark) | a graphite code editor, Atkinson Hyperlegible over Charis SIL |
| `architect` | a drafting sheet: fine grid, title block, dimension lines |
| `chalk` (dark) | a green-black chalkboard, Caveat titles, coloured chalk |
| `neon` (dark) | an instrument panel, phosphor cyan on near-black glass |
| `paper` | a finely printed book: EB Garamond, roman section numbers |

orz-markdown theme ids are accepted as aliases (`light-neat-3` → orchard, …;
`light-academic-1` and `beige-decent-1` → paper). The 0.x themes `executive`,
`poppy` and `sage` are gone (`upgrade` writes `sky`, `sticker`, `orchard`).

## Deck templates (`new --template`)

`starter` (default: a tour of every kind of slide — title, outline, section,
closing, points with `step`, notes, presets, a float, a custom split), `talk`
(title, outline, three sections of two slides, closing) and `minimal` (a
title page and one slide). Start from `talk` for a real talk and replace its
placeholder text.

## Inspect before you act

```bash
npx orz-slides@1 inspect x.slides.html --json    # also a text, a 0.x file or text, any HTML
```

Read `input` (`text`, `assembled`, `legacy`, `html`), `kind`, `format`,
`writable`, `shell.version` / `shell.relation`, `uid`, `title`, `theme` /
`themeEffective`, `ratio`, `slides`, `settings`, `header.keys`, `includes`,
`lint` (with lines), `checks` (a file's structure), `sha256` (the
`--replaces` token), `twin` (`holds`, `newer`, `sha256`, `earlier`),
`upgrade` (for a 0.x deck: what `upgrade` changes), and **follow `advice`** —
it names the command to run, with your file names:

- `legacy` (an orz-slides 0.x file) → `upgrade`; next to an existing
  `x.slides.md`: `upgrade x.slides.html --text x.browser.slides.md`, then
  merge and `assemble x.slides.md --replaces <sha256 upgrade printed>` —
  `extract` does not read 0.x files. The 0.x file's own "Framework 1.0.0
  available" banner (the newest release's number) cannot do this (it ends with "Update failed — check your
  connection" and changes nothing): tell the user to dismiss it;
- a 0.x **text** (a `<!-- deck -->` block; lint `deck-block`) → `upgrade
  deck.md` (writes `deck.slides.md`), then assemble that (a 0.x
  `deck.slides.html` built from exactly that source is replaced without
  `--replaces`);
- `twin` of a text that names a file **cut off** inside its text → the
  advice is `assemble x.slides.md --replaces <sha256>`: the text is the
  complete one, never merge the cut file's text in;
- `twin.holds: "different"` → extract and merge before assembling (unless
  `twin.earlier` is set: then assemble replaces it);
- `checks.island: "unclosed"` → the file was cut off: `extract x.slides.html
  -o x.recovered.slides.md`, compare with a backup; `checks.engine:
  "different"` / `"missing"` → `upgrade` re-assembles it (the text is intact);
- an older shell → `upgrade`; a newer shell or text `format` → `npx
  orz-slides@latest` (do not force a downgrade);
- lint errors → fix the text (each names its line), then assemble;
- another kind (`md`, `paged`) → its own tool (`npx orz-mdhtml`, `npx
  orz-paged`).

## When a command refuses (`--json`)

A failure is `{ "ok": false, "error", "reason", "next"?, "exitCode" }`. `next`
is `{ "command", "args" }`: run `npx orz-slides@1 <command> <args…>` verbatim
(it never replaces a text with another line of work). Stable `reason` codes:
`twin-differs` (extract to `x.browser.slides.md`, merge, assemble with
`--replaces`), `replaces-mismatch` (a save happened since: extract again and
merge), `legacy-file` (a 0.x file or text: `upgrade`, then `assemble
--replaces` with the `sha256` upgrade printed — not `--force`),
`output-differs` (another text at `-o`: follow `next`; another document:
choose another path), `newer-shell` / `newer-format` (`npx
orz-slides@latest`), `unclosed-island`, `not-orz`, `exists`,
`assembled-input`, `other-kind`, `invalid-text`, `no-browser` (`inspect
--layout` without Chrome), `no-such-file`, `unreadable`, `not-utf8`,
`write-failed`, `engine-unavailable`, `bad-usage` (exit 2; also a 0.x form),
`failed`.

## Upgrade old files and texts

```bash
npx orz-slides@1 upgrade old.slides.html            # in place (the 0.x file kept as old.slides.html~), and writes old.slides.md (its text twin)
npx orz-slides@1 upgrade old.slides.html -o new.slides.html --text new.slides.md
npx orz-slides@1 upgrade deck.md                    # a 0.x deck source → deck.slides.md (then assemble it)
```

A 0.x deck (orz-slides ≤ 0.8.5) keeps its slides: the `<!-- deck … -->`
block (wherever 0.x found it) and a `kind: meta` block become one header at
the top, with `carrier: slides`, a `uid`, the file's `#orz-meta` metadata and
title, and the theme the deck SHOWED written explicitly (the deck block's,
else the file's own, else 0.x's implicit `paper`; `executive` → `sky`,
`poppy` → `sticker`, `sage` → `orchard`). Marker spellings 0.x tolerated
(`<!-- @notes: -->`, `left = 50%`, upper-case options) are normalised, a
marker a block swallowed is repaired, and a `v=` the template lacks is
dropped — each with a note. `--json` carries `report`: every difference
against what 0.8.5 showed (slides, titles, regions, layouts, notes, footers,
floats, options, theme), each explained. 0.x slides were 960 × 540; 1.0
slides are 1280 × 720 (16:9), so content has more room — still run `inspect
--layout`. A format-1 file of an older shell is re-assembled with its text
and includes unchanged. Upgrading twice changes nothing more.

## Recover the text from any version by hand

- **Format 1** (`<script id="orz-shell">` exists): read the `<script
  type="text/markdown" id="orz-src">` element's raw content; remove **one**
  backslash after each `<` that is followed by backslashes and then `script`
  or `/script` (any case); turn the line breaks into the style named by
  `data-orz-eol` (`lf`, `crlf`, `cr`); prefix U+FEFF when `data-orz-bom` is
  present. In code: `extract(html).text` from `orz-markdown/carrier` (or
  `orz-slides`).
- **0.x** (no `#orz-shell`; `<script type="text/orz-slides" id="orz-deck">`):
  its raw content with each `<\/script` turned back into `</script` and the
  one line break the writer added at the start and at the end removed — a 0.x
  deck source (`<!-- deck -->` block). Prefer `orz-slides upgrade`.
- A cut-off file (`checks.island: "unclosed"`): `orz-slides extract
  x.slides.html -o x.recovered.slides.md` takes what is there (with a
  warning); compare with a backup.

## What the file does for its reader

The deck in the page — → / Space next, ← previous, **O** overview, **S**
speaker view (its own window), **T** timer, **F** Present — and ONE control:
a pencil at the bottom-left (click: Edit; hover or tap: Edit, Present, Print,
Print with notes, Speaker view, Overview, Save, Download a copy, New
document, Save as new copy, Theme, Ratio, Slide numbers, Progress bar,
Section numbers). Settings write the header (undoable, unsaved until Save).

**Edit** (Cmd/Ctrl+E) has two ways, on the one text with one undo history:

- **the whole deck** — the text beside a **flattened** preview (each slide's
  content in order under a thin divider with its number, title and layout;
  boxes labelled; notes and footers set apart) and the **live slide card** in
  the corner: the slide under the caret as it presents, with a fit badge
  (*fits*, *shrunk to N%*, *footer cut*, *cut on paper*). **Issues** lists
  the lints with quick fixes.
- **single-slide editing** — the card's **Edit** (Cmd/Ctrl+Shift+Enter)
  enlarges it into a layout editor over the slide: split a box into columns
  or rows, delete a box (its text moves to the neighbour), drag a divider (it
  snaps to simple ratios), pick a preset, rename or swap boxes, add / move /
  resize / layer floats, pick a template page's look, set the slide's
  options, notes and footer, and a filmstrip to add, duplicate, delete and
  drag-reorder slides; click a box to edit its text. Each change rewrites
  only marker lines (one undo step) — so a deck edited this way is still a
  clean text for you.

**Save** (Cmd/Ctrl+S) writes `assemble(text)` in place in Chromium,
downloads elsewhere; a save over a file changed on disk asks first. **Print**
puts one slide per page at the slide's size (every step shown); *Print with
notes* adds the notes under each slide; what paper cuts is marked. A quiet,
once-a-day update offer on local files.

## In a web app

The same editor is a component: `npm i orz-slides-browser@1`, then
`mountEditor(element, { text, hooks: { save, ai, fetchInclude, … }, nonce })`
(ES module, or `globalThis.OrzCarrier` from the IIFE); its preview is the
flattened deck with the live slide card and single-slide editing, in a
sandboxed frame. The layout operations are pure functions an app (or you)
can run: `applyOp(text, slideIndex, { type: 'split', box: 'body', dir: 'col'
})` → minimal edits (library `orz-slides`, the ES module, or
`OrzCarrier.layout`). Store the text; call `assemble(text)` only when a file
is needed. Hooks and the CSP recipe: `docs/embedding.md`, shipped in both
packages. Platforms that show assembled files in an iframe use the host
protocols (orz-markdown `spec/host-protocols.md`).

## Gotchas

- Do not edit `x.slides.html` by hand; the text is the deck.
- Keep the `uid` across revisions; a different deck needs its own (`new`, or
  the file's *Save as new copy* / *New document*).
- A box marker must be alone on its line (`<!-- @left -->`), and a slide
  marker too; `<!-- slide -->` inside a code fence is just text — to show
  marker syntax on a slide, put it in a fence.
- One `##` per normal slide, first; `#` only on title / section / closing
  pages.
- Do not lean on floats for layout — that is what splits are for.
- `--force` keeps what it replaces as `<file>~` (or `~1`, `~2`…); still,
  compare before you force. The pair records live in
  `$XDG_CACHE_HOME/orz-slides/` (else `~/.cache/orz-slides/`).
- Package: `orz-slides` 1.x depends on `orz-markdown ^2.4.0` and pins
  reveal.js 5.2.1; files record the shell version that wrote them.
- Security: a `.slides.html` runs the code inside it — treat files like
  programs and open only trusted ones.
