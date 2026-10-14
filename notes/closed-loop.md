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
  rebuild step 7 decides (with `inspect`).
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
