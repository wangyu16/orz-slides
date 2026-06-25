/**
 * Builds the self-contained `.slides.html` shell:
 *   <head>  reveal.js CSS + KaTeX CSS + the slide theme (inline or CDN link)
 *           + the editor chrome styles
 *   <body>  an empty .reveal/.slides container, the editor chrome (FAB + docked
 *           CodeMirror panel + banners), the embedded deck source in
 *           <script id="orz-deck">, the engine bundle (inline or CDN), a config
 *           object, the boot call, and the in-file app (assets/app.js).
 *
 * The deck source in #orz-deck is the single source of truth: the engine renders
 * it on load, and the editor re-serialises it on save (self-reproducing).
 */

export interface ThemeEntry {
  id: string;
  name: string;
  scheme: 'light' | 'dark';
  href: string;
}

export type RendererSpec =
  | { mode: 'inline'; js: string }
  | { mode: 'cdn'; src: string };

export type ThemeSpec =
  | { mode: 'inline'; base: string; themes: Array<{ id: string; css: string }> }
  | { mode: 'cdn' };

export type RevealCssSpec =
  | { mode: 'inline'; reset: string; core: string }
  | { mode: 'cdn'; resetUrl: string; coreUrl: string };

export interface EditorLibs {
  codemirrorCss: string;
  codemirrorLightThemeCss: string;
  codemirrorDarkThemeCss: string;
  codemirrorJs: string;
  codemirrorMarkdownJs: string;
  codemirrorContinuelistJs: string;
}

export interface BuildOptions {
  source: string;
  title: string;
  filename: string;
  docId: string;
  rendererVersion: string;
  renderer: RendererSpec;
  theme: ThemeSpec;
  defaultTheme: string;
  themes: ThemeEntry[];
  ratio: string;
  versionManifest: string;
  appJs: string;
  runtime: string;
  editorLibs: EditorLibs;
  revealCss: RevealCssSpec;
  cdn: {
    katexCss: string;
    mermaidJs: string;
    smilesJs: string;
    chartJs: string;
  };
}

