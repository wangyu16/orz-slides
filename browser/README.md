# orz-slides-browser

Prebuilt, single-file in-browser **presentation engine** for
[`orz-slides`](https://www.npmjs.com/package/orz-slides) `.slides.html` decks.

It is `esbuild(reveal.js + orz-markdown + the orz-slides parser / layout engine /
assembler)` as one IIFE that exposes `window.orzslides`. Each generated
`.slides.html` either inlines this bundle (`--inline`) or loads it from jsDelivr:

```
https://cdn.jsdelivr.net/npm/orz-slides-browser@<version>/orz-slides.browser.js
```

The version is kept in **lockstep** with the `orz-slides` CLI package. Generated
by `npm run bundle`; not edited by hand.
