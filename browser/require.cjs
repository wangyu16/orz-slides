// orz-slides-browser has no CommonJS build: `import` it (ES module) or load
// orz-slides.browser.js with a <script> tag (globalThis.OrzCarrier).
throw new Error("orz-slides-browser: require() is not supported. Use `import { mountEditor } from 'orz-slides-browser'` (ES module), or a <script src=\".../orz-slides.browser.js\"> tag that sets globalThis.OrzCarrier.");
