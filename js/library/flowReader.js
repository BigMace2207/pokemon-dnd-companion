// The reflowable e-reader (EPUB, DOCX, text, Markdown, HTML, images, comics).
//
// Two layouts: "scroll" (the chapter scrolls) and "paged" (real pages made with CSS columns,
// turned by arrow keys, taps on the page edges, or a swipe). Progress is a locator
// { c: chapter, o: character offset of the first visible text }, which survives font-size and
// window-size changes. Highlights are stored as character ranges per chapter and re-applied
// each time the chapter is drawn.

const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

export const HL_COLORS = ["yellow", "green", "blue", "pink"];

function textNodes(root) {
  const out = [];
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (w.nextNode()) out.push(w.currentNode);
  return out;
}

function offsetOf(root, node, off) {
  let n = 0;
  for (const t of textNodes(root)) {
    if (t === node) return n + off;
    n += t.nodeValue.length;
  }
  // node might be an element boundary
  const r = document.createRange();
  r.selectNodeContents(root);
  try { r.setEnd(node, off); } catch { return 0; }
  return r.toString().length;
}

function rangeAt(root, start, end) {
  const r = document.createRange();
  let n = 0, set = false;
  for (const t of textNodes(root)) {
    const len = t.nodeValue.length;
    if (!set && start <= n + len) { r.setStart(t, Math.max(0, start - n)); set = true; }
    if (set && end <= n + len) { r.setEnd(t, Math.max(0, end - n)); return r; }
    n += len;
  }
  return set ? (r.setEnd(root, root.childNodes.length), r) : null;
}

// Wrap [start,end) in <mark> elements (one per text node it crosses).
function wrapRange(root, start, end, cls, data = {}) {
  let n = 0;
  const marks = [];
  for (const t of textNodes(root)) {
    const len = t.nodeValue.length;
    const a = Math.max(start, n), b = Math.min(end, n + len);
    if (a < b) {
      const r = document.createRange();
      r.setStart(t, a - n); r.setEnd(t, b - n);
      const m = el("mark", cls);
      Object.assign(m.dataset, data);
      r.surroundContents(m);
      marks.push(m);
    }
    n += len;
    if (n >= end) break;
  }
  return marks;
}

