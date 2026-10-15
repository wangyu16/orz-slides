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
 *   only separators) goes;
 * - **pictures**: a paragraph that is one image is `p.orz-pic` (round A3),
 *   one of two or more images `p.orz-pics` (round A4);
 * - **charts** that are a block of their own in a region sit in a room,
 *   `.orz-chart-room`, sized by the space their box leaves (round A4);
 * - **media** never play off their slide, and a static copy shows a video
 *   as a still of the player's size with its address (round A3).
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

/**
 * A video in a static copy (round A3, A3-ENG-5): paper cannot play a
 * `{{youtube}}` player, and every copy loaded it again — each becomes a
 * still of the same size (`.orz-video-still`, laid out like the player:
 * deck.css) that shows the video's address (its `data-url`, the kit's
 * paper line), its `data-md` breadcrumb kept. Not the kit's
 * `.youtube-embed` any more, so the kit's print rules (which hide the
 * frame and collapse its box) do not change what was fitted.
 */
export function stillVideos(root: ParentNode): void {
  for (const v of Array.from(root.querySelectorAll<HTMLElement>('.youtube-embed'))) {
    const doc = v.ownerDocument;
    const url = v.getAttribute('data-url') ?? v.querySelector('iframe')?.getAttribute('src') ?? '';
    const still = doc.createElement('div');
    still.className = 'orz-video-still';
    for (const a of ['data-md', 'data-url']) { const x = v.getAttribute(a); if (x !== null) still.setAttribute(a, x); }
    const poster = doc.createElement('div');
    poster.className = 'orz-video-poster';
    const mark = doc.createElement('span');
    mark.className = 'orz-video-mark';
    mark.setAttribute('aria-hidden', 'true');
    mark.textContent = '▶';
    const line = doc.createElement('a');
    line.className = 'orz-video-url';
    if (/^https?:\/\//i.test(url)) line.href = url;
    line.textContent = `YouTube video: ${url}`;
    poster.append(mark, line);
    still.appendChild(poster);
    v.replaceWith(still);
  }
}

/**
 * A paragraph that is a picture (round A3, A3-TH-1): it holds one image
 * (or one linked image) and nothing else but white space — `p.orz-pic`, the
 * one hook deck.css and the themes frame and size pictures by. A
 * `p:has(> img)` rule also matched a sentence with an inline icon, or a
 * caption written on the line above its picture (one paragraph): five
 * themes set its line-height to 0 and printed its lines over each other.
 */
export function markPictures(root: ParentNode): void {
  for (const p of Array.from(root.querySelectorAll<HTMLElement>('.markdown-body p'))) {
    let pics = 0;
    let other = false;
    for (const n of Array.from(p.childNodes)) {
      if (n.nodeType === 3) { if ((n.textContent ?? '').trim() !== '') other = true; continue; }
      if (n.nodeType !== 1) continue;
      const el = n as Element;
      const tag = el.tagName.toLowerCase();
      if (tag === 'img') pics++;
      else if (tag === 'a' && el.children.length === 1 && el.firstElementChild!.tagName.toLowerCase() === 'img' && (el.textContent ?? '').trim() === '') pics++;
      else if (tag !== 'br') other = true;
    }
    p.classList.toggle('orz-pic', pics === 1 && !other);
    // two or more pictures and nothing else: a row (round A4, A4-TH-4)
    p.classList.toggle('orz-pics', pics > 1 && !other);
    // a picture that did not load shows its alt text: themes take their decorations off it (round B, GUI-13)
    if (pics === 1 && !other) {
      const img = p.querySelector('img');
      if (img) {
        const broken = (): void => { p.setAttribute('data-broken', ''); };
        if (img.complete && img.naturalWidth === 0 && (img.getAttribute('src') ?? '') !== '') broken();
        else img.addEventListener('error', broken, { once: true });
      }
    }
  }
}

/**
 * A chart that is a block of its own in a region (round A4, A4-ENG-2) is
 * put in a room, `div.orz-chart-room`: deck.css lets the room grow into the
 * space its box leaves and sizes the chart (its frame, drawn later by the
 * kit inside the room) as the largest one at its aspect in it — as a picture
 * and a video are sized. Inside a container a chart keeps its em size.
 */
export function roomCharts(root: ParentNode): void {
  for (const c of Array.from(root.querySelectorAll<HTMLElement>('.orz-region > .markdown-body > canvas.orz-chart'))) {
    const room = c.ownerDocument.createElement('div');
    room.className = 'orz-chart-room';
    c.replaceWith(room);
    room.appendChild(c);
  }
}

/**
 * A chart's canvas keeps the CHART's aspect ratio in CSS (round A3, A3-ENG-3): deck.css lets it follow its
 * frame's width at once (`height: auto`, ENG-1), but with its height from the bitmap's integer size the
 * frame's fractional width rounds differently each time Chart.js resizes it — 520 ↔ 521 px forever, a
 * fifth of an idle main thread. With the ratio Chart.js draws at, the frame's size depends on its width
 * alone, and Chart.js's resize finds nothing to change. Every chart under `root` (round A4, A4-ENG-1: the
 * slides reveal displays beside the current one too); the ratio also on the frame (`--orz-chart-r`), which
 * a chart in a room is sized by.
 */
export function chartAspects(root: ParentNode): void {
  for (const c of Array.from(root.querySelectorAll<HTMLCanvasElement>('.orz-chart-frame > canvas'))) {
    const chart = (c as HTMLCanvasElement & { __orzChart?: { aspectRatio?: number | null; options?: { aspectRatio?: number } } }).__orzChart;
    const r = Number(chart?.options?.aspectRatio ?? chart?.aspectRatio);
    if (!(r > 0) || !isFinite(r)) continue;
    const want = String(Math.round(r * 1e4) / 1e4);
    if (c.style.getPropertyValue('aspect-ratio') !== want) c.style.setProperty('aspect-ratio', want);
    const f = c.parentElement!;
    if (f.style.getPropertyValue('--orz-chart-r') !== want) f.style.setProperty('--orz-chart-r', want);
  }
}

/** Every DOM addition of a fresh render; `still`: a static copy (print, the speaker view). */
export function decorate(root: ParentNode, o: { steps?: boolean; still?: boolean } = {}): void {
  roomCharts(root);
  if (o.steps !== false) applySteps(root);
  liftClosingQr(root);
  markPictures(root);
  quietMedia(root, o.still === true);
  if (o.still === true) stillVideos(root);
}
