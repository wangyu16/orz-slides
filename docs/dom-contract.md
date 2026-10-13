# The slide DOM and theme contract (orz-slides 1.0)

The single truth shared by the slide renderer (`src/render-slide.ts`, pure),
the engine (`src/present/`: reveal.js, fit, decoration, print, speaker view),
the engine's structure stylesheet (`assets/themes/deck.css`) and the slide
themes (`assets/themes/<id>.css`, built by `scripts/build-themes.ts`). Change
a class, an attribute or a token here **and** in all of them together.

It stays internal to orz-slides (family REBUILD §3c: no FC while no other
repository styles decks). Rebuild step 3 wrote it with one theme (Orchard);
step 4 ports the other 13 themes onto it.

## 1. Logical size

A slide is laid out at a fixed **logical size** — height 720 for every ratio
(Q2): 16:9 = **1280 × 720**, 4:3 = **960 × 720** (header `ratio`). Every px
in deck.css and in a theme is a logical slide px; reveal.js scales the whole
slide to the window (a transform), so layout and fit never depend on the
window. The engine sets `--sl-w` / `--sl-h` on the deck root.

## 2. The deck roots

| Where | Root | Slides |
|---|---|---|
| Read view (the page) | `#orz-view.orz-slides > .reveal.orz-deck[data-orz-theme]` | `.slides > section.orz-slide` (reveal.js positions them) |
| Print document | `.reveal.orz-deck.orz-print[.orz-with-notes]` | `.orz-page > section.orz-slide` (+ `.orz-print-notes`) |
| Speaker view stages | `.reveal.orz-deck.orz-print` (scaled) | `.orz-page > section.orz-slide` |

A theme selects with the `.reveal` prefix (`.reveal .orz-slide …`), so the
same rules style the read view, the print document and the speaker view.
reveal.js's own stylesheet is loaded only in the read view; nothing a theme
needs may come from it.

## 3. One slide

```html
<section class="orz-slide [class option]"
         data-kind="normal|template" [data-template="title|section|outline|closing"] [data-v="2"]
         data-fit="fit|scroll|off" data-n="4" data-sec="01"
         [id] [data-transition] [data-step="1"] [data-background-color|data-background-image]
         style="--progress:0.2727">

  <!-- TOP SLOT: the running head (hidden by default: display none; a theme shows it) -->
  <div class="orz-head">
    <span class="orz-head-deck">Deck title (header title, inline Markdown)</span>
    <span class="orz-head-sec" data-sec="01">Current section title</span>
  </div>

  <div class="orz-frame">                       <!-- flex column, height 100% -->
    <!-- normal slide -->
    <header class="orz-title orz-box"><div class="markdown-body"><h2>…</h2></div></header>
    <div class="orz-content">                   <!-- the layout grid (src/layout.ts) -->
      <div class="orz-split" style="display:grid;grid-template-columns:3fr 2fr">
        <div class="orz-region orz-box" data-region="left"><div class="markdown-body">…</div></div>
        …
      </div>
    </div>
    <!-- template slide instead: one bounded box -->
    <div class="orz-template orz-template-title [orz-v2] orz-box" data-orz-copy>
      <h1 class="orz-title-main">…</h1><div class="orz-title-sub">…</div>
      <div class="orz-title-meta markdown-body">…</div>
      [<div class="orz-qr-slot"><span class="qrcode" data-md="{{qr …}}">…</span></div>]   <!-- closing, lone QR -->
    </div>
  </div>

  <div class="orz-float orz-box" style="left:13%;top:27%;width:17%;height:16%"><div class="markdown-body">…</div></div>

  <!-- BOTTOM SLOT: footer, section, number, progress -->
  <div class="orz-chrome">
    [<div class="orz-footer"><div class="markdown-body">…</div></div>]   <!-- @footer, else the deck footer; never on the title page -->
    <span class="orz-chrome-sec" data-sec="01">Section title</span>       <!-- hidden by default -->
    [<span class="orz-chrome-num"><b>4</b><i>/</i><span>12</span></span>]  <!-- header slide_numbers (default yes) -->
    [<span class="orz-chrome-bar" aria-hidden="true"></span>]            <!-- header progress (default yes); width from --progress -->
  </div>

  [<aside class="notes">…</aside>]               <!-- speaker notes: never shown on the slide -->
</section>
```

Template bodies: **title** and **closing** — `h1.orz-title-main`,
`.orz-title-sub` (the h2), `.orz-title-meta` (the rest); **section** —
`.orz-section-main[data-sec]` (its heading) and `.orz-section-meta`;
**outline** — `.orz-outline.markdown-body[data-here]` holding the list, the
current item `li.orz-here[aria-current=step]`.

### Attributes the engine sets

