/**
 * Adversarial audit 2 of STATUS D-135 (claim W.10), after the audit-1 fix
 * (08a0715: cardLayout floors its viewport to whole CSS px).
 *
 * The fix assumed the frame's window.innerWidth is the floor of the iframe's
 * fractional box. Chrome ROUNDS it (measured in Chrome at DPR 1, 2 and 3: an
 * iframe 563.5 / 563.6 / 563.7 px wide has innerWidth 564; at x.5 and above
 * it rounds up). So the page (editor.ts:735, getBoundingClientRect().width,
 * floored) and the frame (live-frame.ts:171, innerWidth, already rounded)
 * still disagree for a frame whose width is x.5–x.99 px: by 1 px in the card
 * box everywhere, and on the compact verdict for a 564.5–565 px preview.
 */
import { describe, it, expect } from 'vitest';
import { cardCompact, cardLayout } from '../src/browser/slides/stage-geometry.js';

/** Chrome's innerWidth of an iframe whose box is `w` CSS px wide (measured: round half up). */
const chromeInnerWidth = (w: number): number => Math.round(w);

describe('audit2: the page and the frame decide the card alike (D-135)', () => {
  it('[A2-S1] a fractional frame width (page side) and Chrome\'s rounded innerWidth (frame side) give the same compact verdict', () => {
    const disagree: number[] = [];
    for (let w = 400; w <= 700; w += 0.25) {
      const page = cardCompact(cardLayout(w, 2000, 1280, 720).card.w);
      const frame = cardCompact(cardLayout(chromeInnerWidth(w), 2000, 1280, 720).card.w);
      if (page !== frame) disagree.push(w);
    }
    expect(disagree).toEqual([]);
  });

  it('[A2-S2] the card box (x, w) is the same on both sides for a fractional frame width', () => {
    const differ: number[] = [];
    for (let w = 400; w <= 1400; w += 0.25) {
      const a = cardLayout(w, 900, 1280, 720).card;
      const b = cardLayout(chromeInnerWidth(w), 900, 1280, 720).card;
      if (a.x !== b.x || a.w !== b.w) differ.push(w);
    }
    expect(differ.slice(0, 5)).toEqual([]);
  });
});
