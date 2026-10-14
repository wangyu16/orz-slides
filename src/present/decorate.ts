/**
 * What the engine adds to rendered slides in the DOM (after
 * src/render-slide.ts, before reveal.js reads them):
 *
 * - **step** (the `step` slide flag): every block of a region — each item of
 *   a top-level list, every other top-level block — becomes a reveal
 *   fragment, in document order across regions (0.x's rule);
 * - **the closing's QR slot**: a closing template whose body holds exactly
 *   one QR code (`{{qr …}}`) gets it lifted into its own slot,
 *   `.orz-qr-slot`, the template's last child, for the theme to place (its
 *   `data-md` breadcrumb travels with it); a paragraph left empty (or with
 *   only separators) goes.
 */

/** The step units of a region body: list items of top-level lists, other top-level blocks. */
export function stepUnits(body: Element): Element[] {
  const units: Element[] = [];
  for (const child of Array.from(body.children)) {
    const tag = child.tagName.toLowerCase();
    if (tag === 'ul' || tag === 'ol') for (const li of Array.from(child.children)) { if (li.tagName.toLowerCase() === 'li') units.push(li); }
    else units.push(child);
  }
  return units;
}

/** Mark the step slides' units as fragments. */
export function applySteps(root: ParentNode): void {
  for (const body of Array.from(root.querySelectorAll('section[data-step] .orz-region > .markdown-body'))) {
    for (const el of stepUnits(body)) el.classList.add('fragment');
  }
}

/** Lift a closing template's lone QR code into its slot. */
export function liftClosingQr(root: ParentNode): void {
  for (const tpl of Array.from(root.querySelectorAll('.orz-template-closing'))) {
    if (tpl.querySelector(':scope > .orz-qr-slot')) continue;
    const qrs = tpl.querySelectorAll('.qrcode');
    if (qrs.length !== 1) continue;
    const qr = qrs[0];
    const parent = qr.parentElement;
    const slot = tpl.ownerDocument.createElement('div');
    slot.className = 'orz-qr-slot';
    slot.appendChild(qr);
    tpl.appendChild(slot);
    // a paragraph the code leaves empty, or ending in a separator, is tidied
    if (parent && parent !== tpl) {
      const last = parent.lastChild;
      if (last && last.nodeType === 3) last.textContent = (last.textContent ?? '').replace(/[\s·•|–—-]+$/u, '');
      if ((parent.textContent ?? '').trim() === '' && parent.children.length === 0) parent.remove();
    }
  }
}

/**
 * Media never play off their slide (round A2, A2-ENG-7): an `autoplay` audio
 * or video becomes reveal's `data-autoplay` (started when its slide shows,
 * stopped when it leaves); in a static copy (`still`: print, the speaker's
 * copies) media do not play or preload at all.
 */
export function quietMedia(root: ParentNode, still = false): void {
  for (const m of Array.from(root.querySelectorAll<HTMLMediaElement>('audio, video'))) {
    if (m.hasAttribute('autoplay')) { m.removeAttribute('autoplay'); if (!still) m.setAttribute('data-autoplay', ''); }
    if (still) { m.removeAttribute('data-autoplay'); m.setAttribute('preload', 'none'); m.muted = true; m.setAttribute('muted', ''); }
  }
}

/** Every DOM addition of a fresh render; `still`: a static copy (print, the speaker view). */
export function decorate(root: ParentNode, o: { steps?: boolean; still?: boolean } = {}): void {
  if (o.steps !== false) applySteps(root);
  liftClosingQr(root);
  quietMedia(root, o.still === true);
}
