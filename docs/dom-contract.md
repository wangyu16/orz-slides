# The slide DOM and theme contract (orz-slides 1.0)

The single truth shared by the slide renderer (`src/render-slide.ts`, pure),
the engine (`src/present/`: reveal.js, fit, decoration, print, speaker view),
the engine's structure stylesheet (`assets/themes/deck.css`) and the slide
themes (`assets/themes/<id>.css`, built by `scripts/build-themes.ts`). Change
a class, an attribute or a token here **and** in all of them together.

It stays internal to orz-slides (family REBUILD §3c: no FC while no other
repository styles decks). Rebuild step 3 wrote it with one theme (Orchard);
step 4 ported the other 13 themes onto it (14 in all, owner decision 5).

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
| Speaker view stages | `.reveal.orz-deck.orz-print[data-orz-theme]` (scaled) | `.orz-page > section.orz-slide` — static copies from the print pipeline (canvases frozen to images, fitted) |

A theme selects with the `.reveal` prefix (`.reveal .orz-slide …`), so the
same rules style the read view, the print document and the speaker view.
reveal.js's own stylesheet is loaded only in the read view; nothing a theme
needs may come from it.

## 3. One slide

```html
<section class="orz-slide [class option]"
         data-kind="normal|template" [data-template="title|section|outline|closing"] [data-v="2"]
         data-fit="fit|scroll|off" data-n="4" data-sec="01"
         [id] [data-transition] [data-step="1"] [data-background-color|data-background-image|data-background-gradient]
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
| `p.orz-pic` | a region's paragraph | the paragraph IS a picture: one image (or one linked image) and nothing else (round A3). deck.css sizes it to the room its box leaves; a theme frames pictures through it, never through `p:has(> img)` / `p > img`, which also reach a sentence with an inline icon and a caption written above its picture (the build contract refuses such a rule) |
| `.orz-video-still` | static copies (print, the speaker view) | a `{{youtube}}` player replaced by a still of the same size showing the video's address (`.orz-video-poster` > `.orz-video-mark`, `a.orz-video-url`); its `data-md` and `data-url` kept (round A3) |
| `--fit-scale` | `.orz-box` | the box's font scale (absent = 1) |
| `data-scale` | `.orz-box` | `1` or the scale (two decimals; `1` when it rounds to 1) — always set once fitted |
| `data-clipped` | `.orz-box`, `.orz-footer` | content is cut (at the floor, or `fit=off`); on the footer: its one line is ellipsized (its `title` holds the full text) |
| `data-scroll` | `.orz-box` | `fit=scroll` and the content scrolls |
| `data-fitted` | section | fit has run on it (a provisional pass: content may still arrive) |
| `data-fit-settled` | section | its fit is final: the fonts, the content libraries, its images and stylesheets (a theme `<style>`'s `@import`ed webfont CSS included: `data-orz-loading` on it while it loads) are in, its diagrams drawn, a frame passed with nothing to refit (`timeout`: 10 s of one settle CYCLE passed first — a cycle begins when the slide shows and whenever a settled slide is unsettled: a refit, a theme or size switch, Present, the deck shown again). With it the deck root fires `orz-fitted` (`detail: { index, timeout }`); `engine.settled()` resolves. Tests, agents and the editor's badges wait for this, never for `data-fitted` |

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
document and of the speaker view's copies), and it SETTLES: the slide's
content is drawn at its size before its first fit, and one
ResizeObserver over its box contents plus a MutationObserver for what is
drawn into them later (a chart's frame, a Mermaid SVG) refit it when its
content changes size; fonts, stylesheets and images that finish loading do
too. A chart's canvas follows its frame in CSS (`.orz-chart-frame > canvas
{ width: 100%; height: auto }`) at the chart's aspect (`--orz-chart-r` on
the frame, set by the engine; `--chart-aspect` until then), so the size a
trial scale gives is what is drawn. A chart that is a block of its own in a
region is put in a room by the engine, `div.orz-chart-room` (round A4):
the room takes the space its box leaves (`flex: 1 1 0`, at least
`--sl-graphic-min`) and is the size container of the largest chart at its
aspect in it — the frame hugs the chart (a theme whose frame is padded sets
`--orz-chart-pad-x` / `--orz-chart-pad-y`, padding plus border). A paragraph
of two or more images and nothing else is `p.orz-pics`, a row that shares
the room left; a picture anywhere else (a callout, a quote, a list item, a
table cell) is capped at 12em, so fit scales it. With `section_numbers:
none` (an empty `data-sec`) deck.css hides `.orz-section-main::before`; a
theme whose number is its `::after` hides that itself (the build contract
checks). The search guesses √(overflow ratio), learns the exponent from the
last two measurements when the guess still overflows (content that does not
reflow scales as s¹), and brackets the answer to 0.01; a refit starts from
the box's last scale for that theme and size.

On paper and in the speaker view nothing scrolls: a `fit=scroll` slide is
fitted there like any other; the print document's notes area
(`.orz-print-notes`) is fitted the same way (font size `calc(22px *
var(--fit-scale))`). Every cut on paper is VISIBLE: a box cut at the floor
or by `fit=off` (a `fit=scroll` slide past the floor included) and notes cut
at the floor each get the same notice on the page, `.orz-print-cut`
(absolutely placed at the cut box's bottom right; deck.css draws it), and
print says which slides it cut (`printHtml().cut`, the reader's notice).
Images load eagerly in a static copy (`loading="eager"`); audio and video
never autoplay or preload in one, and on screen `autoplay` becomes reveal's
`data-autoplay` (played on its slide only).

Boxes clip with `overflow: clip; overflow-clip-margin: 6px` (deck.css):
nothing scrolls a box, and the glyphs of a big first or last line may stand
a few px past their line box without being cut (the oracle honours the
margin). A display formula clips sideways only.

**Theme rules for fit:** size text in `em` (relative to the slide size
`--sl-size`) so a box's scale reaches it; padding in px is fine; never set
`overflow: visible` (or `hidden`) on `.orz-region` or `.orz-template`; do not
give boxes a fixed height. A decoration that hangs outside its box (a numeral
in the margin, a column divider in the gap, a tick past a title's end) is
cut by the box: give the box the room instead (a negative margin and the same
padding, as Copper's outline, Paper's section page and Architect's title band
do), or draw it with a shadow, which is not overflow. A decoration's
untransformed box counts as overflow (fit would shrink the page): place it
with margins, not `transform`. A template box's padding must leave room for
tilted or stroked lettering. Charts and molecules are sized in `em`.

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
| `--chart-*`, `--mm-*` | the orz-markdown theme's | Chart.js and Mermaid colours and fonts (orz-markdown 2.4.0, read where drawn); a dark theme sets light ink on its dark (dark-native: no light panel) |
| `--chart-font-size`, `--mm-font-size` | 18 | chart and diagram text in logical px (a theme sets 18–22) |
| `--chart-aspect`, `--chart-max-width` | 1.6, `min(100%, 20.8em)` | a chart's shape and width cap (≤ 13em tall: fit scales it) |
| `--mm-labels` | `svg` (deck root) | Mermaid labels as SVG text (reveal scales with a transform) |
| `--orz-grid` | — | on `.orz-region > .markdown-body`: the kit's baseline grid (Notebook); fit re-aligns it at each scale, and an unscaled body starts on one of the slide's lines (its top padded to the next multiple of the pitch from the slide's top) |
| `--sl-accent`, `--sl-accent-ink` | — (required) | the theme's signature colour and the text that reads on it (≥ 4.5 : 1): the template variants draw with them (§7) |
| `--sl-surface` | the accent at 12 % | a quiet tint (section v3's band, outline v2's cards) |
| `--sl-band` | `--sl-accent` | title v4's band |
| `--sl-cover`, `--sl-cover-ink` | `--sl-accent`, `--sl-accent-ink` | the cover pages (title v5, closing v2); a theme whose title page is already a coloured cover sets others (Notebook: its paper) |
| `--mm-gantt-axis-format`, `--mm-gantt-today` | `auto`, `off` (deck root) | a gantt chart's axis by its span and width, its text at `--mm-font-size`, no today line (orz-markdown 2.4.0); the chart's own `axisFormat` / `tickInterval` win |
| `--sl-sec-indent` | 0 | on `.orz-section-main`: the room a theme keeps at the title's left for its section number; section v3/v4 add their padding to it (never the `padding` shorthand) |
| `--sl-cover-chrome-ink` | `--sl-cover-ink` | on a chrome part the theme draws on its OWN surface (a title block, a status bar, a badge): its ink on the cover pages |
| `--sl-title-edge` | 0 | on `.orz-title-main`: the room the title's edge marks need (title v6 / closing v3 set the title as wide as the box less this) |

Read only: `--progress`, `--fit-scale`, `--sl-w`, `--sl-h`, `--sl-page-h` (print).

**Chrome text:** every text a theme shows in the slots (running head,
footer, section, number) is at least 20 px at the logical size — themes set
`.orz-chrome { font-size: 20px }` (deck.css's default is 0.6em of the slide)
and size the slot's parts from it. The footer's Markdown inherits the
footer's font. Every chrome text lies inside its slot and the slide, or is
explicitly ellipsized: the footer is ONE line (deck.css: `white-space:
nowrap; text-overflow: ellipsis` on its text; a theme never lets it wrap) —
a long course line ends in an ellipsis, never past the slide's edge, and no
chrome text overprints another (Nocturne lays its status bar out as one flex
row). The chart palette (`--chart-1…6`) reads apart for every reader: ΔE ≥
18 pairwise and ≥ 10 under protan, deutan and tritan simulation (claims T.6,
T.13).

**reveal's background copies:** reveal copies a section's classes onto its
background layer (`.backgrounds > .slide-background`), so a `.orz-slide`
rule also matches that copy. deck.css takes reveal's geometry and paint back
for it (`!important`) and removes its `::before`/`::after`, and a slide with
`bg=` has its own page transparent (`!important`), so `bg=` shows on every
slide in every theme — a cover page (title v5, closing v2) included: the
author's background replaces the cover colour, the cover ink stays (round
A3). A CSS gradient is `data-background-gradient` (reveal's; a colour, an
image or a gradient — the print document and the speaker's copies draw all
three). A theme never styles `.slide-background` (claim T.14).

**Nothing placed covers content** (round A3): an absolutely placed block a
theme draws (a title block, a label, a badge) never lies over a text — put
it in flow, or keep the content out of its room (Architect's title block is
in flow on every title variant, its scale bar keeps its own band). The
stress oracle T.11 checks it (an opaque box over any text line, and placed
`::before`/`::after` text over a text).

**A video** (`{{youtube}}`) is sized like a picture: as a block of its own,
the largest 16:9 player in the room its box leaves (container units); in a
container (a callout, a column) em-sized, so fit scales it.

## 6. Header keys

`slide_numbers` (yes/no) and `progress` (yes/no) decide whether
`.orz-chrome-num` and `.orz-chrome-bar` exist at all; `section_numbers`
(`plain`/`roman`/`01`/`none`) decides `data-sec`, defaulting to the theme's
style (`src/themes.ts` `sectionNumbers`: Paper roman, the others 01) — the
number only: with `none` a theme still shows the section title wherever it
shows it with a number (hide a section part only when it is `:empty`; round
A3). The
running head and the QR placement are theme design, not keys (Q3).

## 7. A theme

A derived theme (`assets/themes/<id>.css`, generated — never edited) is
orz-markdown's `common.css` and its source theme adapted to a slide, then
`layers/slide-scale.css`, then the theme's layer `layers/<id>.css` (the only
hand-written part: chrome slots, title band, templates, outline,
fragments, floats; the variants are deck.css's, drawn with the layer's
tokens — below). Notebook also keeps its source's screen
notebook (the `@media screen` rules, rescoped to `.reveal .orz-region >
.markdown-body`): region text is written on the slide's ruled lines by the
kit's grid pass, and a region fit shrank becomes a ruled sheet. The four
updated 0.x themes (Architect, Chalk, Neon, Paper) have no source theme:
`layers/content.css` (Markdown content in theme tokens) then their layer.
The engine carries deck.css and the 14 built themes inside its bundle
(inline and cdn decks style the same) and installs them as `<style
id="orz-deck-css">` and `<style id="orz-slide-theme" data-theme
data-theme-css>`. The review page of all 14 on the sample deck is
`npx tsx scripts/theme-sheets.ts` (the family test hub).

**Template variants** (`v=`; the set is 0.x's and `TEMPLATES` in
src/deck/parse.ts): every variant has a look of its own in every theme
(claim T.10). v1 is the theme's own page; the others are compositions
deck.css draws with the theme's tokens (`--sl-accent`, `--sl-accent-ink`,
`--sl-surface`, `--sl-band`, `--sl-cover`, `--sl-cover-ink`) over the
theme's fonts and decoration, selected by the section's `data-template` and
`data-v` (so they win over a theme's `[data-template]` rules; a theme may
refine one with a more specific rule):

| Template | v2 | v3 | v4 | v5 | v6 |
|---|---|---|---|---|---|
| title | left-set, an accent bar down the page's left | a kicker (the subtitle above, small capitals in the accent) between accent rules | split: an accent band (`--sl-band`) down the left third, the page beside it | cover: the slide in `--sl-cover`, the page low on the left in `--sl-cover-ink` | oversized: the title set large, low on the left, with the kicker |
| section | centred, the title in the accent, larger | the title on a tinted band with an accent bar | the title in an outlined box, centred | — | — |
| outline | each item a card with an accent edge | two balanced columns | — | — | — |
| closing | cover sign-off (`--sl-cover`), centred | oversized, low on the left | — | — | — |

A theme whose own page already uses a device (Notebook's title page is a
coloured cover) sets the tokens on those slides so the variants still read
apart (Notebook: the margin's pink for marks, its paper for the band and
the inside cover). `scripts/build-themes.ts` refuses a theme that lacks a
required token or a variant rule (claim T.13).

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
