# CLAUDE.md — orz-slides

Guidance for AI agents working in this repository.

> **orz family:** this repo is one member of the orz family — before changing anything another member depends on, read the family docs via [`../CLAUDE.md`](../CLAUDE.md) (contracts, shared rules, release order, and drift ledger in `../docs/`). The rebuild plan is `../docs/REBUILD.md` §3c (owner decisions 1–6 and the approved plan are binding).

## What this is

`orz-slides` is "Markdown that edits itself", as a slide deck: a deck is its
**text twin** (`x.slides.md`, orz text format 1, FC-18, kind `slides`: a
`{{nyml}}` header — the deck config, and the only one — then slides started by
`<!-- slide … -->` markers and split into boxes by `<!-- @name -->` markers)
and its **self-editing file** (`x.slides.html`) is `assemble(text)` — one page
that presents the deck (reveal.js), edits it two ways (the whole deck beside a
flattened preview with a live slide card; single-slide editing with the
layout GUI), saves itself and prints one slide per page. Built on the
orz-markdown carrier kit ([orz-markdown](../orz-markdown) `carrier/*`,
**2.4.0**): the standalone file's runtime is the kit's
`orz-markdown/carrier/app`; this repo supplies the slides kind behind its
`StandaloneKind` seam, the engine (reveal.js 5.2.1, pinned, in one module),
the 14 slide themes and the two editing modes. orz-mdhtml 1.0 and orz-paged
1.0 are the references for everything that is not slides (CLI, library,
conformance, docs).

Two npm packages live here, **versioned in lockstep**:
- `orz-slides` — the CLI and the Node library (this package).
- `orz-slides-browser` — the browser engine and editor component (`browser/`):
  `orz-slides.browser.js` (IIFE, `globalThis.OrzCarrier`, FC-19, plus
  `OrzCarrier.layout`), the ESM build `esm/orz-slides.browser.mjs`,
  `release.json`, hand-written `index.d.ts`, `require.cjs` (a `require()` shim
  that throws), `docs/embedding.md` (copied), `scripts/check-release.mjs`
  (its `prepublishOnly`).

> **Status: 1.0.0 prepared, not released** — the rebuild on branch
> `rebuild/1.0` (plan `../docs/REBUILD.md` §3c): steps 1–8 done (base,
> format-1 parser and assembler, engine, 14 themes, both editing modes, CLI
> and library, web apps / agents / docs), closed-loop rounds A and B closed
> (`notes/closed-loop.md`); next the UI/theme freeze (step 9), the final
> closed loop (step 10) and the release (step 11). The package version stays
> `0.8.5` until the release step bumps both packages to 1.0.0. Claims in
> `notes/CLAIMS.md` (bound by `tests/claims.test.ts`).
>
> **orz-markdown is linked, not installed**, while 2.4.0 is unpublished:
> `node_modules/orz-markdown` is a symlink to `../../orz-markdown` (the
> prepared 2.4.0 checkout); `package.json` still says `^2.3.0`. The bundle
> resolves the kit's dependencies from its real directory (one KaTeX:
> `build/bundle.ts`). Never release from a link: once 2.4.0 is published,
> `npx npm@11 install orz-markdown@^2.4.0` replaces it and refreshes the
> lockfile.

## Commands

```bash
npm run build            # prebuild (version, themes) + rm -rf dist + tsc -p tsconfig.build.json (dist/) + npm run bundle
npm run bundle           # build/bundle.ts: the live runtime, browser/orz-slides.browser.js (bundle rule) + esm/ + release.json + docs/,
                         #   and the same IIFE + release.json into dist/ (the Node library's engine)
npm test                 # vitest: project "main" (unit, corpus, CLI), then "chrome" (real-Chrome files, one at a time), then "conformance"
npm run typecheck        # tsc --noEmit over src, tests, scripts, build
npm run gen -- new x.slides.md --template talk   # the CLI from source (tsx src/cli.ts …)
npm run examples         # regenerate examples/*.slides.html from examples/*.slides.md (after a build; S.2 fails when stale)
npx tsx scripts/build-themes.ts --check   # the generated themes are fresh (also in prebuild/pretest)
npx tsx scripts/theme-sheets.ts           # a review page of every theme
npm run clean
```

