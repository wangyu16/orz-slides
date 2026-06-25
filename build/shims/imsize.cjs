// Browser stub for markdown-it-imsize's filesystem image-size reader (`./imsize`).
//
// The real module reads image bytes from disk (fs.read) and dynamically
// requires per-format detectors (require('./types/' + type)) — neither works
// in the browser. Auto-dimensioning is simply skipped; explicit
// `![alt](url =WxH)` sizing is parsed elsewhere and still works.
module.exports = function imageSizeStub(_input, callback) {
  var empty = { width: undefined, height: undefined };
  if (typeof callback === 'function') return callback(null, empty);
  return empty;
};
