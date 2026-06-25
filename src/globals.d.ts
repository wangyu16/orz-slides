/* Ambient declarations for the browser bundle. */

// reveal.js ships no types; esbuild resolves the real module at bundle time.
declare module 'reveal.js' {
  const Reveal: any;
  export default Reveal;
}

// Version injected at bundle time via esbuild `define`.
declare const __ORZSLIDES_VERSION__: string;

interface OrzSlidesConfig {
  version?: string;
  docId?: string;
  filename?: string;
  defaultTheme?: string;
  ratio?: string;
  enhancers?: { mermaidJs?: string; smilesJs?: string; chartJs?: string };
}

interface Window {
  __ORZ_SLIDES__?: OrzSlidesConfig;
  orzslides: {
    version: string;
    md: { render(src: string): string; renderInline?(src: string): string };
    parseDeck: typeof import('./slide-parser.js').parseDeck;
    renderDeck: typeof import('./render-slide.js').renderDeck;
    renderSlide: typeof import('./render-slide.js').renderSlide;
    mount(): void;
    renderAll(source: string): void;
    refresh(): void;
    openSpeaker(): void;
    toggleTimer(): void;
    reveal: any;
  };
}
