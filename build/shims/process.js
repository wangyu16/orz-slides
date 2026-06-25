// Minimal `process` shim for the browser bundle. Some transitive code paths
// reference Node's `process` (e.g. markdown-include's process.cwd() fallback,
// or process.emitWarning in a dependency). esbuild `inject`s this so those
// references resolve to a harmless object instead of throwing
// "process is not defined" at render time.
export const process = {
  env: { NODE_ENV: 'production' },
  platform: 'browser',
  browser: true,
  version: '',
  versions: {},
  argv: [],
  cwd: function () { return '/'; },
  nextTick: function (fn) { Promise.resolve().then(fn); },
  emitWarning: function () {},
};
