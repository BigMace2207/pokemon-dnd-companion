// PDF reading via the vendored PDF.js (js/vendor/pdfjs). Pages are drawn lazily as they scroll
// into view, with a selectable text layer, zoom, an outline, and full-text search.
//
// Locator for PDFs: { p: pageNumber }.

let pdfjsPromise = null;
function pdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import("../vendor/pdfjs/pdf.min.js").then((m) => {
      m.GlobalWorkerOptions.workerSrc = new URL("../vendor/pdfjs/pdf.worker.min.js", import.meta.url).href;
      return m;
    });
  }
  return pdfjsPromise;
}

const el = (tag, cls) => { const n = document.createElement(tag); if (cls) n.className = cls; return n; };

export async function loadPdf(buffer) {
  const lib = await pdfjs();
  // isEvalSupported/disableFontFace keep PDF.js inside the site's Content-Security-Policy
  const task = lib.getDocument({ data: new Uint8Array(buffer.slice(0)), isEvalSupported: false, disableFontFace: true, useSystemFonts: true, standardFontDataUrl: new URL("../vendor/pdfjs/standard_fonts/", import.meta.url).href });
  return { lib, doc: await task.promise };
}

// First-page thumbnail for the shelf.
export async function pdfCover(buffer, width = 220) {
  const { doc } = await loadPdf(buffer);
  try {
    const page = await doc.getPage(1);
    const vp0 = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: width / vp0.width });
    const c = document.createElement("canvas");
    c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    await page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
    const info = await doc.getMetadata().catch(() => null);
    return { cover: c.toDataURL("image/jpeg", 0.8), pages: doc.numPages, title: info?.info?.Title || "", author: info?.info?.Author || "" };
  } finally { doc.destroy(); }
}

