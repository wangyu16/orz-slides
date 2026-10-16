// @ts-check
/// <reference path="../../browser/index.d.ts" />
/**
 * A minimal web app that embeds the orz-slides editor component (FC-19): two
 * editors on one page — each with its flattened preview and live slide card
 * in a sandboxed frame —, every hook wired to in-memory app state, under the
 * page's nonce CSP. The app stores TEXT (the canonical deck, FC-18);
 * assembled `.slides.html` files are made on demand with `assemble`. The
 * second editor has no toolbar: the app's own buttons drive the API, including
 * a layout op (`applyOp` → `editor.applyEdits`, one undo step) and the
 * single-slide editing mode (`editor.slides.setPerSlide`).
 */
(() => {
  const loaded = globalThis.OrzCarrier;
  if (!loaded) throw new Error('orz-slides-browser did not load');
  const C = loaded;
  const NONCE = 'orz-demo-nonce';
  const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));

  /** The app's storage: text by deck id (what a course platform would keep in its database). */
  const store = new Map();
  /** Uploaded assets: relative path → object URL. */
  const assets = new Map();
  /** Every hook call, for the log (and the tests). @type {Array<{ hook: string, detail: string }>} */
  const calls = [];
  const log = (/** @type {string} */ hook, /** @type {string} */ detail) => {
    calls.push({ hook, detail });
    const li = document.createElement('li');
    li.textContent = `${hook}: ${detail}`;
    $('log').prepend(li);
  };

  /** Includes the app resolves under its own policy (here: a fixed table): URLs, and its own files by path. @type {Record<string, string>} */
  const INCLUDES = { 'https://example.test/glossary.md': '**Buffer** — resists pH change.\n', 'parts/units.md': '*pH* — the acidity scale.\n' };

  /** @param {string} id @returns {import('../../browser/index.d.ts').EditorHooks} */
  const hooksFor = (id) => ({
    async save(text) { store.set(id, text); log('save', `${id} (${text.length} chars)`); refreshLibrary(); },
    resolveAsset(path) { log('resolveAsset', path); return assets.get(path) ?? new URL(path, location.href).href; },
    resolveLink(href) { log('resolveLink', href); return href; },
    async fetchInclude(target) { log('fetchInclude', target); return Object.prototype.hasOwnProperty.call(INCLUDES, target) ? INCLUDES[target] : null; },
    async uploadAsset(file) { const path = `assets/${file.name}`; assets.set(path, URL.createObjectURL(file)); log('uploadAsset', path); return path; },
    ai: {
      operations: [{ id: 'shout', title: 'Shout the selection', selection: true }, { id: 'sign', title: 'Add a closing slide', selection: false }],
      async request(op, ctx) {
        log('ai', `${op}${ctx.selection ? ` [${ctx.selection.from}, ${ctx.selection.to})` : ''}`);
        if (op === 'shout' && ctx.selection) return { proposed: ctx.text.slice(ctx.selection.from, ctx.selection.to).toUpperCase() };
        return { proposed: `${ctx.text.replace(/\n*$/, '\n')}\n<!-- slide template=closing -->\n# Thank you\nSigned by the lecture app\n` };
      },
    },
    async mintUid() {
      const a = new Uint8Array(16); crypto.getRandomValues(a);
      const uid = `doc-${Array.from(a, (b) => (b % 36).toString(36)).join('')}`;
      log('mintUid', uid);
      return uid;
    },
  });

  const A_TEXT = [
    '{{nyml', 'kind: document', 'carrier: slides', 'title: Buffers — lecture 3', 'author: Lecture app', 'uid: doc-webappslides01', 'theme: orchard', 'footer: CHEM 101 · Buffers', '}}', '',
    '<!-- slide template=title -->', '# Buffers', '## Lecture 3', 'Lecture app · week 2', '',
    '<!-- slide 2col -->', '## What a buffer does', '<!-- @left -->', 'A buffer keeps the pH nearly constant. See [week 2](week2.md).', '',
    '{{md https://example.test/glossary.md}}', '', '{{md parts/units.md}}', '<!-- @right -->', '![a titration curve](figures/curve.svg)', '',
    '<!-- slide -->', '## Henderson–Hasselbalch', '$$pH = pK_a + \\log\\frac{[A^-]}{[HA]}$$', '<!-- @notes -->', 'Derive it on the board first.', '',
  ].join('\n');
  const QUIZ = '{{nyml\nkind: document\ncarrier: slides\ntitle: Quiz\ntheme: nocturne\n}}\n\n<!-- slide -->\n## Quick questions\n\nquick questions here\n';
  store.set('a', A_TEXT);
  store.set('b', QUIZ);

  const editors = {
    a: C.mountEditor($('editor-a'), { text: A_TEXT, hooks: hooksFor('a'), nonce: NONCE, mode: 'split' }),
    b: C.mountEditor($('editor-b'), { text: QUIZ, hooks: hooksFor('b'), nonce: NONCE, chrome: 'none', mode: 'editor' }),
  };

  // Cmd/Ctrl+P in an editor or its preview is the app's (FC-19 `print` event): without a listener the browser would
  // print THIS page. orz-slides-browser 1.0 has no app-side print of the slides (the deck's print document is built by
  // the read view of an assembled file): the app says where to print instead.
  for (const [id, ed] of Object.entries(editors)) {
    ed.on('print', () => {
      log('print', id);
      $('note').textContent = 'To print the slides, download the .slides.html and use Print in its menu.';
    });
  }

  // the app's own controls for the chrome-less editor
  const b = editors.b;
  $('b-save').addEventListener('click', () => { void b.save(); });
  $('b-undo').addEventListener('click', () => { b.undo(); });
  $('b-mode').addEventListener('click', () => {
    const order = /** @type {const} */ (['editor', 'split', 'preview']);
    b.setMode(order[(order.indexOf(b.getMode()) + 1) % order.length]);
  });
  // single-slide editing: the live card enlarged into the layout GUI over the caret's slide (the preview must show)
  $('b-slide').addEventListener('click', () => {
    if (b.getMode() === 'editor') b.setMode('split');
    b.slides.setPerSlide(!b.slides.isPerSlide());
  });
  // a layout op of the app's own: the caret's slide's first box split into two columns — minimal edits on the marker
  // line, applied as ONE undo step (the same ops the layout GUI uses)
  $('b-split').addEventListener('click', () => {
    const text = b.getText();
    const i = b.slides.caretSlide();
    const box = C.layout.slideMap(text, i)?.boxes[0]?.name;
    if (!box) return;
    try {
      const r = C.layout.applyOp(text, i, { type: 'split', box, dir: 'col' });
      b.applyEdits(r.edits, { label: r.label });
      b.flash(r.changed);
    } catch (e) { $('note').textContent = String(/** @type {Error} */ (e).message); }
  });
  $('b-ai').addEventListener('click', () => { void b.requestAi('shout', { selection: true }); });
  $('b-download').addEventListener('click', async () => {
    const html = await C.assemble(b.getText(), { delivery: 'cdn' }); // a small file that loads the engine from jsDelivr
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
    a.download = 'quiz.slides.html';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  // the library: index stored texts without rendering; a read-only flattened preview in a sandboxed frame
  async function refreshLibrary() {
    const ul = $('library');
    ul.replaceChildren();
    for (const [, text] of store) {
      const info = C.readDocument(text);
      const li = document.createElement('li');
      li.textContent = `${info.title} (${info.meta.uid ?? 'no uid'}, theme ${info.theme ?? 'default'}, ${info.settings.ratio ?? '16:9'})`;
      ul.append(li);
    }
    const thumb = /** @type {HTMLIFrameElement} */ ($('thumb'));
    thumb.srcdoc = await C.renderPreview(store.get('a') ?? '', { document: true, nonce: NONCE, fetchInclude: async (u) => INCLUDES[u] ?? null }); // the srcdoc frame inherits the page's policy: its <style> needs the nonce
  }
  $('version').textContent = `orz-slides-browser ${C.version}`;
  void refreshLibrary();

  /** For tests and the console. */
  Object.assign(globalThis, { demo: { editors, store, assets, calls, refreshLibrary } });
})();
