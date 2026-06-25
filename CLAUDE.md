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

> **Status: in active development** — nothing published yet. Some modules below
> are built (WP0–WP4); others are stubs/not-yet-written (the Wave-2 modules).

Two npm packages will live here, **versioned in lockstep** (mirroring
orz-mdhtml):
- `orz-slides` — the CLI (this package).
- `orz-slides-browser` — the prebuilt in-browser engine (`browser/`,
  esbuild of reveal.js + orz-markdown + the slide parser/layout/runtime), served
  via jsDelivr for `--cdn` files.

## Commands

```bash
npm run build            # tsc && npm run bundle
npm run bundle           # esbuild: reveal.js + orz-markdown + parser/layout/runtime → orz-slides-browser
npm test                 # vitest run (parser + layout unit tests)
npm run gen -- deck.md   # generate deck.slides.html (dev; same as the CLI)
```

Pure modules (parser, layout, `{{chart}}`) are unit-tested with vitest; the
in-browser app and the assembled deck must be **verified in a real browser**
(presenting works anywhere; editing and Save need Chromium).

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

**Wave 2 — integration (sequential; not yet built):**
- `src/render-slide.ts` *(WP5)* — the assembler: `renderSlide(slide, md,
  deckConfig)` → a reveal `<section>` (title band + layout grid with each
  region's body rendered by orz-markdown + floats + footer + `@notes` →
  `<aside class="notes">`).
- overflow / scale-to-fit *(WP6)* — per-region measure-and-scale (`--region-
  scale`), `fit=scroll|off`, editor overflow signal. The Phase-0 spike / make-
  or-break.
- `assets/app.js` *(WP7)* — the in-file runtime, plain JS, inlined into every
  `.slides.html`: present mode (reveal nav/overview/speaker), the per-slide
  pop-out editor (CodeMirror + morphdom single-slide preview), deck ops, and
  self-reproducing save (FS-Access + IndexedDB + download + served-notice).
  **Port heavily from orz-mdhtml.**
- `src/cli.ts`, `src/template.ts`, `src/browser-entry.ts`, `build/bundle.ts`
  *(WP8)* — the CLI, the `.slides.html` shell (reveal scaffold + `#orz-deck` +
  app), `window.orzslides` (parse + assemble + reveal-init), and the esbuild
  bundle. Mirror orz-mdhtml packaging exactly.

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
- A generated file needs internet to view (engine/themes/libs from CDN);
  presenting and PDF export work in all modern browsers, **editing/Save only in
  Chromium**.

## Sibling projects

- `../orz-markdown` — the renderer. The `{{chart}}` plugin (WP4) lands there, and
  region bodies are rendered through it.
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
