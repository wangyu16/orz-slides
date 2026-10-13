/**
 * Content libraries in a scaled deck (two carrier-local workarounds).
 *
 * KIT GAP (orz-markdown 2.4.0): Mermaid's HTML labels are measured with
 * `getBoundingClientRect`, which a CSS-transformed ancestor distorts — and
 * reveal.js scales the slides with a transform, so a diagram drawn in the
 * deck gets label boxes cut to the scale ("Initiato" for "Initiator"). The
 * kit draws Mermaid with its own configuration (`OrzContentTheme.runMermaid`
 * calls `mermaid.initialize(config)` per diagram group) and offers no option
 * for SVG labels. Until it does, the engine makes every configuration the
 * kit gives Mermaid in this page use SVG text labels (`htmlLabels: false`,
 * measured with `getBBox`, which transforms do not affect): the global is
 * watched (the kit loads Mermaid by a script) and its `initialize` wrapped
 * once. A diagram's own `%%{init}%%` still wins (Mermaid applies it after).
 */
type MermaidLib = { initialize?(config: Record<string, unknown>): unknown; __orzSlidesLabels?: boolean };

function patch(lib: unknown): void {
  const m = lib as MermaidLib | null;
  if (!m || typeof m !== 'object' || typeof m.initialize !== 'function' || m.__orzSlidesLabels) return;
  const init = m.initialize.bind(m);
  m.initialize = (config: Record<string, unknown> = {}) => {
    const flowchart = config['flowchart'] && typeof config['flowchart'] === 'object' ? config['flowchart'] as Record<string, unknown> : {};
    return init({ ...config, htmlLabels: false, flowchart: { ...flowchart, htmlLabels: false } });
  };
  m.__orzSlidesLabels = true;
}

/** Make Mermaid in `win` draw SVG labels (see the module comment); idempotent. */
export function svgMermaidLabels(win: Window): void {
  const w = win as unknown as { mermaid?: unknown; __orzSlidesMermaidHook?: boolean };
  if (w.__orzSlidesMermaidHook) return;
  w.__orzSlidesMermaidHook = true;
  if (w.mermaid) { patch(w.mermaid); return; }
  let value: unknown;
  try {
    Object.defineProperty(win, 'mermaid', {
      configurable: true,
      enumerable: true,
      get: () => value,
      set: (x: unknown) => { value = x; patch(x); },
    });
  } catch { /* a page that fixed the global: labels as Mermaid draws them */ }
}

/**
 * KIT GAP (orz-markdown 2.4.0): the kit themes Chart.js's colours and font
 * family from `--chart-*` but has no font-size token, so charts keep
 * Chart.js's 12 px — about 1.7 % of a 720 px slide, unreadable projected.
 * Until the kit reads one, the engine sets Chart.js's default size in this
 * page to `--chart-font-size` of the document (default 18, logical px) when
 * the library arrives. A chart's own options still win.
 */
export function chartFontSize(win: Window): void {
  const w = win as unknown as { Chart?: unknown; __orzSlidesChartHook?: boolean };
  if (w.__orzSlidesChartHook) return;
  w.__orzSlidesChartHook = true;
  const apply = (lib: unknown): void => {
    try {
      const d = (lib as { defaults?: { font?: { size?: number } } }).defaults;
      if (!d || !d.font) return;
      const raw = parseFloat(win.getComputedStyle(win.document.documentElement).getPropertyValue('--chart-font-size'));
      d.font.size = Number.isFinite(raw) && raw > 0 ? raw : 18;
    } catch { /* Chart.js's own defaults */ }
  };
  if (w.Chart) { apply(w.Chart); return; }
  let value: unknown;
  try {
    Object.defineProperty(win, 'Chart', {
      configurable: true,
      enumerable: true,
      get: () => value,
      set: (x: unknown) => { value = x; apply(x); },
    });
  } catch { /* a page that fixed the global */ }
}
