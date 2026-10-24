# Embedding the orz-slides editor in a web app

`orz-slides-browser` is the editor that every `.slides.html` file carries,
packaged for web apps (family decision FD-06; contract FC-19 in orz-markdown
`spec/FC-19-editor-component.md`). An app mounts it in its own page, keeps the
**text** (the canonical deck, FC-18 text format 1) wherever it likes, and
makes assembled `.slides.html` files only when someone needs one. The editor
is orz-mdhtml's (the kit's editor shell) with the slides additions: its
preview shows the deck **flattened** — every slide's content in text order
with a thin divider per slide — with a **live slide card** in the corner that
enlarges into **single-slide editing** (see [Two ways to edit](#two-ways-to-edit)).

This guide ships in both packages (`node_modules/orz-slides-browser/docs/embedding.md`,
`node_modules/orz-slides/docs/embedding.md`). A working example:
[`examples/webapp/`](https://github.com/wangyu16/orz-slides/tree/main/examples/webapp) — two editors on
one page with every hook, under a nonce Content-Security-Policy with
`'strict-dynamic'` (`index.html`, IIFE) and the ES module variant
(`esm.html`). The test suite runs both in real Chrome, offline
(`tests/webapp.test.ts`).

## Install and load

```sh
npm install orz-slides-browser@1   # or: npm i orz-slides-browser@1
```

| You want | Use | Resolves to |
|---|---|---|
| a bundler (Vite, esbuild, webpack) | `import { mountEditor } from 'orz-slides-browser'` | `esm/orz-slides.browser.mjs` (`exports` → `import`) |
| a plain `<script>` | `<script src=".../orz-slides.browser.js">` → `globalThis.OrzCarrier` | `orz-slides.browser.js` (`exports` → `default`) |
| `require()` | not supported: it throws, pointing to `import` or `<script>` | `require.cjs` (`exports` → `require`) |
| the CDN | `https://cdn.jsdelivr.net/npm/orz-slides-browser@<version>/orz-slides.browser.js` (e.g. `@1.1.0`; pin an exact version) | the same IIFE |

Types: `orz-slides-browser/index.d.ts` (`Editor`, `EditorOptions`,
`EditorHooks`, `SlidesTools`, `LayoutOp`, …). The ES module sets no global
and boots nothing; the IIFE sets `globalThis.OrzCarrier` and — only inside an
assembled `.slides.html` — starts that file's own read view (the deck) and
chrome. Both bundle orz-markdown, reveal.js 5.2.1 and the 14 slide themes
(about 2.2 MB, 0.6 MB gzipped).

## Versions

**An app pins the component version it wants; files carry their own shells.**
Upgrading the package changes your editor, not anyone's files. The text format
(FC-18 format 1) is the only contract between them: a deck written by any 1.x
editor opens in every other 1.x editor and assembles with any 1.x shell. The
quiet update indicator never appears in an app (FC-19 §5 invariant 6).

## Mount an editor

```ts
import { mountEditor } from 'orz-slides-browser';

const editor = mountEditor(element, {
  text,                       // the deck, exact (BOM, line endings kept)
  mode: 'split',              // 'split' | 'editor' | 'preview' (else the reader's stored preference)
  chrome: 'full',             // 'full' (labels) | 'compact' (icons) | 'none' (your UI drives the API)
  readOnly: false,
  nonce,                      // your CSP nonce (FC-19 §3, see below)
  includes,                   // resolved includes for the preview: { 'parts/a.md': text, 'https://…': text } (FC-19 §3)
  fileName: 'talk.slides.html', // the suggested name of saves without hooks.save (picker, download); default document.slides.html
  hooks: { save, ai, fetchInclude, resolveAsset, uploadAsset, resolveLink, mintUid },
  twinLinks,                  // (1.1) your site's names for linked texts, e.g. { slides: '{stem}.html', md: '{stem}.html' } (below)
  // preferences: your PreferenceStore (default: localStorage, namespaced by the header uid)
});
```

Any number of editors per page: each has its own undo history, preview frame
and preferences namespace; nothing is global. The chrome renders in a shadow
root (your CSS cannot break it; it cannot restyle your page); the preview runs
in a sandboxed `srcdoc` frame (`sandbox="allow-scripts"`, an opaque origin:
document scripts cannot reach your page, storage or cookies). Give an editor
room: below 640 px of width the kit shows the text and the preview as
tabs instead of side by side.

The toolbar has the view modes, the slides settings — **Theme**, **Ratio**,
**Slide numbers**, **Progress bar**, **Section numbers** (they edit the header:
`theme`, `ratio`, `slide_numbers`, `progress`, `section_numbers`; one
undoable edit each) —, **Issues** (the deck's lints, each with its line and,
where one exists, a quick fix applied as one undoable edit), an **AI** menu
when `hooks.ai` offers operations, the save state and Save. Footer,
transition and metadata stay in the header text. `chrome: 'compact'` shows
the same tools as icons. Keyboard: Cmd/Ctrl+S saves, Cmd/Ctrl+\ cycles the
modes, Cmd/Ctrl+Shift+Enter enlarges the live slide card into single-slide
editing and back, Esc leaves the text for the toolbar.

**Your site's link names** (1.1, orz-markdown 2.5.0, FC-18 §8.2). A link to
another text — `[week 2](week2.slides.md)`, `[notes](notes.md)` — points at
its assembled twin: `week2.slides.html`, `notes.md.html`. A site that
publishes under other names passes a naming, per kind a file-name template
(`{stem}` once, then only `A-Z a-z 0-9 . _ -`, ending in `.html`, same
folder): `twinLinks: { slides: '{stem}.html', md: '{stem}.html' }`. The
flattened preview and the live card then link to `week2.html`;
`assemble(text, { twinLinks })` and `renderPreview(text, { twinLinks })`
take the same, and an assembled file keeps the naming in every save and the
update (`extract(html).twinLinks`). With `hooks.resolveLink` links stay as
written, so your hook gets the source href.

### Two ways to edit

Both edit the one text, with one undo history; the text stays the single
source of truth (no hidden layout data).

- **The whole deck** (the default): the text on the left, the **flattened**
  preview on the right — every slide's content in text order (in-slide layout,
  fit and floats not drawn), a thin divider per slide with its number, title
  and layout, each region labelled, notes and footers set apart; scroll sync
  maps a line to its slide. In the preview's bottom-right corner the **live
  slide card** shows the caret's slide as it presents — at its real size
  (1280 × 720 for 16:9, 960 × 720 for 4:3), scaled to the card, every box
  fitted, with a badge (*fits*, *shrunk to 80%*, *footer cut*, *cut on paper*). The card can be
  folded to a small tab (a reader preference) so it never covers the text.
- **Single-slide editing**: the card's **Edit** (or Cmd/Ctrl+Shift+Enter)
  enlarges it into the layout editor over that slide — split a box into rows or
  columns, delete a box (its content moves to the neighbour), drag a divider
  (it snaps to simple ratios), choose a preset, rename or swap boxes, add,
  move, resize and layer floats, choose a template's look (`v=`), set the
  slide's options (fit, background, transition, step), notes and footer, and
  a filmstrip to add, duplicate, delete and reorder slides. Every operation
  writes the marker lines of the text — **one undoable edit** each, its lines
  flashed in the text; clicking a box selects its Markdown in the editor. The
  overlay lives in your page (the trusted side), over the sandboxed frame,
  which only reports the boxes' geometry as data: no operation can come from
  the document's scripts. The shrink icon (or the same key) goes back to the
  whole deck; `?` lists the keys.

Your UI can drive both: `editor.slides.setPerSlide(true)` (the preview must
be showing: `setMode('split')` or `'preview'`), `editor.slides.isPerSlide()`,
`editor.slides.setLive(on)`, `editor.slides.caretSlide()`.

### The `Editor` (FC-19 §4)

`getText()` · `setText(text, { resetHistory? })` · `setHeader(changes)` (one
undoable edit, FC-18 §9 rules) · `applyEdits(edits, { label? })` (several
replacements as ONE undoable edit) · `select(from, to, { scroll? })` ·
`getSelection()` · `setFocusRange(from, to, { mode? })` (dim or fold the text
outside a slide) · `flash(ranges)` · `undo()` / `redo()` · `isDirty()` /
`markSaved()` · `save()` → `{ ok, via, error?, conflict? }` (`via`: `hook`,
`host`, `file`, `download`), never rejects · `setMode(m)` / `getMode()` ·
`focus()` · `on('change' | 'dirty' | 'selection' | 'save' | 'error' |
'print', fn)` → unsubscribe · `proposeAi(op, { selection? })` /
`applyAi(proposal, { proposed? })` (the review flow) · `requestAi(op, {
selection? })` (propose and apply at once) · `uploadAssets(files)` ·
`ensureUid()` · `setReadOnly(flag)` / `isReadOnly()` · `refreshPreview({
includes? })` · `ready` (a promise: the text engine is final, `{ engine:
'codemirror6' }` or `{ engine: 'textarea', error }`; the editor is usable
before) · `destroy()`.

**`editor.slides`** (orz-slides' tools): `caretSlide()` (0-based) ·
`lints()` / `refreshLints()` · `applyFix({ code, line })` · `isLive()` /
`setLive(on)` (the card open or folded) · `isPerSlide()` / `setPerSlide(on)`
(single-slide editing) · `lastFit()` (the live slide's fit report: per box
its `scale` — 1 unscaled, the floor 0.6 — and `clipped`; `footerCut`) ·
`fitCoverage()`.

### Layout operations of your own

The layout editor's operations are pure functions of the text, exported for apps
and agents: `OrzCarrier.layout` on the IIFE's global (and on the ES module's
`OrzCarrier`), or by name from the ES module — `parseDeck`, `applyOp`,
`applyEdits`, `slideMap`, `LayoutOpError`, `PRESET_CHOICES`, `SLIDE_SIZE`.
`applyOp(text, slideIndex, op)` returns the minimal edits (marker lines only;
a deleted box's block moves to its neighbour) — apply them with
`editor.applyEdits`, one undo step:

```js
const text = editor.getText();
const i = editor.slides.caretSlide();
const box = OrzCarrier.layout.slideMap(text, i)?.boxes[0]?.name;   // null: no such slide
if (box) {
const r = OrzCarrier.layout.applyOp(text, i, { type: 'split', box, dir: 'col' });  // throws LayoutOpError when it cannot apply
editor.applyEdits(r.edits, { label: r.label });   // "Split body into columns"
editor.flash(r.changed);
}
```

Ops (`LayoutOp`): `split`, `delete-box`, `tracks`, `preset`, `rename`,
`swap`, `move-content`, `ensure-region`, `open`, `open-float`, `float-add`, `float-geom`,
`float-delete`, `float-z`, `variant`, `options`, `slide-add`,
`slide-duplicate`, `slide-delete`, `slide-move`. A marker whose tree equals a
preset is written as the preset; a marker that did not change is never
rewritten.

### AI with a review step

The toolbar's AI menu never changes the deck by itself. Choosing an
operation calls `proposeAi`: your `hooks.ai.request` runs and the editor gets
a **proposal** (`{ op, proposed, range, original, passage }`) without touching
the text. A review panel shows it — editable — with Apply and Cancel; Apply
calls `applyAi(proposal, { proposed })`, which writes it as **one undoable
edit**, and refuses (`{ ok: false }`) if the text changed since the proposal
was made. Your own UI can run the same flow:

```ts
const r = await editor.proposeAi('tighten', { selection: true });
if (r.ok && await myConfirm(r.proposal.original, r.proposal.proposed)) editor.applyAi(r.proposal);
```

## Hooks (FC-19 §3)

| Hook | Called | Return |
|---|---|---|
| `save(text)` | on Save / Cmd+S / `editor.save()` | a promise; reject to report a failure (the editor stays dirty). **With `save`, you own persistence**: nothing is written to disk or downloaded |
| `ai.operations`, `ai.request(op, { text, selection? })` | the AI menu and `editor.proposeAi` (the proposal is reviewed before `applyAi` writes it), `editor.requestAi` | `{ proposed }` — the replacement of the selection (`selection: true` operations) or of the whole text |
| `fetchInclude(target)` | the preview meets an include `includes` lacks: a URL (`{{md https://…}}` / `{{markdown …}}` / `{{md-include …}}`), or a file include's path as written (`{{md parts/a.md}}` → `'parts/a.md'`; you read your own files) | the Markdown, or `null`. Your trust policy (allowlist) decides |
| `resolveAsset(path)` | every relative `src` / `srcset` / `poster` and every slide background (`bg=`) in the flattened preview, the live slide, single-slide editing and the fit checks, **synchronously** (the preview does not wait) | the URL to load, as a string — not a promise: a URL your app already knows (a public URL, a URL signed beforehand, a `data:` URL, or a `blob:` URL of a stored asset — the editor reads a `blob:` URL it got from you once and hands the sandboxed preview, which cannot load your page's object URLs, the Blob itself: allow `connect-src blob:` and `img-src blob:`). It is asked with the path exactly as `uploadAsset` returned it (`assets/Screen Shot 1.png`, `assets/图表.png`), on every surface, never the percent-encoded form the Markdown holds |
| `uploadAsset(file)` | a file pasted or dropped into the editor, `editor.uploadAssets` | the relative path to insert (`![name](path)` for images) |
| `resolveLink(href)` | a link clicked in the preview (as written, e.g. `week2.md`) | the URL to open |
| `mintUid()` | `editor.ensureUid()` when the header has no `uid` | a **promise** of a `doc-[0-9a-z]{10,32}` id from your registry (FC-18 §10) |

**Includes.** Every preview surface (the flattened preview, the live slide,
single-slide editing) resolves an include the same way (FC-19 §3): a file
include from the `includes` option first (target as written → text, like an
assembled file's `#orz-includes`), then from `hooks.fetchInclude` with the
path as written (`'parts/a.md'`: you read your own files); a URL include
from `hooks.fetchInclude` with the URL first (your trust policy, your current
copy), then from `includes`. Each answer is asked for once per editor. An
include neither answers shows a quiet "Included file not available:
parts/a.md" note in the preview (the directive is kept).

Without `hooks.save` the editor saves like a standalone file: an inline
`.slides.html` (holding the `includes` you passed) through the File System
Access picker, else a download. Your app's page is not a served file: such a
save never shows the "opened from a web address" notice, even over https. If
the picked file is another copy of this deck (same header `uid`) whose text
changed on disk since the editor opened it, nothing is written: `save()`
resolves `{ ok: false, via: 'file', error: 'conflict', conflict: true }` and
the editor asks the reader — **Replace it** writes the file, **Download a copy
instead** downloads one. (Mounted inside an assembled `.slides.html` page, it
is an editor of that file: it saves through the file's own saver, delivery,
includes and host — with the same conflict question.)

## The preview frame

The preview is a `srcdoc` frame (FC-19 §8.4 pluggable preview) written by
orz-slides: the kit's bridge, the deck structure and the header's slide theme
(the same stylesheets the deck presents in, inline and nonce-stamped; the
frame is rebuilt when the header's theme changes), the flattened deck in
`#orz-doc`, the kit's content libraries and the live slide's runtime (fit,
decoration, the card), all carried by the bundle — nothing is fetched for
them. The editor renders the text in your page (pure data, no DOM) and posts
it to the frame; the live card gets the caret's slide as HTML the trusted
page rendered from the text, and answers with its fit report as data (at
worst a wrong badge, never an edit, a save or a key). Fit runs only for the
visible slide, after the typing pause.

### Printing

Cmd/Ctrl+P in the editor or its preview is the editor's `print` event: with
a listener your app decides, without one the browser prints **your page**.
Since 1.1, `printDeck(text, options)` prints the deck as an assembled
`.slides.html` does from its pencil's *Print* and *Print with notes*: one
slide per page at the slide's size, every fragment shown, each slide fitted
as on screen, whatever print had to cut marked on its page — optionally with
the speaker notes. The deck is laid out in a hidden frame of your page that
carries the engine's stylesheets, and printed with orz-markdown's
`printDocument` in a hidden `srcdoc` frame sandboxed `allow-scripts
allow-modals` (an opaque origin; the document holds no script); your page is
never printed. It resolves `true` once printed, `false` when a print of this
page is still running.

```js
editor.on('print', () => printDeck(editor.getText(), {
  nonce,                 // your CSP nonce: stamped on the stylesheets and the print frame's script
  includes,              // resolved includes, as you gave the editor
  fetchInclude,          // URL includes the record lacks (your trust policy)
  notes: false,          // true: each page the slide over its speaker notes
  onCut: (message) => showMessage(message),   // e.g. "slide 4 is cut on paper …"
}));
```

`printDocument(html, { nonce })` (the kit's) is exported too, for a whole
document of your own. 1.0 had no app-side print (STATUS D-114): an app then
offered the `.slides.html` to print from its menu.

The document's own raw HTML runs only inside the frame (an opaque origin in
your page), never in your page.

## Content-Security-Policy (FC-19 §8.4)

The preview frame is a `srcdoc` frame: it inherits your page's policy. With a
nonce policy, pass the nonce as `nonce` (FC-19 §3): the component stamps it on
CodeMirror's `<script>` and `<style>` and on every script and style of the
preview frame — the bridge, the content libraries, the live slide's runtime,
the deck structure and the slide theme. Without it, a nonce or hash policy
blocks the preview frame's inline scripts and the editor reports it (`error`
event, source `render`; its message may name the kit's option
`preview.nonce` — here the option is `nonce` on `mountEditor`). A tested
policy (one header value; replace `RANDOM` with a fresh nonce per response;
`examples/webapp/` uses the same without `frame-src`, plus
`base-uri 'none'; form-action 'none'`, which you may add too):

```
default-src 'none'; script-src 'nonce-RANDOM' 'strict-dynamic'; style-src 'self' 'nonce-RANDOM' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://fonts.googleapis.com; style-src-attr 'unsafe-inline'; font-src https://cdn.jsdelivr.net https://fonts.gstatic.com data:; img-src 'self' data: blob: https:; connect-src 'self' blob: https://cdn.jsdelivr.net; frame-src https://www.youtube.com
```

Why each part:

- `script-src` with `'strict-dynamic'`: the nonce also covers the scripts the
  component loads (CodeMirror, the preview libraries).
- `style-src-attr 'unsafe-inline'`: fit, the single-slide overlay, KaTeX and
  the diagram libraries write style attributes.
- `font-src`: the slide themes' webfonts (Google Fonts) and KaTeX's.
- `img-src`: must cover wherever `hooks.resolveAsset` points.
- `connect-src`: `blob:` only if `resolveAsset` gives `blob:` URLs (the editor
  reads their bytes for the preview).
- `frame-src https://www.youtube.com`: only if your decks embed YouTube
  videos (`{{youtube …}}`: the player is a youtube.com/embed frame); drop it
  otherwise.

The same value works in a `<meta http-equiv="Content-Security-Policy">` tag
(the example does that).

**Use a nonce, not hashes.** `mountEditor` takes no hash list. An app that
builds its own preview frame with the kit (`orz-markdown/carrier/editor`'s
`PREVIEW_BRIDGE_HASH`, `previewScriptHashes`) must take the hash from the
same orz-markdown version its frame runs: the bridge, and so its hash,
differs between kit versions (2.3.0 and 2.4.0 differ; orz-slides 1.0 embeds
2.4.0, 1.1 embeds 2.5.0). Tested in Chrome: the editor (CodeMirror 6), math,
code highlighting, Mermaid, Chart.js and SMILES render in the preview with
no violation but one — Mermaid's run-time `<style>` (below).

What loads from where: CodeMirror 6 from
`cdn.jsdelivr.net/npm/orz-markdown@<version>/vendor/codemirror6.js` (pinned,
SRI-checked; a textarea until it arrives); the slide themes are inside the
bundle (no theme fetch), their webfonts from Google Fonts
(`fonts.googleapis.com` stylesheets, `fonts.gstatic.com` fonts); KaTeX CSS
from jsDelivr, highlight.js from cdnjs, Mermaid / Chart.js from jsDelivr,
SMILES from unpkg (the preview libraries; with `'strict-dynamic'` the nonce
covers them). Mermaid inserts `<style>` elements at run time that nobody
stamps; a nonce policy blocks them and the diagram is drawn unreadable
(black shapes, no theme styling). If your decks use diagrams, add

```
style-src-elem 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://fonts.googleapis.com;
```

A `style-src-elem` directive *replaces* `style-src` for `<style>` and
`<link rel=stylesheet>` elements, so it repeats the whole list (your own
stylesheets, KaTeX, highlight.js, the webfonts) — `style-src-elem
'unsafe-inline'` alone would block them all — and it carries no nonce (a
nonce switches `'unsafe-inline'` off). Offline, editing works without them: the text is edited in a textarea
until CodeMirror arrives, the themes fall back to system fonts, and
formulas, diagrams and charts wait for their libraries.

## Without an editor

```ts
import { assemble, extract, readDocument, renderPreview, newDocument, TEMPLATE_IDS, THEMES, parseDeck, includeTargets, linkTargets, themeSwatch } from 'orz-slides-browser';

readDocument(text)                        // header + derived facts (title, author, uid, theme, settings, lint) — no rendering; index with it
parseDeck(text)                           // the deck: config, slides (kind, template, title, layout, regions, notes, footer), lint
await renderPreview(text, { includes, fetchInclude })  // the flattened deck's HTML (dividers, region labels), not the slides
await renderPreview(text, { document: true, nonce })   // a whole HTML document of it: the slide theme and the flattened styles inline (<style> stamped with your nonce), no script (iframe srcdoc, thumbnails)
includeTargets(text)                      // (1.1) the include directives' targets, as written (orz-markdown 2.5.0, browser-safe)
linkTargets(text)                         // (1.1) every link and image: { href, line, kind: 'twin' | 'asset' | 'other', image, raw } — a site builder's link check
newDocument({ template: 'talk', title, theme: 'nocturne', ratio: '4:3' })  // a new text from a deck template (TEMPLATE_IDS: starter, talk, minimal): carrier slides, a fresh uid
await assemble(text, { delivery: 'cdn' })              // a small .slides.html that loads the engine from jsDelivr
await assemble(text)                                   // an inline .slides.html (the IIFE inlines itself; the ES module fetches this release's bundle once, or pass engineSource)
await assemble(text, { includes })                     // with resolved includes in #orz-includes
await assemble(text, { twinLinks: { slides: '{stem}.html' } })  // (1.1) links to text twins named your site's way; kept by every save
extract(html)                                          // { text, kind, format, shell, delivery, includes, twinLinks? } | null
                                                       // (1.1) an orz-slides 0.x file: the text `upgrade` writes, shell '', legacy: { version, notes }
```

The slides themselves need the engine's layout (reveal.js, fit) — in the
editor's live card and in an assembled file's read view — so
`renderPreview` gives the flattened deck: a styled, continuous view for
thumbnails and lists. It adds no script of its own, but it keeps the
document's raw HTML as written — a deck can hold `<script>` and event
handlers (documents come from trusted sources; orz-markdown does not filter
them). Show its output only in a sandboxed frame (`<iframe sandbox
srcdoc=…>`, without `allow-same-origin`), never with `innerHTML` in your page.

`assemble` writes the same bytes as the Node library (`orz-slides`), so an app
can publish, preview or download without a server. Store the text; regenerate
the HTML. `THEMES` lists the 14 slide themes (`id`, `name`, `scheme`
light/dark, `description`, and since 1.1 `paper` / `accent`, the page and
signature colours); `themeSwatch(id)` is a theme picker's dot (a CSS
`background`); `DEFAULT_THEME` is `orchard`.

## Assembled files in an iframe

To show **assembled files** (untrusted or third-party `.slides.html`) rather
than the component, embed them in a sandboxed iframe and speak the host
protocols (`orz-host-save@1`, `orz-host-ai@1`, `orz-host-include@1`;
orz-markdown `spec/host-protocols.md`, host side `embedCarrierFrame` in
`orz-markdown/carrier/shell`; see `PROTOCOL.md`). The file then saves to you,
takes AI operations and include resolution from you, and shows no update
indicator. Present, the speaker view (its own window) and Print run inside
the file.
