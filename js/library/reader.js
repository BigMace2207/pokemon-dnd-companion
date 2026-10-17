// The e-reader window: toolbar, a side drawer (contents, search, bookmarks & highlights,
// appearance), a progress slider, and keyboard / touch controls. The actual page drawing is done
// by flowReader.js (EPUB, DOCX, text...) or pdfReader.js (PDF); this file is the shared chrome.

import { el, btn, modal, confirmDialog, promptDialog, toast, download, selectEl, field } from "../systems/dnd5e/ui.js";
import { getBookData, updateBook, getNotes, saveNotes } from "./store.js";
import { openFlowBook } from "./formats.js";
import { createFlowReader, HL_COLORS } from "./flowReader.js";

const SETTINGS_KEY = "pokemon-dnd-reader";

function defaultTheme() {
  const t = document.documentElement.getAttribute("data-theme");
  if (t === "lava") return "lava";
  if (t === "dark" || (t !== "light" && matchMedia("(prefers-color-scheme: dark)").matches)) return "dark";
  return "paper";
}

export function loadReaderSettings() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}"); } catch { /* defaults */ }
  return { theme: defaultTheme(), font: "serif", size: 19, lh: 1.65, margin: "medium", align: "left", mode: window.innerWidth > 900 ? "paged" : "scroll", ...s };
}
function saveReaderSettings(s) { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* ignore */ } }

