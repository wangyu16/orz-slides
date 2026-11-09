/**
 * Adversarial audit 1 of STATUS D-135 (claim W.10, compact live-card head).
 * The trusted page decides `cardCompact` from the preview iframe's
 * getBoundingClientRect().width (fractional CSS px); the frame decides it from
 * its own window.innerWidth (an integer: Chrome rounds the box, audit 2). Both must agree, or the page draws
 * the full "Edit" chip over a head that kept room only for the icon (the
 * D-135 symptom: "Slide 1 o…" under the chip).
 */
import { describe, it, expect } from 'vitest';
import { cardCompact, cardLayout } from '../src/browser/slides/stage-geometry.js';

describe('audit1: cardCompact is decided alike on both sides (D-135)', () => {
  it('[A1-S1] a fractional frame width (page side) and its integer innerWidth (frame side) give the same compact verdict', () => {
    const disagree: number[] = [];
    for (let w = 400; w <= 700; w += 0.25) {
      const page = cardCompact(cardLayout(w, 2000, 1280, 720).card.w);
      // audit 2 measured Chrome: the frame's innerWidth is the box ROUNDED (not floored, as audit 1 assumed)
      const frame = cardCompact(cardLayout(Math.round(w), 2000, 1280, 720).card.w);
      if (page !== frame) disagree.push(w);
    }
    expect(disagree).toEqual([]);
  });
});
