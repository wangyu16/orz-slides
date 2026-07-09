# CLAUDE.md — orz-slides

Guidance for AI agents working in this repository.

## What this is

`orz-slides` turns a **deck source** into a single, self-contained, **editable**
`.slides.html` — one portable file that presents like a slide deck in any
browser (reveal.js), is authored in
[orz-markdown](../orz-markdown) with a layout syntax, and can be edited and saved
in the browser via a per-slide pop-out editor. It is the slide-deck sibling of
[orz-mdhtml](../orz-mdhtml) and shares its philosophy and editor stack.

[DESIGN.md](./DESIGN.md) is the **source of truth** (vision §1, file model §4,
authoring syntax §5, pipeline §6, overflow §7, packaging §13).
[BUILD-PLAN.md](./BUILD-PLAN.md) is the **module map** — work packages (WPs),
their owned files, interfaces, and the build order.

> **Status: published (v0.4.0).** All work packages (WP0–WP10) are built and
> verified — `orz-slides deck.md` generates a working, self-editing
> `.slides.html`. Presenter tools are wired: speaker view (**S**), step-reveal
> fragments (`step` flag / `{{attrs[.fragment]}}`), on-deck clock/timer (**T**),
> slide numbers + progress bar. Both npm packages are published in lockstep at
> v0.4.0; **PDF export** is the remaining planned presenter extra.

Two npm packages live here, **versioned in lockstep** (mirroring
orz-mdhtml):
- `orz-slides` — the CLI (this package).
- `orz-slides-browser` — the prebuilt in-browser engine (`browser/`,
  esbuild of reveal.js + orz-markdown + the slide parser/layout/runtime), served
  via jsDelivr for `--cdn` files.

## Commands

```bash
npm run build            # tsc && npm run bundle
npm run bundle           # esbuild: reveal.js + orz-markdown + parser/layout/assembler → orz-slides-browser
npm test                 # vitest run (parser + layout + assembler unit tests)
npm run gen -- deck.md   # generate deck.slides.html (dev; same as the CLI)
npx tsx scripts/spike.ts # regenerate the WP6 fit spike harness (out/spike.html)
```

The CLI is `orz-slides <input.md> [-o out] [--theme id] [--inline|--cdn] [--title t]`;
`--inline` (default) embeds the engine + theme, `--cdn` references jsDelivr. The
deck's `<!-- deck -->` config (theme/title/ratio) overrides the flags.

Pure modules (parser, layout, assembler, `{{chart}}`) are unit-tested with
vitest; the in-browser app and the assembled deck must be **verified in a real
browser** (presenting works anywhere; editing and Save need Chromium).

## Architecture (by work package — see BUILD-PLAN.md)

Strategy is **interface-first**: WP0 locks the shared types and the DOM/CSS
contract, then the Wave-1 leaf modules (WP1–WP4, WP9) are built concurrently,
then the Wave-2 modules (WP5–WP8, WP10) integrate them.

**Foundation (WP0):**
- `src/types.ts` — the **locked interface**: `Deck`, `Slide`, `LayoutNode`,
  `Region`, `FloatRegion`, `DeckConfig`. Every module codes against these.
- `docs/dom-contract.md` — the **shared DOM + CSS-variable contract** for a
  rendered slide (`.orz-slide`, `.orz-title`, `.orz-content`/`.orz-region`,
  `.orz-footer`, `.orz-float`, `.markdown-body`, the `:root` token set). The
  single truth shared by the layout engine, the themes, and the assembler.

**Wave 1 — independent leaves (parallel):**
- `src/slide-parser.ts` *(WP1)* — `parseDeck(source): Deck`. Splits at
  `<!-- slide … -->`, parses the `<!-- deck … -->` config, and per slide parses
  the layout (preset alias **or** raw `row/col` split), regions
  (`<!-- @name -->`), floats (`<!-- @float … -->`), options, the leading-h2
  title, and `@notes`/`@footer`; applies the heading lint. **Presets are
  expanded here** (via `expandPreset` from the layout engine) — downstream sees
  only the split tree.
- `src/layout.ts` *(WP2)* — the **pure** layout engine: `expandPreset(name,
  ratio?)` (aliases → `LayoutNode` tree) and `renderLayout(node)` →
  nested-CSS-grid DOM with `.orz-region` leaf placeholders, per the DOM
  contract. No DOM globals, no network — just AST → HTML string + region list.
- `assets/themes/*.css` *(WP3)* — the base + 7 slide themes (Paper, Architect,
  Executive, Sage, Poppy, Neon, Chalk), styling the DOM contract and
  `.markdown-body` content, reveal.js-compatible.
- `{{chart}}` plugin *(WP4)* — lives in **`../orz-markdown`** (`src/plugins/
  chart.ts`), not here; emits a `data-md` breadcrumb so it round-trips through
  copy-as-markdown.

**Wave 2 — integration (built):**
- `src/render-slide.ts` *(WP5)* — the assembler: `renderSlide(slide, md,
  deckConfig)` → a reveal `<section>` = `.orz-slide` > `.orz-frame` (title band +
  `.orz-content` layout grid with each region's body rendered by orz-markdown +
  footer) + floats + `@notes` → `<aside class="notes">`. The **`.orz-frame`**
  wrapper is required: reveal forces inline `display:block` on the `<section>`,
  which would kill a flex frame placed on `.orz-slide`.
