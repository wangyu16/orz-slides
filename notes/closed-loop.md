# Closed-loop hardening — orz-slides 1.0 (rebuild/1.0)

The method (the family's closed loop, as in `../orz-markdown/notes/closed-loop.md`):
requirements are claims in [`CLAIMS.md`](CLAIMS.md), each bound to a test
(`tests/claims.test.ts` keeps the registry and the tests in step); an
independent auditor attacks them each round and a verifier reproduces every
finding; each real finding becomes a probe that fails on the code it was
found in, then the fix (and its class siblings), then the round's record
here. The family plan (`../docs/REBUILD.md` §3c) sets the checkpoints:
round A after step 4, round B after step 6, the final loop at step 10 with
the stop rule (no HIGH ORZ/ISOLATION finding).

Oracles in use: the **fit oracle** (`tests/fit-oracle.ts`: every word,
image, canvas and diagram of a box inside the box and inside every clipping
element on the way, unless the box says `data-clipped`); the **chrome-slot
oracle** (T.11); the **upgrade report** (U.7: the frozen 0.8.5 parser
against `parseDeck` of the upgraded text, over every 0.x deck of the
family); **settled-and-final** (F.5: once settled, a refit changes nothing);
pixel distinctness of variants (T.10); measured cost bounds (P.14, F.7).

---

## Round A — 2026-10-13 (after step 4; rebuild/1.0@817de2e)

Audit in three areas — format (parser, upgrade), engine (fit, print,
speaker view), themes and the 2.4.0 kit additions — each finding
reproduced by a verifier who re-rated its severity. Verified: 8 format,
6 engine, 5 themes; 8 LOW. Two HIGH after verification (FMT-2, ENG-1).

### Found and fixed

Every probe below failed on rebuild/1.0@817de2e (run with the round-start
`src/`, `assets/themes` or kit, then restored) and passes now.

| Id | Sev | Finding | Fix | Probe (claim) |
|---|---|---|---|---|
| FMT-1 | MED | a marker line inside a raw HTML block (`<img>`, `<div>` … run to a blank line) was swallowed silently: notes on the slide, slides merged | the split rule stays (FC-18 §7.2); lint `marker-in-html` (error) with its blank line as the quick fix (`SlideLint.fix`); upgrade inserts it | P.13, U.6 |
| FMT-2 | HIGH | upgrade wrote `paper` for a 0.x file built with `--theme` | the theme is what 0.x SHOWED: deck block, else the file's `defaultTheme` (its CLI `--theme`), else paper; dropped ids mapped | U.6 (fixture `cli-theme/neon-0.8.5`) |
| FMT-3 | LOW | `upgradeText` wrote `theme: paper` into a format-1 text with no theme | the paper rules apply only to 0.x texts; a format-1 header keeps its theme (none stays none) | U.4 |
| FMT-4 | MED | only the first deck block was consumed, so `deck-block`'s `next: upgrade` looped | every top-level deck block consumed; a later one fills only missing keys; notes | U.6 |
| FMT-5 | MED | an unclosed fence or `:::` container turned the rest of the deck into one code block, no lint | lints `unclosed-fence` / `unclosed-container` (error, quick fix: close before the next marker); upgrade closes it where 0.x ended it | P.13, U.6 |
| FMT-6 | MED | marker spellings 0.x read were left broken: `@notes:` showed notes on the slide, `col 1 / 2`, `left = 50%`, `BG=`, `2in`/`vmin` lengths, `z=2.5` | `@name` + punctuation is the marker (`marker-punctuation` warning); float lengths take every CSS unit; upgrade normalises marker lines (`normalizeMarker`), drops a non-integer `z` | P.13, P.9, U.6 |
| FMT-7 | MED | coursewerk's real 0.x decks (`v=5` on outline/section/closing) upgraded with `invalid-option` errors | upgrade drops a `v=` the template has no variant for (0.x showed its first look), with a note; the format keeps the range | U.6, U.7 |
| FMT-8 | MED | `parseDeck` quadratic (500 slides 402 ms, 2000 slides 5.9 s), run 3–4 times per present | one forward pass, per-slide binary search over indexed tokens; memoised by text (frozen result); tokens memoised; the read view reads title/lang once per text | P.14 |
| ENG-1 | HIGH | charts (and a jumped-to Mermaid) drawn after the fit, nothing refit: slide shrunk to 0.6 and falsely clipped, or cut with no `data-clipped`, flipping on each refit | the fit SETTLES: content drawn before a shown slide's fit; one ResizeObserver over the box contents + a MutationObserver for late drawings refit (the fit's own changes ignored); a chart canvas follows its frame in CSS | F.5 |
| ENG-2 | MED | the seed: `data-fitted` set on the provisional pass; a theme `<style>`'s `@import` loads ignored | `data-fit-settled` + `orz-fitted` + `engine.settled()` after fonts, libraries, images, stylesheets (STYLE too) and a quiet frame; tests wait for it | F.5 (deterministic: late webfonts), F.6 |
| ENG-3 | MED | print: a `fit=scroll` slide scrolled on paper, its end cut silently | nothing scrolls on paper: scroll slides fitted in the print stage | Q.4 |
| ENG-4 | MED | print with notes cut long notes at 520 px silently | the notes area is fitted (font scale to the floor) and, cut, says so on the page | Q.4 |
| ENG-5 | MED | speaker view: charts and molecules blank (a DOM clone has no pixels) | the speaker view's slides come from the print pipeline (frozen images, fitted); the live fallback copies canvases as images | K.9 |
| ENG-7 | MED | fit cost 164 ms (Orchard) / 367 ms (Notebook) per math slide, 10 trials a box | √(overflow ratio) guess, bracket, bisect to 0.01; refit from the box's last scale per theme and size; clipping descendants read once; redraw only when a slide shows and once when it settles | F.7 |
| TK-1 | MED | template variants v2…v6 looked exactly like v1 in all 14 themes | the 0.x variant set drawn in deck.css from each theme's tokens (`--sl-accent`, `--sl-accent-ink`, `--sl-surface`, `--sl-band`, `--sl-cover`, `--sl-cover-ink`); Notebook refines them for its coloured cover; dom-contract §7 | T.10 |
| TK-2 | MED | gantt charts drawn 300 px wide, axis labels overprinted | a diagram is a block until drawn; a compact gantt axis via the kit's new `--mm-gantt-axis-format` (orz-markdown 2.4.0, M.38) | T.6 (stress) |
| TK-3 | MED | Notebook: rows 2… of a row split wrote between the ruled lines | the grid pass pads an unscaled ruled body's top onto the slide's next line | T.12 |
| TK-4 | MED | a long footer wrapped past the slot / slide edge (Notebook, Small Press, Nocturne…) — a theme's `text-wrap: pretty` reset the inherited `nowrap` | the footer's text is one ellipsized line in deck.css | T.11 |
| TK-5 | MED | Architect, Chalk, Neon, Paper had 4 chart colours; Sticker (and Stationery) near-duplicates | six distinct colours (CIE76 ΔE ≥ 18) in every theme | T.6 |
| FMT-9 | LOW | `<!-- notes -->`, `<!-- @ notes -->` showed the notes on the slide, no lint | `marker-lookalike` (warning) | P.13 |
| FMT-10 | LOW | an author comment between the title and the first region marker was a false `region-twice` | a comment-only lead block is not leading text | P.10 |
| FMT-11 | LOW | upgrade dropped a BOM before the deck block | the BOM stays | U.6 |
| FMT-12 | LOW | `<!-- deck-notes … -->` was taken for a deck block (and deleted by upgrade) | the word `deck` itself, in the carrier and the kit (`header.ts`, K.29) | P.4 |
| ENG-6 | LOW | the speaker's Next pane showed an unfitted copy | its copies are fitted (static pipeline; the live fallback fitted in the window) | K.9 |
| ENG-8 | LOW | the speaker window kept the old theme after a Theme switch | the page's stylesheets are synced into it on every update | K.9 |
| ENG-9 | LOW | `data-scale="1.00"` for an effectively unscaled box | `1` when the scale rounds to 1 | F.7 |

Class siblings found while fixing:
- the speaker view's static copies and the print notes are fitted by the
  same `fitBox` (one fit for screen, paper and the presenter);
- a theme `<style>` that loads (its `@import`ed fonts) and a stylesheet that
  FAILED both count for settling (a failed one is not waited for);
- the cover/oversized title and the enlarged section title (v2) had glyph
  boxes past their box (tight line-height at large size): room given;
  the oracle now measures words (a hanging trailing space in a `pre-wrap`
  code line is no content);
- outline v2's cards must not remove a theme's own numbering indent (Neon's
  `CH1` labels collided), outline v3's columns need a block list (Small
  Press lays its list out as flex);
- the round-start tests waited for `data-fitted` — the same provisional
  signal the seed was measured in: `goTo`/`openDeck` now wait for settled.

### Improvements adopted

- **The fit settles** (engine improvement 1): the contract above.
- **Faster, cached fit** (improvement 2): adopted but for "pre-fit the
  neighbour in idle time" (open: the speaker's Next pane is right through
  the static copies; a first visit costs 84 ms on Orchard's math slide).
- **Speaker view from the print pipeline** (improvement 3).
- **Stress fixture for T.3–T.7** (themes improvement 1): run at 16:9 and
  4:3 in every theme.
- **Chrome-slot oracle** (themes improvement 2): T.11.
- **Self-checking theme contract** (themes improvement 3): build-themes
  (and `--check`) exits 1 on a contract problem; T.13 shows it catches
  TK-1, TK-4 and TK-5 in the round-start themes.
- **Marker hygiene lint family** (format improvement 2), with quick fixes as
  text edits (`SlideLint.fix`) for the step-5/6 editor.
- **Parse once** (format improvement 3).
- **Upgrade report** (format improvement 1): as a test oracle now (U.7,
  the frozen 0.8.5 parser under `tests/fixtures/legacy/parser-0.8.5`, over
  the 14 legacy fixtures and the family's 47 other 0.x decks: no
  unexplained difference). The registered deliberate differences: a deck
  block 0.x did not read is applied (owner default 2026-10-13); a region
  filled twice is joined (0.x showed only its last fill; owner decision 6);
  a marker shown in code no longer splits (D-47).

### Measured (before → after)

- Parse, tokens given: 500 slides 402 → 34 ms; 2000 slides 5851 → 100 ms
  (bound P.14: 500 < 50 ms, 2000 < 8 × that). `readDocument` 2000 slides
  6349 → ~200 ms (tokenising dominates now).
- Fit on the sample's math slide (slide 5, real Chrome): trials per box
  ≤ 10 → ≤ 6 (first fit), ≤ 3 (refit, measured 2); time Orchard
  164 → 84 ms (refit 59 ms), Stationery → 103 ms, Notebook 367 → 252 ms
  (its baseline-grid pass, ~9 ms a trial, dominates).

### Dismissed (with reasons)

- **FMT-1's "marker in a raw HTML block should split".** FC-18 §7.2
  recognises markers only as top-level comment blocks; the verifier
  confirmed the parse follows the spec. The lint and upgrade's blank line
  are the fix; the rule is not changed (owner, round-A brief).
- **FMT-7's "accept v=1…6 for every template".** 0.x defined title 6,
  section 4, outline 3, closing 3 and had no look for the rest (it showed
  v1); upgrade drops the out-of-range `v=` with a note. coursewerk's skill
  (`skills/orz-slides/SKILL.md:108`, "v=1..6" for every template) is
  contract drift in coursewerk — reported, not edited here (coursewerk
  stays on 0.8.x until Phase 5).

### Open by choice

- The upgrade report inside the library (`upgrade --json` notes listing
  each difference) needs the frozen 0.8.5 parser in the shipped package:
  rebuild step 7 decides (with `inspect`). **Step 7: shipped** — the frozen
  parser moved to `src/legacy/parser-0.8.5`, the report to
  `src/upgrade-report.ts`; `upgrade --json` and `inspect --json` carry it
  (`report` / `upgrade`, and the notes) — claims I.6, V.4.
- Pre-fitting the next slide in idle time (see above).
- Variant looks are generic compositions in each theme's tokens; their
  polish per theme belongs to the step-9 UI/theme freeze (review page:
  `npx tsx scripts/theme-sheets.ts` → the hub's *Variants* sheets).
- Notebook's fit stays the slowest (the kit's grid pass at every trial).

### After round A

- orz-slides: the full suite once — 18 files, 193 tests green (main,
  chrome one file at a time, conformance 45 passed + `C.update.from-previous`
  not applicable), tsc clean, `build-themes --check` clean (contract
  included). New probes: 40 (P.13, P.14, U.6, U.7, F.5–F.7, K.9, Q.4,
  T.10–T.13, the stress run per theme).