The CLI (`orz-slides --help`; FC-10, inline by default, `--cdn` for the web):

```bash
orz-slides new [x.slides.md] [--template id] [--title T] [--theme id] [--ratio 16:9|4:3] [--html] [--cdn]
orz-slides assemble x.slides.md [-o out] [--cdn] [--resolve-includes | --no-includes] [--replaces sha256]   # also: orz-slides x.slides.md
orz-slides extract x.slides.html [-o out] [--replaces sha256]   # the exact text twin; 0.x files → upgrade
orz-slides upgrade old.slides.html [-o out] [--text t.slides.md | --no-text] [--cdn | --inline]
orz-slides upgrade deck.md [-o out.slides.md]                   # a 0.x deck source → a format-1 text
orz-slides inspect <file> [--layout [--offline]] [--json]
orz-slides themes
orz-slides templates
```

`src/cli.ts` holds the commands; the overwrite guards, known states, pair
records, backups, atomic writes, includes, reason codes and `next` are
orz-markdown's CLI core (`orz-markdown/carrier/node`, bound by
`carrierNode({ name: 'orz-slides', kind: 'slides', readLegacy, storedText })`).
Every command takes `--json`, `--help`, `--force`; exit 0 done / 1 refused or
failed / 2 usage. Content comes only from the text's header — `assemble` has
no content options (D-07). `inspect --layout` (`src/layout-report.ts`) drives
the installed Chrome over the DevTools pipe (`ORZ_SLIDES_CHROME` names one;
none: reason `no-browser`). Tests point `XDG_CACHE_HOME` at a temporary
folder.

Tests live in `tests/` and are bound to the claims in `notes/CLAIMS.md`.
`tests/global-setup.ts` runs `tsc -p tsconfig.build.json` and stages the
engine into `dist/` and `browser/` first (the CLI tests spawn `dist/cli.js`).
Real-Chrome tests run **offline** (`OFFLINE_ARGS` in `tests/helpers.ts`:
`--host-resolver-rules`, STATUS D-63 — `ctx.route()` misses `srcdoc` frames);
only files that load the CDN libraries on purpose launch `online: true`. The
`chrome` project runs its files one at a time (timings); a timing test that
fails under a full run is re-run alone. The `conformance` project runs
orz-markdown's carrier harness (46 checks, no skips; 45 pass,
`C.update.from-previous` not applicable — `firstRelease`) with a `next`
build. Real-Chrome tests skip without an installed Chrome (playwright-core,
channel `chrome`) — such a run verifies nothing "real".

## Architecture

- **Isomorphic core** (no Node built-ins, no clock, no randomness except
  `mintUid`): `src/assemble.ts` (`assemble`, `shellParts`, `newDocument` from
  a deck template, `readDocument` with kind `slides` and the deck lints, the
  kit's `extract`), `src/presentation.ts` (header → head links and the read
  view's markup), `src/inspect.ts`, `src/legacy.ts` (`readLegacy`, `upgrade`
  of 0.x files, `upgradeText` of 0.x deck sources), `src/upgrade-report.ts`
  (what an upgraded deck shows against 0.8.5, with the frozen 0.8.5 parser in
  `src/legacy/parser-0.8.5/` — **never edit it**), `src/themes.ts` (the 14
  themes, aliases, dropped-theme map), `src/starters.ts` (deck templates),
  `src/version.ts` (generated).
- **The deck** `src/deck/`: `parse.ts` (`parseDeck` on the kit's token
  scanner: markers only as top-level comment blocks, slide options, regions,
  floats, the heading rule, lints as carrier lints; memoised and
  incremental), `layout-spec.ts` (presets and the split grammar, canonical
  writing), `plan.ts` (slide numbers, sections, outline current item),
  `config.ts` (header → `DeckConfig`). `src/types.ts` is the shared model
  (`Deck`, `Slide`, `LayoutNode`, …); `src/layout.ts` the pure layout tree →
  nested-grid HTML; `src/render-slide.ts` the pure slide DOM (per
  `docs/dom-contract.md`).
