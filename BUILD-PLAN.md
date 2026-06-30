# orz-slides — build plan (modular, parallelizable)

Implements [DESIGN.md](./DESIGN.md). Strategy: **interface-first** — lock the
shared types and the DOM/CSS contract, then build the independent leaf modules
**concurrently** (each unit-verifiable in isolation), then integrate.

## Dependency graph

```
        ┌──────────────────────── WP0 Foundation (types + DOM contract + scaffold) ──┐
        │ (blocking; defines every interface below)                                  │
        └───────────────────────────────────────────────────────────────────────────┘
   WAVE 1 — independent, concurrent (subagents)
     WP1 parser        WP2 layout        WP3 themes        WP4 {{chart}}      WP9 skill/docs
     (pure → AST)      (AST → grid)      (CSS vs contract) (orz-markdown)     (text)
        │  └────────┬──────┘                 │                                   
   WAVE 2 — integration (sequential; lead)
     WP5 render-slide (assembler: parser+layout+orz-markdown → <section>)
       → WP6 overflow/scale-to-fit (browser)
       → WP7 in-file app.js (present/edit/pop-out editor/save — port from orz-mdhtml)
       → WP8 CLI + template + bundle + browser package (packaging)
       → WP10 end-to-end browser validation + example deck
```

## Work packages

Each WP lists: **owns** (files it may write — disjoint, so concurrency is safe),
**interface** (what it implements/consumes), **verify** (independent check), and
**parallel** (can it run concurrently in Wave 1).

### WP0 — Foundation *(lead, blocking)*
- **Owns:** `package.json`, `tsconfig.json`, `build/bundle.ts`, `.gitignore`,
  `src/types.ts`, `docs/dom-contract.md`, stub `src/*.ts` with signatures.
- **Interface:** defines `Deck`, `Slide`, `LayoutNode`, `Region`, `FloatRegion`,
  `DeckConfig`, etc., and the rendered-slide DOM + CSS-variable contract.
- **Verify:** `npx tsc --noEmit` compiles; deps install.

### WP1 — Slide parser  *(parallel)*
- **Owns:** `src/slide-parser.ts`, `tests/parser.test.ts`.
- **Interface:** `export function parseDeck(source: string): Deck`. Implements:
  split at `<!-- slide … -->`; parse `<!-- deck … -->`; per slide parse the
  layout (preset alias **or** raw `row/col` split grammar), regions
  (`<!-- @name -->`), floats (`<!-- @float … -->`), options, the leading-h2
  title, `@notes`, `@footer`; apply heading lint (h1 only on title pages; exactly
  one h2; no second h2). Consumes `expandPreset` from WP2 for alias→tree.
- **Verify:** vitest — sample deck sources → asserted `Deck` AST (grammar,
  nesting, presets, floats, lint cases). Pure functions; no DOM, no network.

### WP2 — Layout engine  *(parallel)*
- **Owns:** `src/layout.ts`, `tests/layout.test.ts`.
- **Interface:** `expandPreset(name, ratio?): LayoutNode | null` (aliases →
  tree); `renderLayout(node: LayoutNode): { html: string; regions: string[] }`
  → a nested CSS-grid DOM (nested splits = nested grid `<div>`s), leaves =
  `<div class="orz-region" data-region="NAME"></div>` placeholders, per the DOM
  contract. Track ratios → `grid-template-*`.
- **Verify:** vitest — `LayoutNode`/preset → expected grid HTML + region list;
  nesting, ratios, header/footer-as-split. Plus a static harness page.

### WP3 — Themes  *(parallel)*
- **Owns:** `assets/themes/*.css` (base + 7), `tests/theme-harness.html`.
- **Interface:** style the DOM contract — `.orz-slide`, `.orz-title`,
  `.orz-content`/`.orz-region`, `.orz-footer`, `.orz-float`, and `.markdown-body`
  content within regions; define the `:root` token set; reveal.js compat.
- **Verify:** open `theme-harness.html` (a static sample slide using the
  contract) in a browser, switch the `<link>` across the 7 themes; visual check
  + structural assertions (tokens present, content legible).