export async function createFlowReader({ book, host, initial, onProgress, getSettings, highlights, onHighlights }) {
  const root = el("div", "lib-flow");
  const stage = el("div", "lib-flow-stage");
  const article = el("article", "lib-flow-text");
  const clip = el("div", "lib-flow-clip");
  clip.append(article);
  stage.append(clip);
  root.append(stage);
  host.append(root);

  const cache = new Map();
  let chapter = Math.min(Math.max(0, initial?.c || 0), book.chapters.length - 1);
  let page = 0, pages = 1, pageW = 0, gap = 0;
  let closed = false;
  let searchTerm = "";
  const settings = () => getSettings();

  async function load(i) {
    if (!cache.has(i)) cache.set(i, book.chapters[i].load());
    return (await cache.get(i)).cloneNode(true);
  }

  // ---- drawing a chapter -----------------------------------------------------------------
  async function show(i, { offset = 0, anchor = "", lastPage = false } = {}) {
    chapter = Math.min(Math.max(0, i), book.chapters.length - 1);
    article.replaceChildren(el("p", "dnd-muted", "Loading…"));
    const node = await load(chapter);
    if (closed) return;
    article.replaceChildren(...node.childNodes);
    applyHighlights();
    if (searchTerm) markSearch();
    layout();
    if (anchor) {
      const target = article.querySelector(`[id="${CSS.escape(anchor)}"]`);
      if (target) scrollToEl(target); else toStart();
    } else if (offset > 0) scrollToOffset(offset);
    else if (lastPage && settings().mode === "paged") setPage(pages - 1);
    else toStart();
    report();
  }

  function toStart() { if (settings().mode === "paged") setPage(0); else stage.scrollTop = 0; }

  function layout() {
    const s = settings();
    root.dataset.mode = s.mode;
    if (s.mode === "paged") {
      const cs = getComputedStyle(stage);
      const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
      const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
      pageW = Math.max(200, stage.clientWidth - padX);
      const h = Math.max(240, stage.clientHeight - padY);
      gap = Math.max(32, Math.round(pageW * 0.08));
      clip.style.cssText = `width:${pageW}px;height:${h}px;`;
      article.style.cssText = `column-width:${pageW}px;column-gap:${gap}px;column-fill:auto;height:${h}px;width:${pageW}px;--page-h:${h}px;`;
      pages = Math.max(1, Math.round((article.scrollWidth + gap) / (pageW + gap)));
      page = Math.min(page, pages - 1);
      article.style.transform = `translateX(${-page * (pageW + gap)}px)`;
    } else {
      clip.style.cssText = "";
      article.style.cssText = "";
    }
  }

  function setPage(p) {
    page = Math.min(Math.max(0, p), pages - 1);
    article.style.transform = `translateX(${-page * (pageW + gap)}px)`;
    report();
  }

  function scrollToEl(target) {
    if (settings().mode === "paged") {
      const left = target.getBoundingClientRect().left - article.getBoundingClientRect().left + page * (pageW + gap);
      setPage(Math.floor(left / (pageW + gap)));
    } else target.scrollIntoView({ block: "start" });
  }

  function scrollToOffset(offset) {
    const r = rangeAt(article, offset, offset + 1);
    if (!r) return toStart();
    const rect = r.getBoundingClientRect();
    if (settings().mode === "paged") {
      const left = rect.left - article.getBoundingClientRect().left + page * (pageW + gap);
      setPage(Math.floor(left / (pageW + gap)));
    } else stage.scrollTop += rect.top - stage.getBoundingClientRect().top - 24;
  }

  function firstVisibleOffset() {
    const sr = stage.getBoundingClientRect();
    const cs = getComputedStyle(stage);
    const x = sr.left + parseFloat(cs.paddingLeft) + 4, y = sr.top + parseFloat(cs.paddingTop) + 6;
    let range = null;
    if (document.caretRangeFromPoint) range = document.caretRangeFromPoint(x, y);
    else if (document.caretPositionFromPoint) { const pos = document.caretPositionFromPoint(x, y); if (pos) { range = document.createRange(); range.setStart(pos.offsetNode, pos.offset); } }
    if (!range || !article.contains(range.startContainer)) return 0;
    return offsetOf(article, range.startContainer, range.startOffset);
  }

  const chapterLen = () => Math.max(1, article.textContent.length);
  function report() {
    if (closed) return;
    const o = firstVisibleOffset();
    onProgress?.({ c: chapter, o }, (chapter + Math.min(1, o / chapterLen())) / book.chapters.length);
  }

  // ---- navigation ------------------------------------------------------------------------
  async function next() {
    if (settings().mode === "paged") {
      if (page < pages - 1) return setPage(page + 1);
      if (chapter < book.chapters.length - 1) return show(chapter + 1);
      return null;
    }
    const atEnd = stage.scrollTop + stage.clientHeight >= stage.scrollHeight - 4;
    if (!atEnd) { stage.scrollBy({ top: stage.clientHeight * 0.88, behavior: "smooth" }); return null; }
    return chapter < book.chapters.length - 1 ? show(chapter + 1) : null;
  }
  async function prev() {
    if (settings().mode === "paged") {
      if (page > 0) return setPage(page - 1);
      if (chapter > 0) return show(chapter - 1, { lastPage: true });
      return null;
    }
    if (stage.scrollTop > 4) { stage.scrollBy({ top: -stage.clientHeight * 0.88, behavior: "smooth" }); return null; }
    return chapter > 0 ? show(chapter - 1).then(() => { stage.scrollTop = stage.scrollHeight; }) : null;
  }

  async function goto(loc) {
    if (loc.c == null) return null;
    return show(loc.c, { offset: loc.o || 0, anchor: loc.a || "" });
  }

  stage.addEventListener("scroll", () => { if (settings().mode === "scroll") { clearTimeout(stage._t); stage._t = setTimeout(report, 250); } }, { passive: true });

  // taps on the left/right edge turn the page; swipes too
  let down = null;
  stage.addEventListener("pointerdown", (e) => { down = { x: e.clientX, y: e.clientY, t: Date.now() }; });
  stage.addEventListener("pointerup", (e) => {
    if (!down || settings().mode !== "paged") { down = null; return; }
    const dx = e.clientX - down.x, dy = e.clientY - down.y;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) { down = null; return; }
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) { dx < 0 ? next() : prev(); }
    else if (Math.abs(dx) < 8 && Math.abs(dy) < 8 && Date.now() - down.t < 400 && !e.target.closest("a,mark,button")) {
      const r = stage.getBoundingClientRect();
      const fx = (e.clientX - r.left) / r.width;
      if (fx < 0.22) prev(); else if (fx > 0.78) next();
    }
    down = null;
  });

  // internal links
  article.addEventListener("click", (e) => {
    const a = e.target.closest("a[data-chapter]");
    if (a) { e.preventDefault(); show(Number(a.dataset.chapter), { anchor: a.dataset.anchor || "" }); }
  });

  const ro = new ResizeObserver(() => { clearTimeout(ro._t); ro._t = setTimeout(() => { const o = firstVisibleOffset(); layout(); if (o) scrollToOffset(o); }, 150); });
  ro.observe(stage);

  // ---- highlights ------------------------------------------------------------------------
  function applyHighlights() {
    for (const h of highlights.filter((x) => x.c === chapter)) {
      try { wrapRange(article, h.start, h.end, `hl hl-${h.color}${h.note ? " has-note" : ""}`, { id: h.id }); } catch { /* range no longer valid */ }
    }
  }
  function redrawKeeping() {
    const o = firstVisibleOffset();
    const keep = settings().mode === "scroll" ? stage.scrollTop : 0;
    show(chapter, { offset: o }).then(() => { if (settings().mode === "scroll" && !o) stage.scrollTop = keep; });
  }

  // selection toolbar
  const bar = el("div", "lib-sel-bar");
  bar.hidden = true;
  root.append(bar);
  function hideBar() { bar.hidden = true; }
  function selectionInfo() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const r = sel.getRangeAt(0);
    if (!article.contains(r.startContainer) || !article.contains(r.endContainer)) return null;
    const start = offsetOf(article, r.startContainer, r.startOffset), end = offsetOf(article, r.endContainer, r.endOffset);
    if (end <= start) return null;
    return { start, end, text: sel.toString().trim().slice(0, 400), rect: r.getBoundingClientRect() };
  }
  function showBar() {
    const info = selectionInfo();
    if (!info) return hideBar();
    bar.replaceChildren(
      ...HL_COLORS.map((c) => { const b = el("button", `lib-swatch hl-${c}`); b.type = "button"; b.title = `Highlight ${c}`; b.setAttribute("aria-label", `Highlight ${c}`); b.addEventListener("click", () => addHighlight(info, c)); return b; }),
      Object.assign(el("button", "lib-sel-btn", "Note"), { type: "button", onclick: () => addHighlight(info, "yellow", true) }),
      Object.assign(el("button", "lib-sel-btn", "Copy"), { type: "button", onclick: () => { navigator.clipboard?.writeText(info.text); hideBar(); } }),
    );
    const hr = root.getBoundingClientRect();
    bar.hidden = false;
    bar.style.left = `${Math.max(8, Math.min(hr.width - 250, info.rect.left - hr.left + info.rect.width / 2 - 125))}px`;
    bar.style.top = `${Math.max(8, info.rect.top - hr.top - 46)}px`;
  }
  async function addHighlight(info, color, withNote = false) {
    const h = { id: `h${Date.now().toString(36)}${Math.floor(Math.random() * 999)}`, c: chapter, start: info.start, end: info.end, color, text: info.text, note: "", ts: Date.now() };
    if (withNote) { const t = await onHighlights?.promptNote?.(""); if (t == null) return; h.note = t; }
    highlights.push(h);
    window.getSelection()?.removeAllRanges();
    hideBar();
    onHighlights?.changed?.();
    redrawKeeping();
  }
  stage.addEventListener("pointerup", () => setTimeout(showBar, 10));
  stage.addEventListener("keyup", () => setTimeout(showBar, 10));
  document.addEventListener("selectionchange", () => { const s = window.getSelection(); if (!s || s.isCollapsed) hideBar(); });

  article.addEventListener("click", (e) => {
    const m = e.target.closest("mark.hl");
    if (!m) return;
    const h = highlights.find((x) => x.id === m.dataset.id);
    if (h) onHighlights?.edit?.(h, () => redrawKeeping());
  });

  // ---- search ----------------------------------------------------------------------------
  function markSearch() {
    if (!searchTerm) return;
    const low = article.textContent.toLowerCase();
    const needle = searchTerm.toLowerCase();
    const spots = [];
    let at = 0;
    while ((at = low.indexOf(needle, at)) >= 0 && spots.length < 400) { spots.push(at); at += needle.length; }
    for (const s of spots.reverse()) { try { wrapRange(article, s, s + needle.length, "search-hit"); } catch { /* skip */ } }
  }
  async function search(q, onBatch) {
    searchTerm = q;
    const needle = q.toLowerCase();
    const results = [];
    if (needle.length < 2) { redrawKeeping(); return results; }
    for (let i = 0; i < book.chapters.length; i++) {
      if (closed || searchTerm !== q) break;
      const node = await load(i);
      const text = node.textContent;
      const low = text.toLowerCase();
      let at = 0, count = 0;
      while ((at = low.indexOf(needle, at)) >= 0 && count < 6) {
        results.push({ loc: { c: i, o: at }, label: book.chapters[i].title, snippet: `…${text.slice(Math.max(0, at - 45), at + needle.length + 70).replace(/\s+/g, " ")}…`, hit: q });
        at += needle.length; count++;
      }
      if (i % 8 === 0) onBatch?.(results.length, i, book.chapters.length);
      if (results.length >= 300) break;
    }
    return results;
  }
  function clearSearch() { if (searchTerm) { searchTerm = ""; redrawKeeping(); } }

  function apply() {
    const s = settings();
    root.dataset.rtheme = s.theme;
    root.style.setProperty("--r-size", `${s.size}px`);
    root.style.setProperty("--r-lh", String(s.lh));
    root.style.setProperty("--r-margin", { narrow: "6%", medium: "12%", wide: "20%" }[s.margin] || "12%");
    root.dataset.font = s.font;
    root.dataset.align = s.align;
    layout();
    const o = firstVisibleOffset();
    if (o) scrollToOffset(o);
  }

  function destroy() { closed = true; ro.disconnect(); root.remove(); }

  apply();
  await show(chapter, { offset: initial?.o || 0 });

  return {
    kind: "flow", total: book.chapters.length,
    toc: async () => book.toc.map((t) => ({ title: t.title, loc: { c: t.chapter, a: t.anchor }, depth: t.depth })),
    search, clearSearch, goto, next, prev, destroy, applySettings: apply,
    locator: () => ({ c: chapter, o: firstVisibleOffset() }),
    label: () => `${book.chapters[chapter].title}${settings().mode === "paged" ? ` · page ${page + 1}/${pages}` : ""}`,
    fraction: () => (chapter + Math.min(1, firstVisibleOffset() / chapterLen())) / book.chapters.length,
    redraw: redrawKeeping,
    gotoHighlight: (h) => goto({ c: h.c, o: h.start }),
  };
}