- **Layout ops** `src/layout-ops.ts` (pure): one op → minimal text edits on
  marker lines (a deleted box's block moves to its neighbour), parsed back
  before writing; the preset alias written when the tree equals a preset;
  `applyOp`, `applyEdits`, `slideMap`, `partAt`, float placement, track
  snapping. Exported by the library, the ES module and `OrzCarrier.layout`.
- **The engine** `src/present/` — the ONE module that owns reveal.js
  (`keyboard: false`, keys through the kit's `onKey`; controls, progress,
  number and print route off): `engine.ts` (the deck, Present, overview,
  fragments, timer, keys), `render.ts` (text → slides), `fit.ts` (two-axis fit
  on every box, floor 0.6, `data-scale` / `data-clipped`; settles after
  fonts, libraries, images), `decorate.ts` (chrome slots, charts,
  molecules, diagrams per visible slide), `print.ts` (the print document,
  with or without notes, cuts marked), `speaker.ts` (the speaker window),
  `styles.ts` (the engine's stylesheets: reveal core, `deck.css`, the themes).
- **Node only**: `src/engine.ts` (finds and verifies the engine an inline file
  carries: `dist/` + `release.json`, version and SHA-384), `src/lib.ts` (the
  package's main export), `src/cli.ts`, `src/layout-report.ts`.
- **Browser** `src/browser/`: `index.ts` (the IIFE: captures its engine
  source, the kit's `startCarrier(SLIDES_KIND)`, `OrzCarrier.layout`),
  `esm.ts`, `carrier.ts` (the FC-19 API: `mountEditor` on the kit's editor
  shell with the slides preview, settings and tools; `renderPreview` — the
  flattened deck), `layout-api.ts`, and `slides/`: `kind.ts` (the
  `StandaloneKind`: actions Present, Print, Print with notes, Speaker view,
  Overview), `read-view.ts`, `settings.ts` (Theme, Ratio, Slide numbers,
  Progress bar, Section numbers), `flat.ts` (the flattened preview, pure),
  `frame.ts` (the preview frame document), `live-frame.ts` (the live card's
  runtime INSIDE the frame — fit, decoration, the stage; built into
  `__ORZ_SLIDES_LIVE__` by `build/bundle.ts`), `editor.ts` (the live card,
  lints and quick fixes, the slide kept across read and edit, the per-slide
  seam), `per-slide.ts`, `layout-gui.ts` (the TRUSTED overlay over the
  sandboxed frame: toolbar, filmstrip, boxes, dividers, floats, badges;
  every op through `shell.applyEdits`, one undo step, flashed; only
  `isTrusted` input acts; keys in `LAYOUT_KEYS`), `stage-geometry.ts`
  (computed the same way on both sides).
- `build/bundle.ts` — esbuild → the live runtime, the IIFE/ESM (one KaTeX,
  the themes as a virtual module), the bundle rule, `release.json`;
  `buildBrowser({ version })` builds in memory (tests, the conformance
  `next`).
- `scripts/build-themes.ts` — the 14 themes (`assets/themes/<id>.css`,
  generated, committed, never edited by hand): a derived theme is
  orz-markdown's source theme + `layers/slide-scale.css` + `layers/<id>.css`;
  an updated 0.x theme `layers/content.css` + `layers/<id>.css`;
  `assets/themes/deck.css` is the structure. The slide DOM and theme contract
  (slots, tokens, logical size) is `docs/dom-contract.md`.
- `examples/` — `starter` (inline), `demo`, `talk`, `raft` (cdn) with their
  files (S.2); `examples/webapp/` + `docs/embedding.md` — the app embedding
  path (X.*). `tests/decks/` — format-1 review decks (S.3; their HTML is
  git-ignored).
- `orz-slides-skills/SKILL.md` — the agent skill (mirrored by
  orz-claude-plugin); `PROTOCOL.md` — a pointer to orz-markdown
  `spec/host-protocols.md` plus the slides specifics (shipped).
- `archive/` — the 0.x design documents (DESIGN, BUILD-PLAN), with a README
  saying what is still true and where. `notes/closed-loop.md` — the
  closed-loop rounds.
- Legacy 0.x fixtures (for `upgrade`/`inspect`) in `tests/fixtures/legacy/`
  (0.7.1–0.8.5, never regenerate them).

## Conventions & gotchas

- **The text is the document; never serialize the live DOM or the rendered
  deck.** Every save, update, "New document" and "Save as new copy" writes
  `assemble(text)`.
- **The layout GUI only rewrites the text** (owner decision 1): marker lines,
  one undo step per op, no hidden layout data, no rich-text editing; a marker
  that did not change is never rewritten. Ops come only from trusted input in
  the page; the frame reports geometry as data.
- **Markers are top-level comment blocks only** (the kit's token scanner): a
  marker in a code fence, list, blockquote or raw HTML is text (the 0.x
  freeze, D-47). Duplicate region names and a region filled twice are lint
  errors.
- **The header is the only deck config**; a `<!-- deck -->` block is lint
  `deck-block` (error, `next: upgrade`).
- **Fit never cuts silently**: a box shrinks to 0.6, then carries
  `data-clipped`; the editor's badge, the print notice and `inspect --layout`
  report it. Fit runs on the visible slide, after the typing pause.
- **reveal.js stays behind `src/present/`** (pinned 5.2.1); nothing else
  imports it.
- **Node and the browser write the same bytes** (FC-18 law 2): the Node
  library inlines exactly the bundle `npm run bundle` staged in `dist/`; a
  stale engine is refused ("run `npm run bundle`"), never inlined.
- **The browser bundle embeds orz-markdown and the themes.** To pick up kit
  or theme changes: `npm run build`, `npm run examples`.
- **`dist/`, `browser/orz-slides.browser.js`, `browser/esm/`,
  `browser/release.json` and `browser/docs/` are gitignored** build
  artifacts; the examples (`examples/*.slides.html`) are committed.
- **Bundle rule** (orz-markdown spec/shell-runtime.md §6): the bundle and the
  live runtime hold no `<script`/`</script`, no CR, only ASCII; the build
  rewrites `<` as `\x3C`, checks, then computes the SHA-384.
- **Kit gaps** are worked around locally behind a `KIT GAP` comment and
  reported, never patched in orz-markdown from here.
- **Deliberate limits** (do not "fix" without the owner): floats are unnamed
  (told apart by order) in format 1; filmstrip thumbnails are schematic;
  no app-side print in 1.0 (the `print` event goes to the app); handouts
  later.
- Reading, presenting and editing work in all modern browsers; **Save in
  place only in Chromium** (File System Access; elsewhere Save downloads).

## Releasing (two packages, same version)

1. Publish orz-markdown 2.4.0 first; replace the link with the registry
   package (`npx npm@11 install orz-markdown@^2.4.0`).
2. Bump **both** `package.json` and `browser/package.json` to the same
   version; date the CHANGELOG entry.
3. `npm run build`, `npm run examples`, `npm test` (green, conformance
   included; timing tests re-run alone if they fail under load).
4. `cd browser && npm publish` (orz-slides-browser; its `prepublishOnly` runs
   `scripts/check-release.mjs`) **first**, then `npm publish` in the root
   (`prepublishOnly`: build and test).
5. Token: granular with bypass-2FA in a temp `.npmrc`, deleted after; never
   commit.
6. **Network note**: IPv6 is unreliable on this machine — prefix npm/git
   network commands with
   `NODE_OPTIONS="--dns-result-order=ipv4first --no-network-family-autoselection"`.
7. Then the family docs (CONTRACTS, STATUS), the plugin skill mirror, the
   website (slides page, the `new-slides` starter, the verifier for format 1).

## After each major revision

Check coherency and update the README, the skill, `docs/embedding.md`,
CLAUDE.md, the CHANGELOG and the examples. Stale docs are bugs. Before each
publishing, regenerate the examples with the current version.