- Kit (orz-markdown 2.4.0, prepared, unpublished; `orz-markdown@9944ae5`):
  `deck-block` takes the word `deck` itself (K.29), `--mm-gantt-axis-format`
  (M.38); its suite 2101/2101. Downstream against the checkout (symlink,
  run, restore; both git-clean after): orz-mdhtml 153/154, orz-paged
  372/374 — the failures (mdhtml E.1, paged D.1 and P.1: committed examples
  and theme files stamped with the installed 2.3.0) fail the same against
  the round-start kit `b27dc7b`: artifact checks any 2.4.0 checkout trips,
  regenerated at those carriers' next patch. The kit's site bundle
  (`npm run build:web`) is to be rebuilt at the 2.4.0 release.
- The hub (`output/orz-test/slides/engine/`): the 14 decks, the sample, the
  stress decks, sheets and variant sheets regenerated.

---

## Round A2 — 2026-10-13/14 (round A's fixes attacked; rebuild/1.0@6d3aa97)

The same three areas, the auditor given round A's list to break. Of round
A's fixes 4 were NOT fixed (FMT-1, FMT-5, FMT-6, TK-5: each fixed an
instance, not its class); verified: 6 format, 4 engine, 10 themes (one
HIGH: A2-TH-1); 12 LOW. Each fix below is for the CLASS the finding
belongs to.

### Class-level mechanisms introduced

- **One terminator-aware hygiene lint** (`hiddenMarkers`, parse.ts): every
  level-0 block that holds a marker line after its first line is classified
  by how it ENDS — an HTML block of type 6/7 ends at a blank line
  (`marker-in-html`); a construct with a terminator of its own (fences of
  any length and character, containers of any length, `$$` math, HTML
  blocks of types 1–5, an open `<!--`) is `unclosed-*` when never closed,
  closed by a marker's own `-->`, or closed by mistake (a later block of
  its kind after a slide marker; a slide marker in a container or `$$`),
  a warning for a bare fence holding a slide marker (two open fences pair
  up). Its quick fix inserts the construct's OWN closer in the text's line
  ending. Property test: over every construct × LF / CR LF / CR, applying
  the fix removes its lint and makes a marker line a marker.
- **A repair loop that must progress** (`repairHidden`, legacy.ts): repairs
  run before the spelling normalisation (so upgrade is idempotent); a pass
  applies only fixes that cannot interact, must turn each fix's target line
  into a marker (else it is undone and the loop stops, the lint left for the
  author), and the loop is bounded by the marker lines. Notes cite the
  ORIGINAL lines (a line map over removals and insertions).
- **An upgrade oracle aligned by marker** (U.7): 0.x slide j began at the
  j-th `<!-- slide`; each 1.0 slide is compared with the 0.x slide that began
  at its own marker; `marker-in-code` is accepted only for the slide that
  holds the block, and only when no hygiene lint calls it left open; a
  synthetic 0.x corpus of the A2 shapes runs through it.
- **A settle CYCLE** (engine): the 10 s limit counts from the change that
  unsettled a slide, never from when it showed; a queued fit always runs
  before a timeout is written.
- **One readiness set for settle and print**: a theme `<style>` whose
  `@import` loads is marked until its OWN sheet's `load` (Chrome also fires
  one for the empty sheet it replaced); `quiet()` and `buildStaticDeck`
  wait on it; static copies load images eagerly.
- **Lazy speaker copies**: current + next first in one build (a placeholder
  meanwhile), the rest one slide per idle period, nearest first, keyed by
  render, theme and size; the window's first panes in a task of their own.
- **Every cut on paper is visible**: one `.orz-print-cut` notice placed at
  the cut box's (or notes area's) bottom right, the same for boxes and
  notes, and `printHtml().cut` / `notify` name the slides.
- **Background-copy guard** (deck.css): reveal copies a section's classes
  onto its background layer; deck.css restores reveal's geometry and paint
  there and removes its pseudo-elements, and a `bg=` slide's page steps
  aside; the T.14 audit compares every copy's computed style with a bare
  `.slide-background` in every theme — the whole selector class, not the
  one rule.
- **Per-text visual oracle** (T.11): on every stress slide at both ratios,
  no visible text overprints another and no placed `::before`/`::after` text
  lies over a text (rectangles cut to their clipping ancestors; rotated text
  and tightly set lines tolerated); cover chrome contrast against its own
  surface (T.10); no template page clipped.