| Attribute / property | Where | Meaning |
|---|---|---|
| `data-n` | section | 1-based slide number |
| `data-sec` | section, `.orz-head-sec`, `.orz-chrome-sec`, `.orz-section-main` | the section label in the deck's style: `1` (plain), `I` (roman), `01`, or `''` (none, or before the first section) |
| `--progress` | section | (n − 1) / (total − 1), 0 … 1 |
| `li.orz-here` | outline | the next section's item (automatic), or `here=N`; none for `here=0` |
| `.fragment` | step units | `step` slides: each top-level list item and every other top-level block of a region |
| `.orz-qr-slot` | closing template | a lone `{{qr}}` lifted out of the text |
| `--fit-scale` | `.orz-box` | the box's font scale (absent = 1) |
| `data-scale` | `.orz-box` | `1` or the scale (two decimals) — always set once fitted |
| `data-clipped` | `.orz-box` | content is cut (at the floor, or `fit=off`) |
| `data-scroll` | `.orz-box` | `fit=scroll` and the content scrolls |
| `data-fitted` | section | fit has run on it |

## 4. Fit

Every `.orz-box` (title band, region, template box, float) shows its content
on both axes: an overflowing box is scaled by font size
(`font-size: calc(1em * var(--fit-scale))`) to the largest scale that fits,
never below **0.6**; still overflowing at 0.6, it is marked `data-clipped`.
`fit=off` never scales but marks; `fit=scroll` scrolls. The title band is
bounded in width only. Overflow counts the box itself and any element inside
it that clips or scrolls its content (a wide table or code block). Pictures
and diagrams in a region take the room left (`flex: 1 1 0`, at least
`--sl-graphic-min`); molecules and charts are sized in `em`, so fit scales
them. Fit runs on the visible slide only (and on every page of the print
document).

**Theme rules for fit:** size text in `em` (relative to the slide size
`--sl-size`) so a box's scale reaches it; padding in px is fine; never set
`overflow: visible` on `.orz-region` or `.orz-template`; do not give boxes a
fixed height.

## 5. Tokens

Set by a theme on `:root` (defaults in deck.css):

| Token | Default | |
|---|---|---|
| `--sl-size` | 28px | body text size |
| `--sl-lh` | 1.42 | body line height |
| `--sl-pad-t`, `--sl-pad-x` | 48px, 72px | slide padding (top, sides) |
| `--sl-chrome` | 56px | bottom slot height (= the slide's bottom padding) |
| `--sl-head` | `--sl-pad-t` | top slot height |
| `--sl-gap` | 40px | gap between regions |
| `--sl-title-gap`, `--sl-title-size` | 28px, 1.62em | title band |
| `--sl-bg`, `--sl-ink`, `--sl-viewport`, `--sl-mono` | — | slide background, text colour, the page around the slide, code font |
| `--sl-graphic-min` | 4em | the smallest height a picture or diagram keeps |
| `--sl-qr` | 4.6em | the QR code's size in its slot |
| `--chart-*`, `--mm-*` | the orz-markdown theme's | Chart.js and Mermaid colours and fonts (orz-markdown 2.4.0, read where drawn) |
| `--chart-font-size` | 18 | Chart.js font size in logical px (carrier stop-gap until the kit reads one) |

Read only: `--progress`, `--fit-scale`, `--sl-w`, `--sl-h`, `--sl-page-h` (print).

## 6. Header keys

`slide_numbers` (yes/no) and `progress` (yes/no) decide whether
`.orz-chrome-num` and `.orz-chrome-bar` exist at all; `section_numbers`
(`plain`/`roman`/`01`/`none`) decides `data-sec`, defaulting to the theme's
style (`src/themes.ts` `sectionNumbers`: Paper roman, the others 01). The
running head and the QR placement are theme design, not keys (Q3).

## 7. A theme

A derived theme (`assets/themes/<id>.css`, generated — never edited) is
orz-markdown's `common.css` and its source theme adapted to a slide, then
`layers/slide-scale.css`, then the theme's layer `layers/<id>.css` (the only
hand-written part: chrome slots, title band, templates and variants,
outline, fragments, floats). The engine carries deck.css and the built
themes inside its bundle (inline and cdn decks style the same) and installs
them as `<style id="orz-deck-css">` and `<style id="orz-slide-theme"
data-theme data-theme-css>`. The four updated 0.x themes (Architect, Chalk,
Neon, Paper) are layers without a source theme (step 4).

Porting a concept layer (branch `concepts/themes`) to this contract:
the footer now sits inside `.orz-chrome` (whose font size is 0.6em: scale
the footer's own size by 1 / 0.6); the current outline item is
`li.orz-here` (was `li:has(> strong)`); the closing's QR code is
`.orz-template-closing > .orz-qr-slot` (was `span.qrcode` inside the meta);
a running head belongs in `.orz-head` (was `.orz-chrome-sec` moved up by a
negative offset); `data-sec` is already the label in the deck's style (no
roman mapping in CSS); `--region-scale` is `--fit-scale`; the concept's
`--chart-palette` / `--chart-ink` / `--mm-node-2` are orz-markdown's
`--chart-1…8` / `--chart-text` / `--mm-*`.
