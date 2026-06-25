# orz-slides

Turn notes or Markdown into a **single, self-contained `.slides.html`** — one
portable file that presents like a slide deck in any browser, is authored in
[orz-markdown](https://www.npmjs.com/package/orz-markdown) with a small layout
syntax, and stays *quietly editable*. Built on
[reveal.js](https://revealjs.com) for the deck mechanics.

One file. Open it in a browser to present. Pop out a per-slide editor to change
a slide. Save it back in place. Nothing to install for the audience.

> **Status: in active development.** Nothing is published yet. The authoring
> syntax is settled (see [DESIGN.md](./DESIGN.md) §5/§14); tooling, CLI flags,
> and the runtime are still being built.

## What a `.slides.html` does

1. **Presents in any browser.** The deck is a reveal.js presentation —
   keyboard/touch navigation, slide overview (ESC), speaker notes + timer (S),
   fullscreen (F), and PDF export — with no install for the viewer.
2. **Authored in orz-markdown.** Every slide is Markdown (math, mermaid, smiles,
   qr, charts, tabs, containers) — never hand-written HTML — divided into
   regions by a small **comment-based layout syntax**.
3. **Edits in place.** A per-slide **pop-out editor** (CodeMirror + live preview
   of just that slide) lets you rewrite a slide and **Save** the whole file —
   in-place on Chromium, or as a downloaded copy elsewhere.
4. **Template-driven structure pages.** Title, section, outline, and closing
   slides come from a small gallery of templates.
5. **Self-contained, CDN-delivered.** The deck source is embedded in the file as
   the single source of truth; everything else (reveal.js, the orz-markdown
   renderer, themes, libraries) loads from jsDelivr, cached after first open.

The deck source lives in the file as the single source of truth; Save
re-serializes the whole document around it:

```html
<script type="text/orz-slides" id="orz-deck">
  ...deck config + slides (this is what you write)...
</script>
```

> "Self-contained" means *works as one file*, **not** *zero network*. The engine
> (`orz-slides-browser` from jsDelivr by default), theme CSS, and libraries
> (KaTeX, Mermaid, SmilesDrawer, Chart.js) load from CDN, so **viewing needs
> internet**. Presenting, themes, and PDF export work in all modern browsers;
> in-place Save needs a Chromium browser.

## Its place in the orz family

orz-slides is the slide-deck sibling of
[orz-mdhtml](https://www.npmjs.com/package/orz-mdhtml), sharing the same
philosophy — deck-first, quietly editable, self-contained, CDN-delivered
renderer — and the same in-file editor stack (CodeMirror, morphdom live preview,
File System Access save, theme picker, copy-as-markdown). Both render content
through **orz-markdown**:

- **orz-markdown** — the Markdown renderer (parser, plugins, themes) that turns
  region bodies into HTML.
- **orz-mdhtml** — produces an editable `.md.html` *document* to read and
  annotate.
- **orz-slides** — produces an editable `.slides.html` *deck* to present.

Reach for `.md.html` when the output is a document to read; reach for
`.slides.html` when it is a deck to present.

## Authoring example

A deck source is plain text: an optional leading `<!-- deck … -->` config block,
then a sequence of slides. **Every slide begins with a `<!-- slide … -->`
marker** — that marker is also the slide separator. There is no bare `---`.

```
<!-- deck
  title: Controlled Polymerization
  theme: executive
  ratio: 16:9
  author: Dr. Yu Wang
  footer: Internal · v3 · 2026
-->

<!-- slide template=title -->
# Controlled Polymerization
## RAFT vs ATRP
**Dr. Yu Wang** · University of Louisiana · 2026

<!-- slide -->
## Why controlled polymerization
- Narrow dispersity, predictable chain length
- Block copolymers by sequential addition
- The tradeoff: rate vs control

<!-- slide 2col 3/2 -->
## Results at a glance
<!-- @left -->
- Accuracy **92%** across all runs
- Latency under **40 ms**
<!-- @right -->
{{smiles C(=S)(SC)SC}}
<!-- @notes -->
Lead with accuracy; the latency number is the surprise — pause here.
```

The leading `## h2` becomes each slide's title band automatically; layout
presets (`2col`, `3col`, `main-side`, `quad`, …) and raw `row/col` splits divide
the content area into named regions filled by `<!-- @name -->`. See
[orz-slides-skills/SKILL.md](./orz-slides-skills/SKILL.md) for the full layout
grammar, templates, and per-container capacity budgets.

## Key features

- **Portable & self-contained** — one `.slides.html` opens and presents in any
  modern browser; renderer, engine, and themes load from CDN.
- **Markdown-native slides** — orz-markdown content (math, mermaid, smiles, qr,
  charts) in every region, never hand-written HTML.
- **Layout by space division** — a recursive `row`/`col` split grammar, with
  terse preset aliases for the common cases.
- **In-browser per-slide editor** — pop-out CodeMirror + live preview; deck ops
  (add / duplicate / delete / reorder / theme / ratio).
- **Structure templates** — title / section / outline / closing pages from a
  small gallery.
- **Presenter-grade** — navigation, overview, speaker notes + timer, and PDF
  export inherited from reveal.js.
- **Overflow that behaves** — scale-to-fit per region (with `fit=scroll|off`),
  backed by agent capacity budgets so slides are authored within their bounds.

## Browser support

| Feature | Support |
|---|---|
| Present, navigation, overview, speaker notes, theme switch, PDF export | All modern browsers |
| Per-slide pop-out editor (CodeMirror, live preview) | All modern browsers |
| **Save in place** (File System Access API) | Chromium (Chrome/Edge); others fall back to download a copy |

Viewing requires internet (engine, themes, and libraries load from CDN, cached
after first open).

## License

MIT
