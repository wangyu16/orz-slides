/**
 * The visual oracles shared by the theme tests (rounds A2, A3): texts that
 * overprint each other ({@link textOverlaps}) and texts that something
 * opaque covers ({@link coveredTexts}), on the current slide.
 */
type Page = import('playwright-core').Page;

/**
 * Round A2 — the per-text visual oracle (A2-TH-2, -4, -11, -12 slipped past bounds-only checks): on the current
 * slide, no visible text overlaps another text — two lines of one paragraph included (round A3) — and no
 * absolutely placed ::before/::after with text (a section number, a label) overlaps a text — each rectangle cut to
 * the elements that clip it (an ellipsized footer's range runs on under its clip).
 */
export function textOverlaps(page: Page): Promise<string[]> {
  return page.evaluate(`(() => {
    const s = document.querySelector('.reveal .slides > section.present');
    const k = s.getBoundingClientRect().width / s.offsetWidth;
    const clipOf = (el) => {
      let r = { l: -1e9, t: -1e9, r: 1e9, b: 1e9 };
      for (let p = el; p && p !== s.parentElement; p = p.parentElement) {
        const c = getComputedStyle(p);
        const x = c.overflowX !== 'visible', y = c.overflowY !== 'visible';
        if (!x && !y) continue;
        const q = p.getBoundingClientRect();
        if (x) { r.l = Math.max(r.l, q.left); r.r = Math.min(r.r, q.right); }
        if (y) { r.t = Math.max(r.t, q.top); r.b = Math.min(r.b, q.bottom); }
      }
      return r;
    };
    const cut = (x, c) => ({ l: Math.max(x.left, c.l), t: Math.max(x.top, c.t), r: Math.min(x.right, c.r), b: Math.min(x.bottom, c.b) });
    const shown = (el) => { const c = getComputedStyle(el); return c.visibility !== 'hidden' && Number(c.opacity) > 0.05 && c.display !== 'none'; };
    // under a rotation a text's rectangle is its bounding box, larger than its ink
    const rotated = (el) => { for (let p = el; p && p !== s; p = p.parentElement) { const m = /matrix\(([^)]*)\)/.exec(getComputedStyle(p).transform); if (m) { const v = m[1].split(',').map(Number); if (Math.abs(v[1]) > 0.01 || Math.abs(v[2]) > 0.01) return true; } } return false; };
    const items = [];
    const w = document.createTreeWalker(s, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const t = (n.textContent || '').trim();
      const el = n.parentElement;
      if (!t || el.closest('aside.notes, .katex, svg, canvas, .orz-qr-slot') || !shown(el)) continue;
      let hidden = false;
      for (let p = el; p && p !== s; p = p.parentElement) if (!shown(p)) { hidden = true; break; }
      if (hidden) continue;
      const c = clipOf(el);
      const r = document.createRange();
      r.selectNodeContents(n);
      for (const x of Array.from(r.getClientRects())) { const q = cut(x, c); if (q.r - q.l > 1 && q.b - q.t > 1) items.push({ el, node: n, one: /nowrap/.test(getComputedStyle(el).whiteSpace + ' ' + getComputedStyle(el).textWrapMode), pseudo: '', text: t.slice(0, 40), q, rot: rotated(el) }); }
    }
    for (const el of Array.from(s.querySelectorAll('*'))) {
      if (el.closest('aside.notes, svg')) continue;
      for (const ps of ['::before', '::after']) {
        const c = getComputedStyle(el, ps);
        if (c.position !== 'absolute' || !/^["']/.test(c.content) || !/\\S/.test(c.content.slice(1, -1)) || c.visibility === 'hidden' || c.display === 'none') continue;
        // placed against its own (positioned) element, where left and top are definite; one placed against an
        // ancestor may be at its static position ('auto' resolves to it), which cannot be read back here
        if (getComputedStyle(el).position === 'static') continue;
        const b = el.getBoundingClientRect();
        const ec = getComputedStyle(el);
        const left = parseFloat(c.left), top = parseFloat(c.top), wd = parseFloat(c.width), ht = parseFloat(c.height);
        if (!isFinite(left) || !isFinite(top) || !(wd > 0) || !(ht > 0)) continue;
        // its own transform: a translation moves it (a rotation makes its box a bounding box)
        const tm = /matrix\(([^)]*)\)/.exec(c.transform);
        const tv = tm ? tm[1].split(',').map(Number) : [1, 0, 0, 1, 0, 0];
        const x0 = b.left + (parseFloat(ec.borderLeftWidth) || 0) * k + (left + tv[4]) * k, y0 = b.top + (parseFloat(ec.borderTopWidth) || 0) * k + (top + tv[5]) * k;
        const q = cut({ left: x0, top: y0, right: x0 + wd * k, bottom: y0 + ht * k }, clipOf(el));
        if (q.r - q.l > 1 && q.b - q.t > 1) items.push({ el, pseudo: ps, text: el.className + ps + ' ' + c.content.slice(0, 20), q, rot: rotated(el) || Math.abs(tv[1]) > 0.01 });
      }
    }
    const out = [];
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      const a = items[i], b = items[j];
      // two line boxes of ONE element are compared too (round A3, A3-TH-1: a paragraph set at line-height 0 printed its
      // lines over each other, and the oracle skipped them); an element and one inside it on the same line are not
      if (!a.pseudo && !b.pseudo && a.el !== b.el && (a.el.contains(b.el) || b.el.contains(a.el))) continue;
      // a text that cannot wrap is one line: Chrome gives an ellipsized line's range two rectangles
      if (a.node && a.node === b.node && a.one) continue;
      // two lines of one element overprint when one stands on the other (line-height 0), not when a tall font's boxes
      // reach past a tight line pitch (Notebook's handwriting: 92 px boxes on a 66 px pitch)
      if (!a.pseudo && !b.pseudo && a.el === b.el && Math.abs(a.q.t - b.q.t) >= 0.5 * Math.min(a.q.b - a.q.t, b.q.b - b.q.t)) continue;
      const ow = Math.min(a.q.r, b.q.r) - Math.max(a.q.l, b.q.l), oh = Math.min(a.q.b, b.q.b) - Math.max(a.q.t, b.q.t);
      // a text's rectangle is its font's whole ascent and descent: tightly set big type touches the next line's; an
      // overprint covers a good part of a line
      if (ow > 3 * k && oh > Math.max(4 * k, (a.rot || b.rot ? 0.5 : 0.3) * Math.min(a.q.b - a.q.t, b.q.b - b.q.t))) { out.push('"' + a.text + '" x "' + b.text + '" (' + Math.round(ow / k) + 'x' + Math.round(oh / k) + ')'); if (out.length > 5) return out; }
    }
    return out;
  })()`) as Promise<string[]>;
}

