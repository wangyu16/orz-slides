/*
 * orz-slides in-file runtime — present + edit.
 *
 * Present mode is reveal.js (driven by the bundled engine, window.orzslides).
 * Edit mode docks a CodeMirror panel under the deck: it shows the CURRENT
 * slide's source, and the live preview is the real reveal slide, re-rendered as
 * you type. The embedded #orz-deck source is the single source of truth; Save
 * re-serialises the whole document with the updated source (self-reproducing).
 *
 * Ported from orz-mdhtml's app.js (save / IndexedDB handle / version check /
 * served-page notice), adapted to the per-slide deck model.
 */
(function () {
  var CFG = window.__ORZ_SLIDES__ || {};
  var root = document.documentElement;
  var API = window.orzslides;

  var dirty = false;
  var fileHandle = null;
  var editing = false;
  var editingDeck = false; // editing the <!-- deck --> preamble vs a slide
  var cm = null;
  var curIndex = 0;
  var suppressChange = false;
  var rerenderTimer = null;
  var rerenderAllTimer = null;
  var currentTheme = CFG.defaultTheme;

  // Deck source split into preamble (the <!-- deck --> block) + per-slide chunks.
  var preamble = '';
  var slides = [];

  // ---- source helpers ------------------------------------------------------
  function escapeSource(s) { return String(s).replace(/<\/(script)/gi, '<\\/$1'); }
  function unescapeSource(s) { return String(s).replace(/<\\\/(script)/gi, '</$1'); }

  function embeddedSource() {
    var el = document.getElementById('orz-deck');
    var raw = el ? el.textContent || '' : '';
    return unescapeSource(raw).replace(/^\n/, '').replace(/\n\s*$/, '');
  }

  // Split on the slide markers, keeping each marker with its slide.
  function splitDeck(src) {
    var i = src.search(/<!--\s*slide\b/);
    var pre = i >= 0 ? src.slice(0, i) : src;
    var rest = i >= 0 ? src.slice(i) : '';
    var parts = rest ? rest.split(/(?=<!--\s*slide\b)/) : [];
    return { preamble: pre, slides: parts };
  }
  function fullSource() { return preamble + slides.join(''); }

  function loadParts() {
    var p = splitDeck(embeddedSource());
    preamble = p.preamble;
    slides = p.slides.length ? p.slides : ['<!-- slide -->\n## New slide\n'];
  }
  function writeDeck() {
    var el = document.getElementById('orz-deck');
    if (el) el.textContent = '\n' + escapeSource(fullSource()) + '\n';
  }

  function themeById(id) {
    var list = CFG.themes || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return list[0] || { id: id, scheme: 'light', href: '' };
  }

  // ---- live rendering ------------------------------------------------------
  function sections() { return document.querySelectorAll('.reveal .slides > section.orz-slide'); }

  function renderCurrentSlide() {
    var src = fullSource();
    var deck = API.parseDeck(src);
    var secs = sections();
    // structural change (a slide added/removed in-place) → full re-render
    if (deck.slides.length !== secs.length) { API.renderAll(src); return; }
    var section = secs[curIndex];
    var slide = deck.slides[curIndex];
    if (!section || !slide) return;
    var tmp = document.createElement('div');
    tmp.innerHTML = API.renderSlide(slide, API.md, deck.config);
    var fresh = tmp.firstElementChild;
    if (!fresh) return;
    // Update the existing <section> in place — replacing the element would
    // orphan reveal.js's reference to the current slide (it would lose its
    // `present` class). Copy the rendered content + render-time attributes; let
    // reveal keep managing the state classes (present/past/future).
    section.innerHTML = fresh.innerHTML;
    ['data-fit', 'data-kind', 'data-template', 'data-background-color', 'data-transition', 'data-step'].forEach(function (a) {
      if (fresh.hasAttribute(a)) section.setAttribute(a, fresh.getAttribute(a));
      else section.removeAttribute(a);
    });
    try { API.reveal.sync(); } catch (e) {}
    API.refresh();
  }
  function scheduleRerender() {
    if (rerenderTimer) clearTimeout(rerenderTimer);
    rerenderTimer = setTimeout(renderCurrentSlide, 160);
  }
  // Deck-config edits affect every slide (footer, etc.) → re-render the whole deck.
  function scheduleRerenderAll() {
    if (rerenderAllTimer) clearTimeout(rerenderAllTimer);
    rerenderAllTimer = setTimeout(function () { API.renderAll(fullSource()); }, 240);
  }

  function curH() { return (API.reveal && API.reveal.getIndices) ? API.reveal.getIndices().h : 0; }
  function gotoSlide(i) { if (API.reveal) API.reveal.slide(Math.max(0, Math.min(slides.length - 1, i)), 0); }

  // ---- editor --------------------------------------------------------------
  function loadScript(src) {
    return new Promise(function (res, rej) {
      if (!src || document.querySelector('script[data-lib="' + src + '"]')) return res();
      var s = document.createElement('script');
      s.src = src; s.async = true; s.setAttribute('data-lib', src);
      s.onload = function () { res(); }; s.onerror = function () { rej(); };
      document.head.appendChild(s);
    });
  }
  function loadCss(href) {
    if (!href || document.querySelector('link[data-lib="' + href + '"]')) return;
    var l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = href; l.setAttribute('data-lib', href);
    document.head.appendChild(l);
  }
  function ensureEditorLibs() {
    var L = CFG.editorLibs || {};
    loadCss(L.codemirrorCss);
    // Load BOTH editor themes so cmTheme() can switch freely (dark editor on
    // dark slide themes, light on light) without a reload.
    loadCss(L.codemirrorLightThemeCss);
    loadCss(L.codemirrorDarkThemeCss);
    return loadScript(L.codemirrorJs)
      .then(function () { return loadScript(L.codemirrorMarkdownJs); })
      .then(function () { return loadScript(L.codemirrorContinuelistJs); });
  }
  function cmTheme() { return themeById(currentTheme).scheme === 'dark' ? 'material-darker' : 'eclipse'; }

  function initEditor() {
    return ensureEditorLibs().then(function () {
      if (cm || !window.CodeMirror) return;
      var ta = document.getElementById('orz-ta');
      cm = window.CodeMirror.fromTextArea(ta, {
        mode: 'markdown', theme: cmTheme(), lineNumbers: true, lineWrapping: true,
        viewportMargin: Infinity,
        extraKeys: { Enter: 'newlineAndIndentContinueMarkdownList' },
      });
      cm.on('change', function () {
        if (suppressChange) return;
        markDirty();
        if (editingDeck) {
          preamble = cm.getValue();
          writeDeck();
          scheduleRerenderAll();
        } else {
          slides[curIndex] = cm.getValue();
          writeDeck();
          scheduleRerender();
        }
      });
    });
  }

  function loadSlideIntoEditor(i) {
    editingDeck = false;
    curIndex = i;
    if (!cm) return;
    suppressChange = true;
    cm.setValue(slides[i] != null ? slides[i] : '');
    suppressChange = false;
    updatePos();
    setTimeout(function () { cm.refresh(); }, 0);
  }
  function updatePos() {
    var el = document.getElementById('orz-pos');
    if (!el) return;
    el.textContent = editingDeck ? 'Deck config' : ((curIndex + 1) + ' / ' + slides.length);
    var deckBtn = document.getElementById('orz-deck-btn');
    if (deckBtn) deckBtn.classList.toggle('active', editingDeck);
  }

  function enterEdit() {
    editing = true;
    editingDeck = false;
    root.setAttribute('data-mode', 'edit');
    checkVersion(); // edit view only — broad viewers never see the update banner
    initEditor().then(function () {
      curIndex = curH();
      loadSlideIntoEditor(curIndex);
      if (API.reveal) API.reveal.layout();
    });
  }
  // Load the <!-- deck --> preamble into the editor (theme/footer/ratio/title).
  function editDeck() {
    editing = true;
    root.setAttribute('data-mode', 'edit');
    initEditor().then(function () {
      editingDeck = true;
      suppressChange = true;
      if (cm) cm.setValue(preamble);
      suppressChange = false;
      updatePos();
      if (API.reveal) API.reveal.layout();
      if (cm) setTimeout(function () { cm.refresh(); cm.focus(); }, 0);
    });
  }
  function done() {
    editing = false;
    root.setAttribute('data-mode', 'present');
    if (API.reveal) { API.reveal.layout(); API.refresh(); }
  }

  // Drag the panel's top edge to set the editor/deck height split (--orz-vsplit);
  // the deck refits live (rAF-throttled) and on release.
  function wireVDivider() {
    var d = document.getElementById('orz-vdivider'); if (!d || d.__wired) return; d.__wired = true;
    var dragging = false, rafPending = false;
    d.addEventListener('mousedown', function (e) {
      dragging = true; d.classList.add('dragging'); e.preventDefault();
      document.body.style.userSelect = 'none';
    });
    document.addEventListener('mousemove', function (e) {
      if (!dragging) return;
      var pct = Math.max(20, Math.min(80, ((window.innerHeight - e.clientY) / window.innerHeight) * 100));
      root.style.setProperty('--orz-vsplit', pct + '%');
      if (!rafPending) { rafPending = true; requestAnimationFrame(function () { rafPending = false; if (API.reveal) API.reveal.layout(); }); }
    });
    document.addEventListener('mouseup', function () {
      if (!dragging) return;
      dragging = false; d.classList.remove('dragging'); document.body.style.userSelect = '';
      if (cm) cm.refresh(); if (API.reveal) API.reveal.layout();
    });
  }

  // ---- deck ops ------------------------------------------------------------
  function rebuildFrom(newSlides, focus) {
    slides = newSlides;
    writeDeck();
    API.renderAll(fullSource());
    markDirty();
    setTimeout(function () {
      gotoSlide(focus);
      curIndex = focus;
      if (editing) loadSlideIntoEditor(focus);
      updatePos();
    }, 30);
  }
  function addSlide() {
    var s = slides.slice();
    s.splice(curIndex + 1, 0, '<!-- slide -->\n## New slide\n\n');
    rebuildFrom(s, curIndex + 1);
  }
  function dupSlide() {
    var s = slides.slice();
    s.splice(curIndex + 1, 0, slides[curIndex]);
    rebuildFrom(s, curIndex + 1);
  }
  function delSlide() {
    if (slides.length <= 1) { toast('Cannot delete the only slide'); return; }
    var s = slides.slice();
    s.splice(curIndex, 1);
    rebuildFrom(s, Math.max(0, curIndex - 1));
  }
  function moveSlide(dir) {
    var j = curIndex + dir;
    if (j < 0 || j >= slides.length) return;
    var s = slides.slice();
    var tmp = s[curIndex]; s[curIndex] = s[j]; s[j] = tmp;
    rebuildFrom(s, j);
  }

  // ---- theme ---------------------------------------------------------------
  // Inline mode embeds every theme as a <style data-theme-css>; activate one by
  // matching media. Returns false if no inline themes (CDN mode).
  function applyInlineTheme(id) {
    var blocks = document.querySelectorAll('style[data-theme-css]');
    if (!blocks.length) return false;
    for (var i = 0; i < blocks.length; i++) {
      blocks[i].media = blocks[i].getAttribute('data-theme-css') === id ? 'all' : 'not all';
    }
    return true;
  }
  function setTheme(id) {
    currentTheme = id;
    root.setAttribute('data-theme', id);
    if (!applyInlineTheme(id)) {
      // CDN mode: swap the theme link (loads from jsDelivr).
      var link = document.getElementById('orz-theme-override');
      if (!link) {
        link = document.createElement('link');
        link.id = 'orz-theme-override'; link.rel = 'stylesheet';
        document.head.appendChild(link);
      }
      link.href = themeById(id).href;
    }
    if (cm) cm.setOption('theme', cmTheme());
    markDirty();
    if (API.reveal) setTimeout(function () { API.reveal.layout(); API.refresh(); }, 60);
  }

  // ---- dirty / save (self-reproducing) -------------------------------------
  function markDirty() { if (!dirty) { dirty = true; root.setAttribute('data-dirty', '1'); } }
  function clearDirty() { dirty = false; root.setAttribute('data-dirty', '0'); }

  function serializeDoc() {
    var clone = root.cloneNode(true);
    var deckEl = clone.querySelector('#orz-deck');
    if (deckEl) deckEl.textContent = '\n' + escapeSource(fullSource()) + '\n';
    clone.setAttribute('data-mode', 'present');
    clone.setAttribute('data-theme', currentTheme);
    clone.removeAttribute('data-dirty');
    // never bake in the (edit-only) update banner so a viewer can't see it
    var ub = clone.querySelector('#orz-update'); if (ub) { ub.classList.remove('show'); ub.removeAttribute('data-latest'); }
    // Reset reveal's rendered DOM so the reopened file re-renders from #orz-deck.
    var reveal = clone.querySelector('.reveal');
    if (reveal) { reveal.className = 'reveal'; reveal.innerHTML = '<div class="slides"></div>'; }
    // Reset the live editor back to a clean textarea.
    var ed = clone.querySelector('#orz-editor-host');
    if (ed) ed.innerHTML = '<textarea id="orz-ta" spellcheck="false"></textarea>';
    return '<!DOCTYPE html>\n' + clone.outerHTML + '\n';
  }

  function idbOpen() {
    return new Promise(function (res, rej) {
      var r = indexedDB.open('orz-slides', 1);
      r.onupgradeneeded = function () { r.result.createObjectStore('handles'); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
  }
  function idbGet(key) {
    return idbOpen().then(function (db) {
      return new Promise(function (res, rej) {
        var t = db.transaction('handles', 'readonly');
        var g = t.objectStore('handles').get(key);
        g.onsuccess = function () { res(g.result || null); };
        g.onerror = function () { rej(g.error); };
      });
    }).catch(function () { return null; });
  }
  function idbPut(key, val) {
    return idbOpen().then(function (db) {
      return new Promise(function (res, rej) {
        var t = db.transaction('handles', 'readwrite');
        var p = t.objectStore('handles').put(val, key);
        p.onsuccess = function () { res(); };
        p.onerror = function () { rej(p.error); };
      });
    }).catch(function () {});
  }
  function pickAndStore() {
    return window.showSaveFilePicker({
      suggestedName: (CFG.filename || 'deck') + '.slides.html',
      types: [{ description: 'Slides HTML', accept: { 'text/html': ['.slides.html', '.html'] } }],
    }).then(function (h) { fileHandle = h; if (CFG.docId) idbPut(CFG.docId, h); return h; });
  }
  function acquireHandle() {
    if (fileHandle) return Promise.resolve(fileHandle);
    if (!CFG.docId) return pickAndStore();
    return idbGet(CFG.docId).then(function (saved) {
      if (!saved || !saved.queryPermission) return pickAndStore();
      return saved.queryPermission({ mode: 'readwrite' }).then(function (p) {
        if (p === 'granted') return saved;
        return saved.requestPermission({ mode: 'readwrite' }).then(function (p2) {
          return p2 === 'granted' ? saved : null;
        });
      }).then(function (h) { if (h) { fileHandle = h; return h; } return pickAndStore(); });
    }).catch(function () { return pickAndStore(); });
  }
  function isServed() { return location.protocol === 'http:' || location.protocol === 'https:'; }

  function save() {
    if (cm) { slides[curIndex] = cm.getValue(); writeDeck(); }
    var html = serializeDoc();
    if (isServed() && !fileHandle) { if (dirty) showServedNote(); return; }
    if (window.showSaveFilePicker) {
      acquireHandle()
        .then(function (h) { return h.createWritable(); })
        .then(function (w) { return Promise.resolve(w.write(html)).then(function () { return w.close(); }); })
        .then(function () { clearDirty(); toast('Saved'); })
        .catch(function (err) { if (err && err.name === 'AbortError') return; downloadFile(html); clearDirty(); toast('Saved a local copy'); });
    } else {
      downloadFile(html); clearDirty(); toast('Saved a local copy');
    }
  }
  function downloadFile(text) {
    var blob = new Blob([text], { type: 'text/html' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = (CFG.filename || 'deck') + '.slides.html';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }
  function exportCopy() {
    if (cm) { slides[curIndex] = cm.getValue(); writeDeck(); }
    downloadFile(serializeDoc()); toast('Downloaded a local copy');
  }
  function showServedNote() { var n = document.getElementById('orz-served-note'); if (n) n.classList.add('show'); }

  // ---- version check -------------------------------------------------------
  function isNewer(a, b) {
    var pa = String(a).split('.'), pb = String(b).split('.');
    for (var i = 0; i < 3; i++) {
      var x = parseInt(pa[i], 10) || 0, y = parseInt(pb[i], 10) || 0;
      if (x > y) return true; if (x < y) return false;
    }
    return false;
  }
  // SECURITY: the update source is HARDCODED here, never read from the file's
  // config — a tampered/forged file cannot redirect "Update" to attacker code.
  // Host is fixed to jsDelivr/HTTPS; the exact URLs are confirmed with the user.
  // (Protects genuine files; a wholly-malicious file controls this code too — see
  // the README security note. Clicking Update trusts npm + jsDelivr.)
  var UPD = {
    host: 'https://cdn.jsdelivr.net/npm/',
    manifest: 'https://data.jsdelivr.com/v1/packages/npm/orz-slides-browser/resolved',
    enginePkg: 'orz-slides-browser', engineFile: 'orz-slides.browser.js', appPkg: 'orz-slides'
  };
  function checkVersion() {
    if (!CFG.rendererVersion) return;
    try {
      var cached = JSON.parse(localStorage.getItem('orz-slides:vercheck') || 'null');
      if (cached && (Date.now() - cached.t) < 86400000) {
        if (cached.v && isNewer(cached.v, CFG.rendererVersion)) showUpdate(cached.v);
        return;
      }
    } catch (e) {}
    fetch(UPD.manifest).then(function (r) { return r.json(); }).then(function (j) {
      var latest = j && j.version;
      try { localStorage.setItem('orz-slides:vercheck', JSON.stringify({ t: Date.now(), v: latest })); } catch (e) {}
      if (latest && isNewer(latest, CFG.rendererVersion)) showUpdate(latest);
    }).catch(function () {});
  }
  function showUpdate(latest) {
    var bar = document.getElementById('orz-update'); if (!bar) return;
    bar.querySelector('.upd-text').textContent = 'Framework ' + latest + ' available (file uses ' + CFG.rendererVersion + ').';
    bar.setAttribute('data-latest', latest);
    bar.classList.add('show');
  }
  /** One-click update: re-fetch the engine bundle + app.js at the latest version,
   *  re-inline them, bump the version, save in place, and reload. */
  function applyUpdate() {
    var bar = document.getElementById('orz-update'); var latest = bar && bar.getAttribute('data-latest'); if (!latest) return;
    var engineUrl = UPD.host + UPD.enginePkg + '@' + latest + '/' + UPD.engineFile;
    var appUrl = UPD.host + UPD.appPkg + '@' + latest + '/assets/app.js';
    if (!window.confirm('Update the framework to ' + latest + '?\n\nThis downloads and runs code from:\n  ' + engineUrl + '\n  ' + appUrl + '\n\nOnly proceed if you trust this document and its publisher.')) return;
    toast('Downloading framework ' + latest + '…');
    Promise.all([
      fetch(engineUrl).then(function (r) { if (!r.ok) throw new Error('engine'); return r.text(); }),
      fetch(appUrl).then(function (r) { if (!r.ok) throw new Error('app'); return r.text(); }),
    ]).then(function (res) {
      var es = document.querySelector('script[data-orz-asset="engine"]');
      if (es) { if (es.getAttribute('src')) es.setAttribute('src', engineUrl); else es.textContent = res[0]; }
      var as = document.querySelector('script[data-orz-asset="app"]');
      if (as) as.textContent = res[1];
      var cs = document.querySelector('script[data-orz-asset="config"]');
      if (cs) { CFG.version = latest; CFG.rendererVersion = latest; cs.textContent = 'window.__ORZ_SLIDES__ = ' + JSON.stringify(CFG) + ';'; }
      bar.classList.remove('show');
      var html = serializeDoc();
      if (isServed() && !fileHandle) { showServedNote(); return; }
      if (window.showSaveFilePicker) {
        return acquireHandle()
          .then(function (h) { return h.createWritable(); })
          .then(function (w) { return Promise.resolve(w.write(html)).then(function () { return w.close(); }); })
          .then(function () { toast('Updated to ' + latest + ' — reloading…'); setTimeout(function () { location.reload(); }, 700); });
      }
      downloadFile(html); toast('Updated copy downloaded — reopen it to use the new framework.');
    }).catch(function () { toast('Update failed — check your connection.'); });
  }

  // ---- toast ---------------------------------------------------------------
  var toastTimer = null;
  function toast(msg) {
    var t = document.getElementById('orz-toast'); if (!t) return;
    t.textContent = msg; t.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 1800);
  }

  // Position the edit control just above reveal's left/right arrows, centered on
  // the cluster — it reads as part of the controls. Kept in sync on nav/resize.
  // (reveal's .controls box is a 0-size anchor, so we measure the arrows.)
  function positionEditCtrl() {
    var btn = document.getElementById('orz-edit-fab');
    if (!btn) return;
    var left = document.querySelector('.reveal .controls .navigate-left');
    var right = document.querySelector('.reveal .controls .navigate-right');
    if (!left || !right) return;
    var lr = left.getBoundingClientRect(), rr = right.getBoundingClientRect();
    if (!lr.width && !rr.width) return; // controls hidden → keep the corner default
    // Bottom-left corner, vertically centered on the arrow row.
    var rowCenterY = (lr.top + lr.height / 2 + rr.top + rr.height / 2) / 2;
    btn.style.left = '24px';
    btn.style.top = (rowCenterY - btn.offsetHeight / 2) + 'px';
    btn.style.right = 'auto';
    btn.style.bottom = 'auto';
  }

  // ---- wiring --------------------------------------------------------------
  function on(id, ev, fn) { var el = document.getElementById(id); if (el) el.addEventListener(ev, fn); }
  function navTo(i) { editingDeck = false; gotoSlide(i); }
  function wireUi() {
    on('orz-edit-fab', 'click', enterEdit);
    on('orz-close', 'click', done);
    wireVDivider();
    on('orz-deck-btn', 'click', function () { if (editingDeck) loadSlideIntoEditor(curH()); else editDeck(); });
    on('orz-save', 'click', save);
    on('orz-download', 'click', exportCopy);
    on('orz-add', 'click', addSlide);
    on('orz-dup', 'click', dupSlide);
    on('orz-del', 'click', delSlide);
    on('orz-up', 'click', function () { moveSlide(-1); });
    on('orz-down', 'click', function () { moveSlide(1); });
    on('orz-prev', 'click', function () { navTo(curIndex - 1); });
    on('orz-next', 'click', function () { navTo(curIndex + 1); });
    on('orz-served-download', 'click', function () { exportCopy(); var n = document.getElementById('orz-served-note'); if (n) n.classList.remove('show'); });
    on('orz-served-dismiss', 'click', function () { var n = document.getElementById('orz-served-note'); if (n) n.classList.remove('show'); });
    on('orz-upd-dismiss', 'click', function () { var u = document.getElementById('orz-update'); if (u) u.classList.remove('show'); });
    on('orz-upd-apply', 'click', applyUpdate);
    var sel = document.getElementById('orz-theme');
    if (sel) sel.addEventListener('change', function () { setTheme(this.value); });

    document.addEventListener('keydown', function (e) {
      if ((e.metaKey || e.ctrlKey) && String(e.key).toLowerCase() === 's') { e.preventDefault(); save(); }
      else if (e.key === 'Escape' && editing) { done(); }
    });
    window.addEventListener('beforeunload', function (e) { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
  }

  // ---- boot ----------------------------------------------------------------
  function boot() {
    if (!API) return; // engine bundle missing
    currentTheme = root.getAttribute('data-theme') || CFG.defaultTheme;
    var sel = document.getElementById('orz-theme');
    if (sel) {
      var opts = (CFG.themes || []).map(function (t) { return '<option value="' + t.id + '">' + t.name + '</option>'; }).join('');
      sel.innerHTML = opts; sel.value = currentTheme;
    }
    // The deck's <!-- deck theme: --> may differ from the file's data-theme; if a
    // saved override link exists it already wins. Keep currentTheme in sync.
    if (root.getAttribute('data-theme') && root.getAttribute('data-theme') !== currentTheme) currentTheme = root.getAttribute('data-theme');
    applyInlineTheme(currentTheme); // assert the active inline theme on load

    function start() {
      loadParts();
      writeDeck();
      updatePos();
      positionEditCtrl();
      if (API.reveal && API.reveal.on) {
        API.reveal.on('slidechanged', function () {
          curIndex = curH();
          if (editing && !editingDeck) loadSlideIntoEditor(curIndex);
          updatePos();
          positionEditCtrl();
        });
      }
      window.addEventListener('resize', function () { setTimeout(positionEditCtrl, 80); });
      [300, 900].forEach(function (t) { setTimeout(positionEditCtrl, t); });
    }
    // The engine mounts on DOMContentLoaded too; wait until reveal exists.
    if (API.reveal) start();
    else {
      var tries = 0;
      var iv = setInterval(function () {
        if (API.reveal || tries++ > 100) { clearInterval(iv); start(); }
      }, 30);
    }
    wireUi();
    // version check runs on entering edit (edit view only), not on load
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
