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
  html { --orz-vsplit: 42%; }
  .reveal { height: 100%; }
  [data-mode="edit"] .reveal { height: calc(100% - var(--orz-vsplit)); }

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
  .orz-edit-ctrl svg { width: 19px; height: 19px; display: block; }

  #orz-panel {
    display: flex; flex-direction: column;
    position: fixed; left: 0; right: 0; bottom: 0; height: var(--orz-vsplit); z-index: 40;
    background: #1f2228; border-top: 1px solid #333; box-shadow: 0 -2px 16px rgba(0,0,0,.3);
    transform: translateY(calc(100% + 28px)); transition: transform .22s ease;
  }
  [data-mode="edit"] #orz-panel { transform: translateY(0); }
  /* vertical resize handle on the panel's top edge (drag to set editor/deck split) */
  #orz-vdivider { position: absolute; top: 0; left: 0; right: 0; height: 6px; z-index: 44; cursor: row-resize; }
  #orz-vdivider:hover, #orz-vdivider.dragging { background: #3b82f6; }
  /* close tab — a small handle on the editor's top edge that slides it away */
  #orz-close {
    position: absolute; top: -19px; left: 50%; transform: translateX(-50%);
    width: 50px; height: 19px; z-index: 46; padding: 0;
    display: inline-flex; align-items: center; justify-content: center;
    border: 0; border-radius: 8px 8px 0 0; background: #23262c; color: #c2c8d0;
    cursor: pointer; box-shadow: 0 -2px 8px rgba(0,0,0,.18);
  }
  #orz-close:hover { background: #383d45; color: #fff; }
  #orz-close svg { width: 15px; height: 15px; display: block; }
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
  #orz-toolbar #orz-copy { font: 500 11px/1 system-ui, sans-serif; color: #6b7480; text-decoration: none;
    padding: 0 4px; white-space: nowrap; }
  #orz-toolbar #orz-copy:hover { color: #cdd3df; }
  #orz-toolbar .orz-sep { width: 1px; height: 20px; background: #3c414a; margin: 0 5px; }
  #orz-toolbar .orz-pos { color: #9aa3b2; font: 600 12px/1 system-ui, sans-serif; padding: 0 4px; min-width: 40px; text-align: center; }
  #orz-toolbar .orz-spacer { flex: 1; }
  #orz-toolbar #orz-brand {
    display: inline-flex; align-items: center; gap: 6px; text-decoration: none;
    color: #cdd3df; padding: 2px 7px; border-radius: 7px;
  }
  #orz-toolbar #orz-brand:hover { color: #fff; background: #383d45; }
  #orz-toolbar #orz-brand .orz-logo svg { height: 22px; width: auto; display: block; }
  #orz-toolbar #orz-brand .orz-brand-name { font: 700 13px/1 system-ui, sans-serif; letter-spacing: .01em; }
  #orz-toolbar #orz-brand .orz-gh { display: inline-flex; opacity: .55; }
  #orz-toolbar #orz-brand:hover .orz-gh { opacity: 1; }
  #orz-toolbar #orz-brand .orz-gh svg { width: 15px; height: 15px; display: block; }
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

  /* layout picker popover */
  #orz-layout-menu { position: fixed; z-index: 75; display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px;
    width: 320px; max-height: 64vh; overflow: auto; padding: 8px; box-sizing: border-box;
    background: #23262c; border: 1px solid #3c414a; border-radius: 10px; box-shadow: 0 12px 32px rgba(0,0,0,.5); }
  #orz-layout-menu[hidden] { display: none; }
  .orz-layout-tile { display: flex; flex-direction: column; align-items: center; gap: 5px; padding: 7px 4px;
    background: transparent; border: 1px solid transparent; border-radius: 8px; cursor: pointer; color: #c2c8d0; }
  .orz-layout-tile:hover { background: #2f343c; border-color: #454b55; color: #fff; }
  .orz-layout-tile svg { width: 74px; height: 46px; display: block; }
  .orz-layout-tile .lname { font: 500 11px/1.15 system-ui, sans-serif; text-align: center; }
  .orz-layout-more { grid-column: 1 / -1; display: block; text-align: center; padding: 9px 8px 4px;
    margin-top: 3px; border-top: 1px solid #3c414a; color: #9aa3b2; text-decoration: none;
    font: 600 12px/1 system-ui, sans-serif; }
  .orz-layout-more:hover { color: #fff; }
`;

/** Inline line-icons (stroke = currentColor) for the editor toolbar. */
function svg(path: string): string {
  return `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
}
/** Canonical 24-viewBox icons (shared across the orz family) for functions that
 *  exist on every surface, so the same function shows the same glyph. */
function ic24(path: string): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
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
  download: ic24('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>'),
  save: ic24('<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/>'),
  pencil: ic24('<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>'),
  collapseDown: ic24('<path d="M6 9l6 6 6-6"/>'),
  layout: ic24('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>'),
};

/** The orz mark — the "orz" wordmark knocked out of a weathered green seal
 *  (rough-edged, stone-textured). From wangyu16/logoes-and-icons (orz.svg);
 *  IDs are namespaced `orzlogo-*` so they can't collide with user SVGs. */
const ORZ_LOGO =
  "<svg viewBox=\"-5 -5 180 100\" xmlns=\"http://www.w3.org/2000/svg\" class=\"orz-mark\" aria-hidden=\"true\"><defs><filter id=\"orzlogo-rough\" x=\"-10%\" y=\"-10%\" width=\"120%\" height=\"120%\"><feTurbulence type=\"fractalNoise\" baseFrequency=\"0.04\" numOctaves=\"3\" result=\"noise\" /><feDisplacementMap in=\"SourceGraphic\" in2=\"noise\" scale=\"2.5\" xChannelSelector=\"R\" yChannelSelector=\"G\" /></filter><path d=\"M 20,23 C 33,16 57,17 84,13 C 111,8 137,4 153,6 C 165,7 170,13 169,25 L 167,66 C 166,79 159,87 146,89 C 121,93 92,92 60,91 C 41,90 27,92 16,89 C 6,86 1,79 1,67 L 1,50 C 1,35 7,25 20,23 Z\" id=\"orzlogo-seal\" /><filter id=\"orzlogo-stone\" x=\"-10%\" y=\"-10%\" width=\"120%\" height=\"120%\"><feTurbulence type=\"fractalNoise\" baseFrequency=\"0.95\" numOctaves=\"2\" seed=\"11\" result=\"noise\" /><feColorMatrix in=\"noise\" type=\"saturate\" values=\"0\" result=\"mono\" /><feComponentTransfer in=\"mono\" result=\"grain\"><feFuncA type=\"table\" tableValues=\"0 0.16\" /></feComponentTransfer></filter><mask id=\"orzlogo-mask\"><use href=\"#orzlogo-seal\" fill=\"white\" /><path d=\"M37.81 80.31Q30.44 80.31 24.50 77Q18.56 73.69 15.25 67.75Q11.94 61.81 11.94 54.19L11.94 54.19Q11.94 41.69 21.13 35.56Q30.31 29.44 43.69 29.44L43.69 29.44Q49.81 29.44 55.13 32.44Q60.44 35.44 63.69 41.06Q66.94 46.69 66.94 54.06L66.94 54.06Q66.94 62.06 62.81 68Q58.69 73.94 52 77.13Q45.31 80.31 37.81 80.31L37.81 80.31ZM36.44 73.19Q48.06 73.19 54.06 67.94Q60.06 62.69 60.06 52.56L60.06 52.56Q60.06 45.69 55.38 40.69Q50.69 35.69 42.31 35.69L42.31 35.69Q36.69 35.69 30.94 37.81Q25.19 39.94 21.44 44.19Q17.69 48.44 17.69 54.44L17.69 54.44Q17.69 59.44 20.19 63.75Q22.69 68.06 27 70.63Q31.31 73.19 36.44 73.19L36.44 73.19ZM87.94 80.19Q82.81 70.19 79.88 56.69Q76.94 43.19 76.94 33.31L76.94 33.31Q76.94 29.44 78.69 28.31L78.69 28.31Q79.69 27.69 80.19 27.69L80.19 27.69Q81.06 27.69 81.50 29.06Q81.94 30.44 82.44 34.06L82.44 34.06L83.06 38.56Q84.44 31.81 88.38 27.88Q92.31 23.94 98.06 23.94L98.06 23.94Q104.44 23.94 107.56 26.38Q110.69 28.81 110.69 34.44L110.69 34.44Q104.44 31.44 99.31 31.44L99.31 31.44Q94.44 31.44 90.94 34.06Q87.44 36.69 86.06 41.81L86.06 41.81Q84.94 45.31 84.94 48.44L84.94 48.44Q84.94 51.81 85.88 54.75Q86.81 57.69 88.81 61.94L88.81 61.94Q90.69 66.31 91.75 69.44Q92.81 72.56 92.94 76.19L92.94 76.19Q92.94 78.31 91.44 79.25Q89.94 80.19 87.94 80.19L87.94 80.19ZM160.56 66.19Q163.06 68.06 163.06 70.19L163.06 70.19Q163.06 73.56 157.31 75.81Q151.56 78.06 144.31 79.13Q137.06 80.19 132.81 80.19L132.81 80.19Q128.06 80.19 123.75 78.63Q119.44 77.06 119.44 73.19L119.44 73.19Q119.44 69.44 123.63 63.44Q127.81 57.44 133.69 51.19L133.69 51.19L117.56 51.19Q116.31 51.19 116.31 48.94L116.31 48.94Q116.31 47.19 116.69 46.50Q117.06 45.81 117.69 45.69Q118.31 45.56 120.06 45.56L120.06 45.56L139.31 45.56Q143.94 39.69 146.38 35.50Q148.81 31.31 148.81 27.69L148.81 27.69Q148.81 24.06 146.31 21.19L146.31 21.19Q142.44 20.44 138.81 20.44L138.81 20.44Q131.94 20.44 127.19 22.75Q122.44 25.06 121.94 28.81L121.94 28.81Q119.06 28.81 118.13 27.81Q117.19 26.81 117.19 24.44L117.19 24.44Q117.19 21.94 119.75 19.63Q122.31 17.31 126.94 15.88Q131.56 14.44 137.31 14.44L137.31 14.44Q142.06 14.44 147.31 15.56L147.31 15.56Q150.56 16.19 152.81 19.69Q155.06 23.19 155.06 27.44L155.06 27.44Q155.06 31.19 152.75 35.31Q150.44 39.44 145.94 45.56L145.94 45.56L152.06 45.56Q156.81 45.56 158.38 46.06Q159.94 46.56 159.94 48.06L159.94 48.06Q159.94 49.31 159.13 50.19Q158.31 51.06 157.44 51.06L157.44 51.06L140.19 51.06Q134.06 57.94 130.81 63.25Q127.56 68.56 128.19 70.81L128.19 70.81Q128.69 73.19 135.94 74.06L135.94 74.06Q144.06 74.06 149.69 72.13Q155.31 70.19 160.56 66.19L160.56 66.19Z\" fill=\"black\" stroke=\"black\" stroke-width=\"3\" stroke-linejoin=\"round\" stroke-linecap=\"round\" /></mask></defs><g filter=\"url(#orzlogo-rough)\"><use href=\"#orzlogo-seal\" fill=\"#96d969\" mask=\"url(#orzlogo-mask)\" /><use href=\"#orzlogo-seal\" fill=\"#6ea84d\" opacity=\"0.28\" filter=\"url(#orzlogo-stone)\" mask=\"url(#orzlogo-mask)\" /><use href=\"#orzlogo-seal\" fill=\"none\" stroke=\"#c8f7a5\" stroke-width=\"1.5\" stroke-linejoin=\"round\" stroke-linecap=\"round\" stroke-opacity=\"0.42\" mask=\"url(#orzlogo-mask)\" /><use href=\"#orzlogo-seal\" fill=\"none\" stroke=\"#5f8f44\" stroke-width=\"1.2\" stroke-linejoin=\"round\" stroke-linecap=\"round\" stroke-opacity=\"0.35\" mask=\"url(#orzlogo-mask)\" /></g></svg>";

/** GitHub mark (fill = currentColor). */
const GH_ICON =
  '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>';

/** Editor-header brand: logo + app name + GitHub link (whole thing → repo). */
const BRAND =
  '<a id="orz-brand" href="https://github.com/wangyu16/orz-slides" target="_blank" rel="noopener noreferrer" title="orz-slides on GitHub">' +
  `<span class="orz-logo">${ORZ_LOGO}</span>` +
  '<span class="orz-brand-name">slides</span>' +
  `<span class="orz-gh">${GH_ICON}</span>` +
  '</a>';

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
      ? `<script data-orz-asset="engine">${escapeForScript(o.renderer.js)}</script>`
      : `<script data-orz-asset="engine" src="${escapeHtml(o.renderer.src)}"></script>`;

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
    // NB: the update SOURCE (manifest/packages/host) is hardcoded in app.js, not
    // here — a config field must never be able to redirect the self-update.
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
<!-- ═══════════ orz · editing this deck with an AI agent ═══════════
  This is a self-contained, EDITABLE orz-slides deck (.slides.html). The editable
  source of truth is the slide markdown inside <script id="orz-deck"> below (kind:
  slides, format: 1) — NOT the rendered HTML.

  To edit it correctly, load the official orz-slides agent skill first: it defines
  the comment-based layout grammar (slide markers, title bands, region splits,
  speaker notes) and guarantees a byte-identical round-trip.
    - Fetch the skill: https://cdn.jsdelivr.net/npm/orz-slides/orz-slides-skills/SKILL.md
    - Install routes:  https://markdown.orz.how/agents.html

  Rules: edit ONLY the embedded deck source and re-embed it in place.
═══════════════════════════════════════════════════════════════════ -->
<div class="reveal"><div class="slides"></div></div>

<button id="orz-edit-fab" class="orz-edit-ctrl" title="Edit this deck">${ICON.pencil}</button>

<div id="orz-panel">
  <div id="orz-vdivider" title="Drag to resize"></div>
  <button id="orz-close" title="Close editor — back to presenting">${ICON.collapseDown}</button>
  <div id="orz-toolbar">
    ${BRAND}
    <span class="orz-sep"></span>
    <button id="orz-save" class="ic primary" title="Save (Ctrl/Cmd+S)">${ICON.save}</button>
    <button id="orz-download" class="ic" title="Download a copy">${ICON.download}</button>
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
    <button id="orz-layout-btn" class="ic" title="Slide layout" aria-haspopup="true" aria-expanded="false">${ICON.layout}</button>
    <button id="orz-deck-btn" class="ic" title="Deck settings (theme, footer, ratio, title)">${ICON.deck}</button>
    <select id="orz-theme" title="Theme"></select>
    <a id="orz-copy" href="https://markdown.orz.how" target="_blank" rel="noopener noreferrer" title="orz-markdown">© orz-markdown</a>
  </div>
  <div id="orz-editor-host"><textarea id="orz-ta" spellcheck="false"></textarea></div>
</div>

<div id="orz-layout-menu" hidden role="menu" aria-label="Slide layouts"></div>

<div id="orz-update" class="orz-banner"><span class="upd-text"></span><button id="orz-upd-apply" class="upd-primary">Update</button><button id="orz-upd-dismiss">Dismiss</button></div>
<div id="orz-served-note" class="orz-banner"><span>This is a published page &mdash; edits can&rsquo;t be saved back to the server.</span><button id="orz-served-download">Download copy</button><button id="orz-served-dismiss">Dismiss</button></div>
<div id="orz-toast"></div>

<script type="text/orz-slides" id="orz-deck">
${escapeForScript(o.source)}
</script>

${rendererTag}
<script data-orz-asset="config">window.__ORZ_SLIDES__ = ${JSON.stringify(config)};</script>
<script>
  (function () {
    function boot() { if (window.orzslides) window.orzslides.mount(); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
  })();
</script>
<script>${o.runtime}</script>
<script data-orz-asset="app">${o.appJs}</script>
</body>
</html>
`;
}
