// Browser stub for Node's `fs`, used when bundling orz-markdown.
//
// Filesystem-dependent features (markdown-include directives, auto image
// sizing via markdown-it-imsize) cannot run in the browser. These no-ops let
// the bundle build and load; the features simply degrade rather than crash.
function unavailable() {
  return undefined;
}
module.exports = {
  readFileSync: function () {
    throw new Error('fs.readFileSync is unavailable in the browser build');
  },
  existsSync: function () { return false; },
  statSync: unavailable,
  lstatSync: unavailable,
  readdirSync: function () { return []; },
};
