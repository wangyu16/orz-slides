/**
 * The IIFE entry of `orz-slides-browser` (`orz-slides.browser.js`). First its
 * own script text is captured (`captureEngineSource`, only this carrier's
 * bundle: an inline file's `#orz-engine` — or the update sandbox's — exact
 * bundle, which an inline assembly writes back; a script loaded by URL as
 * `orz-slides.browser.js`); then the kit's `startCarrier` sets the standard
 * bundle global `globalThis.OrzCarrier` (FC-19 §2) and, when it runs inside
 * an assembled `.slides.html` (an `#orz-src` island is present), boots the
 * standalone file (orz-markdown `carrier/app`: read view, chrome, edit mode,
 * saves, host, quiet update).
 *
 * In the quiet update's sandbox and in an app's page there is no island: only
 * the global is set, nothing else is touched.
 */
import { captureEngineSource, startCarrier } from 'orz-markdown/carrier/app';
import { BUNDLE_FILE } from '../assemble.js';
import { useEngineSource } from './carrier.js';
import { SLIDES_KIND } from './slides/kind.js';

useEngineSource(captureEngineSource(undefined, { bundle: BUNDLE_FILE }));
startCarrier(SLIDES_KIND);
