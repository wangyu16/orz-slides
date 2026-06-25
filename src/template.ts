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

  /* Small edit control — app.js positions it in the middle of reveal's arrow
     cluster and keeps it in sync; it adapts to the active theme via --accent. */
  .orz-edit-ctrl {
    position: fixed; right: 16px; bottom: 16px; z-index: 30;
    width: 22px; height: 22px; padding: 0; box-sizing: border-box;
    border: 0; border-radius: 50%; background: transparent;
    color: var(--accent, #888); cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    font-size: 13px; line-height: 1; opacity: .5;
    transition: opacity .15s, transform .15s;
  }
  .orz-edit-ctrl:hover { opacity: 1; transform: scale(1.18); }
  [data-mode="edit"] .orz-edit-ctrl { display: none; }

  #orz-panel { display: none; }
  [data-mode="edit"] #orz-panel {
    display: flex; flex-direction: column;
    position: fixed; left: 0; right: 0; bottom: 0; height: 42%; z-index: 40;
    background: #1f2228; border-top: 1px solid #333; box-shadow: 0 -2px 16px rgba(0,0,0,.3);
  }
  #orz-toolbar {
    display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
    padding: 6px 8px; background: #2b2f36; border-bottom: 1px solid #383d45;
  }
  #orz-toolbar button, #orz-toolbar select {
    font: 500 12.5px/1 system-ui, sans-serif; color: #e6e8ec; background: #3a3f48;
    border: 1px solid #4a505a; border-radius: 6px; padding: 6px 10px; cursor: pointer;
  }
  #orz-toolbar button:hover { background: #454b55; }
  #orz-toolbar button.primary { background: #3b82f6; border-color: #3b82f6; color: #fff; }
  #orz-toolbar button.active { background: #3b82f6; border-color: #3b82f6; color: #fff; }
  #orz-toolbar .orz-pos { color: #aab; font: 600 12.5px/1 system-ui, sans-serif; padding: 0 4px; }
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
    <button id="orz-done">Done</button>
    <button id="orz-deck-btn" title="Edit deck settings: theme, footer, ratio, title">Deck&hellip;</button>
    <span id="orz-pos" class="orz-pos">1 / 1</span>
    <button id="orz-prev" title="Previous slide">&#9664;</button>
    <button id="orz-next" title="Next slide">&#9654;</button>
    <button id="orz-add" title="Add a slide after this one">+ Slide</button>
    <button id="orz-dup" title="Duplicate this slide">Duplicate</button>
    <button id="orz-del" title="Delete this slide">Delete</button>
    <button id="orz-up" title="Move slide earlier">Move &#8593;</button>
    <button id="orz-down" title="Move slide later">Move &#8595;</button>
    <span class="orz-spacer"></span>
    <select id="orz-theme" title="Theme"></select>
    <button id="orz-download">Download</button>
    <button id="orz-save" class="primary">Save</button>
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
<script>${o.appJs}</script>
</body>
</html>
`;
}