- **Palettes for every reader**: T.6 and the build contract check ΔE ≥ 18
  pairwise and ≥ 10 under protan, deutan and tritan simulation (Machado
  2009); ten themes' palettes re-picked with the least change that reaches
  it (Orchard gets its own six, over light-neat-3's); the kit (M.39) extends
  any palette past its end with the tint or shade furthest from every colour
  before it.
- **A gantt that reads at slide size** (kit M.40): `--mm-gantt-axis-format:
  auto` (format by span, tick interval by width), gantt text at
  `--mm-font-size`, `--mm-gantt-today: off`; the deck sets both.
- **A contract that checks values** (T.13): resolved token values, contrast,
  palette ΔE incl. CVD, variant rules per compound (`:is()` expanded),
  footer-wrap by specificity, title band overflow.
- **Fit search**: a log-space secant that learns the content's exponent.

### Found and fixed

Every probe failed on rebuild/1.0@6d3aa97 (format and kit probes run against
the round-start `src/`; the real-Chrome probes against the round-start
engine and themes) and passes now.

| Id | Sev | Finding | Fix | Probe (claim) |
|---|---|---|---|---|
| FMT-1 (not fixed) / A2-FMT-1 | MED | HTML blocks of types 1–5 and an open comment: the blank-line fix never took; upgrade added 50 blank lines and 51 notes; a closed `<pre>` got false errors | terminator-aware classification; `unclosed-html` with the tag's own closer; the loop must progress | P.13, U.6 |
| FMT-5 (not fixed) / A2-FMT-2 | MED | a fence or container closed by a LATER slide's block hid the slides between (notes on screen), no lint; the oracle accepted it deck-wide | closed-by-mistake rule; bare-fence pairing a warning with the fix; the oracle aligned by marker | P.13, U.6, U.7 |
| A2-FMT-3 | MED | `::::` containers: the fix inserted `:::`, upgrade added 50 lines | the opener's own markup as the closer | P.13, U.6 |
| A2-FMT-4 | MED | an unclosed `$$` swallowed the rest of the deck silently | `unclosed-math` (a `$$` block holding a slide marker is never closed on purpose) | P.13, U.6 |
| FMT-6 (not fixed) / A2-FMT-5 | MED (rare) | spaced `/` inside nested braces upgraded to `bad-split` | squeezed at every depth | U.6, U.7 |
| A2-FMT-6 | MED (rare) | `@notes:private`, `@notes(speaker)`, `@notes!` showed private notes on the slide, no lint | anything 0.x read after the name is the marker (`marker-punctuation`); upgrade writes `@notes` | P.13, U.6 |
| A2-FMT-7 | LOW (rare) | upgrade read slide-marker `key = value` 0.x never read; `fit=shrink` became an error | `=` squeezed only in float markers; a `fit=` value 0.x ignored dropped with a note | U.6, U.7 |
| A2-FMT-8 | LOW (rare) | upgrade not idempotent (normalised before repairing; a batched fix landed inside a fence) | repair first; only non-interacting fixes per pass | U.6 |
| A2-FMT-9 | LOW | quick fixes inserted LF into CR LF / CR texts | the line ending before the insertion | P.13, U.6 |
| A2-ENG-1 | MED | any refit 10 s into a slide said `timeout` at once, with the stale scale | the settle cycle | F.6 |
| A2-ENG-2 | MED (rare) | settle and print did not wait for a theme `<style>`'s `@import`: print cut 3 slides silently on a slow network | the style readiness mark; print waits | F.6 |
| A2-ENG-3 | MED | the speaker view froze the page 1–8 s (whole-deck static build) | lazy copies; placeholder; longest task 379–530 ms on 80 chart slides | K.9 (long-task bound) |
| A2-ENG-4 | MED | print cut `fit=scroll` / `fit=off` slides with nothing on the page | `.orz-print-cut` on every cut, the cut list, `notify` | Q.4 |
| A2-ENG-5 | LOW | a `loading="lazy"` image never loaded off screen: 10 s wait, box overflowing | eager images in static copies | Q.4 |
| A2-ENG-6 | LOW | F.7's "≤ 6 trials" exceeded (7–8) | secant fit (stress deck ≤ 5); F.7 restated to the measured bound ≤ 8 over EVERY box of the sample and stress decks | F.7 |
| A2-ENG-7 | LOW (rare) | autoplay media played off their slide and in the speaker's copy | `data-autoplay` on screen; still media in copies | K.9 |
| A2-TH-1 | HIGH | `bg=` showed only on the first slide (deck.css's `.orz-slide` matched reveal's background copies; five themes' pages covered it) | background-copy guard; the bg= page transparent | T.14 |
| A2-TH-2 | MED | section v3/v4 reset the room for the section number (Small Press, Preprint) | no padding shorthand; `--sl-sec-indent` | T.11 (overprint oracle) |
| A2-TH-3 | MED | closing v2 chrome invisible on its own surface (Architect, Nocturne 1:1; Sticker 1.93) | `--sl-cover-chrome-ink` on a theme's own chrome surfaces | T.10 |
| A2-TH-4 | MED | Nocturne: the footer ran under the section indicator | the status bar is one flex row | T.11 |
| TK-5 (not fixed) / A2-TH-7 | MED / LOW | a 10-slice pie repeated colours (A = G …) | kit M.39: extra colours chosen apart from every colour before | T.6, M.39 |
| A2-TH-8 | MED | four palettes merged for deutan readers (ΔE 1.0–1.9), more for protan | palettes re-picked (ΔE ≥ 10 under protan, deutan, tritan); checked in T.6 and the build contract | T.6, T.13 |
| A2-TH-6 | MED (UPSTREAM) | gantt: fixed axis overprinted on semester spans, years dropped, text 10–11 px, today line | kit M.40 (`auto`, sizes, `--mm-gantt-today`); the deck sets them | T.6, M.40 |
| A2-TH-9 | MED | Notebook: the line pad pushed a row to 0.995, which then dropped the pad while saying `1` | a box that reports scale 1 is padded onto the lines; else it says it is scaled | T.12 |
| A2-TH-10 | MED | Notebook outline could not shrink (fixed px line height): items cut | the outline's pitch scales with fit | T.11 (no template clipped) |
| A2-TH-11 | MED | Architect title v6: `max-width: none` put the tick past the box; the page fell to the floor, falsely clipped | `--sl-title-edge`; the title block in flow on v4/v6 | T.11 |
| A2-TH-5 | LOW | Architect cover variants: bright grid over the cover ink; v5 not low | grid, frame and scale bar in the cover's ink; v5 low | T.10 (sheets reviewed) |
| A2-TH-12 | LOW (rare) | Architect title v4 at 4:3: PREPARED BY over a long subtitle | the title block in flow on v4/v6, above the scale bar | T.11 |
| A2-TH-13 | LOW | an ellipsized footer's full text was nowhere | `title` on the footer; `data-clipped` when cut | T.11 |
| A2-TH-14 | LOW | the build contract checked presence only | the value contract above | T.13 |

### Class siblings found while fixing

- **A refit loop the old timeout hid**: Stationery's chart slide never
  settled — its chart frames jitter by 1 px (Chart.js resize ↔ layout) and
  every jitter refit; round A's per-slide 10 s clock ended it as `timeout`,
  which the A2-ENG-1 cycle (rightly) no longer does. Now a resize refit that
  changes nothing, twice in a row, ends the resize watch for the cycle (a
  font, an image, a drawing, a theme or the slide shown again watch again),
  and the timeout keeps a hard bound (a queued fit gets 2 s of grace). F.6
  probe on that slide.
- **Chrome's `load` for a replaced sheet**: a `<style>` appended empty and
  then filled fires `load` twice; the readiness mark ends only on its own
  sheet's.
- **The overprint oracle's own traps** (fixed in the oracle, each checked
  against a screenshot): a pseudo-element's containing block is its nearest
  positioned ancestor (Paper's numeral), a rotated text's rectangle is its
  bounding box (Sticker's title), tightly set big type's font boxes touch.
- **Architect's scale bar** under the title block once the block is in flow
  (4:3): the bar gives the block its corner on v4 and v6.
- **Notebook's outline title and gap** scale with fit like its items.

### Dismissed (with reasons)

- **A2-FMT-2's "bare fences pairing up should be an error"**: two fences
  with no info string, the first left open, are the same text as a closed
  fence that shows a slide marker on purpose (the documented use) — the
  parse cannot tell; a WARNING with the same fix (and upgrade applies it:
  0.x split there) is the honest form. An info string marks the purpose.
- **A2-ENG-6's "≤ 6 trials"**: no search that verifies its answer to 0.01
  over [0.6, 1] can promise 6 for every content (bisection alone needs 6
  after the first trial); the claim now states the measured bound over
  every box and the stress deck dropped to ≤ 5.

### Open by choice

- The speaker copies freeze charts at the print pipeline's resolution
  (≥ 2×); a DPR-1 copy for the panes would halve the remaining per-slide
  cost (kit option) — the page no longer freezes, so left.
- An editor lint for a `fit=scroll`/`fit=off` slide that will be cut on
  paper, and for a cut footer (`data-clipped`), belongs to the editing
  modes (step 5/6).
- orz-markdown's own `light-neat-3` palette (and the other kit themes) are
  not checked for colour-blind readers; the slides layer overrides
  Orchard's. A kit-side CVD check is the owner's call for a kit release.
- Gantt charts with a `dateFormat` other than `YYYY-MM-DD` keep Mermaid's
  axis (`auto` reads only that format's dates).

### After round A2

- orz-slides: the full suite once — 18 files, 216 tests (193 after round A;
  23 new probes and tests) — 212 green in the run, the 4 that failed
  (render-slide's two footer-markup expectations, written before the footer
  gained its `title`; Sticker's and Chalk's stress runs: an oracle false
  positive on a transformed label, fixed in the oracle, and a Chart.js load
  that did not arrive) green re-run alone; conformance 45 passed +
  `C.update.from-previous` not applicable; tsc clean; `build-themes --check`
  clean (the value contract included). Every new probe failed on the
  round-start code (format and kit: the round-start `src/`; engine and
  themes: `src/`, `assets/themes/` and `scripts/` of 6d3aa97, with the
  stress oracles on Small Press, Nocturne, Architect and Neon).
- Kit (orz-markdown 2.4.0, prepared, unpublished; `orz-markdown@10b2bc6`):
  M.39 (a palette that never repeats), M.40 (`--mm-gantt-axis-format: auto`,
  gantt type size, `--mm-gantt-today`); its suite 2103 — 2100 in the run,
  the A.2 bundle budget (exceeded by these additions: 1.150 MB) raised to
  1.16 MB with the measurement recorded, two E.13 frame tests green re-run
  alone. Downstream against the checkout (symlink, run, restore; both
  git-clean after): orz-mdhtml 153/154, orz-paged 372/374 — the same stale
  example and theme-file checks as round A (mdhtml E.1, paged D.1, P.1).
- The hub (`output/orz-test/slides/engine/`): the 14 decks, the sample,
  the stress decks (with the A2 shapes) and every sheet and variant sheet
  regenerated; the variant sheets of Architect, Small Press and Nocturne,
  the gantt, pie and `bg=` slides looked at.


---

## Round A3 — 2026-10-14 (round A2's fixes attacked; rebuild/1.0@a9f4ab3)

The same three areas, the auditor given round A2's list to break. Of A2's
fixes, A2-ENG-2 (the theme-CHANGE path) and A2-TH-12 (v1, v2, v5) were NOT
fixed; every other confirmed. Verified: 4 format (all rare or LOW), 5 engine
(one HIGH: A3-ENG-1), 6 themes (one HIGH: A3-TH-1); 3 LOW.

**The format area is CLOSED by this pass** (owner's stop rule: its findings
were only rare combinations or LOW — a final pass, fixed with tests, no
further round). Engine and themes had a HIGH each and go to the next round
of the plan (round B after step 6).

### Class-level mechanisms introduced

- **Hidden markers by token nesting** (format): a container's closer is the
  line after its token's map (the kit leaves it out) and its own marker
  lines are those outside the code blocks nested in it; a type-1 HTML block
  (`<pre>`, `<script>`, `<style>`, `<textarea>`) closed by ANOTHER raw-text
  tag, or holding another raw-text opener after a slide marker, was closed
  by mistake; a comment holding a marker line was always closed by a
  marker (a multi-line one included).
- **Quick fixes that commute** (format): a lint that only follows from an
  earlier block closed by mistake or ambiguously (a block of its kind opened
  after that block's closing line, before the next marker) and a type-6/7
  HTML block's later marker lines carry no fix — so the fixes, applied in
  any order, reach one deck. Property test: 600 random decks of every
  construct × LF / CR LF / CR, first-first, last-first and random order.
- **Upgrade leaves format 1 alone**: repairs and respellings run only on a
  0.x text (no header, or a legacy meta header).
- **A tighter upgrade oracle** (U.7): `marker-in-code` is accepted only for a
  block that can show a marker (fence, indented code, plugin block, list,
  blockquote) — never an HTML block, `$$` or a container, where "no lint"
  is a gap in the lint.
- **A resize watch that never stops** (engine): a resize refit the fit
  decides the same (every box within 0.01, the same clipping: hysteresis)
  leaves the slide as it was (settled stays settled); after two in a row the
  next resize refit waits 250 ms — debounced, never dropped; a capture
  `toggle` listener refits a `<details>` / `::: spoil` at once.
- **One sizing contract for a chart** (engine): its canvas keeps the CHART's
  aspect ratio in CSS (set by the engine from Chart.js), so the frame's size
  depends on its width alone and Chart.js's resize finds nothing to change.
- **Readiness read from the sheet, waits bounded once** (engine): a theme
  `<style>` is loading while its own sheet has an `@import` whose
  `styleSheet` is null (a failed one has a sheet); a theme change replaces
  the element; a mark, or fonts that keep loading, are waited for at most
  5 s per load — never per slide, print or copy — and the slide refits when
  they arrive.
- **Static copies hold no live media** (engine): a `{{youtube}}` player is a
  still of the same size with its address in print and the speaker view.
- **Pictures by a mark, not by a selector** (themes): `p.orz-pic` (one image,
  or one linked image, and nothing else) is the one hook for picture
  layout; the build contract refuses any rule that sets a paragraph's
  metrics or layout by the image it holds (`p:has(> img)`, `p > img`).
- **No placed block over content** (themes): Architect's title block in
  flow on every title variant, its scale bar in a band of its own; the T.11
  oracle gained an occlusion check (an opaque box above any text line,
  `elementsFromPoint`) and compares two lines of one paragraph.
- **Hide a section part only when it is empty** (themes): `section_numbers`
  decides the number, never the title.
- **The kit's extension colours for every reader** (orz-markdown M.39) and
  **a gantt axis of continuous intervals** with label thinning (M.40).

### Found and fixed

Every probe failed on rebuild/1.0@a9f4ab3 (format probes against the
round-start `src/`; engine and theme probes against the round-start engine
and themes; kit probes against `orz-markdown@10b2bc6`) and passes now.

| Id | Sev | Finding | Fix | Probe (claim) |
|---|---|---|---|---|
| A3-FMT-1 | MED (rare) | a closed container whose fenced example shows a marker was a false `unclosed-container`; its fix broke the example | the container's closer after its map; code nested in it is not its own | P.13 |
| A3-FMT-2 | MED (rare) | `<pre>` left open, closed by a later `<style>`/`<pre>`/`<textarea>`: slides swallowed, notes on screen, no lint; the oracle accepted it | a type-1 block closed by another tag (or reopened) after a marker is closed by mistake; the oracle never accepts an HTML block | P.13, U.7 |
| A3-FMT-3 | LOW | quick fixes did not commute: fixing the consequence first left an empty code or `$$` block | consequence lints carry no fix (also a type-6/7 block's later markers); order property | P.13 |
| A3-FMT-4 | MED (rare) | an open comment closed by a multi-line marker's `-->`: the marker swallowed silently | a comment holding a marker line was closed by a marker | P.13, U.7 |
| A3-FMT-5 | LOW (rare) | `upgradeText` repaired correct format-1 texts | repairs and respellings only for 0.x texts | U.4 |
| A3-ENG-1 | HIGH | after two no-op refits the resize watch was muted: a spoiler opened later was cut, never refitted | the watch never stops (hysteresis, debounce); `toggle` refits | F.6 |
| A2-ENG-2 (not fixed) / A3-ENG-2 | MED (rare) | on a theme CHANGE the replaced sheet's `load` ended the `@import` wait: print cut 3 slides | readiness from the sheet; the element replaced | F.6 |
| A3-ENG-3 | MED | chart canvases resized 520 ↔ 521 px forever: 10–18 % of an idle main thread (75 % at 4×) | the chart's aspect ratio on the canvas | F.6 (idle: 0 resizes / 3 s, < 4 % CPU) |
| A3-ENG-4 | MED (rare) | a stalled webfont request cost 10 s per slide, print and speaker copy | waits bounded once per load (5 s); refit on arrival | F.6 |
| A3-ENG-5 | MED | `{{youtube}}` under a title clipped at the floor; in print a blank frame, a false cut, no address; players reloaded by every copy | sized like a picture (container units); a still with the address in static copies | Q.4 |
| A3-TH-1 | HIGH | five themes set `line-height: 0` on any paragraph holding an image: an inline icon or a caption above its picture printed lines over each other | `p.orz-pic`; every picture rule retargeted (Architect, Chalk, Neon, Notebook, Paper, Sticker, Inscription, deck.css); contract rule | T.11, T.13 |
| A2-TH-12 (not fixed) / A3-TH-5 | MED (rare) | Architect's PREPARED BY block covered a long subtitle on v1, v2, v5 at 4:3; the SCALE label under the meta | the title block in flow on every variant, clear of the scale bar | T.11 (occlusion oracle) |
| A3-TH-2 | MED (UPSTREAM, ours) | the `auto` gantt axis restarted day steps each month and collapsed 24/60-month steps: overprinted full-width semester and 12-year charts; no year across New Year | kit M.40: continuous intervals, thinned labels, the year on crossing spans | M.40, T.6 |
| A3-TH-3 | MED (UPSTREAM, ours) | the palette extension merged slices for colour-blind readers (ΔE 0.8 deutan) in five themes | kit M.39: candidates scored under protan, deutan, tritan | M.39, T.6 |
| A3-TH-4 | MED | `section_numbers: none` hid the section title (Nocturne, Neon, Paper, Small Press; Copper the same) | hide only when `:empty`; drop just the number | C.1 |
| A3-TH-6 | MED (rare) | `bg=` never showed on a cover page (the cover's inset shadow) | the author's background replaces the cover colour | T.14 |
| A3-TH-7 | LOW (rare) | a gradient `bg=` drew nothing on screen | `data-background-gradient`; print and speaker copies too | E.2, T.14 |
| A3-TH-8 | LOW | Nocturne capped the section at 40 % beside a short footer | footer and section sized by their text, shrinking in proportion | T.11 |

### Class siblings found while fixing

- **Every picture rule, not just line-height 0**: Architect's `p > img {
  display: block }` and Sticker's sticker frame on `p > img` reached an
  inline icon too, as did deck.css's own picture layout (`p:has(> img:only-
  child)` matched a sentence whose only element was an icon) and Chalk's
  region padding (`:has(> .markdown-body > p > img)`); Inscription's outline
  on `p > img`. All on `p.orz-pic`; cosmetic `p > img` rules (radius,
  shadow off) stay.
- **Copper** hid the section title with `section_numbers: none` too (not in
  the finding); fixed with the others. Neon's readout shows the title (with
  its `SEC` label) when there is no number to show.
- **A gradient `bg=` was also cut by A2's background-copy guard**: reveal
  sets the gradient as an inline `background-image` on the background copy,
  which the guard reset with `!important`; the reset now spares an inline
  image.
- **The speaker's live fallback** (when a static build fails) drew neither
  a gradient nor an image background and loaded a video player: it uses the
  same still and backgrounds as the static copies.
- **The fit oracle measured a closed `<details>`'s text** (rectangles all
  the same): it is skipped, and so in the new occlusion oracle.
- **Round A's FMT-1 test expected a fix on every marker line of one HTML
  block**; under the commute rule only the first carries one (the others
  follow from it) — the test now applies fixes one at a time and reaches
  the same deck.

### Dismissed (with reasons)

- **A3-FMT-2's "treat every `<pre>`/`<script>`/`<style>` holding a slide
  marker as closed by mistake"**: a `<pre>` closed by its own `</pre>` that
  holds a marker is the A2-FMT-1 case closed on purpose (round A2 decided it
  is no error); only a closer of ANOTHER tag, or another raw-text opener
  after a slide marker, is the mistake CommonMark makes possible. Both are
  fixed; the same-tag case keeps A2's decision.
- **A3-ENG-4's "remember the element as failed for the session"**: a slow
  font that DOES arrive must still be fitted with; the bound is per load
  (5 s from the mark, from the first time the fonts were seen loading), and
  the arrival refits. A stalled request is therefore paid once, as asked.

### Open by choice

- Speaker copies' background build (A3 improvement): skip it during a
  reveal transition and use idle time without the 500 ms timeout — a cost
  measured only at 4× CPU on a 100-chart deck; step 5/6 (editing modes)
  revisits the copies.
- Greyscale print of the categorical palettes (A3 improvement): a print-only
  fallback (dashes or patterns) is a kit option for a later release.
- The kit's md/paged content themes do not yet set `--mm-gantt-axis-format:
  auto` and `--mm-gantt-today: off` (A3 improvement): a kit default for
  documents is the owner's call at the 2.4.0 release.
- A `bg=` on a cover page keeps the cover ink: its contrast against an
  author's image cannot be checked; the author chose both.

### The oracles' own traps (fixed in the oracles, each checked against a screenshot)

- Chrome gives an ellipsized nowrap line's range TWO rectangles (one cut
  short): a text that cannot wrap is one line.
- A tall font's boxes reach past a tight pitch (Notebook's handwriting: 92 px
  boxes on a 66 px pitch): two lines of one element overprint only when one
  stands on the other (tops closer than half a box — line-height 0).
- Reveal's background fade: the probes measure with transitions off.

### After round A3

- orz-slides: the full suite once — 18 files, 236 tests (216 after round
  A2; 20 new probes) — 222 green in the run; the 14 per-theme stress runs
  (one file) failed on the oracle traps above and a probe that matched the
  wrong "Thank you" slide, all green re-run alone after the oracle fixes;
  conformance 45 passed + `C.update.from-previous` not applicable; tsc
  clean; `build-themes --check` clean (with the A3-TH-1 contract rule).
  Every new probe failed on the round-start code (format: `src/` of
  a9f4ab3; engine: `src/present` and deck.css of a9f4ab3; themes:
  `assets/themes`, `render-slide.ts`, `decorate.ts` and `build-themes.ts`
  of a9f4ab3; kit: `orz-markdown@10b2bc6`).
- Kit (orz-markdown 2.4.0, prepared, unpublished; `orz-markdown@dc301f7`):
  M.39 (extension colours apart for colour-blind readers), M.40 (continuous
  gantt intervals, label thinning, the year across New Year); its suite
  2105/2105 (2 new probes). Downstream against the checkout (symlink, run,
  restore; both git-clean after): orz-paged 372/374 — D.1 and P.1, the stale
  committed examples and theme files of round A/A2; orz-mdhtml 152/154 —
  E.1 (the same stale example) and X.1 (the example web app's page load
  times out against ANY 2.4.0 checkout: it fails the same against the
  round-start kit 10b2bc6 and passes on the installed 2.3.0).
- The hub (`output/orz-test/slides/engine/`): the 14 decks, the sample, the
  stress decks (with the A3 shapes) and every sheet and variant sheet
  regenerated; Architect's variant sheet (the title block in flow beside
  the scale bar) and Chalk's picture frame looked at.


---

## Round A4 — 2026-10-14 (round A3's fixes attacked; rebuild/1.0@ab85c1e)

Two areas (engine, themes); the format area closed at A3. The auditor got
round A3's list to break. Of A3's fixes, two were **not fixed**:
A3-ENG-3 (the chart aspect reached only the CURRENT slide) and A3-TH-8 (the
status-bar fix cut a SHORT footer). All the others were confirmed. Verified:
2 engine and 4 themes, all MEDIUM, **no HIGH**. LOW: 3 engine, 3 themes.

**Round A is CLOSED by this pass** (owner's stop rule: a round without a
HIGH ends with one closing fix pass, with tests, and no further review
round). Engine and themes are looked at again in round B (after step 6).

### Class-level mechanisms introduced

- **A chart is sized like a picture** (engine): a chart that is a block of
  its own in a region sits in a room (`div.orz-chart-room`, decorate.ts).
  The room grows into the space its box leaves (it shrinks before text is
  scaled) and is the size container of the largest chart at its aspect;
  the frame hugs the chart, so a theme's panel is the chart's size
  (Architect and Notebook declare their frame padding,
  `--orz-chart-pad-x/-y`). A frozen chart (an img in print and the
  speaker's copies) follows its frame the same way.
- **A chart's aspect for every slide reveal displays** (engine): every
  canvas has the chart's aspect in CSS from the start
  (`var(--orz-chart-r, var(--chart-aspect))`); the engine sets the
  chart's own ratio over the whole deck after enhancement and on every
  slide change (`chartAspects` moved to decorate.ts).
- **Every wait on the network is bounded once per load** (engine): a
  `<link>` stylesheet that never answers counts as failed 5 s after it was
  first seen loading, like the theme imports and fonts of A3.
- **A room is no frame** (engine): a video's room carries no theme
  decoration (no pillar-box bars); the player keeps its corners.
- **Room shared fairly** (themes): Nocturne's status bar is a grid whose
  footer and section tracks grow in equal steps, so the short text stays
  whole and the long one takes the rest.
- **Images inline by default in running text** (kit M.42): an image in a
  link, a list item or a table cell stays in its line; only a raw `<img>`
  of its own is a block.
- **A number that is not there is not drawn** (themes): deck.css hides an
  empty `.orz-section-main::before` in every theme. A theme whose number is
  its `::after` (Notebook) guards it itself, and the build contract checks
  this.
- **Pictures in containers and in rows** (themes): `p.orz-pics` (two or
  more images and nothing else) is a row that shares the room left. Any
  other picture, including a picture paragraph inside a container, is
  capped at 12em, so fit's scale reaches it.
- **A tighter picture contract** (themes, A4-TH-5): a rule that reaches a
  paragraph by its image may set only cosmetic properties. It is exempt
  only when one of its own compounds is the picture mark (`:not(.orz-pic)`
  no longer exempts it). `img` is read in any case, and `[src]` counts too.
  A rule that makes every image a block is refused.
- **Offline tests are offline in every frame** (STATUS D-63): every Chrome
  launch in the tests resolves no host but the loopback
  (`--host-resolver-rules`, `OFFLINE_ARGS` in tests/helpers.ts; the
  conformance launch too), unless it says `online: true`. Only the files
  whose decks load the pinned CDN libraries on purpose do: engine, settle,
  themes-look, themes-stress, and the hub script.

### Found and fixed

Every probe failed on rebuild/1.0@ab85c1e, with the kit probes on
`orz-markdown@dc301f7`, and passes now.

| Id | Sev | Finding | Fix | Probe (claim) |
|---|---|---|---|---|
| A3-ENG-3 (not fixed) / A4-ENG-1 | MED | the slides reveal displays beside a chart slide still resized their canvases 520 ↔ 521 px forever (up to 33 % CPU idle) | the aspect in CSS for every canvas; `chartAspects` over the deck | F.6 (idle on the slides BEFORE a chart slide) |
| A4-ENG-2 | MED | a chart in a quad cell could never fit (em-sized, at the floor still taller than the cell): cut on screen and on paper, in every chart type | the chart room | K.7, Q.4 (8 types × quad/3col/2col/alone, 16:9 and 4:3, Orchard + Architect + Notebook, print cut `[]`) |
| A3-TH-8 (not fixed) / A4-TH-1 | MED | Nocturne cut a short footer ('CHEM 512' → 'C…') beside a long section title | the fair grid | T.11 |
| A4-TH-2 | MED (UPSTREAM, ours) | the kit's `common.css` made an image in a link, list item or cell a block: a linked icon broke its sentence into three lines (10 slide themes, every document theme) | kit M.42: `:is(p, a, li, td, th) > img` inline | T.11; kit M.42 (common.css + all 12 document themes) |
| A4-TH-3 | MED | `section_numbers: none` left an empty number badge on the section pages (Sky, Stationery, Notebook, Sticker, Chalk, Architect, Small Press) | deck.css hides an empty `::before`; Notebook its `::after`; contract | C.1, T.13 |
| A4-TH-4 | MED | a photo in a callout, quote, list or cell, and two side by side, were cut by a third (fit at the 0.6 floor) | `p.orz-pics` row; 12em cap for any other picture, nested picture paragraphs included | F.3, T.11 (every theme at 16:9, three at 4:3) |
| A4-ENG-3 | LOW (rare) | a stalled `<link>` stylesheet (KaTeX's CSS) held every slide's settle to the 10 s limit | bounded once per load, 5 s from first seen | F.6 |
| A4-ENG-4 | LOW (UPSTREAM) | `type: polarArea` drew nothing: the kit lower-cased it | kit M.41: Chart.js's names kept in any case; `data-chart-error` when Chart.js refuses a chart | K.7; kit M.41 |
| A4-ENG-5 | LOW | a video's room kept the theme's frame beside a narrower player | the room is undecorated | Q.4 |
| A4-TH-5 | LOW (rare) | the picture contract let other properties, `:not(.orz-pic)`, `[src]`, `IMG` and an all-images block rule through | the tighter contract | T.13 |

### Class siblings found while fixing

- **Theme picture rules reached nested picture paragraphs**: Sticker's and
  Architect's `p.orz-pic` sizing (`max-height: 100%` of an auto height)
  matched a picture paragraph inside a callout, quote or loose list item,
  which overrode a plain cap. The cap now also targets those paragraphs.
- **Notebook's chart slip** targeted a chart frame that is a direct child.
  It now also reaches the frame in its room.
- **A static copy's frozen chart** (an img carrying Chart.js's pixel width)
  did not follow its frame. It now does, in every container.
- **The kit's preview frame** swallowed a refused chart the same way as
  `enhanceDocument` did. Both now set `data-chart-error`.

### Dismissed or open by choice (with reasons)

- **A4-TH-6** (LOW, rare; the T.11 occlusion oracle cannot see an opaque
  `::before`/`::after` box over text): open by choice. A pseudo box cannot
  be hit-tested. Painting it means re-deriving the stacking order of
  pseudos (z-index, stacking contexts) from computed styles, and every
  theme draws its decoration that way, so a naive check flags decorations
  that sit behind text. No current theme is known to cover text with a
  pseudo: the A3 screenshots and the hub sheets were looked at. A
  screenshot-difference oracle is the real fix and belongs to round B.
- **A4-TH-7** (LOW, UPSTREAM, rare; in document theme dark-elegant-3 the
  12th extension colour is ΔE 9.3 from the 9th for a tritan reader):
  open by choice. M.39 binds ten categories (ΔE ≥ 10 for every reader),
  and this case holds through eleven; the twelfth is best effort. No slide
  theme is affected (all at 11.7 or more). Widening the candidates would
  change every document theme's extension colours at the 2.4.0 release, so
  that is the owner's call.
- **Improvements** (not findings): a notice when print goes ahead after a
  bounded wait expired (the 5 s cap stays registered, and a notice belongs
  with step 5/6's notify work); Architect's 4:3 SCALE label touching the
  title block (polish, round B); a quad-of-charts slide in the stress deck
  (covered instead by the A4-ENG-2 probe in three themes).
- **Side-by-side pictures (`p.orz-pics`) take no theme frame** (Sticker's
  sticker border, Architect's VIEW label): the themes frame a single
  picture. A row is plain until a theme designs one (round B).

### Round A — closing summary (rounds A–A4)

| Round | Base | Verified findings (HIGH) | LOW | A previous round's fix not fixed | Fixed in the round |
|---|---|---|---|---|---|
| A | 817de2e | 19 (2: FMT-2, ENG-1) | 8 | — | all 19 verified; LOWs per its table |
| A2 | 6d3aa97 | 20 (1: A2-TH-1) | 12 | 4 (FMT-1, FMT-5, FMT-6, TK-5) | all 20 and the 4, each as a class |
| A3 | a9f4ab3 | 15 (2: A3-ENG-1, A3-TH-1) | 3 | 2 (A2-ENG-2, A2-TH-12) | all 15 and the 2; the format area closed |
| A4 | ab85c1e | 6 (0) | 6 | 2 (A3-ENG-3, A3-TH-8) | all 6, the 2, and 4 of 6 LOWs (A4-TH-6, A4-TH-7 open by choice) |

The finding count fell from 27 to 6 plus 6 LOW, and the HIGHs from 2 to 0.
Each round's not-fixed items were partial fixes of a class, and each was
fixed as a class in the next round. **Round A is CLOSED.**

Open by choice when round A closed (consolidated; details in each round's
entry):

- The speaker copies' DPR-1 build and their background-build scheduling
  (rounds A2, A3).
- The editor lints for `fit=scroll`/`fit=off` cut on paper and for a cut
  footer (step 5/6).
- Kit-side CVD checks for the kit's own themes, the document defaults for
  the gantt tokens, and the twelfth extension colour (A4-TH-7): the owner
  decides these at the 2.4.0 release.
- Gantt charts with another `dateFormat` keep Mermaid's axis.
- A greyscale print fallback for the palettes (a kit option).
- The 5 s once-per-load bound on theme webfonts and stylesheets (print made
  inside it may be cut); a notice is an improvement for step 5/6.
- The pseudo-element occlusion oracle (A4-TH-6) and picture-row frames:
  round B.

### After the closing pass

- orz-slides: the full suite once: 18 files, 245/245 green in the run
  (236 after round A3, plus 9 new probes), conformance included; tsc
  clean; `build-themes --check` clean (with the A4 contract rules). Every
  new probe failed on ab85c1e.
- Kit (orz-markdown 2.4.0, prepared, unpublished; `orz-markdown@0f32c73`):
  M.41 and M.42. Its suite: 2108 tests, 2107 green in the run; the one
  failure, E.16 (an editor pacing timing test), was green when its file was
  re-run alone (131/131). Downstream against the checkout (symlink, run,
  restore; both git-clean after, and orz-paged's pretest-regenerated theme
  files restored): orz-paged 373/374 and orz-mdhtml 153/154. Each failed
  only its stale committed example (paged D.1, mdhtml E.1), as in rounds
  A–A3.
- Commits: `orz-slides@ac91d57` (D-63, the offline launches),
  `orz-slides@1f63776` (the fixes and probes) and the record.
- The hub (`output/orz-test/slides/engine/`): the 14 decks, the stress
  decks and every sheet and variant sheet regenerated. Looked at:
  Architect's and Notebook's chart panel in its room (sample slide 8) and
  Nocturne's status bar. Also screenshots of section pages with
  `section_numbers: none` (Sticker, Architect, Sky, Small Press), a quad
  of charts (Nocturne, Notebook, Paper; polarArea drawn), and pictures
  side by side, in a callout and as icons (Orchard, Sticker).

### After round A: step 5 took two open-by-choice items

- The editor lints for a slide cut on paper and a cut footer
  (`cut-on-paper`, `footer-cut`): from the live view's fit reports in the
  whole-deck editor (claims W.4, W.5).
- A notice when print goes ahead after the 5 s bounded wait for webfonts
  and stylesheets: `printHtml().cut.fontsLate` and the reader's line
  (claim Q.5; a font that FAILED, offline, is no late one).

---

## Round B — 2026-10-14 (after step 6; rebuild/1.0@6accc1f, kit orz-markdown@6cdf16e)

Audit in four areas — the layout ops and text safety, the whole-deck editor
and saving, the layout GUI's usability, preview isolation — each finding
reproduced by a verifier who re-rated it. Verified: 6 ops, 4 editor, 7 GUI
(one HIGH after verification: OPS-2); LOW: 4 ops, 1 editor, 6 GUI, 3
isolation. Owner decision 6 (intuitive and comprehensive) weighed the GUI
items; the coordinator's step-6 decisions applied (schematic thumbnails,
floats and options on template slides, three-track ratios simple, float
em/px/right/bottom kept until the reader changes that axis).

### Found and fixed

Every probe below failed on rebuild/1.0@6accc1f (the pure probes in place
before the fix; the Chrome probes in a 6accc1f worktree with the new tests)
and passes now.

| Id | Sev | Finding | Fix | Probe (claim) |
|---|---|---|---|---|
| OPS-2 | HIGH | a run of arrow keys (a divider, a float) was written to whatever slide was current when it committed: Page Down sent it to the next slide | every deferred write (key runs, divider/float/tag/slide drags) binds its slide and its text at the start; it is written there before any navigation (Page Up/Down, the filmstrip, a caret move to another slide), undo or mode switch, and dropped when the text changed under it | L.12 |
| OPS-1 | MED (rare) | an op wrote a region marker right after a float's raw-HTML body (`<img>`, `<div>`): the slide got blocked and the next typing landed in the title | check() refuses any new blocking problem (deck-level marker-in-html / unclosed-*) and compares every float's text and geometry and the slide's options; a region marker is never anchored inside or right after a float's, the notes' or the footer's body; the GUI focuses the editor only where an op put the caret | L.6 (and the L.6 generator: floats before region markers with raw-HTML bodies) |
| OPS-3 | MED | floats in em, without a size or anchored right/bottom jumped to a default box on their first nudge; a one-axis nudge rewrote the other axis | a move writes only the axes it moves, in the text's units (px stays px) and anchors (right/bottom stay); an em axis starts from the box the reader sees (`from`), else the op is refused with the reason | L.3, L.9 |
| OPS-4 | MED | a divider of a 3+ track split wrote 2/8/5, 4/15/5 … | `snapTracks` / `stepTracks`: the whole split in small whole numbers (fr sum ≤ 12), the pair keeping its share so every other divider stays put | L.1, L.8 |
| OPS-5 | LOW (rare) | a refused commit after a drag (read-only) left the frame's preview at the new place | a refused write resets the preview and redraws the stage; read-only hides the handles and dividers and disables the toolbar | L.10 |
| OPS-6 | MED (rare) | a new float went before an author's float placed after notes/footer, and the GUI selected the author's float | a new float goes after the last float; the op names it (`target`) and the GUI selects that one | L.3, L.9 |
| B-ED-1 | MED | after Duplicate (no blank line before the next marker) a float added on the slide before sent the stage to the next slide | an empty box/float with no body line is selected at its marker's end (inside its slide); `run()` pins the caret to the op's slide after every select | L.6, L.9 |
| B-ED-2 | MED | after a header setting, an AI edit or a reload the slides tools' caret was stale (live view, stage, Done on the wrong slide) | the caret is the editor's own: orz-markdown `shell.getSelection()` (FC-19 additive, kit claim E.42) in the change handler, a mapped fallback for an older kit | W.8 |
| B-ED-3 | MED | cut-on-paper / footer-cut covered only the slides shown at the caret, while the panel said "No issues in this deck." | idle fit checks: one unshown slide at a time, rendered off screen in the frame (`orz-slides-check`), after 1.2 s without typing, 120 ms apart, never during a drag or a run of keys, at most 2000 per editor; the panel says "checked on N of M slides" until done; the deck-footer lint names what it has not checked | W.5 |
| B-ED-4 | MED (rare) | typing in the per-slide mode redrew the whole GUI per key (300 slides: p90 114 ms, max 277 ms) | the GUI follows typing at its pause (the stage marked stale meanwhile, nothing on it acting); 300 slides now median 11, p90 13, max 66 ms, no long task | W.7 |
| GUI-1 | MED | region names and fit badges (the red "cut" included) were tucked away at rest at common window sizes | the frame reports the slide's ink (text lines, pictures); each label takes the first place on no ink and no other label (above, inside a top corner, under, inside a bottom corner), else it is tucked — a "cut" badge never is; a cut box is outlined in red (`data-fit`), a shrunk one in blue; the toolbar names every box that does not fit | L.7 (cut slide at 1280 × 800 and 1500 × 900; the sample at 1280 × 800) |
| GUI-2 | LOW | a new float landed on the title band and body text | `placeFloat(existing, size, content)`: the emptiest 2 % grid place (bottom right first) avoiding the stage's ink and floats; with none, offset and the label says it covers content | L.3, L.9 |
| GUI-3 | LOW | clicking the checked preset reset a custom ratio | the preset a slide already has, any sizes, is no change ("drag a divider to change the sizes") | L.2, L.8 |
| GUI-4 | LOW | the stage used ~40 % of its pane (width-bound, 148 px filmstrip) | the filmstrip goes beside the slide or under it (a row), whichever leaves the slide larger; it folds from its own head; 1500 × 900 Split: scale 0.446 → 0.562 | L.7 |
| GUI-5 | MED | outlines below 3 : 1 on every theme (1.7 on dark); dividers invisible until hovered, so not found on touch | the outline takes the slide theme's scheme (a dark dashed line with a light halo on light slides, the reverse on dark), ≥ 3 : 1 on all 14 themes; divider grips drawn at rest (0.55), fully under `hover: none` | L.7 |
| GUI-6 | MED | Architect: PREPARED BY wrapped to two lines over a short meta | the meta has a minimum width, the bar one line | T.11 |
| GUI-7 | LOW | picture rows took no theme frame (round A's open item) | each picture of `p.orz-pics` framed in the seven framing themes; the build contract refuses a theme that frames `p.orz-pic` and not a row | T.11, T.13 |
| OPS-7 | LOW (rare) | Ctrl+Z during a drag did not cancel it; the drop moved the restored float | undo and redo cancel a drag first | L.10 |
| OPS-8 | LOW (rare) | a region starting with indented code was refused as unsafe (the check trimmed its indentation) | the check keeps a first line's indentation (the test oracle had the same bug) | L.6 |
| OPS-9 | LOW (rare) | with a key written twice, z/move ops wrote the first value while the parser read the last | the last value counts when a marker is rewritten | L.3 |
| OPS-10 / GUI-11 | LOW | each op re-tokenised the whole deck (1000 slides: 130–360 ms per op); 300 slides at 4× CPU: 220–399 ms long tasks per op | the DERIVED deck: `parseDeck` of an edit of the last text re-reads only the touched slides alone and moves the rest (P.14 property: equal to a fresh parse on 9000 random edits); `presentationOf` and the fit keys' header part read once per text; idle checks never during drags. 1000 slides, per op (node, op + the deck after it): split 9.9, float-add 4.8, float-geom 2.4, tracks 12.6, slide-move 27.3, duplicate 19.9, delete 14.3, options 16.2 ms; 300 slides at 4× CPU: no long task over 200 ms | L.6, L.10, P.14 |
| GUI-8 | LOW | refusals cut to one line with no way to read the rest | warnings wrap to two lines, the whole text in `title` and a click away | L.12 |
| GUI-9 | LOW | internal words (2col, variant), a "Float" button, an incomplete Keys panel | labels and refusals use the picker's names and "look"; "Add a float"; every key listed (Space, Alt+Shift+Arrows, Enter on a divider, the filmstrip's Home/End/Page/Enter/Delete, ?) | L.2, L.12 |
| GUI-10 | LOW | template thumbnails all alike, their names cut to "Ti…", fit dots only on visited slides | a drawing per template kind, the kind on the second line whole; dots for every slide once the idle checks ran | L.10 |
| GUI-12 | LOW | the toolbar came after every box in the tab order | the toolbar first in the DOM | L.12 |
| GUI-13 | LOW (rare) | Chalk's tape covered a broken picture's alt text | the engine marks `p.orz-pic[data-broken]`; Chalk and Notebook drop their tape | T.11 |
| B-ED-5 | LOW (rare, UPSTREAM) | textarea fallback: This slide dimmed nothing and said nothing | the slide's text brought into view; the GUI says the rest is not dimmed | W.9 |
| ISO-B1 | LOW (rare) | box names reported by the frame became op inputs | boxes named from the text (the frame's rectangles in document order; a count mismatch draws a stale stage) | L.13 |
| ISO-B2 | LOW (rare) | a forged name with a newline threw in `querySelector` | `CSS.escape` | L.13 |
| ISO-B3 | LOW | L.13 / W.4 isolation stated without scope | scoped in L.13, the per-slide seam and the DOM contract: app hosts and served pages; a standalone file from disk is orz-markdown's registered B-2 (not to be "fixed": RULES §9) | L.13 (the app host's sandbox asserted) |

### Class siblings found while fixing

- **The test oracle trimmed like check()**: L.6's own region normaliser
  dropped a first line's indentation (OPS-8's bug in the oracle).
- **Every frame-reported name** — fit badges were matched to boxes by the
  frame's name too: now by document order with the text's names.
- **A stale-stage click**: a stale stage's boxes no longer take the pointer
  (a quick click after an op or while typing acted on the last report).
- **The cursor mark** used the engine's offsets (LF, no BOM) against the
  text's: now `shell.getSelection()` (exact offsets).
- **Popovers** (options, swap, move, rename) close when the slide changes:
  their choices were the last slide's.
- **The derived deck's first cut** let an edit that unmakes a slide's own
  marker keep the slide before it unchanged; the P.14 property caught it on
  its first run (now: an edit inside a marker re-reads the slide before).

### Open by choice (with reasons)

- **Root family docs** (`docs/REBUILD.md`, STATUS, CONTRACTS FC-19 for
  `getSelection`) are the coordinator's to record.
- **The kit's `readDocument` still tokenises the whole deck** for the lints
  (once per typing pause, ~25 ms at 300 slides): it is off the op path and
  within W.7's budget; a kit option to take a derived deck is a 2.4.x item.
- Improvements not taken: the occlusion oracle as a standing theme test over
  every theme × template (GUI-6's probe checks the case found; T.11's
  existing checks stand), "Move to slide N…" for far moves, a negative test
  for messages from other windows (the kit's `e.source` check covers it, by
  reading).

### Owner decisions taken into the round (2026-10-14)

- **Notebook's ruling is a background** (T.12 rewritten): the rules and the
  margin line are the slide's own background, the same on every slide; no
  text is aligned to them any more. Gone: the source's screen notebook in
  the derivation (`SCREEN_GRID` empty), the region grid alignment and the
  "onto the slide's next line" padding (src/present/grid.ts deleted), fit's
  re-alignment at each trial scale (`fitBox`/`fitSlide` lost their
  `prepare` hook), the ruled sheet of a shrunk region. Slips, notes and
  taped pictures stay as decoration on the page. The probe (with every text,
  slip and picture hidden, a short slide, two columns, three untitled rows
  and a shrunk slide look the same) failed on 6accc1f (the shrunk slide's
  sheet: 6.2 % of the page at 16:9, 5.7 % at 4:3). Fit cost (fresh fit of
  every slide, offline, 1280 × 720): the sample deck 27.4 → 5.1 ms per
  slide (worst 128 → 32 ms), the stress deck 5.2 → 1.2 ms (worst 43 → 8.6).
  Sibling found by the full run: without the grid's block margins a picture
  slip filled its box exactly and its 0.6° tilt overflowed by 3 px at every
  scale (the sample's GPC slide cut at 0.6): the slip now keeps room for its
  tape and tilt.
  Hub sheets before: `sheets/before-roundB/`.
- **A simpler editor** (W.10; W.1, W.4, W.9 changed): no Live slide / This
  slide toggles. The live card is always in the preview's bottom-right
  corner, placed by `cardLayout` (both sides compute it, as the stage), with
  the trusted page's enlarge and fold buttons over it; clicking it or
  Ctrl/Cmd+Shift+Enter enlarges it into the single-slide view, whose
  labelled "Whole deck" shrink button (or the same key, in the Keys panel)
  brings the slide back to the card and the focus to it; the card moves
  between corner and stage in 160 ms (no motion with reduced motion); folded,
  it is a pill "Slide N · fits" (its fit from the live view or the idle
  checks). The preference `slideCard` replaces `liveSlide` (an old "off" is
  carried over as folded, then forgotten).

### After the round

- orz-slides: the full suite once (after the two owner revisions): 22
  files, 311 tests, 302 green in the run. The 9 that failed were re-run file
  by file and are green: P.14 (parallel-load timing, green alone, as in
  round A), T.2 (still asserted the retired screen notebook: now asserts
  that no theme carries `--orz-grid`), F.6 (online webfont timing, green
  alone), W.3 (green alone), L.7 and the OPS-5 probe (measured the frame
  mid card→stage transition: the GUI tests wait for it), GUI-11 (201 ms
  twice at 4× CPU: whole-text copies per change cut — 300 slides at 4× now
  no long task over 200 ms), and F.7 / T.3 Notebook (the picture slip
  overflowing by its tilt: fixed, see the owner decisions above). Re-run
  alone: layout-gui 21/21, editor 14/14, settle 16/16, themes-look 29/29,
  themes-stress 14/14, themes 6/6, parse 38/38, conformance 48/48. tsc
  clean; `build-themes --check` clean.
- Kit (orz-markdown 2.4.0, prepared, unpublished; `orz-markdown@606425e`:
  E.42 `getSelection`): its suite 2112/2112. Downstream against the
  checkout (symlink, run, restore; both git-clean after, orz-paged's
  pretest-regenerated themes restored): orz-paged 373/374 and orz-mdhtml
  153/154, each failing only its stale committed example (D.1, E.1), as in
  rounds A–A4.
- Numbers: ops on 1000 slides 130–360 → 2–27 ms; per-slide typing on 300
  slides p90 114 → 13 ms, max 277 → 66 ms; the stage at 1500 × 900 Split
  0.446 → 0.562 of the slide; Notebook's fit 27.4 → 5.1 ms per slide
  (sample), 5.2 → 1.2 (stress).
- Screenshots retaken (`output/orz-test/slides/engine/editor-shots/`,
  step6-1 … step6-21; new: 17 fit at rest, 18 the live card, 19 folded to a
  pill, 20 enlarged with the Whole deck button, 21 back to the deck), the
  hub editor sample re-assembled, every hub deck and sheet regenerated;
  Notebook's sheets before the decision kept in `sheets/before-roundB/`.
  Looked at: labels and fit badges at rest (the cut box red), the filmstrip
  under the slide, the card and its pill, the enlarged view's Whole deck
  button, Notebook before/after (the ruling identical on every slide; the
  callouts now show the source theme's coloured slips instead of the screen
  notebook's restyling of them).
- Commits: `orz-slides@7c3a0bf`, `@7d118f3`, `@ed91313` (round B),
  `@18a8334` (Notebook), `@c610976` (the card) and this record; kit
  `orz-markdown@606425e`.

Round B ends here; the next round (the final loop, step 10) starts from
this entry.

---

## Round B2 — 2026-10-15 (round B's fixes attacked; rebuild/1.0@e92ab0c, the closing pass on @15c9719)

The confirming round: the four areas again (ops, the whole-deck editor,
the GUI, isolation), each of round B's 31 items checked by reproduction and
the new mechanisms attacked (the derived deck, the flush of key runs, the
live card, the surround). **All 31 round-B items confirmed fixed** (OPS-1…10,
B-ED-1…5, GUI-1…13, ISO-B1…B3). New: 5 verified findings, **no HIGH**
(B2-OPS-1, B2-OPS-2, B2-ED-1, GUI2-1 MEDIUM; GUI2-2 re-rated LOW by its
verifier), 13 LOW, 12 improvements. Under the owner's stop rule round B
closes with this pass: no further review round for B.

### Found and fixed (closing pass)

Every probe below failed on rebuild/1.0@15c9719 (the pure probes in place;
the Chrome probes in a 15c9719 worktree with the new tests) and passes now.

| Id | Sev | Finding | Fix | Probe (claim) |
|---|---|---|---|---|
| B2-OPS-1 | MED | the derived deck differed from a fresh parse when a kit `{{name` block's closing `}}` lay outside the re-read slides (the kit's block dispatcher looks AHEAD past slide markers for the next line holding `}}`): typing `{{mermaid` above a later `{{chart` showed 4 slides in the GUI and the single-slide view while the saved deck had 2; an op was accepted on a slide a fresh parse does not have; the memo and undo kept the wrong deck | the derivation's one precondition the next-marker check cannot see, made explicit (`lookaheadSafe`): the touched part is read alone only when no opener before it was left unclosed while the edit adds a `}}`, and no opener in it reaches past it — else a full parse. Sound for every construct the dispatcher looks ahead for (it is the only one); the auditor's fuzzers (fz1 seeds 2, 4, 5, 7, 8, 9 and a `{{`-heavy variant, 12 000 edits each; the op fuzz seed 6) find no mismatch | P.14 (the property's generator now makes `{{name` blocks, lone `}}`, one-line and inline `{{qr …}}`; typing `{{mermaid` a character at a time; a lone `}}` closing an earlier opener; the minimal case) |
| B2-OPS-2 | MED (rare) | marker hygiene missed kit `{{name … }}` blocks: an unclosed `{{mermaid` swallowed every slide up to the next line holding `}}` (another `{{chart`, a one-line or even an inline `{{qr …}}`) with no lint, no fix, the ops not blocked | the same terminator-aware mechanism: `unclosed-plugin` (error; the fix inserts `}}` before the first marker line, in the text's line ending) when, after a slide marker, a line opens another multi-line `{{name` block, when the closing line's `}}` ends a one-line or inline `{{…}}` of its own, or when a DRAWN block (chart, mermaid, smiles, qr, youtube) holds a slide marker; a text block (`{{yaml`, `{{nyml`, an include) closed on purpose may still show markers (corpus `markers-in-code`); `REPAIR_CODES` (upgrade repairs it), `RUN_ON_OPENER`, the ops' `BLOCKING` | P.13, L.2 |
| B2-ED-1 | MED | a pending arrow-key run was not written before Cmd/Ctrl+S (the save lacked the last nudge) or Cmd/Ctrl+E (the nudge was lost: the kit's `leave()` read the text before the GUI's destroy flushed it) | the class: ONE flush hook ahead of every command — the GUI listens in the window's capture phase (before the kit's and the editor's own handlers) and writes a pending run on every key that does not go on with the run (any shortcut, Tab, Enter, keys elsewhere) and on every press outside the stage; Escape still cancels it | L.12 (Save, the enlarge key, a toolbar click, Escape), W.10 (Done by Cmd/Ctrl+E in the assembled file) |
| GUI2-1 | MED | the live card — since the owner's 2026-10-14 revision the only way into slide editing — showed no sign at rest that it can be clicked; on touch the "Edit this slide" hint (hover/focus only) never appeared | an "Edit" chip in the card's head, drawn at rest on every pointer (filled on hover and focus), clear of the head's number and fit (the frame's head keeps room for it) and of the fold button; the whole card stays the target and a keyboard button | W.10 (at rest, on touch, geometry) |
| GUI2-2 | LOW (rare) | Ctrl/Cmd+Shift+Enter in the Editor-only view turned on an invisible single-slide mode (a 64 × 36 stage, the deck dimmed, nothing said) | with no preview to draw in, the key says "Show the preview (Split or Preview) to edit a slide on its own" and changes nothing | W.10 |
| B2-OPS-3 | LOW (rare) | a divider next to a px/auto/em track of a 3+ track split wrote 2/8/5, 9/1/5 (sum over 12) | the fixed track of the pair is written as the split's mean fr, then the whole-split snap (sum ≤ 12); an fr pair that is the split's only fr tracks steps through the simple ratios, the fixed tracks kept | L.1 |
| B2-ED-2 | LOW | enlarging from the keyboard (Enter on the card) dropped the focus to `<body>` | the focus goes to the single-slide view's Whole deck button | W.10 |
| B2-ED-3 | LOW | the folded pill stayed "not checked yet" after an idle check found the slide cut | an idle check's report redraws the card or pill | W.10 |
| B2-ED-4 | LOW (rare) | a `select()` from code to another slide while a key run was pending was undone: the run's commit pinned the caret back | a run written late after the caret left its slide leaves the caret where it is | L.12 |
| B2-ED-5 | LOW | on touch the 36 px fold button was placed as if 24 px and overhung the card | placed from its measured width | W.10 |
| GUI2-3 | LOW | a filmstrip auto-hidden in a short pane never came back | it comes back when the pane is 400 px or more again (40 px hysteresis), unless the reader hid it | L.7 |
| GUI2-4 | LOW | the template look captions on a dark theme's soft-dark surround: 2.5–2.9 : 1 | the captions take the slide's scheme (light on dark; the checked one in `--lg-ink`): ≥ 4.5 : 1 on chalk, copper, inscription, neon, nocturne | L.7 |
| GUI2-5 | LOW (rare) | Notebook: a single picture's slip filled its room, not the picture (blank paper under a wide picture) | the paper is the image's own box (sized to its aspect by deck.css); the paragraph keeps the tilt and the tape. Before/after: `output/closed-loop/b2-shots/notebook-slip-4x3-{before,after}.png` | T.12 |
| GUI2-6 | LOW | the Keys panel broke "Ctrl/Cmd+Shift+Ent / er", did not list Ctrl/Cmd+Y, and the template note was cut to "…choose it…" | key names break only after `+` or `/`; undo and redo listed apart (Ctrl/Cmd+Y); the note "Title page: choose a look" (the rest in its title) | L.12 |
| GUI2-7 | LOW | a box's name tag could land beside the next box's ('left' drawn just left of 'right', 27 px apart) | a name tag also tries the places along its edge between the corners, and never comes within two tag widths of a neighbouring box's left edge (where that box's tag sits); a first try (own side first) put a tag under the box onto a fit=off slide's overflowing text — caught by round B's GUI-1 probe in the full run | L.7 |
| ISO-B2-1 | LOW (rare) | the Issues messages quoted the region name the frame reported | named from the text (the frame's region boxes in document order; a count mismatch says "box") | L.13 |
| ISO-B2-2 | LOW (rare) | the overlay drew and selected floats the text does not have | the frame's float count is checked against the text as the regions are (a mismatch draws a stale stage) | L.13 |
| ISO-B2-3 | LOW (UPSTREAM) | Ctrl/Cmd+Shift+Enter did nothing with the focus inside the preview frame, though W.10 said "anywhere in the editor" | scoped: the key works in the text and the editor's chrome; the frame's bridge forwards only the kit's own keys (W.10 and the Keys panel say so) | W.10 |

Also taken from the improvements (cheap, same files): a report without its
parts (a document script's `parts: null`) keeps the last good parts of the
same slide text, so a forgery cannot make the stage stale for good (L.13).

### Owner-reported bug (2026-10-15): the slide left in the pane after a shrink

Intermittent: after enlarging the card and clicking Whole deck, the slide
sometimes stayed large in the centre of the pane, with only an empty card
frame (its fold chevron) in the corner. **Root cause**: the page's `post()`
resent a message the frame could not take (`preview.post` is false while
the frame's document is being rebuilt — `followPresentation` rebuilds it
after a theme or header change — or boots) as it was, every 100 ms, with
one counter for all messages. An enlarge (`stage: true`) that failed and a
shrink (`stage: false`) that failed later each kept their own retry timer;
when the frame came back between the two timers' phases, the shrink got
through first and the older enlarge after it — the frame drew the stage,
the page believed it was back in the whole deck, and nothing corrected it
(nothing depended on `transitionend`: the 160 ms transition is decoration;
the frame's `apply()` already derives its layout from each message). **Fix,
the class**: what the frame shows is a function of the page's CURRENT
state — a message the frame could not take is never resent; the current
state is sent again once, shortly (`syncLive(true)`, the posted key reset so
the slide goes with it). Reproduction (`output/closed-loop/b2-shots/
card-shrink-race-repro.mts`: CPU 6×, the frame rebuilt between enlarge and
shrink): on 15c9719 25 of 48 cycles ended with the stage in the pane
(`card-shrink-race-before.png`), with the fix 0 of 48
(`card-shrink-race-after.png`). Probe (W.10, real Chrome, CPU 4×): 45
enlarge → shrink cycles — clicks, the key, double clicks, a click right
after the enlarge, typing, theme changes, and the frame rebuilt between the
enlarge and the shrink — each must end with the card in the corner, its
slide drawn, the page's card button on it and the flattened preview back.
It failed on 15c9719 (cycles 4, 7, … "the frame still draws the stage") and
passes.

### Coordinator item (2026-10-15): the outline column and its leaders

Paper's outline at 4:3 wrapped short items ("Mechanism and / kinetics")
in a narrow column beside half a slide of white, and its dot leaders broke
into stray fragments next to wrapped items. The class, checked over 14
themes × outline v1–v3 × 16:9 and 4:3, had three members:

- **Paper**: `.orz-outline { width: 62% }` (≈ 470 px at 4:3); the leader
  (`flex: 1 1 auto; min-width: 1em`) forced the text to shrink and wrap,
  and the shrunk text box left the leader far from the wrapped line.
- **Orchard**: `ol { max-width: 22em }` wrapped a 707 px item at 16:9 with
  1075 px offered.
- **Nocturne**: an 18 % right padding made v3's columns ≈ 270 px at 4:3
  ("RAFT in the lab" wrapped).

The fix is CSS only, one mechanism: the outline's measure is the same in
both ratios and grows to the slide's width for a longer item
(`width: fit-content; min-width: min(100%, <N>em); max-width: 100%`, N
the theme's old 16:9 width, so 16:9 looks the same). Paper's leader takes
only the room the text leaves (`flex: 1 1 0; min-width: 0`, whole dots):
it is never a reason to wrap, and on a wrapped item it is 0 wide — dropped
— with the numeral on the item's last line (`align-items: last baseline`).
The DOM contract (§7) states the rule; T.11 binds it. Probe (T.11, every
theme × v1–v3 × both ratios, a 6-item outline with one long item): an item
whose one-line row needs ≤ 80 % of the width the slide offers is one line;
a drawn leader lies on the item's last line, starting ≤ 1 em after its end
and ending ≤ 1 em before the numeral. It failed on 15c9719 with 35 entries
(Orchard 16:9 v1/v2, Nocturne 4:3 v3, Paper's wraps and leaders on v1–v3
at both ratios) and passes. Screenshots:
`output/orz-test/slides/engine/outline-fix/{before,after}/` (Paper,
Orchard, Nocturne at 16:9 and 4:3; the sample's outline and the probe's).
Looked at: Paper 4:3 one line per item with continuous dots; a wrapped
long item without a leader, its numeral on the last line. Seen, not
changed: Notebook's "← today" label (`left: 100%`) could run off the slide
for a very long current item (round C).

### Class siblings found while fixing

- **The derivation's preconditions are now named in the code** next to
  `SAYS_LINE` (`lookaheadSafe`): a later kit block construct that looks
  ahead past markers has one place to be added.
- **The plugin block's "closed by mistake" has three faces** (another
  opener after a marker, a foreign `}}` on the closing line — inline uses
  included —, a drawn block holding a slide marker); the verifier's U.7
  point (a text block may show markers on purpose) kept `{{yaml` examples
  lint-free.
- **A tag's place has two neighbours to respect**: the slide's ink and the next box's tag; the edge positions between the corners serve both (GUI-1 and GUI2-7 together).
- **Every command, not every shortcut**: the flush also runs on a pointer
  press outside the stage (the kit's Done and Save buttons, the host page's
  own), which before relied on the focus leaving the stage.

### Open by choice (with reasons)

- **The enlarge key inside the preview frame** (ISO-B2-3, the "better"
  fix): forwarding Mod+Shift+Enter through the kit's authenticated bridge
  changes `PREVIEW_BRIDGE` (its CSP hash and the conformance checks) for a
  LOW; scoped instead. A kit 2.4.x item if the owner wants it.
- **A command with no input** (an app host's own save request by message)
  still reads the text without flushing a run made in the last 650 ms; the
  flush hook covers every key and pointer, the only ways a run is made.
  A kit FC-19 "before a command" hook would close it; not worth an FC-19
  change at this stage.
- **Notebook's sticky note at 4:3** (the second half of GUI2-5): the
  sample's float (`w=17% h=16%`, sized at 16:9) is reported cut at 4:3 in
  Notebook only (its larger heading font in a 163 px wide note); the lint
  tells the author; trimming Notebook's note would change its look.
- **Improvements not taken**: an idle-time safety net comparing the
  derived deck with a fresh parse (the precondition is now explicit and
  fuzzed); the fit key with the header's slide-number/progress keys and the
  plan (no stale result found, e9); faster idle checks for slides without
  pictures (1000 slides in ~12 min is within the background budget); the
  live slide's place under the card in Sync scroll; ignoring repeated
  `orz-slides-live-ready` (self-inflicted by a document script, trusted
  author); a standing contrast test over all 14 surrounds and the T.12
  probe over the whole stress deck (the probes above cover the cases
  found); a nested-window negative test and an HTML-in-titles unit test
  (p2 verified both by hand; the kit's `e.source` check and `textContent`
  everywhere stand).

### After the closing pass

- orz-slides: the full suite once (main tree, all fixes but the GUI2-7
  rework in): 23 files, 357 tests, 353 green in the run. The 4 that failed,
  re-run alone: P.14's linear-time bound (parallel-load timing, as in rounds
  A and B; parse + base 46/46, B.1 included — its worktree failure was the
  worktree's node_modules link), L.8 (green alone), GUI-1 (a real regression
  of the first GUI2-7 fix: reworked, see the table) and GUI-11 (one long
  task of 201–206 ms at 4× CPU; 15c9719 gave 219 ms in the same session, and
  the fixed code passed 2 of 3 runs: machine timing, round B's own note).
  After the rework: layout-gui alone 29/29, editor + claims 21/21; tsc
  clean; `build-themes --check` clean; conformance green in the full run.
- Kit: untouched (no kit commit; no downstream run needed).
- Screenshots retaken (`output/orz-test/slides/engine/editor-shots/`):
  step6-18 (the card at rest, its Edit chip), step6-18b (on touch, 1024 ×
  1366: the chip and the fold inside the card; the narrow card cuts its fit
  badge to "c…", still red), step6-18c (the card focused), step6-12 (the
  Keys panel, names broken only at +, / or spaces); the hub editor sample
  `editor.slides.html` re-assembled; the hub decks and sheets regenerated.
  Evidence for the owner's bug and Notebook's slip:
  `output/closed-loop/b2-shots/`.

## Round B — CLOSED (rounds B and B2)

| Round | Base | Verified findings (HIGH) | LOW | A previous round's fix not fixed | Fixed in the round |
|---|---|---|---|---|---|
| B | 6accc1f | 17 (1: OPS-2) | 14 | — | all 17 and the 14 LOWs (ISO-B3 by scoping), with both owner revisions |
| B2 | e92ab0c / 15c9719 | 5 (0) | 13 | 0 of 31 (every round-B item confirmed fixed) | all 5 and all 13 LOWs (ISO-B2-3 by scoping), the coordinator's outline item and the owner's intermittent card bug |

The verified findings fell from 17 to 5 and the HIGHs from 1 to 0; no
round-B fix was found broken. Under the owner's stop rule (a round with no
HIGH ends the loop after its fix pass) **round B is CLOSED**.

Open by choice when round B closed (details in each round's entry):

- The kit's `readDocument` tokenises the whole deck for the lints (a 2.4.x
  kit option to take the derived deck).
- The enlarge key inside the preview frame (a kit bridge change); a command
  with no input (an app host's save request) does not flush a key run of the
  last 650 ms (a kit FC-19 "before a command" hook).
- Notebook's sticky note at 4:3 in the sample (author's 16:9 size; the lint
  says so); Notebook's "← today" label for a very long current item.
- Improvements not taken (rounds B and B2): "Move to slide N…", an occlusion
  oracle and a contrast test as standing tests over every theme, an idle-time
  derived-vs-fresh safety net, the fit key with the header's slide-number
  keys and the plan, faster idle checks, the caret's slide under the card,
  repeated live-ready, nested-window and HTML-in-titles tests.
- Root family docs (REBUILD.md, STATUS, CONTRACTS) are the coordinator's.

The next loop is the final one, at step 10.

---

## Final loop — 2026-10-16 (step 10; rebuild/1.0@0ca80a5, kit orz-markdown@0e5c38e)

Five release audits (CLI/agents, engine/themes, editing/isolation, kit
2.4.0, release readiness), each finding verified by an independent agent
(`output/closed-loop/slides-final.json` in the family root): 3 HIGH, 16
MEDIUM after verification, 13 LOW. The fix pass was cut off by a session
limit and resumed from its uncommitted work (backup in the family
`output/closed-loop/final-fixpass-wip-2026-10-16/`). Every finding has a
probe that fails on the round's base (checked in worktrees at 0ca80a5 /
0e5c38e with the new tests copied in) and passes now, or a dismissal.

| Id | Sev. | What | Fix (class) | Probe |
|---|---|---|---|---|
| FINAL-ENG-1 | HIGH | heading-only template pages shrank to 0.6 and were marked clipped (Inscription, Architect, Sticker, Preprint) | every decoration keeps its room inside the template box (Inscription's lozenges, Architect's bubble, Sticker's tilted letters and number sticker, Preprint's number on the first line in every variant, Small Press's ink room, Sky's halo, Paper's drop numeral sized to its room by the new `data-sec-len`); fit counts as overflow only what passes the box's `overflow-clip-margin` (≤ 6 px, painted) — dom-contract §7 states the rule | T.16: all 14 themes × every variant × short/long × 16:9/4:3, offline: never clipped, a one-line heading never scaled, nothing cut (pixels with the clip widened) |
| FINAL-ENG-2 | HIGH | print with notes: dark themes' notes light ink on white | the notes area is a sheet of paper in every theme (ink, panels, links, quotes) | Q.6 (every theme, plain and with notes, 4.5 : 1; chrome 3 : 1) |
| EI-1 / EI-4 | HIGH / MED | `blob:` uploads and `bg=` pictures never shown in the editor surfaces | kit `inlineBlobUrls` (E.44) in the shell and in slides' live card, stage and fit checks; `bg=` through `resolveAsset` | X.5 (example app, real Chrome) |
| CLI-1 (D-65) | MED | git-proved "unchanged" read as proof the file is newer | kit: only the pair record proves it; git-only gets the safe pull (N.11) | kit N.11 |
| CLI-2 | MED | floats never shrank | `--sl-float-size` token, deck.css scales it; build-themes contract refuses a fitted box's own font-size; float advice | F.8 (every theme, both ratios) + contract |
| CLI-3/4/6/7, RR-8 | MED/LOW | `next`s and advice that did not run as written | `--replaces <sha256>` wording, 0.x pair recorded by `upgrade deck.md`, newer shell first, `upgrade` for 0.x files, `new` named only for its keys | V.14 (every named command run verbatim in 10 states) |
| CLI-5 | LOW | cut-off twin advised as "browser changes"; "last wrote it from" | cut-off advice names `assemble --replaces`; kit wording "last synced it with" | V.14 |
| CLI-8, CLI-9 | LOW | plain Markdown assembled to an empty deck; `inspect x.slides.md` without the text gave no next | kind decided once (`textKindOf`); `no-such-file` with `next: extract` | V.14 (kind/advice test) |
| FINAL-ENG-3 | MED | offline, Notebook's undrawn Mermaid overprinted | line-height 0 only for drawn content; an undrawn diagram takes its source's height (deck.css) | T.17 (every theme, offline sample) |
| EI-2 | MED | `fetchInclude` never asked for file includes | kit `previewIncludes` (E.45) used by every surface | kit E.45, X.1/X.5 |
| EI-3 | MED | CSP advice blocked the app's own sheets | the `style-src-elem` line spelled out, FC-19 note | X.6 (the guide's policy taken literally) |
| EI-5 / RR-7 | MED/LOW | `nonce` missing in index.d.ts; unguarded `slideMap` sample | type added, sample guarded | X.7 (tsc --strict over app.js and the guide's snippets) |
| EI-6 | MED | read-only editor's pickers changed the header | kit: pickers disabled, `setHeader` throws read-only (E.43) | kit E.43 |
| EI-7 / RR-3 | MED/LOW | 0.x files' "Framework 1.0.x" banner fails | documented (CHANGELOG known limits, README, skill, `inspect` note); no stub shipped | — (docs) |
| RR-1 | MED | `inspect --layout` ENOTEMPTY | Chrome closed with its process group; profile removed with retries, never failing the report | I.9 (12 runs, 4 at a time) |
| RR-2 / RR-5 | MED/LOW | kit range unguarded; publish order | `scripts/release-check.ts` in both `prepublishOnly`s (range ≥ 2.4.0, no link, lockstep, dated entry, clean tree); CLAUDE.md runs the root's checks before the browser publish. The previous pass's green-run stamp was taken out: the owner put it in Phase 4, "not before" | B.6, B.7 |
| RR-4 | MED | README library sample threw | slide index 3, `version` listed | I.10 (the sample run verbatim) |
| RR-6 | LOW | PROTOCOL.md pointed at an unshipped `spec/` | kit ships `spec/` | — (kit `files`) |
| RR-9 | LOW | release notes gaps | merge step, CHANGELOG items, status | — (docs) |
| KR-1/2/3 | LOW | stale site bundle; CHANGELOG/spec ranges | kit `web-bundle.mjs --check` in check:site and prepublishOnly; wording | the check itself |
| EI-8 | LOW | IIFE README omitted `layout` | listed | — (docs) |

Found by the new probes beyond the findings (same classes, fixed): Sky's
section-number halo clipped flat; Paper's drop numeral for III–VIII cut at
the box's left edge; Small Press's fallback-font ink above its headings;
Inscription's closing `min-width` wider than the box at 4:3; Sticker's
title `max-width` wider than its box at title v4, 4:3.

Not taken: the kit-level `blob:` transfer over the port (the shell's
`data:` copy covers it); a speaker-view fragment counter; an offline
placeholder for undrawn charts and molecules (kit, later); a 3 : 1 chrome is
the themes' frozen design (Stationery's slide number 3.07 : 1, the
separators decorative). The round-B open item "Notebook's sticky note at
4:3" was the float bug (CLI-2) and is closed with it.

Verification (2026-10-16):
- Probes on the base: kit N.11, E.43, E.44, E.45 fail at 0e5c38e; slides
  V.14 (three tests), B.6, B.7, T.16 (six themes run), Q.6, F.8, T.17,
  X.5, X.6, X.7, I.10 fail at 0ca80a5 (worktrees, the new tests copied
  in). I.9 passed there: RR-1 needs a loaded machine (the verifier saw 4 in
  16 with four loops at once); the fix is by construction (cleanup never
  throws) and I.9 guards it under load.
- orz-slides full `npm test`: 446/452; the six were D.5 (the new
  `data-sec-len` in its expected string), S.2 (examples regenerated), V.14
  (help prose named `new --template` without its value — reworded), X.4
  (the browser package's new prepublishOnly), F.3 (its fixture overflowed
  by 1–2 px, now painted: lengthened) and P.14 (timing); all six files green
  alone after the fixes (81/81). Typecheck clean; `build-themes --check`
  clean.
- Kit (orz-markdown@9588335): 2116/2116 (unit + cli 1625, chrome + screen +
  conformance 491); `web-bundle --check` clean.
- Downstream against the linked kit (worktrees, real repos untouched):
  orz-mdhtml 153/154, orz-paged 372/374 — the known stale-examples
  artifacts (mdhtml E.1, paged D.1) and paged T.18, which pins the kit's
  2.3.0 refusal words (`--replaces` followed by that sha256; 2.4.0 writes
  `--replaces <sha256>`): the regex follows at paged's `^2.4.0` move
  (STATUS D-64), green in the copy with it.
- The hub (`output/orz-test/slides/`): the 14 decks, sample, stress and
  surround decks, sheets, the editor sample and the web-app copy
  regenerated; the hub-only CodeMirror path (`/slides/cm/`) re-applied.

## Confirming round — 2026-10-16 (step 10; rebuild/1.0@b2f62e8, kit orz-markdown@9588335)

Three audits of the fix pass (CLI/agents, editor/isolation, engine/themes),
each finding verified by an independent agent: 1 HIGH (rare), 4 MEDIUM, 10
LOW. Every finding has a probe that fails on the round's base (worktrees at
b2f62e8 / 9588335 with the new tests copied in) and passes now.

| Id | Sev. | What | Fix (class) | Probe |
|---|---|---|---|---|
| C-H1 | HIGH (rare) | a file cut off inside its text beside a twin unchanged since the sync: `assemble` named `extract x.slides.html` (also `-o`), which replaced the complete text with the truncated one, no backup | kit: `assemble` over a cut file → `unclosed-island`, next `assemble x.slides.md --replaces <its hash>`; `textOutputCheck({ fileHtml })` never lets a cut file's text replace another text without `--force` (next `extract -o x.recovered.slides.md`) | kit N.12; V.15 |
| C-L1 | LOW | in-place `extract` of a file holding an earlier commit of a newer committed twin replaced it, no backup | kit: the file holding a known earlier state of a changed twin → `twin-differs`, next `assemble` | kit N.13; V.16 |
| C-L2 | LOW | in-place `upgrade` of a 0.x file kept no backup | `old.slides.html~` kept (`backups`) | V.16 |
| C-L3 | trivial | docs named the 0.x banner "Framework 1.x / 1.0.x available" | docs quote it as it reads, "Framework 1.0.0 available" | — (docs) |
| E-M1 | MED | uploads named with spaces / non-ASCII letters broken on every surface: `resolveAsset` got the percent-encoded form | kit: every reference decoded once (`assetPath`), inserted Markdown also encodes `%`; slides' live card, stage, fit checks and `bg=` resolve through `shell.preview.resolveAsset(s)` | kit E.47; X.8 |
| E-M2 | MED | `blob:` uploads re-embedded as base64 into every render (ten 4 MB pictures: preview 19 s behind typing on the base, 47–52 s with twenty) | kit: each Blob crosses ONCE per frame document over the port (`orz-preview-assets`), the bridge swaps its own object URL in (`__orzPreview.assets`), only URLs `resolveAsset` gave, unused ones released; slides' surfaces share through `shell.preview.shareAssets` | kit E.46; X.9 (within 2 s, no long task > 1 s) |
| E-L1 | LOW | includes fetched twice (the live card's own cache) | kit: `shell.preview.context` = the render context; the live card resolves through it | kit E.48; X.10 |
| E-M3 | docs | STATUS D-65 ✅ was wrong for orz-mdhtml (its own guard copy) | D-65 reopened for orz-mdhtml; D-66 records C-H1/C-L1 downstream | — (STATUS) |
| T-M1 | MED | Architect, Chalk, Neon, Paper: a long URL shrank the box to 0.6 and was cut | deck.css: `overflow-wrap: break-word` on every `.markdown-body` | T.18 |
| T-L1 | LOW | decorations cut once a box holds content: Nocturne's closing QR outline, Notebook's first-slip tape (and the danger tape on the left), Inscription's picture hairline, Sticker's tilted outline label in a full outline | the decoration's room inside the box (QR slot `right: 11px`; first slip `margin-top`, danger tape at the note's edge; picture paragraph padding; outline label `margin-top`, last item no margin); dom-contract §7 | T.19 (every box's clip widened, every theme, both ratios) |
| T-L2 | LOW | Paper's single drop numeral X (X, XV, XX at 4:3) cut ~12 px | numeral sized by `data-sec-len` on the template's width, for the widest numerals | T.20 |
| T-L3 | LOW | Preprint, roman, section v2: XVIII overprinted the heading | the number's room by `data-sec-len` | T.20 |
| T-L4 | LOW | code wrapped in 5 themes, not in 9 (deck.css said it wraps) | one rule in deck.css: `pre-wrap; overflow-wrap: anywhere` (nothing cut; fit still scales a too-tall block) | T.21 |
| T-L5 | docs | README "inline — it opens offline" over-promised for math | README and skill: inline holds the engine, not the content libraries | — (docs) |

Visual changes (the frozen design kept; each is the smallest change that
removes the cut or overprint):
- every theme: a long unbreakable word (a URL) breaks at the box's edge —
  new for Architect, Chalk, Neon and Paper; code blocks wrap (`pre-wrap`,
  a token longer than the line breaks anywhere) — new for Architect, Chalk,
  Copper, Inscription, Neon, Nocturne, Notebook, Paper and Sticker (their
  long code lines shrank the whole box);
- Nocturne: the closing page's QR slip stands 11 px further in from the
  right edge;
- Notebook: a callout that is a box's first block keeps 16 px above it (a
  danger note 24 px), a first quote 0.9 em; on slides the danger note's tape
  starts at the note's left edge (it stood 14 px outside);
- Inscription: a picture's paragraph has 7 px padding, so the hairline frame
  6 px out stays inside the box;
- Sticker: the outline's tilted label has 0.3 em above it and the last item
  no space below it; the title page paints 16 px past its box (the name
  card's shadow; no layout change);
- Paper: the section drop numeral is sized on the template's width with
  factors for the widest numeral of each length (X, XV, XX, XVIII smaller,
  most visibly at 4:3);
- Preprint: a section number of 3+ characters indents the heading by its
  own room (2.6 / 3.1 / 3.6 / 4.2 em instead of 2.1 em), the meta line
  aligned with it.

Not taken: fit's 6 px painted slack stays (a wider slack would let text
out); decorations get room per theme instead.

Verification (2026-10-16/17):
- Probes on the base fail: kit N.12, N.13, E.46, E.47, E.48 at 9588335
  (E.46: the frame showed data: copies); slides V.15, V.16, X.8, X.9 (19.2 s
  behind typing on the base), X.10 (`parts/units.md` fetched twice), and
  T.18 (Architect, Chalk, Neon, Paper), T.19 (Inscription, Nocturne,
  Notebook, Sticker), T.20 (Paper, Preprint), T.21 (the nine non-wrapping
  themes) at b2f62e8 (worktrees, the new tests copied in).
- Kit (orz-markdown@5cb79c7): 2121 tests, 2118 green in the full run; the
  three others pinned the old bridge string and bundle bound (updated, green
  alone).
- orz-slides full `npm test`: 509/513; the four were timing: P.14, L.6
  (green alone, 58/58), L.10 GUI-11 (211–225 ms against 200 ms at 4×
  CPU throttle — the base b2f62e8 measures 213–217 ms on the same machine
  now: not a regression) and T.16 chalk (a 240 s timeout; green alone in
  293 s, base also times out; its budget raised to 480 s). The theme file
  alone: 111/112, then nocturne T.20 green twice alone after the cut
  measure was made robust to a late paint (re-measured once).
- Downstream against the linked kit (worktrees): orz-mdhtml 152/154 (E.1
  stale examples; X.1 its example policy lacks `connect-src blob:` — STATUS
  D-67), orz-paged 372/374 (T.18 wording D-64, D.1 stale examples).
- The hub (`output/orz-test/slides/`): engine decks, stress and surround
  decks, sample and editor decks, sheets and the web-app copy regenerated;
  the hub-only CodeMirror path (`/slides/cm/`) re-applied.

## Final check — 2026-10-17 (step 10 closes; rebuild/1.0@0f21d77, kit orz-markdown@5cb79c7)

One context-limited pass over the confirming round's fixes only, run as a
user or agent would (real Chrome, offline; a 0.8.5 deck built with the
published CLI; the base b2f62e8 built beside it for comparison). Every fix
held: a cut-off file's `next` repairs it verbatim, and extract/upgrade
refuse; older-vs-newer refuses with or without the pair cache; 0.x
upgrade keeps a byte-identical `~` and never replaces one; `Screen Shot
1.png` and `图表.png` show on every surface and as `bg=` in all three
spellings; ten 3.6 MB uploads leave no long task, and the preview catches up
in 0.2–0.6 s; each include is fetched once; isolation holds (an opaque
origin, no parent `blob:` readable). Long URLs, words and code break or
wrap in all 14 themes × 2 ratios with nothing clipped; the decoration fixes
are whole; the sample deck fits the same as or better than at base.

Found: one LOW, rare. `inspect` on a cut-off file beside a complete text
gives the correct cut-off advice first, then adds the generic
browser-changes bullet (extract, merge, `--replaces`), which does not fit a
cut file. Nothing is lost, and `assemble`'s own message there is right.
Left for 1.0.x (stop rule: no HIGH, rare LOW only). These are older than
the base, not regressions: the numeral against the frame in Preprint section
v4, Notebook's paperclip touching a quote's first letter, Sticker v6's
square sticker over the kicker, and wrapped code with no hanging indent
(intended, T-L4).

Step 10 is closed. Next: step 11 (release).