/**
 * Round A3 (A3-TH-5; the A2-TH-12 class): no box covers a text. For every
 * visible line of text on the current slide, three points along it are
 * looked at from the top (`elementsFromPoint`, every element hit-testable for
 * the look): an opaque box — a background colour or image, a picture, a
 * canvas, a frame — that is neither the text's element nor one of its
 * ancestors or descendants and lies above it covers it. Two points of three
 * covered is a finding (Architect's PREPARED BY block over a long subtitle).
 */
export function coveredTexts(page: Page): Promise<string[]> {
  return page.evaluate(`(() => {
    const s = document.querySelector('.reveal .slides > section.present');
    const k = s.getBoundingClientRect().width / s.offsetWidth;
    const look = document.createElement('style');
    look.textContent = '.reveal .slides section.present, .reveal .slides section.present * { pointer-events: auto !important; }';
    document.head.appendChild(look);
    const clipOf = (el) => {
      let r = { l: -1e9, t: -1e9, r: 1e9, b: 1e9 };
      for (let p = el; p && p !== s.parentElement; p = p.parentElement) {
        const c = getComputedStyle(p);
        const x = c.overflowX !== 'visible', y = c.overflowY !== 'visible';
        if (!x && !y) continue;
        const q = p.getBoundingClientRect();
        if (x) { r.l = Math.max(r.l, q.left); r.r = Math.min(r.r, q.right); }
        if (y) { r.t = Math.max(r.t, q.top); r.b = Math.min(r.b, q.bottom); }
      }
      return r;
    };
    const shown = (el) => { const c = getComputedStyle(el); return c.visibility !== 'hidden' && Number(c.opacity) > 0.05 && c.display !== 'none'; };
    const alpha = (c) => { const m = /rgba?\\(([^)]*)\\)/.exec(c); if (!m) return 0; const v = m[1].split(',').map(Number); return v.length > 3 ? v[3] : 1; };
    const opaque = (h) => {
      const c = getComputedStyle(h);
      if (c.visibility === 'hidden' || Number(c.opacity) < 0.5) return false;
      return alpha(c.backgroundColor) > 0.5 || c.backgroundImage !== 'none' || /^(IMG|CANVAS|VIDEO|IFRAME|svg)$/.test(h.tagName);
    };
    const out = [];
    try {
      const w = document.createTreeWalker(s, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        const t = (n.textContent || '').trim();
        const el = n.parentElement;
        if (!t || el.closest('aside.notes, .katex, svg, canvas, .orz-qr-slot, details:not([open]) > :not(summary)')) continue;
        let hidden = false;
        for (let p = el; p && p !== s; p = p.parentElement) if (!shown(p)) { hidden = true; break; }
        if (hidden) continue;
        const c = clipOf(el);
        const r = document.createRange();
        r.selectNodeContents(n);
        for (const x of Array.from(r.getClientRects())) {
          const l = Math.max(x.left, c.l), rr = Math.min(x.right, c.r), tp = Math.max(x.top, c.t), bt = Math.min(x.bottom, c.b);
          if (rr - l < 4 * k || bt - tp < 4 * k) continue;
          let hit = 0, by = '';
          for (const fx of [0.15, 0.5, 0.85]) {
            const px = l + fx * (rr - l), py = (tp + bt) / 2;
            if (px < 0 || py < 0 || px >= innerWidth || py >= innerHeight) continue;
            for (const h of document.elementsFromPoint(px, py)) {
              if (h === el || el.contains(h) || h.contains(el)) break;
              if (opaque(h)) { hit++; by = h.tagName.toLowerCase() + (h.className && typeof h.className === 'string' ? '.' + h.className.split(' ')[0] : ''); break; }
            }
          }
          if (hit >= 2) { out.push('"' + t.slice(0, 40) + '" under ' + by); break; }
        }
      }
    } finally { look.remove(); }
    return out;
  })()`) as Promise<string[]>;
}

/** The share of the viewport (1280 × 720) in the bg= red of the test decks (#d81b1b), from a screenshot. */
export async function redShare(page: Page): Promise<number> {
  const shot = await page.screenshot({ clip: { x: 0, y: 0, width: 1280, height: 720 } });
  return page.evaluate(async (data) => {
    const img = new Image(); img.src = `data:image/png;base64,${data}`; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d')!; g.drawImage(img, 0, 0);
    const px = g.getImageData(0, 0, c.width, c.height).data;
    let n = 0; for (let i = 0; i < px.length; i += 4) if (Math.abs(px[i] - 216) + Math.abs(px[i + 1] - 27) + Math.abs(px[i + 2] - 27) < 60) n++;
    return n / (px.length / 4);
  }, shot.toString('base64'));
}

