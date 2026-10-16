# orz-slides-browser

The browser engine and editor component of
[orz-slides](https://github.com/wangyu16/orz-slides) — slide decks written in
Markdown that present, edit and save themselves: the very bundle every
`.slides.html` file carries, and the same editor for web apps (orz family
contract FC-19). Built on the carrier kit of
[orz-markdown](https://www.npmjs.com/package/orz-markdown) 2.4 and
[reveal.js](https://revealjs.com/) 5.2.1 (both bundled), with the 14 slide
themes inside.

```sh
npm i orz-slides-browser@1
```

| File | What |
|---|---|
| `orz-slides.browser.js` | the IIFE. Sets `globalThis.OrzCarrier` = `{ kind: 'slides', version, formats, assemble, extract, readDocument, mountEditor, renderPreview, standalone, layout }` — `layout` holds the per-slide editor's pure layout ops (`parseDeck`, `applyOp`, `applyEdits`, `slideMap`, `LayoutOpError`, `PRESET_CHOICES`, `SLIDE_SIZE`). Inside an assembled `.slides.html` it also starts that file (orz-markdown `carrier/app`): the read view — the deck, at 1280 × 720 (16:9) or 960 × 720 (4:3), every box fitted —, Present, Print, Print with notes, Speaker view, Overview, Edit (the whole deck beside a flattened preview, with the live slide card that enlarges into single-slide editing), Save, Download a copy, New document, Save as new copy, the header settings (theme, ratio, slide numbers, progress, section numbers), host protocols and the quiet update; `OrzCarrier.standalone` is then the file's handle, `null` elsewhere. Anywhere else it only sets the global. |
| `esm/orz-slides.browser.mjs` | the same API as ES module exports, plus `OrzCarrier`, `THEMES`, `DEFAULT_THEME`, `TEMPLATES`, `TEMPLATE_IDS`, `DEFAULT_TEMPLATE`, `newDocument`, `editHeader`, `parseDeck` and the per-slide editor's pure layout ops (`applyOp`, `applyEdits`, `slideMap`, `LayoutOpError`, `PRESET_CHOICES`, `SLIDE_SIZE`). Sets no global and boots nothing. |
| `release.json` | the release manifest the quiet update reads: `kind`, `version`, `formats`, `notes`, and `bundle.path` / `bundle.integrity` (the SHA-384 of `orz-slides.browser.js`'s exact bytes). |
| `index.d.ts` | types (`Editor`, `EditorOptions`, `EditorHooks`, `SlidesTools`, `LayoutOp`, …). |

```js
import { mountEditor } from 'orz-slides-browser';   // a bundler: the ES module
const editor = mountEditor(element, { text, nonce, hooks: { async save(text) { /* store the text */ } } });
```

```html
<script src="https://cdn.jsdelivr.net/npm/orz-slides-browser@1.0.0/orz-slides.browser.js"></script>
<script>const editor = OrzCarrier.mountEditor(element, { text, hooks: { save } });</script>
```

`.slides.html` files carry the bundle inline (the CLI's default) or load it
from `https://cdn.jsdelivr.net/npm/orz-slides-browser@<version>/orz-slides.browser.js`
(`--cdn`); the slide themes are inside the bundle, so both style the same.
The bundle holds no `<script` / `</script`, no CR and only ASCII, so it can be
inlined byte for byte and checked against `release.json`.
`require('orz-slides-browser')` is not supported (it throws): use `import` or a
`<script>` tag.

Embedding guide (hooks, the two editing modes, the preview frame, CSP,
versions): `docs/embedding.md` in this package
([on GitHub](https://github.com/wangyu16/orz-slides/blob/main/docs/embedding.md)).
Versioned in lockstep with `orz-slides`; built by its `build/bundle.ts`.

## License

MIT