/** Prevent an embedded `</script>` in user content from closing the block. */
function escapeForScript(s: string): string {
  return s.replace(/<\/(script)/gi, '<\\/$1');
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const CHROME_CSS = `
  html, body { margin: 0; height: 100%; }
  .reveal { height: 100%; }
  [data-mode="edit"] .reveal { height: 58%; }

  /* Edit control — a circular, theme-tinted button (color = --accent) that
     app.js positions just above reveal's left/right arrows, reading as part of
     the control cluster. The unused up/down arrows are hidden to make room. */
  .reveal .controls .navigate-up, .reveal .controls .navigate-down { display: none; }
  .orz-edit-ctrl {
    position: fixed; left: 24px; bottom: 18px; z-index: 30;
    width: 40px; height: 40px; padding: 0; box-sizing: border-box;
    border: 0; border-radius: 50%;
    background: rgba(130,130,130,.16);
    background: color-mix(in srgb, var(--accent, #888) 16%, transparent);
    color: var(--accent, #888); cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    font-size: 19px; line-height: 1; opacity: .85;
    transition: opacity .15s, transform .15s, background .15s;
  }
  .orz-edit-ctrl:hover {
    opacity: 1; transform: scale(1.1);
    background: color-mix(in srgb, var(--accent, #888) 30%, transparent);
  }
  [data-mode="edit"] .orz-edit-ctrl { display: none; }

  #orz-panel { display: none; }
  [data-mode="edit"] #orz-panel {
    display: flex; flex-direction: column;
    position: fixed; left: 0; right: 0; bottom: 0; height: 42%; z-index: 40;
    background: #1f2228; border-top: 1px solid #333; box-shadow: 0 -2px 16px rgba(0,0,0,.3);
  }
  #orz-toolbar {
    display: flex; align-items: center; gap: 3px; flex-wrap: wrap;
    padding: 7px 10px; background: #23262c; border-bottom: 1px solid #34383f;
  }
  #orz-toolbar .ic {
    width: 32px; height: 30px; padding: 0; display: inline-flex; align-items: center; justify-content: center;
    background: transparent; border: 0; border-radius: 7px; color: #c2c8d0; cursor: pointer;
    transition: background .12s, color .12s;
  }
  #orz-toolbar .ic:hover { background: #383d45; color: #fff; }
  #orz-toolbar .ic:active { transform: translateY(1px); }
  #orz-toolbar .ic svg { width: 17px; height: 17px; display: block; }
  #orz-toolbar .ic.primary { background: #3b82f6; color: #fff; }
  #orz-toolbar .ic.primary:hover { background: #2f6fe0; }
  #orz-toolbar .ic.active { background: #3b82f6; color: #fff; }
  #orz-toolbar .ic.danger:hover { background: #b4434333; color: #ff8a8a; }
  #orz-toolbar select {
    font: 500 12.5px/1 system-ui, sans-serif; color: #e6e8ec; background: #34383f;
    border: 1px solid #454b55; border-radius: 7px; padding: 6px 8px; cursor: pointer; margin: 0 2px;
  }
  #orz-toolbar .orz-sep { width: 1px; height: 20px; background: #3c414a; margin: 0 5px; }
  #orz-toolbar .orz-pos { color: #9aa3b2; font: 600 12px/1 system-ui, sans-serif; padding: 0 4px; min-width: 40px; text-align: center; }
  #orz-toolbar .orz-spacer { flex: 1; }
  #orz-editor-host { flex: 1; min-height: 0; overflow: hidden; }
  #orz-editor-host .CodeMirror { height: 100%; font-size: 14px; }
  #orz-ta { width: 100%; height: 100%; box-sizing: border-box; border: 0; padding: 10px;
    font: 14px/1.5 ui-monospace, Menlo, Consolas, monospace; }

  .orz-banner {
    position: fixed; left: 50%; top: 14px; transform: translateX(-50%); z-index: 60;
    display: none; align-items: center; gap: 10px;
    background: #2b2f36; color: #eee; border: 1px solid #444; border-radius: 8px;
    padding: 9px 14px; font: 13px/1.3 system-ui, sans-serif; box-shadow: 0 4px 16px rgba(0,0,0,.3);
  }
  .orz-banner.show { display: flex; }
  .orz-banner button { font: 500 12.5px system-ui, sans-serif; color: #e6e8ec; background: #3a3f48;
    border: 1px solid #4a505a; border-radius: 6px; padding: 5px 10px; cursor: pointer; }
  #orz-toast {
    position: fixed; left: 50%; bottom: 18px; transform: translateX(-50%) translateY(20px);
    z-index: 70; background: #111; color: #fff; padding: 9px 16px; border-radius: 8px;
    font: 13px system-ui, sans-serif; opacity: 0; transition: opacity .2s, transform .2s; pointer-events: none;
  }
  #orz-toast.show { opacity: .95; transform: translateX(-50%) translateY(0); }
`;

/** Inline line-icons (stroke = currentColor) for the editor toolbar. */
function svg(path: string): string {
  return `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
}
const ICON = {
  done: svg('<path d="M3 8.4l3.2 3.2L13 4.8"/>'),
  deck: svg('<path d="M2.5 5h6M2.5 11h2.5M8 11h5.5"/><circle cx="10" cy="5" r="1.7"/><circle cx="5.5" cy="11" r="1.7"/>'),
  prev: svg('<path d="M10 3.5L5.5 8l4.5 4.5"/>'),
  next: svg('<path d="M6 3.5L10.5 8 6 12.5"/>'),
  add: svg('<path d="M8 3.2v9.6M3.2 8h9.6"/>'),
  dup: svg('<rect x="5.5" y="5.5" width="7.3" height="7.3" rx="1.3"/><path d="M3.2 10V4.3A1.1 1.1 0 0 1 4.3 3.2h5.7"/>'),
  del: svg('<path d="M3 4.5h10M6.2 4.5V3.3a.8.8 0 0 1 .8-.8h2a.8.8 0 0 1 .8.8v1.2M4.9 4.5l.5 8a1 1 0 0 0 1 .95h3.2a1 1 0 0 0 1-.95l.5-8"/>'),
  up: svg('<path d="M8 13V3.4M4 7.2l4-4 4 4"/>'),
  down: svg('<path d="M8 3v9.6M4 8.8l4 4 4-4"/>'),
  download: svg('<path d="M8 2.6v7.6M4.6 6.9 8 10.3l3.4-3.4M3 13.2h10"/>'),
  save: svg('<path d="M3.4 3.2h7L13 5.6v7.2H3.4z"/><path d="M5.6 3.2v3.2h4V3.2M5.6 12.8V9.4h4.8v3.4"/>'),
};

export function buildHtml(o: BuildOptions): string {
  // Inline mode embeds base.css once + every theme as a toggleable <style>
  // (only the active one matches media), so the editor can switch themes with
  // no network. CDN mode links the default theme; the editor swaps the link.
  const themeTag =
    o.theme.mode === 'inline'
      ? `<style id="orz-theme-base">\n${o.theme.base}\n</style>\n`
        + o.theme.themes
            .map(
              (t) =>
                `<style class="orz-theme-css" data-theme-css="${escapeHtml(t.id)}" media="${
                  t.id === o.defaultTheme ? 'all' : 'not all'
                }">\n${t.css}\n</style>`
            )
            .join('\n')
      : `<link id="orz-theme-base" rel="stylesheet" href="${escapeHtml(
          (o.themes.find((t) => t.id === o.defaultTheme) || o.themes[0]).href
        )}">`;

  const rendererTag =
    o.renderer.mode === 'inline'
      ? `<script>${escapeForScript(o.renderer.js)}</script>`
      : `<script src="${escapeHtml(o.renderer.src)}"></script>`;

  const revealCssTag =
    o.revealCss.mode === 'inline'
      ? `<style>\n${o.revealCss.reset}\n</style>\n<style>\n${o.revealCss.core}\n</style>`
      : `<link rel="stylesheet" href="${escapeHtml(o.revealCss.resetUrl)}">\n`
        + `<link rel="stylesheet" href="${escapeHtml(o.revealCss.coreUrl)}">`;

  const config = {
    version: o.rendererVersion,
    docId: o.docId,
    filename: o.filename,
    rendererVersion: o.rendererVersion,
    versionManifest: o.versionManifest,
    defaultTheme: o.defaultTheme,
    themes: o.themes,
    ratio: o.ratio,
    enhancers: { mermaidJs: o.cdn.mermaidJs, smilesJs: o.cdn.smilesJs, chartJs: o.cdn.chartJs },
    editorLibs: o.editorLibs,
  };

  return `<!DOCTYPE html>
<html lang="en" data-mode="present" data-theme="${escapeHtml(o.defaultTheme)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(o.title)}</title>
<meta name="generator" content="orz-slides">
${revealCssTag}
<link rel="stylesheet" href="${escapeHtml(o.cdn.katexCss)}">
${themeTag}
<style>${CHROME_CSS}</style>
</head>
<body>
<div class="reveal"><div class="slides"></div></div>

<button id="orz-edit-fab" class="orz-edit-ctrl" title="Edit this deck">&#9998;</button>

<div id="orz-panel">
  <div id="orz-toolbar">
    <button id="orz-done" class="ic" title="Done — back to presenting">${ICON.done}</button>
    <button id="orz-deck-btn" class="ic" title="Deck settings (theme, footer, ratio, title)">${ICON.deck}</button>
    <span class="orz-sep"></span>
    <button id="orz-prev" class="ic" title="Previous slide">${ICON.prev}</button>
    <span id="orz-pos" class="orz-pos">1 / 1</span>
    <button id="orz-next" class="ic" title="Next slide">${ICON.next}</button>
    <span class="orz-sep"></span>
    <button id="orz-add" class="ic" title="Add a slide after this one">${ICON.add}</button>
    <button id="orz-dup" class="ic" title="Duplicate this slide">${ICON.dup}</button>
    <button id="orz-del" class="ic danger" title="Delete this slide">${ICON.del}</button>
    <button id="orz-up" class="ic" title="Move slide earlier">${ICON.up}</button>
    <button id="orz-down" class="ic" title="Move slide later">${ICON.down}</button>
    <span class="orz-spacer"></span>
    <select id="orz-theme" title="Theme"></select>
    <button id="orz-download" class="ic" title="Download a copy">${ICON.download}</button>
    <button id="orz-save" class="ic primary" title="Save (Ctrl/Cmd+S)">${ICON.save}</button>
  </div>
  <div id="orz-editor-host"><textarea id="orz-ta" spellcheck="false"></textarea></div>
</div>

<div id="orz-update" class="orz-banner"><span class="upd-text"></span><button id="orz-upd-dismiss">Dismiss</button></div>
<div id="orz-served-note" class="orz-banner"><span>This is a published page &mdash; edits can&rsquo;t be saved back to the server.</span><button id="orz-served-download">Download copy</button><button id="orz-served-dismiss">Dismiss</button></div>
<div id="orz-toast"></div>

<script type="text/orz-slides" id="orz-deck">
${escapeForScript(o.source)}
</script>

${rendererTag}
<script>window.__ORZ_SLIDES__ = ${JSON.stringify(config)};</script>
<script>
  (function () {
    function boot() { if (window.orzslides) window.orzslides.mount(); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
  })();
</script>
<script>${o.runtime}</script>
<script>${o.appJs}</script>
</body>
</html>
`;
}
