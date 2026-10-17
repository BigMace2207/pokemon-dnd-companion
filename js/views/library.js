// Library: the user's own books and rulebooks (PDF, EPUB, Word, text, Markdown, HTML, images,
// comic zips), kept privately on this device, with a full e-reader. Nothing is uploaded: files live
// in this browser's IndexedDB, so they're never shared with the campaign or the server.

import { el, btn, chip, toast, confirmDialog, modal, field, selectEl, textInput } from "../systems/dnd5e/ui.js";
import { listBooks, addBook, updateBook, deleteBook, usage, persist } from "../library/store.js";
import { detectFormat, FORMATS, openEpub, openDocx, thumb } from "../library/formats.js";
import { openReader } from "../library/reader.js";
import { getViewState, setViewState } from "../viewState.js";

const SHELVES = ["Pokémon D&D", "D&D 5e", "Homebrew", "Other"];
const fmtBytes = (n) => (n > 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
const COVER_HUES = [8, 24, 38, 205, 150, 280, 340, 18];

function generatedCover(book) {
  const hue = COVER_HUES[[...book.title].reduce((n, c) => n + c.charCodeAt(0), 0) % COVER_HUES.length];
  return el("div", { class: "lib-cover generated", style: `--hue:${hue}` }, [
    el("div", { class: "lib-cover-title" }, book.title), book.author ? el("div", { class: "lib-cover-author" }, book.author) : null,
    el("div", { class: "lib-cover-fmt" }, FORMATS[book.format] || book.format),
  ].filter(Boolean));
}

export function renderLibrary(container) {
  container.replaceChildren();
  const st = getViewState("library:ui", { q: "", shelf: "", format: "", sort: "recent" });
  const remember = () => setViewState("library:ui", st);

  const head = el("div", { class: "lib-head" }, [
    el("div", {}, [el("h1", { class: "view-title" }, "Library"), el("p", { class: "view-sub" }, "Your own books and rulebooks, with a built-in reader. Files stay on this device — nothing is uploaded.")]),
  ]);
  const input = el("input", { type: "file", multiple: "", accept: ".pdf,.epub,.docx,.txt,.md,.markdown,.html,.htm,.png,.jpg,.jpeg,.gif,.webp,.cbz", hidden: "" });
  const addBtn = btn("+ Add books", () => input.click(), "btn");
  const drop = el("div", { class: "lib-drop", role: "button", tabindex: "0", "aria-label": "Add books: click or drop files here" }, [
    el("strong", {}, "Drop books here"), el("span", { class: "dnd-muted" }, "PDF · EPUB · Word · TXT · Markdown · HTML · images · CBZ"),
  ]);
  const meter = el("div", { class: "lib-meter dnd-small dnd-muted" });
  const toolbar = el("div", { class: "card lib-toolbar-card" });
  const shelfHost = el("div");
  const status = el("div", { class: "dnd-small dnd-muted", "aria-live": "polite" });
  container.append(head, toolbar, drop, status, shelfHost, meter, input);
  head.append(addBtn);

  drop.addEventListener("click", () => input.click());
  drop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } });
  for (const ev of ["dragenter", "dragover"]) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); });
  for (const ev of ["dragleave", "drop"]) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); });
  drop.addEventListener("drop", (e) => importFiles([...e.dataTransfer.files]));
  input.addEventListener("change", () => { importFiles([...input.files]); input.value = ""; });

  async function importFiles(files) {
    if (!files.length) return;
    let ok = 0;
    for (const file of files) {
      status.textContent = `Adding ${file.name}…`;
      try {
        const format = await detectFormat(file);
        if (!format) { toast(`${file.name}: that file type isn't supported.`, "bad"); continue; }
        if (file.size > 250 * 1024 * 1024) { toast(`${file.name} is over 250 MB.`, "bad"); continue; }
        const buffer = await file.arrayBuffer();
        const meta = { title: file.name.replace(/\.[^.]+$/, "").replace(/[_]+/g, " "), format, mime: file.type, shelf: st.shelf || "" };
        if (format === "pdf") {
          const { pdfCover } = await import("../library/pdfReader.js");
          const info = await pdfCover(buffer);
          Object.assign(meta, { cover: info.cover, pages: info.pages });
          if (info.title && info.title.length > 2) meta.title = info.title;
          if (info.author) meta.author = info.author;
        } else if (format === "epub") {
          const m = await openEpub(buffer);
          Object.assign(meta, { title: m.title || meta.title, author: m.author, cover: m.cover });
        } else if (format === "docx") {
          const m = await openDocx(buffer, file.name);
          Object.assign(meta, { title: m.title || meta.title, author: m.author });
        } else if (format === "image") {
          meta.cover = await thumb(URL.createObjectURL ? await fileToDataUrl(file) : "");
        }
        await addBook(meta, buffer);
        ok++;
      } catch (err) {
        toast(`${file.name}: ${err.message || "couldn't be read."}`, "bad");
      }
    }
    status.textContent = "";
    if (ok) { toast(`Added ${ok} book${ok === 1 ? "" : "s"}.`, "good"); persist(); }
    draw();
  }

  const fileToDataUrl = (file) => new Promise((resolve) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = () => resolve(""); r.readAsDataURL(file); });

  async function draw() {
    let books = [];
    try { books = await listBooks(); } catch (err) {
      shelfHost.replaceChildren(el("div", { class: "card" }, el("p", { class: "view-sub" }, `The library isn't available in this browser: ${err.message}`)));
      return;
    }
    // toolbar
    const q = el("input", { type: "search", placeholder: "Search your library…", value: st.q, "aria-label": "Search your library", autocomplete: "off" });
    q.addEventListener("input", () => { st.q = q.value; remember(); drawShelf(books); });
    const shelves = [...new Set([...SHELVES, ...books.map((b) => b.shelf).filter(Boolean)])];
    const shelfSel = selectEl([["", "All shelves"], ...shelves.map((s) => [s, s])], st.shelf, (v) => { st.shelf = v; remember(); drawShelf(books); });
    const fmtSel = selectEl([["", "All formats"], ...Object.entries(FORMATS)], st.format, (v) => { st.format = v; remember(); drawShelf(books); });
    const sortSel = selectEl([["recent", "Recently read"], ["added", "Recently added"], ["title", "Title"], ["author", "Author"], ["progress", "Progress"]], st.sort, (v) => { st.sort = v; remember(); drawShelf(books); });
    toolbar.replaceChildren(el("div", { class: "dnd-grid-2" }, [field("Search", q), el("div", { class: "dnd-row" }, [field("Shelf", shelfSel), field("Format", fmtSel), field("Sort", sortSel)])]));
    drawShelf(books);
    const u = await usage();
    const total = books.reduce((n, b) => n + (b.size || 0), 0);
    meter.textContent = `${books.length} book${books.length === 1 ? "" : "s"} · ${fmtBytes(total)} on this device${u?.quota ? ` · browser storage ${Math.round((u.used / u.quota) * 100)}% used` : ""}. Your files never leave this browser, so clearing site data deletes them — keep your originals.`;
  }

  function drawShelf(books) {
    const needle = st.q.trim().toLowerCase();
    let list = books.filter((b) => (!needle || `${b.title} ${b.author}`.toLowerCase().includes(needle)) && (!st.shelf || b.shelf === st.shelf) && (!st.format || b.format === st.format));
    const sorters = {
      recent: (a, b) => (b.lastRead || 0) - (a.lastRead || 0) || b.added - a.added, added: (a, b) => b.added - a.added,
      title: (a, b) => a.title.localeCompare(b.title), author: (a, b) => (a.author || "~").localeCompare(b.author || "~") || a.title.localeCompare(b.title), progress: (a, b) => (b.progress || 0) - (a.progress || 0),
    };
    list = list.sort(sorters[st.sort] || sorters.recent);
    const continuing = !needle && !st.shelf && !st.format ? books.filter((b) => b.lastRead && b.progress < 0.99).sort((a, b) => b.lastRead - a.lastRead).slice(0, 4) : [];
    shelfHost.replaceChildren(
      ...(continuing.length ? [el("h3", { class: "lib-h" }, "Continue reading"), el("div", { class: "lib-grid" }, continuing.map(card))] : []),
      el("h3", { class: "lib-h" }, st.q || st.shelf || st.format ? `Results (${list.length})` : `All books (${list.length})`),
      list.length ? el("div", { class: "lib-grid" }, list.map(card)) : el("div", { class: "card" }, el("p", { class: "view-sub" }, books.length ? "No book matches those filters." : "Your shelf is empty. Add a PDF, EPUB or Word file to start reading.")),
    );
  }

  function card(book) {
    const cover = book.cover ? el("img", { class: "lib-cover", src: book.cover, alt: "" }) : generatedCover(book);
    const pct = Math.round((book.progress || 0) * 100);
    const open = el("button", { type: "button", class: "lib-card-open", "aria-label": `Read ${book.title}` }, [
      el("div", { class: "lib-cover-wrap" }, [cover, el("span", { class: "lib-badge" }, FORMATS[book.format] || book.format)]),
      el("div", { class: "lib-card-title" }, book.title),
      el("div", { class: "lib-card-author dnd-muted dnd-small" }, book.author || " "),
      el("div", { class: "lib-bar", role: "img", "aria-label": `${pct}% read` }, el("div", { style: `width:${pct}%` })),
      el("div", { class: "dnd-tiny dnd-muted" }, book.lastRead ? (pct >= 99 ? "Finished" : `${pct}% · ${book.label || "in progress"}`) : "Not started"),
    ]);
    open.addEventListener("click", () => openBook(book));
    const menu = btn("⋯", () => editBook(book), "btn secondary tiny lib-card-menu", { "aria-label": `Edit ${book.title}`, title: "Edit, move or delete" });
    return el("div", { class: "lib-card" }, [open, menu]);
  }

  function openBook(book) {
    updateBook(book.id, { lastRead: Date.now() });
    openReader(container, book, { onClose: () => renderLibrary(container) });
  }

  function editBook(book) {
    const title = textInput(book.title, () => {}, { ariaLabel: "Title" });
    const author = textInput(book.author || "", () => {}, { ariaLabel: "Author" });
    const shelf = textInput(book.shelf || "", () => {}, { placeholder: "e.g. Pokémon D&D", ariaLabel: "Shelf" });
    const list = el("datalist", { id: "lib-shelves" }, SHELVES.map((s) => el("option", { value: s })));
    shelf.setAttribute("list", "lib-shelves");
    modal({
      title: "Book details",
      body: [field("Title", title), field("Author", author), field("Shelf", shelf), list,
        el("p", { class: "dnd-small dnd-muted" }, `${FORMATS[book.format]} · ${fmtBytes(book.size)}${book.pages ? ` · ${book.pages} pages` : ""} · added ${new Date(book.added).toLocaleDateString()}`)],
      actions: [
        { label: "Delete", cls: "btn danger", onClick: () => { confirmDialog(`Remove "${book.title}" from this device? Your bookmarks and highlights go with it.`, { ok: "Remove", danger: true }).then(async (yes) => { if (yes) { await deleteBook(book.id); toast("Removed.", ""); draw(); } }); } },
        { label: "Reset progress", onClick: async () => { await updateBook(book.id, { progress: 0, locator: null, label: "", lastRead: 0 }); draw(); } },
        { label: "Save", cls: "btn", onClick: async () => { await updateBook(book.id, { title: title.value.trim() || book.title, author: author.value.trim(), shelf: shelf.value.trim() }); draw(); } },
      ],
    });
  }

  draw();
  void chip;
}