- overflow / scale-to-fit *(WP6, in browser-entry.ts)* — per-region
  measure-and-scale (`--region-scale`, floor 0.6) on the visible slide;
  `fit=scroll|off`. Needs `min-height:0` down the frame→region→markdown-body
  chain (see dom-contract.md) so regions clamp and overflow is detectable.
- `assets/app.js` *(WP7)* — the in-file runtime, plain JS, inlined into every
  `.slides.html`: present mode (reveal nav/overview), the per-slide pop-out
  editor (CodeMirror; the live preview is the real reveal slide, re-rendered in
  place by setting the section's `innerHTML` — replacing the element would orphan
  reveal's `present` state), deck ops (add/dup/delete/move/theme), and
  self-reproducing save (FS-Access + IndexedDB + download + served-notice).
  **Ported from orz-mdhtml.**
- `src/cli.ts`, `src/template.ts`, `src/browser-entry.ts`, `build/bundle.ts`
  *(WP8)* — the CLI, the `.slides.html` shell (reveal scaffold + `#orz-deck` +
  editor chrome + app), `window.orzslides` (parse + assemble + reveal-init +
  enhancers + fit, plus `renderAll`/`refresh`/`reveal` for the editor), and the
  esbuild bundle. Mirror orz-mdhtml packaging exactly. The template also embeds
  orz-markdown's `getBrowserRuntimeScript()` for **copy-as-markdown** (its `init`
  runs once on load before slides exist, so it's a no-op for tabs/qr — the engine
  owns those — and only its global copy handler stays active; no conflict).

`orz-slides-skills/SKILL.md` *(WP9)* is the agent skill for authoring/editing
decks; match its terminology in any doc change.

## Conventions & gotchas

- **`src/types.ts` is the LOCKED interface.** Every module codes against it;
  changing a type ripples across the parser, layout engine, assembler, and
  runtime. Treat edits to it as a coordinated change, not a local one.
- **`docs/dom-contract.md` is the shared DOM/CSS truth** between the layout
  engine (emits the DOM), the themes (style it), and the assembler (fills it).
  If you change a class, structure, or token, update the contract **and** all
  three consumers together — otherwise themes and rendering drift.
- **Presets are expanded in the parser**, not downstream. The split tree is the
  only layout representation past `parseDeck`; the renderer and editor implement
  **one** layout mechanism, not two.
- **The layout engine (`src/layout.ts`) is pure** — AST → HTML string, no DOM
  globals and no network, so it is unit-testable in isolation. Keep it that way.
- **`assets/app.js` is plain JS** (backticks OK) and depends on element ids from
  `src/template.ts` and on the DOM contract's classes; change them together.
- **Preserve `data-md` breadcrumbs** on generated constructs (mermaid, smiles,
  qr, chart) if you post-process rendered HTML — copy-as-markdown depends on
  them.
- **The browser bundle embeds orz-markdown.** To pick up parser/runtime changes,
  bump the `orz-markdown` dep, `npm install`, then `npm run bundle`.
- **Charts (and any responsive canvas) draw per visible slide.** A chart drawn in
  a hidden (`display:none`) slide sizes to 0 — `browser-entry.ts` draws/resizes
  charts only on the current slide. Smiles/mermaid are fixed-size, so they're
  fine drawn anytime.
- Default `--inline` embeds the engine, reveal's core CSS, and all seven themes;
  a deck that uses math/diagrams/charts still pulls those content libraries from
  CDN at view time.
  Presenting works in all modern browsers, **editing/Save only in Chromium**.

## Sibling projects

- `../orz-markdown` — the renderer. The `{{chart}}` plugin (WP4) lands there, and
  region bodies are rendered through it. **This project is a host app that brings
  its own CSS (`assets/themes/`), JS runtime, and copy — so it must follow
  `../orz-markdown/orz-markdown-skills/references/embedding.md`.** That guide is
  the contract for content styling (every plugin/container class; restoring
  inline semantics that reveal's reset strips), the embedded runtime + drawing
  mermaid/smiles/chart, and copy-as-Markdown (`data-md` + plugin classes). Most
  of this project's content bugs were violations of it — consult it before
  touching `base.css`, the enhancers, or copy.
- `../orz-mdhtml` — the document-first sibling. The in-file app (WP7) and
  packaging (WP8) are ported from it; keep the editor/save/theme stack in sync.

## Releasing (two packages, same version)

Mirror orz-mdhtml: bump **both** `package.json` and `browser/package.json` to the
same version, `npm run build` (stages the bundle), publish `orz-slides-browser`
**first**, then the CLI, so `--cdn` URLs resolve. Token: granular with
**bypass-2FA** in a temp `.npmrc`, **deleted after** — never commit it.

**Network note**: IPv6 is unreliable on this machine — prefix npm/git network
commands with
`NODE_OPTIONS="--dns-result-order=ipv4first --no-network-family-autoselection"`.

## After each major revision

**Check coherency and update the README and the agent skill.** When you change
the authoring syntax, the layout grammar/presets, the DOM contract, the in-file
UI/runtime, delivery defaults, or the release flow, make sure `README.md` and
`orz-slides-skills/SKILL.md` still match reality (and stay consistent with
DESIGN.md). Stale docs/skill are treated as bugs.

## Release

- Before each publishing, always check coherency and consistency, update docs and agent skills, update the example/sample/testing dual extension name files to current version.