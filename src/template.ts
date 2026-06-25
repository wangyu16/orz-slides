/**
 * Builds the self-contained `.slides.html` shell:
 *   <head>  reveal.js CSS + KaTeX CSS + the slide theme (inline or CDN link)
 *   <body>  an empty .reveal/.slides container, the embedded deck source in
 *           <script id="orz-deck">, the engine bundle (inline or CDN), a config
 *           object, and a boot call to orzslides.mount().
 *
 * The deck source in #orz-deck is the single source of truth: the engine renders
 * it on load, and (with the WP7 editor) re-serialises it on save.
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
  | { mode: 'inline'; css: string }
  | { mode: 'cdn' };

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
  cdn: {
    revealResetCss: string;
    revealCss: string;
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

export function buildHtml(o: BuildOptions): string {
  const themeTag =
    o.theme.mode === 'inline'
      ? `<style id="orz-theme">\n${o.theme.css}\n</style>`
      : `<link id="orz-theme" rel="stylesheet" href="${escapeHtml(
          (o.themes.find((t) => t.id === o.defaultTheme) || o.themes[0]).href
        )}">`;

  const rendererTag =
    o.renderer.mode === 'inline'
      ? `<script>${escapeForScript(o.renderer.js)}</script>`
      : `<script src="${escapeHtml(o.renderer.src)}"></script>`;

  const config = {
    version: o.rendererVersion,
    docId: o.docId,
    filename: o.filename,
    rendererVersion: o.rendererVersion,
    versionManifest: o.versionManifest,
    defaultTheme: o.defaultTheme,
    themes: o.themes,
    ratio: o.ratio,
    enhancers: {
      mermaidJs: o.cdn.mermaidJs,
      smilesJs: o.cdn.smilesJs,
      chartJs: o.cdn.chartJs,
    },
  };

  return `<!DOCTYPE html>
<html lang="en" data-mode="present" data-theme="${escapeHtml(o.defaultTheme)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(o.title)}</title>
<meta name="generator" content="orz-slides">
<link rel="stylesheet" href="${escapeHtml(o.cdn.revealResetCss)}">
<link rel="stylesheet" href="${escapeHtml(o.cdn.revealCss)}">
<link rel="stylesheet" href="${escapeHtml(o.cdn.katexCss)}">
${themeTag}
<style>
  html, body { margin: 0; height: 100%; }
  .reveal { height: 100%; }
</style>
</head>
<body>
<div class="reveal"><div class="slides"></div></div>

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
</body>
</html>
`;
}
