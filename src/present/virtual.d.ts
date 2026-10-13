/**
 * The virtual module build/bundle.ts provides (esbuild plugin
 * `slide-themes`): the engine's stylesheets as text — reveal.js's core CSS,
 * the engine's structure (assets/themes/deck.css) and the generated slide
 * themes (assets/themes/<id>.css, scripts/build-themes.ts).
 */
declare module 'orz-slides:themes' {
  /** reveal.js `dist/reveal.css` (its core layout; no reveal theme). */
  export const REVEAL_CSS: string;
  /** assets/themes/deck.css: the engine's structure (docs/dom-contract.md). */
  export const DECK_CSS: string;
  /** Theme id → its stylesheet (the themes built so far). */
  export const THEME_CSS: Readonly<Record<string, string>>;
}

/** reveal.js 5 (no bundled types): the part of its API the engine uses (src/present/engine.ts). */
declare module 'reveal.js' {
  export interface RevealApi {
    initialize(options?: Record<string, unknown>): Promise<unknown>;
    configure(options: Record<string, unknown>): void;
    destroy(): void;
    sync(): void;
    layout(): void;
    slide(h: number, v?: number, f?: number): void;
    next(): void;
    prev(): void;
    getIndices(slide?: HTMLElement): { h: number; v: number; f?: number };
    getCurrentSlide(): HTMLElement | undefined;
    getSlides(): HTMLElement[];
    getTotalSlides(): number;
    isReady(): boolean;
    isOverview(): boolean;
    toggleOverview(override?: boolean): void;
    availableFragments(): { prev: boolean; next: boolean };
    on(type: string, listener: (event: Event & Record<string, unknown>) => void): void;
    off(type: string, listener: (event: Event & Record<string, unknown>) => void): void;
  }
  const Reveal: { new (element: HTMLElement, options?: Record<string, unknown>): RevealApi };
  export default Reveal;
}
