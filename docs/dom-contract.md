# Rendered-slide DOM & CSS contract

The single source of truth shared by the **layout engine (WP2)**, the
**assembler (WP5)**, and the **themes (WP3)**. If you change this, update all
three.

## Slide structure

Each slide is one reveal.js `<section>`. A **normal** slide has the standard
frame (title band · content area · footer band); the content area holds the
grid produced by the layout engine; floats overlay the whole slide.

```html
<section class="orz-slide" data-fit="fit|scroll|off" data-kind="normal">

  <!-- title band: the slide's leading h2 (omitted if the slide has no title) -->
  <header class="orz-title"><div class="markdown-body"><h2>…</h2></div></header>

  <!-- content area: the layout grid (from WP2 renderLayout) -->
  <div class="orz-content">
    <!-- nested grid containers; a leaf region cell looks like: -->
    <div class="orz-region" data-region="left">
      <div class="markdown-body"><!-- region's rendered orz-markdown --></div>
    </div>
    …
  </div>

  <!-- footer band (omitted if no footer) -->
  <footer class="orz-footer"><div class="markdown-body">…</div></footer>

  <!-- float overlays (zero or more), absolutely positioned -->
  <div class="orz-float" style="left:58%;top:10%;width:36%;height:44%;z-index:1">
    <div class="markdown-body">…</div>
  </div>

  <!-- speaker notes (never shown on the slide) -->
  <aside class="notes">…</aside>
</section>
```

**Template slides** (`title`/`section`/`outline`/`closing`) set
`data-kind="template" data-template="title"` and use their own inner structure
(still wrapped in `.orz-slide`); they may use `.orz-title-*` helper classes.

## Layout grid (WP2 output)

`renderLayout(node)` returns the `.orz-content` *inner* HTML:

- A `SplitNode` → a `<div class="orz-split" style="display:grid; grid-auto-flow:…;
  grid-template-columns|rows: <tracks>">` containing its children.
  - `dir:'col'` → `grid-template-columns`; `dir:'row'` → `grid-template-rows`.
  - Tracks: bare number `2` → `2fr`; pass `auto`/`1fr`/`30%`/`200px` through.
  - `gap` is themed (CSS var `--slide-gap`), not inline.
- A `RegionLeaf` → `<div class="orz-region" data-region="NAME"></div>` (the
  assembler injects `<div class="markdown-body">…</div>` inside).

Nesting is real DOM nesting (`.orz-split` inside `.orz-region` cells is **not**
used — splits nest directly as grid items). Region names are unique per slide,
so `[data-region="name"]` is a unique selector.

## CSS variable contract (themes define these in `:root`)

Ported/adapted from the extension's `base.css`. Themes set:

```
--accent            brand/accent color
--ink               body text color
--bg                slide background
--font-heading      heading font stack
--font-body         body font stack
--heading-color     --heading-bg     (the h2 title-band styling)
--slide-gap         grid gap between regions (e.g. 28px)
--slide-pad         slide content padding
--box-info / --box-warning / --box-danger / --box-success
--table-head-bg / --row-highlight
/* dark themes also override reveal vars: --r-background-color, --r-main-color … */
```

Themes must style: `.orz-slide`, `.orz-title h2` (the title band),
`.orz-content`, `.orz-region`, `.orz-footer`, `.orz-float`, and **the
`.markdown-body` content inside regions** (headings h3–h6, lists, tables, code,
blockquote, `.box-*` callouts, math/mermaid/smiles wrappers) so orz-markdown
output looks right on a slide. Reuse orz-markdown's content classes where
possible.

## Fit (WP6)

The app sets `.orz-slide[data-fit]` and, when scaling, a per-region
`--region-scale` CSS variable on `.orz-region`. Themes should not hard-code font
sizes that fight the scale; size with `em`/variables.
