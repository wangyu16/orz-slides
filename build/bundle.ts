/**
 * Bundles src/browser-entry.ts (+ orz-markdown, reveal.js, the slide parser,
 * layout engine, and assembler) into a single browser IIFE at
 * dist/orz-slides.browser.js — the in-file presentation engine.
 *
 * It is either inlined into each .slides.html (`--inline`) or published to npm
 * as `orz-slides-browser` and served from jsDelivr (`--cdn`).
 */
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdirSync, existsSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

/** orz-slides' own version pins the engine into each generated file. */
const selfVersion: string =
  JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version || '0.0.0';

mkdirSync(join(ROOT, 'dist'), { recursive: true });

/** Redirect markdown-it-imsize's fs/dynamic-require image reader to a stub. */
const stubImsizeFsReader = {
  name: 'stub-imsize-fs-reader',
  setup(b: import('esbuild').PluginBuild) {
    b.onResolve({ filter: /(^|[\\/])imsize$/ }, (args) => {
      if (args.importer.includes('markdown-it-imsize')) {
        return { path: join(HERE, 'shims', 'imsize.cjs') };
      }
      return undefined;
    });
  },
};

await build({
  entryPoints: [join(ROOT, 'src', 'browser-entry.ts')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2020'],
  outfile: join(ROOT, 'dist', 'orz-slides.browser.js'),
  minify: true,
  sourcemap: false,
  plugins: [stubImsizeFsReader],
  // Filesystem-only orz-markdown features don't apply in the browser: give
  // `path` a real browser impl and `fs` a graceful stub.
  alias: {
    fs: join(HERE, 'shims', 'fs.cjs'),
    path: 'path-browserify',
  },
  inject: [join(HERE, 'shims', 'process.js')],
  define: {
    __ORZSLIDES_VERSION__: JSON.stringify(selfVersion),
    'process.env.NODE_ENV': '"production"',
  },
  logLevel: 'info',
});

// Stage the bundle into the orz-slides-browser package (published to CDN).
const browserPkgDir = join(ROOT, 'browser');
mkdirSync(browserPkgDir, { recursive: true });
copyFileSync(
  join(ROOT, 'dist', 'orz-slides.browser.js'),
  join(browserPkgDir, 'orz-slides.browser.js')
);

// CDN-delivered files request the engine at orz-slides' OWN version
// (`orz-slides-browser@${selfVersion}` — see lib.ts). The two package versions
// are therefore one version, and drift is not a nuisance but a hard break: a
// root-only release leaves every CDN deck pointing at a 404, which renders as a
// themed-but-empty page with no engine and no editor. Keep them in lockstep
// here, at the only place that already knows the real version.
const browserPkgPath = join(browserPkgDir, 'package.json');
const browserPkg = JSON.parse(readFileSync(browserPkgPath, 'utf8'));
if (browserPkg.version !== selfVersion) {
  browserPkg.version = selfVersion;
  writeFileSync(browserPkgPath, `${JSON.stringify(browserPkg, null, 2)}\n`);
}

console.log(`Bundled orz-slides@${selfVersion} → dist/orz-slides.browser.js (+ browser/ @ ${selfVersion})`);
