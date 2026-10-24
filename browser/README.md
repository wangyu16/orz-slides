# orz-slides-browser

The browser engine and editor component of
[orz-slides](https://github.com/wangyu16/orz-slides) — slide decks written in
Markdown that present, edit and save themselves: the very bundle every
`.slides.html` file carries, and the same editor for web apps (orz family
contract FC-19). Built on the carrier kit of
[orz-markdown](https://www.npmjs.com/package/orz-markdown) 2.5.0 and
[reveal.js](https://revealjs.com/) 5.2.1 (both bundled: this release embeds
orz-markdown 2.5.0), with the 14 slide themes inside.

```sh
npm i orz-slides-browser@1
```

| File | What |
|---|---|
| `orz-slides.browser.js` | the IIFE. Sets `globalThis.OrzCarrier` = `{ kind: 'slides', version, formats, assemble, extract, readDocument, mountEditor, renderPreview, includeTargets, linkTargets, printDocument, printDeck, standalone, layout }` — `layout` holds the layout editor's pure layout ops (`parseDeck`, `applyOp`, `applyEdits`, `slideMap`, `LayoutOpError`, `PRESET_CHOICES`, `SLIDE_SIZE`). Inside an assembled `.slides.html` it also starts that file (orz-markdown `carrier/app`): the read view — the deck, at 1280 × 720 (16:9) or 960 × 720 (4:3), every box fitted —, Present, Print, Print with notes, Speaker view, Overview, Edit (the whole deck beside a flattened preview, with the live slide card that enlarges into single-slide editing), Save, Download a copy, New document, Save as new copy, the header settings (theme, ratio, slide numbers, progress, section numbers), host protocols and the quiet update; `OrzCarrier.standalone` is then the file's handle, `null` elsewhere. Anywhere else it only sets the global. |
| `esm/orz-slides.browser.mjs` | ES module exports: `kind`, `version`, `formats`, `assemble`, `extract`, `readDocument`, `renderPreview`, `mountEditor`, `OrzCarrier` (the same object without `standalone`), `includeTargets` / `linkTargets` (a text's include directives and links, orz-markdown 2.5.0), `printDeck` (print a deck from your page, one slide per page) and `printDocument` (the kit's), `THEMES`, `DEFAULT_THEME`, `themeSwatch`, `TEMPLATES`, `TEMPLATE_IDS`, `DEFAULT_TEMPLATE`, `newDocument`, `parseDeck`, `editHeader(text, changes)` — change header keys in a text the way the pencil's settings do (one line per key, the rest of the text untouched; `null` removes a key) — and the layout editor's pure layout ops (`applyOp`, `applyEdits`, `slideMap`, `LayoutOpError`, `PRESET_CHOICES`, `SLIDE_SIZE`). Sets no global and boots nothing. |
| `release.json` | the release manifest the quiet update reads: `kind`, `version`, `formats`, `notes`, and `bundle.path` / `bundle.integrity` (the SHA-384 of `orz-slides.browser.js`'s exact bytes). |
| `index.d.ts` | types (`Editor`, `EditorOptions`, `EditorHooks`, `SlidesTools`, `LayoutOp`, …). |

```js
import { mountEditor } from 'orz-slides-browser';   // a bundler: the ES module
const editor = mountEditor(element, { text, nonce, hooks: { async save(text) { /* store the text */ } } });
```

```html
<script src="https://cdn.jsdelivr.net/npm/orz-slides-browser@1.1.0/orz-slides.browser.js"></script>
<script>const editor = OrzCarrier.mountEditor(element, { text, hooks: { save } });</script>
```

Since 1.1, `assemble`, `mountEditor` and `renderPreview` take `twinLinks` — your
site's names for linked decks and documents (`{ slides: '{stem}.html' }`):
links to text twins point at them, and a file keeps the naming in every save.

`.slides.html` files carry the bundle inline (the CLI's default) or load it
from `https://cdn.jsdelivr.net/npm/orz-slides-browser@<version>/orz-slides.browser.js`
(`--cdn`); the slide themes are inside the bundle, so both style the same.
The bundle holds no `<script` / `</script`, no CR and only ASCII, so it can be
inlined byte for byte and checked against `release.json`.
`require('orz-slides-browser')` is not supported (it throws): use `import` or a
`<script>` tag.

## Browsers, delivery and limits

- **Presenting, printing and editing work in every modern browser.** **Save
  in place** needs Chromium (Chrome, Edge, …: the File System Access API):
  the first Save asks where the file is (a file picker), later saves write
  it directly; elsewhere Save downloads the file. A page served over http(s)
  never saves in place (*Download a copy*).
- **CDN dependence.** Even an inline file (the engine, reveal.js and the
  themes inside) loads the themes' webfonts (Google Fonts), KaTeX's and
  highlight.js's styles, Mermaid / SMILES / Chart.js and the CodeMirror
  editor from CDNs; a `--cdn` file also loads the engine. **Offline**, a deck
  still presents (system fonts; formulas unstyled, diagrams and charts not
  drawn) and edits in a plain text area.
- **Content-Security-Policy.** Under a nonce policy pass your nonce as
  `mountEditor(element, { nonce })`; the component stamps it on its scripts
  and styles and on the preview frame's. The tested policy and what loads
  from where: `docs/embedding.md`, "Content-Security-Policy".
- **No app-side print** (1.0): in an app, Cmd/Ctrl+P in the editor is its
  `print` event; the slides' print document (one slide per page, with or
  without notes) comes from an assembled `.slides.html`'s *Print*.
- **Deliberate limits**: floats are unnamed (told apart by their order).
  (Copying from a slide, reading or presenting, gives Markdown, as in every
  orz file.)
- **Files are programs.** A `.slides.html` runs the engine and any raw HTML
  in its deck: open only trusted files; show `renderPreview` output only in a
  sandboxed frame.

Embedding guide (hooks, the two editing modes, the preview frame, CSP,
versions): `docs/embedding.md` in this package
([on GitHub](https://github.com/wangyu16/orz-slides/blob/main/docs/embedding.md)).
Versioned in lockstep with `orz-slides`; built by its `build/bundle.ts`.

## License

MIT