### WP4 — `{{chart}}` plugin  *(parallel; different repo: orz-markdown)*
- **Owns (in ../orz-markdown):** `src/plugins/chart.ts`, register in
  `src/index.ts`, `tests/chart.test.ts`, add `chart.js` dep.
- **Interface:** a `{{chart …}}` block → `<canvas data-chart="…" …>` + a
  `data-md` breadcrumb (round-trips via copy-as-markdown). Design a small config
  syntax (type + data; JSON or compact). Client draws via Chart.js (enhancer,
  like smiles).
- **Verify:** orz-markdown vitest (render → canvas + data-md; copy walker emits
  the directive). Self-contained; does **not** touch orz-slides.

### WP5 — Render-slide / assembler  *(lead, Wave 2)*
- `renderSlide(slide, md, deckConfig) → <section> HTML`: title band + grid (WP2)
  with each region's markdown rendered by orz-markdown + floats + footer + notes.
- **Verify:** snapshot tests (slide AST → HTML) + first browser render.

### WP6 — Overflow / scale-to-fit  *(lead, Wave 2; the spike)*
- Per-region measure-and-scale; `fit=scroll|off`; editor overflow signal.
- **Verify:** browser — over-stuffed region scales to a floor and stays put.

### WP7 — In-file app runtime  *(lead, Wave 2)*
- `assets/app.js`: present mode (reveal nav/overview/speaker), per-slide pop-out
  editor (CodeMirror + live single-slide preview via morphdom), deck ops
  (add/dup/delete/reorder/theme), self-reproducing save (FS-Access + IndexedDB +
  download + served-notice), copy-as-markdown. **Port heavily from orz-mdhtml.**
- **Verify:** browser — present, edit a slide, save; reuse orz-mdhtml test method.

### WP8 — CLI + template + bundle + browser package  *(lead, Wave 2)*
- `src/cli.ts` (deck source → `.slides.html`), `src/template.ts` (shell:
  reveal scaffold + `#orz-deck` + app), `src/browser-entry.ts`
  (`window.orzslides`: parse+assemble+reveal-init), `build/bundle.ts`
  (esbuild reveal + orz-markdown + parser + layout + runtime → `orz-slides-browser`),
  `browser/` package. Mirror orz-mdhtml packaging exactly.
- **Verify:** generate a `.slides.html`, open in browser end-to-end.

### WP9 — Agent skill + docs  *(parallel)*
- **Owns:** `orz-slides-skills/SKILL.md`, `README.md`, `CLAUDE.md`.
- **Interface:** the settled syntax (DESIGN §5), capacity budgets (§14),
  templates, do/don'ts. Mirror the family's skill/README/CLAUDE style.
- **Verify:** review against DESIGN.md for accuracy/consistency.

### WP10 — End-to-end validation  *(lead, last)*
- A real example deck exercising every preset, template, float, math/mermaid/
  smiles/chart, overflow; browser-verified. PDF export remains a planned
  presenter extra.

## Parallelization

- **Wave 1 (concurrent subagents):** WP1, WP2, WP3, WP4, WP9 — disjoint files,
  each independently verifiable. WP1 consumes WP2's `expandPreset` *type* (in
  `types.ts`); both code against the locked interface, integrated in WP5.
- **Wave 2 (sequential, lead):** WP5 → WP6 → WP7 → WP8 → WP10, pulling Wave-1
  outputs together.

## Milestones

- **M1 — interfaces locked** (WP0). 
- **M2 — leaves green** (WP1–4, WP9 pass their own checks).
- **M3 — first slide renders** (WP5 + WP2 + parser in a browser harness).
- **M4 — fit works** (WP6).
- **M5 — editable deck** (WP7 + WP8: a real `.slides.html` presents, edits, saves).
- **M6 — release** (publish `orz-slides` + `orz-slides-browser`, lockstep).

## Risks (carried from DESIGN §15)

Overflow/fit (M4 is the gate); editing inside reveal's DOM (regenerate one
section + `reveal.sync()`); theme↔markdown reconciliation (DOM contract is the
shared truth); bundle size (default `--inline`, optional `--cdn`, lazy-load editor
libs).