export async function openReader(container, book, { onClose } = {}) {
  container.replaceChildren();
  const settings = loadReaderSettings();
  const notes = await getNotes(book.id);
  const buffer = await getBookData(book.id);
  if (!buffer) { toast("That book's file is missing from this device.", "bad"); onClose?.(); return; }

  const root = el("div", { class: "lib-reader", tabindex: "-1", "data-rtheme": settings.theme });
  const titleEl = el("div", { class: "lib-title" }, book.title);
  const content = el("div", { class: "lib-content" });
  const drawer = el("aside", { class: "lib-drawer", hidden: "" });
  const progressLabel = el("span", { class: "lib-progress-label" });
  const slider = el("input", { type: "range", min: "0", max: "1000", value: "0", class: "lib-slider", "aria-label": "Reading position" });
  let reader = null;
  let drawerTab = "toc";
  let fullscreen = false;

  // ---- toolbar
  const tb = (label, title, fn, cls = "") => { const b = el("button", { type: "button", class: `lib-tool ${cls}`, title, "aria-label": title }, label); b.addEventListener("click", fn); return b; };
  const bookmarkBtn = tb("♡", "Bookmark this page (B)", () => addBookmark());
  const toolbar = el("div", { class: "lib-toolbar" }, [
    tb("←", "Back to the library", close, "lib-back"), titleEl,
    el("div", { class: "lib-tools" }, [
      tb("☰", "Contents (T)", () => toggleDrawer("toc")),
      tb("🔍", "Search (/)", () => toggleDrawer("search")),
      bookmarkBtn,
      tb("✎", "Bookmarks & highlights", () => toggleDrawer("marks")),
      tb("Aa", "Appearance", () => toggleDrawer("look")),
      tb("⛶", "Full screen (F)", () => toggleFull()),
    ]),
  ]);
  const bottom = el("div", { class: "lib-bottom" }, [
    tb("‹", "Previous page", () => reader?.prev(), "lib-nav"), slider, progressLabel, tb("›", "Next page", () => reader?.next(), "lib-nav"),
  ]);
  root.append(toolbar, el("div", { class: "lib-body" }, [content, drawer]), bottom);
  container.append(root);

  // ---- progress
  let saveTimer = null;
  function onProgress(loc, frac) {
    slider.value = String(Math.round(frac * 1000));
    progressLabel.textContent = `${reader?.label?.() || ""}  ·  ${Math.round(frac * 100)}%`;
    bookmarkBtn.textContent = nearBookmark() ? "♥" : "♡";
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => updateBook(book.id, { progress: frac, locator: loc, label: reader?.label?.() || "", lastRead: Date.now() }), 700);
  }
  slider.addEventListener("change", () => {
    const f = Number(slider.value) / 1000;
    if (!reader) return;
    if (reader.kind === "pdf") reader.goto({ p: Math.max(1, Math.round(f * (reader.total - 1)) + 1) });
    else reader.goto({ c: Math.min(reader.total - 1, Math.floor(f * reader.total)), o: 0 });
  });

  // ---- notes
  const persist = () => saveNotes(notes);
  const sameLoc = (a, b) => (a.p != null ? a.p === b.p : a.c === b.c && Math.abs((a.o || 0) - (b.o || 0)) < 1500);
  const nearBookmark = () => reader && notes.bookmarks.some((b) => sameLoc(b.loc, reader.locator()));
  function addBookmark() {
    if (!reader) return;
    const loc = reader.locator();
    const hit = notes.bookmarks.find((b) => sameLoc(b.loc, loc));
    if (hit) { notes.bookmarks = notes.bookmarks.filter((b) => b !== hit); toast("Bookmark removed."); }
    else { notes.bookmarks.push({ id: `m${Date.now().toString(36)}`, loc, label: reader.label(), fraction: reader.fraction(), ts: Date.now() }); toast("Bookmarked.", "good"); }
    persist(); bookmarkBtn.textContent = nearBookmark() ? "♥" : "♡";
    if (!drawer.hidden && drawerTab === "marks") drawTab();
  }

  const highlightApi = {
    changed: () => { persist(); if (!drawer.hidden && drawerTab === "marks") drawTab(); },
    promptNote: (initial) => promptDialog("Highlight note", "Your note", initial, { multiline: true }),
    edit: (h, redraw) => {
      const note = el("textarea", { class: "dnd-text", rows: 4, "aria-label": "Note" });
      note.value = h.note || "";
      let color = h.color;
      const sw = el("div", { class: "dnd-row" }, HL_COLORS.map((c) => { const b = el("button", { type: "button", class: `lib-swatch hl-${c}${c === color ? " on" : ""}`, "aria-label": c }); b.addEventListener("click", () => { color = c; sw.querySelectorAll(".lib-swatch").forEach((x) => x.classList.toggle("on", x === b)); }); return b; }));
      modal({
        title: "Highlight", body: [el("p", { class: "lib-quote" }, `“${h.text}”`), sw, field("Note", note)],
        actions: [
          { label: "Delete", cls: "btn danger", onClick: () => { notes.highlights = notes.highlights.filter((x) => x !== h); persist(); redraw(); highlightApi.changed(); } },
          { label: "Cancel" },
          { label: "Save", cls: "btn", onClick: () => { h.note = note.value.trim(); h.color = color; persist(); redraw(); highlightApi.changed(); } },
        ],
      });
    },
  };

  // ---- drawer
  function toggleDrawer(tab) {
    if (!drawer.hidden && drawerTab === tab) { drawer.hidden = true; root.classList.remove("drawer-open"); root.focus(); return; }
    drawerTab = tab; drawer.hidden = false; root.classList.add("drawer-open");
    drawTab();
  }
  function drawTab() {
    const tabs = [["toc", "Contents"], ["search", "Search"], ["marks", "Marks"], ["look", "Aa"]];
    const bar = el("div", { class: "lib-drawer-tabs", role: "tablist" }, tabs.map(([id, label]) => {
      const b = el("button", { type: "button", role: "tab", class: `pill-btn${id === drawerTab ? " active" : ""}`, "aria-selected": String(id === drawerTab) }, label);
      b.addEventListener("click", () => { drawerTab = id; drawTab(); });
      return b;
    }));
    const body = el("div", { class: "lib-drawer-body" });
    drawer.replaceChildren(bar, body, el("button", { type: "button", class: "lib-drawer-close", "aria-label": "Close panel" }, "✕"));
    drawer.querySelector(".lib-drawer-close").addEventListener("click", () => { drawer.hidden = true; root.classList.remove("drawer-open"); });
    ({ toc: drawToc, search: drawSearch, marks: drawMarks, look: drawLook })[drawerTab](body);
  }

  async function drawToc(body) {
    body.replaceChildren(el("p", { class: "dnd-muted" }, "Loading…"));
    const items = await reader.toc();
    const here = reader.locator();
    body.replaceChildren(...items.map((t) => {
      const current = t.loc.p != null ? t.loc.p === here.p : t.loc.c === here.c && !t.loc.a;
      const b = el("button", { type: "button", class: `lib-toc-item${current ? " current" : ""}`, style: `padding-left:${12 + t.depth * 16}px` }, t.title || "Untitled");
      b.addEventListener("click", () => { reader.goto(t.loc); if (window.innerWidth < 900) { drawer.hidden = true; root.classList.remove("drawer-open"); } });
      return b;
    }));
    body.querySelector(".current")?.scrollIntoView({ block: "center" });
  }

  function drawSearch(body) {
    const input = el("input", { type: "search", placeholder: "Search this book…", "aria-label": "Search this book", autocomplete: "off" });
    const status = el("p", { class: "dnd-small dnd-muted" });
    const list = el("div", { class: "dnd-stack" });
    let seq = 0;
    async function run() {
      const q = input.value.trim();
      const mine = ++seq;
      list.replaceChildren();
      if (q.length < 2) { status.textContent = "Type at least two letters."; reader.clearSearch?.(); return; }
      status.textContent = "Searching…";
      const results = await reader.search(q, (n, at, total) => { if (mine === seq) status.textContent = `${n} so far… (${Math.round((at / total) * 100)}%)`; });
      if (mine !== seq) return;
      status.textContent = results.length ? `${results.length}${results.length >= 300 ? "+" : ""} result${results.length === 1 ? "" : "s"}` : "No matches.";
      list.replaceChildren(...results.map((r) => {
        const b = el("button", { type: "button", class: "lib-result" }, [el("strong", {}, r.label), el("span", { class: "dnd-small" }, r.snippet)]);
        b.addEventListener("click", () => { reader.goto(r.loc); if (window.innerWidth < 900) { drawer.hidden = true; root.classList.remove("drawer-open"); } });
        return b;
      }));
    }
    let t = null;
    input.addEventListener("input", () => { clearTimeout(t); t = setTimeout(run, 350); });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { clearTimeout(t); run(); } if (e.key === "Escape") e.stopPropagation(); });
    body.replaceChildren(input, status, list);
    setTimeout(() => input.focus(), 30);
  }

  function drawMarks(body) {
    const bms = [...notes.bookmarks].sort((a, b) => a.fraction - b.fraction);
    const hls = [...notes.highlights].sort((a, b) => a.c - b.c || a.start - b.start);
    body.replaceChildren(
      el("h5", {}, `Bookmarks (${bms.length})`),
      ...(bms.length ? bms.map((m) => row(m.label, `${Math.round(m.fraction * 100)}%`, () => reader.goto(m.loc), () => { notes.bookmarks = notes.bookmarks.filter((x) => x !== m); persist(); drawTab(); })) : [el("p", { class: "dnd-small dnd-muted" }, "Press B (or the heart) to bookmark where you are.")]),
      reader.kind === "flow" ? el("h5", {}, `Highlights (${hls.length})`) : null,
      ...(reader.kind === "flow" ? (hls.length ? hls.map((h) => {
        const r = row(h.text, h.note, () => reader.gotoHighlight(h), () => { notes.highlights = notes.highlights.filter((x) => x !== h); persist(); reader.redraw(); drawTab(); }, `hl-${h.color}`);
        return r;
      }) : [el("p", { class: "dnd-small dnd-muted" }, "Select some text to highlight it or add a note.")]) : [el("p", { class: "dnd-small dnd-muted" }, "Highlighting isn't available for PDFs — use bookmarks.")]),
      (bms.length || hls.length) ? btn("Export as Markdown", () => download(`${book.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-notes.md`, exportMarkdown(), "text/markdown"), "btn secondary small") : null,
    );
  }
  function row(text, sub, go, remove, cls = "") {
    const open = el("button", { type: "button", class: `lib-mark ${cls}` }, [el("span", {}, text), sub ? el("span", { class: "dnd-small dnd-muted" }, sub) : null].filter(Boolean));
    open.addEventListener("click", go);
    const del = el("button", { type: "button", class: "lib-mark-del", "aria-label": "Delete" }, "✕");
    del.addEventListener("click", remove);
    return el("div", { class: "lib-mark-row" }, [open, del]);
  }
  function exportMarkdown() {
    const out = [`# Notes: ${book.title}`, book.author ? `*${book.author}*` : "", ""];
    if (notes.bookmarks.length) { out.push("## Bookmarks"); for (const b of notes.bookmarks) out.push(`- ${b.label} (${Math.round(b.fraction * 100)}%)`); out.push(""); }
    if (notes.highlights.length) { out.push("## Highlights"); for (const h of notes.highlights) { out.push(`> ${h.text}`); if (h.note) out.push("", h.note); out.push(""); } }
    return out.join("\n");
  }

  function drawLook(body) {
    const set = (patch) => { Object.assign(settings, patch); saveReaderSettings(settings); root.dataset.rtheme = settings.theme; reader?.applySettings(); drawLookInner(); };
    function seg(key, opts) {
      return el("div", { class: "dnd-segment", role: "group" }, opts.map(([v, l]) => { const b = el("button", { type: "button", class: settings[key] === v ? "on" : "" }, l); b.addEventListener("click", () => set({ [key]: v })); return b; }));
    }
    function drawLookInner() {
      const isPdf = reader?.kind === "pdf";
      body.replaceChildren(
        field("Theme", seg("theme", [["paper", "Paper"], ["sepia", "Sepia"], ["dark", "Night"], ["lava", "Lava"]])),
        ...(isPdf ? [
          el("div", { class: "dnd-row" }, [btn("Zoom −", () => reader.zoomOut(), "btn secondary small"), btn("Fit width", () => reader.zoomFit(), "btn secondary small"), btn("Zoom +", () => reader.zoomIn(), "btn secondary small")]),
          el("p", { class: "dnd-small dnd-muted" }, "Night and Lava themes invert the page colours."),
        ] : [
          field("Layout", seg("mode", [["paged", "Pages"], ["scroll", "Scroll"]])),
          field("Font", seg("font", [["serif", "Serif"], ["sans", "Sans"], ["mono", "Mono"]])),
          field(`Text size (${settings.size}px)`, Object.assign(el("input", { type: "range", min: "13", max: "34", value: String(settings.size), "aria-label": "Text size" }), { oninput: (e) => { settings.size = Number(e.target.value); saveReaderSettings(settings); reader?.applySettings(); } })),
          field(`Line spacing (${settings.lh})`, Object.assign(el("input", { type: "range", min: "1.2", max: "2.2", step: "0.05", value: String(settings.lh), "aria-label": "Line spacing" }), { oninput: (e) => { settings.lh = Number(e.target.value); saveReaderSettings(settings); reader?.applySettings(); } })),
          field("Margins", seg("margin", [["narrow", "Narrow"], ["medium", "Medium"], ["wide", "Wide"]])),
          field("Alignment", seg("align", [["left", "Left"], ["justify", "Justified"]])),
        ]),
      );
    }
    drawLookInner();
  }

  // ---- window controls
  function toggleFull() {
    fullscreen = !fullscreen;
    root.classList.toggle("fullscreen", fullscreen);
    document.body.classList.toggle("lib-fullscreen", fullscreen);
    reader?.applySettings?.();
  }
  function close() {
    clearTimeout(saveTimer);
    if (reader) updateBook(book.id, { progress: reader.fraction(), locator: reader.locator(), label: reader.label(), lastRead: Date.now() });
    document.removeEventListener("keydown", onKey, true);
    document.body.classList.remove("lib-fullscreen");
    reader?.destroy();
    onClose?.();
  }
  function onKey(e) {
    if (!document.body.contains(root)) { document.removeEventListener("keydown", onKey, true); return; }
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
    if (e.key === "Escape") { if (document.querySelector(".modal-overlay")) return; if (!drawer.hidden) { drawer.hidden = true; root.classList.remove("drawer-open"); } else if (fullscreen) toggleFull(); else close(); return; }
    if (typing || e.ctrlKey || e.metaKey || e.altKey) { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") { e.preventDefault(); toggleDrawer("search"); } return; }
    switch (e.key) {
      case "ArrowRight": case "PageDown": case " ": e.preventDefault(); reader?.next(); break;
      case "ArrowLeft": case "PageUp": e.preventDefault(); reader?.prev(); break;
      case "/": e.preventDefault(); toggleDrawer("search"); break;
      case "t": case "T": toggleDrawer("toc"); break;
      case "b": case "B": addBookmark(); break;
      case "f": case "F": toggleFull(); break;
      case "+": case "=": reader?.zoomIn ? reader.zoomIn() : (settings.size = Math.min(34, settings.size + 1), saveReaderSettings(settings), reader?.applySettings()); break;
      case "-": reader?.zoomOut ? reader.zoomOut() : (settings.size = Math.max(13, settings.size - 1), saveReaderSettings(settings), reader?.applySettings()); break;
      default:
    }
  }
  document.addEventListener("keydown", onKey, true);

  // ---- open the book
  content.append(el("p", { class: "lib-loading dnd-muted" }, "Opening…"));
  try {
    if (book.format === "pdf") {
      const { createPdfReader } = await import("./pdfReader.js");
      content.replaceChildren();
      reader = await createPdfReader({ buffer, host: content, initial: book.locator, onProgress, getSettings: () => settings });
    } else {
      const model = await openFlowBook(book.format, buffer, book.title, book.mime);
      content.replaceChildren();
      reader = await createFlowReader({ book: model, host: content, initial: book.locator, onProgress, getSettings: () => settings, highlights: notes.highlights, onHighlights: highlightApi });
      if (model.title && book.title === "Untitled") updateBook(book.id, { title: model.title });
    }
  } catch (err) {
    content.replaceChildren(el("div", { class: "card" }, [el("h4", {}, "Couldn't open this book"), el("p", { class: "view-sub" }, String(err.message || err)), btn("Back to the library", close, "btn")]));
    return;
  }
  onProgress(reader.locator(), reader.fraction());
  root.focus();
  void selectEl; void confirmDialog;
}
