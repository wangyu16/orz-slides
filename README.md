# orz-slides

Turn notes or Markdown into a **single, self-contained `.slides.html`** — one
portable file that presents like a slide deck in any browser, is authored in
[orz-markdown](https://www.npmjs.com/package/orz-markdown) with a small layout
syntax, and stays *quietly editable*. Built on
[reveal.js](https://revealjs.com) for the deck mechanics.

One file. Open it in a browser to present. Pop out a per-slide editor to change
a slide. Save it back in place. Nothing to install for the audience.

> **Status: published (v0.1.0).** The authoring syntax, CLI, engine, and in-file
> editor all work (see [DESIGN.md](./DESIGN.md)). Two packages publish in
> lockstep: the [`orz-slides`](https://www.npmjs.com/package/orz-slides) CLI and
> the [`orz-slides-browser`](https://www.npmjs.com/package/orz-slides-browser)
> engine. Speaker view, step-reveal fragments, an on-deck timer, and slide
> numbers are wired; **PDF export** is the remaining planned extra.

## Install & generate

```bash
npm install -g orz-slides          # or: npx orz-slides <deck.md>
orz-slides deck.md                 # → deck.slides.html (inline engine + all 7 themes)
orz-slides deck.md --cdn           # reference the engine + theme from jsDelivr instead
orz-slides deck.md -o talk.slides.html --theme executive
```

The `--inline` default embeds the engine, reveal's core CSS, and all seven themes,
so a text deck presents (and switches themes) offline. `--cdn` keeps the file
small by loading the engine + theme from jsDelivr.

## What a `.slides.html` does

1. **Presents in any browser.** The deck is a reveal.js presentation —
   keyboard/touch navigation, slide overview (ESC), fullscreen (F) — with no
   install for the viewer.
2. **Authored in orz-markdown.** Every slide is Markdown (math, mermaid, smiles,
   qr, charts, tabs, containers) — never hand-written HTML — divided into
   regions by a small **comment-based layout syntax**.
3. **Edits in place.** A per-slide **pop-out editor** (CodeMirror + live preview
   of just that slide) lets you rewrite a slide and **Save** the whole file —
   in-place on Chromium, or as a downloaded copy elsewhere.
4. **Template-driven structure pages.** Title, section, outline, and closing
   slides come from a small gallery of templates.
5. **Self-contained.** The deck source is embedded in the file as the single
   source of truth. By default the CLI **inlines** the engine, reveal's core CSS,
   and all seven themes, so a deck **presents and switches themes even offline**.
   Only KaTeX (math), Mermaid, SmilesDrawer, Chart.js, and the editor
   (CodeMirror) load from CDN — so a deck that uses math/diagrams/charts, or
   in-browser editing, needs internet. `--cdn` references the engine + theme from
   jsDelivr instead.

The deck source lives in the file as the single source of truth; Save
re-serializes the whole document around it:

```html
<script type="text/orz-slides" id="orz-deck">
  ...deck config + slides (this is what you write)...
</script>
```

> "Self-contained" means *works as one file*. With the default `--inline`, the
> engine, reveal's core CSS, and all themes are embedded — a text deck presents
> offline. The math/diagram/chart libraries (KaTeX, Mermaid, SmilesDrawer,
> Chart.js) and the editor (CodeMirror) load from CDN, so a deck that uses them,
> or in-browser editing, needs internet. With `--cdn`, the engine + theme load
> from jsDelivr too. Presenting works in all modern browsers; in-place Save needs
> a Chromium browser.

## Its place in the orz family

orz-slides is the slide-deck sibling of
[orz-mdhtml](https://www.npmjs.com/package/orz-mdhtml), sharing the same
philosophy — deck-first, quietly editable, self-contained, CDN-delivered
renderer — and the same in-file editor stack (CodeMirror with a dark theme on
dark decks, live preview, File System Access save, theme picker, and
copy-as-markdown — selecting rendered slide content copies its Markdown source).
Both render content through **orz-markdown**:

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

## Use with an AI agent

The package ships an **agent skill** that teaches an AI agent the deck format — the
layout grammar, structure templates, regions, and floats. The quickest way to build a
deck is to let an agent do it:

- **Any agent** — point it at the skill, then describe what you want:
  `https://cdn.jsdelivr.net/npm/orz-slides/orz-slides-skills/SKILL.md`
- **Claude Code** — copy `orz-slides-skills/` into `~/.claude/skills/orz-slides/`.

More install routes: <https://markdown.orz.how/agents.html> · layout reference:
<https://markdown.orz.how/slides.html>

## Key features

- **Portable & self-contained** — one `.slides.html` opens and presents in any
  modern browser; with the default `--inline`, the engine and all themes are
  embedded (math/diagram libraries still load from CDN).
- **Markdown-native slides** — orz-markdown content (math, mermaid, smiles, qr,
  charts) in every region, never hand-written HTML.
- **Layout by space division** — a recursive `row`/`col` split grammar, with
  terse preset aliases for the common cases.
- **In-browser per-slide editor** — pop-out CodeMirror + live preview; deck ops
  (add / duplicate / delete / reorder / theme).
- **Structure templates** — `title` / `section` / `outline` / `closing` pages
  (`title` is fully styled; the others are evolving).
- **Presenter tools** — navigation, slide overview, fullscreen, slide numbers,
  and a progress bar from reveal.js; a self-contained **speaker view** (press
  **S** — current/next slide, your `@notes`, clock + timer) and an on-deck
  **clock/timer** overlay (press **T**). Speaker notes are authored with
  `<!-- @notes -->` and stored per slide.
- **Step-reveal fragments** — `<!-- slide step -->` reveals a slide's content
  one piece at a time (lists per item); or tag individual blocks with
  `{{attrs[.fragment]}}`.
- **Overflow that behaves** — scale-to-fit per region (with `fit=scroll|off`),
  backed by agent capacity budgets so slides are authored within their bounds.

## Browser support

| Feature | Support |
|---|---|
| Present, navigation, overview, fullscreen, theme switch | All modern browsers |
| Per-slide pop-out editor (CodeMirror, live preview) | All modern browsers |
| **Save in place** (File System Access API) | Chromium (Chrome/Edge); others fall back to download a copy |

A deck that uses math/diagrams/charts needs internet for those content
libraries, cached after first open. With `--inline` (default), the engine,
reveal's core CSS, and all themes are embedded.

## Security — treat these as programs, not documents

A `.slides.html` is **self-contained executable HTML**: opening one runs the
JavaScript embedded in it (the engine, the editor, and — because the parser allows
raw HTML in the source — potentially anything in the content). The trust model is
the same as **running a downloaded program**, not opening a PDF.

- **Only open or edit files from sources you trust.** Anyone can craft a file that
  looks authentic (same chrome, logo, layout) but contains hostile code. The
  format has no built-in authenticity — appearance proves nothing.
- **What the browser limits.** A page can't run native code or read your disk
  silently (Save uses the File System Access prompt and is scoped to the file you
  pick). Realistic harm from a hostile file is web-context — phishing, exfiltrating
  what you type or paste, beaconing — within the browser sandbox.
- **The one-click update is opt-in and fixed-source.** It only checks for and
  fetches a new framework after you enter edit mode and click **Update**, always
  from the canonical jsDelivr packages over HTTPS (the source is hardcoded in the
  engine — a tampered file cannot redirect it), and it shows the exact URLs for
  confirmation first. Clicking Update places trust in npm + jsDelivr for those
  packages.
- **Integrity can't be self-verified.** A file cannot prove its own integrity (a
  forgery would just lie). If you need authenticity, verify it out-of-band — a
  checksum or signature from the publisher over a trusted channel.

## License

MIT