export async function createPdfReader({ buffer, host, initial, onProgress, getSettings }) {
  const { lib, doc } = await loadPdf(buffer);
  const scroller = el("div", "lib-pdf-scroll");
  const pagesBox = el("div", "lib-pdf-pages");
  scroller.append(pagesBox);
  host.append(scroller);

  const total = doc.numPages;
  const first = await doc.getPage(1);
  const base = first.getViewport({ scale: 1 });
  let zoom = 0; // 0 = fit width
  let scale = 1;
  const slots = [];
  const state = new Map(); // page -> { canvas, text, task, rendered }
  let current = initial?.p || 1;
  let closed = false;

  function computeScale() {
    const fit = Math.max(0.3, (scroller.clientWidth - 24) / base.width);
    scale = zoom ? zoom : fit;
  }

  function sizeSlots() {
    computeScale();
    for (const [i, slot] of slots.entries()) {
      const st = state.get(i + 1);
      const h = (st?.vp ? st.vp.height / st.vp.scale : base.height) * scale;
      const w = (st?.vp ? st.vp.width / st.vp.scale : base.width) * scale;
      slot.style.width = `${Math.round(w)}px`;
      slot.style.height = `${Math.round(h)}px`;
    }
  }

  for (let i = 1; i <= total; i++) {
    const slot = el("div", "lib-pdf-page");
    slot.dataset.page = String(i);
    pagesBox.append(slot);
    slots.push(slot);
  }
  sizeSlots();

  async function render(n) {
    const slot = slots[n - 1];
    const prev = state.get(n);
    if (prev?.renderedScale === scale) return;
    prev?.task?.cancel?.();
    const page = await doc.getPage(n);
    if (closed) return;
    const vp = page.getViewport({ scale });
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const canvas = el("canvas", "lib-pdf-canvas");
    canvas.width = Math.round(vp.width * ratio); canvas.height = Math.round(vp.height * ratio);
    canvas.style.width = `${Math.round(vp.width)}px`; canvas.style.height = `${Math.round(vp.height)}px`;
    const st = { vp, renderedScale: scale };
    state.set(n, st);
    slot.style.width = canvas.style.width; slot.style.height = canvas.style.height;
    const task = page.render({ canvasContext: canvas.getContext("2d"), viewport: vp, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : null });
    st.task = task;
    try { await task.promise; } catch { return; }
    if (closed) return;
    const textBox = el("div", "lib-pdf-text");
    textBox.style.setProperty("--scale-factor", String(vp.scale));
    slot.replaceChildren(canvas, textBox);
    try {
      const tl = new lib.TextLayer({ textContentSource: page.streamTextContent(), container: textBox, viewport: vp });
      await tl.render();
      markHits(textBox);
    } catch { /* text layer is optional */ }
    st.text = textBox;
  }

  function release(n) {
    const st = state.get(n);
    if (!st) return;
    st.task?.cancel?.();
    slots[n - 1].replaceChildren();
    state.delete(n);
  }

  let query = "";
  function markHits(box) {
    if (!query) return;
    const q = query.toLowerCase();
    for (const span of box.querySelectorAll("span")) if (span.textContent.toLowerCase().includes(q)) span.classList.add("hit");
  }
  function refreshHits() {
    for (const st of state.values()) if (st.text) { st.text.querySelectorAll(".hit").forEach((s) => s.classList.remove("hit")); markHits(st.text); }
  }

  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const n = Number(e.target.dataset.page);
      if (e.isIntersecting) render(n);
    }
  }, { root: scroller, rootMargin: "800px 0px" });
  slots.forEach((s) => io.observe(s));

  // free canvases that are far away so a 600-page book doesn't eat memory
  let gcTimer = null;
  function pageAtTop() {
    const mid = scroller.scrollTop + scroller.clientHeight * 0.3;
    let lo = 0, hi = slots.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (slots[m].offsetTop <= mid) lo = m; else hi = m - 1; }
    return lo + 1;
  }
  scroller.addEventListener("scroll", () => {
    const p = pageAtTop();
    if (p !== current) { current = p; onProgress?.({ p }, (p - 1) / Math.max(1, total - 1)); }
    clearTimeout(gcTimer);
    gcTimer = setTimeout(() => { for (const n of [...state.keys()]) if (Math.abs(n - current) > 8) release(n); }, 600);
  }, { passive: true });

  const ro = new ResizeObserver(() => { if (!zoom) refit(); });
  ro.observe(scroller);
  let refitTimer = null;
  function refit() {
    clearTimeout(refitTimer);
    refitTimer = setTimeout(() => { const keep = current; computeScale(); sizeSlots(); for (const n of [...state.keys()]) release(n); goto({ p: keep }); }, 200);
  }

  function goto(loc) {
    const p = Math.max(1, Math.min(total, loc?.p || 1));
    current = p;
    slots[p - 1].scrollIntoView({ block: "start" });
    render(p);
    onProgress?.({ p }, (p - 1) / Math.max(1, total - 1));
  }

  async function toc() {
    const outline = await doc.getOutline().catch(() => null);
    const out = [];
    async function walk(items, depth) {
      for (const it of items || []) {
        let page = 1;
        try {
          const dest = typeof it.dest === "string" ? await doc.getDestination(it.dest) : it.dest;
          if (dest) page = (await doc.getPageIndex(dest[0])) + 1;
        } catch { /* keep 1 */ }
        out.push({ title: it.title, loc: { p: page }, depth });
        await walk(it.items, depth + 1);
      }
    }
    await walk(outline, 0);
    return out.length ? out : Array.from({ length: Math.min(total, 200) }, (_, i) => ({ title: `Page ${i + 1}`, loc: { p: i + 1 }, depth: 0 }));
  }

  const textCache = new Map();
  async function pageText(n) {
    if (textCache.has(n)) return textCache.get(n);
    const page = await doc.getPage(n);
    const tc = await page.getTextContent();
    const s = tc.items.map((i) => i.str).join(" ").replace(/\s+/g, " ");
    textCache.set(n, s);
    return s;
  }
  async function search(q, onBatch) {
    query = q;
    refreshHits();
    const needle = q.toLowerCase();
    const results = [];
    if (needle.length < 2) return results;
    for (let n = 1; n <= total; n++) {
      if (closed || query !== q) break;
      const t = await pageText(n);
      const low = t.toLowerCase();
      let at = 0, count = 0;
      while ((at = low.indexOf(needle, at)) >= 0 && count < 3) {
        results.push({ loc: { p: n }, label: `Page ${n}`, snippet: `…${t.slice(Math.max(0, at - 40), at + needle.length + 60)}…`, hit: q });
        at += needle.length; count++;
      }
      if (n % 25 === 0) onBatch?.(results.length, n, total);
      if (results.length >= 300) break;
    }
    return results;
  }

  function destroy() {
    closed = true;
    io.disconnect(); ro.disconnect();
    for (const st of state.values()) st.task?.cancel?.();
    doc.destroy();
    scroller.remove();
  }

  function apply() {
    const s = getSettings?.() || {};
    scroller.dataset.night = s.theme === "dark" || s.theme === "lava" ? "1" : "";
  }
  apply();
  goto({ p: current });

  return {
    kind: "pdf", total,
    toc, search, destroy, goto,
    applySettings: apply,
    locator: () => ({ p: current }),
    label: () => `Page ${current} of ${total}`,
    fraction: () => (current - 1) / Math.max(1, total - 1),
    next: () => goto({ p: Math.min(total, current + 1) }),
    prev: () => goto({ p: Math.max(1, current - 1) }),
    zoomIn: () => { zoom = Math.min(4, (zoom || scale) * 1.2); const keep = current; computeScale(); sizeSlots(); [...state.keys()].forEach(release); goto({ p: keep }); },
    zoomOut: () => { zoom = Math.max(0.3, (zoom || scale) / 1.2); const keep = current; computeScale(); sizeSlots(); [...state.keys()].forEach(release); goto({ p: keep }); },
    zoomFit: () => { zoom = 0; refit(); },
    clearSearch: () => { query = ""; refreshHits(); },
  };
}
