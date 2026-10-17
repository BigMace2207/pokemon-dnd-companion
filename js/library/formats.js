// Book parsers. Every reflowable format (EPUB, DOCX, TXT, Markdown, HTML, images, comic zips)
// is turned into the same model so one reader can show them all:
//
//   { kind: "flow", title, author, cover, chapters: [{ id, title, load() -> Promise<Element> }],
//     toc: [{ title, chapter, anchor, depth }] }
//
// PDFs are handled separately by pdfReader.js (they're fixed-layout pages, not reflowable text).

import { Zip } from "./zip.js";
import { sanitizeChildren, bytesToDataUrl, IMAGE_MIME, extOf, resolvePath, textOf } from "./sanitize.js";
import { renderMarkdown } from "../markdown.js";

export const FORMATS = {
  pdf: "PDF", epub: "EPUB", docx: "Word", txt: "Text", md: "Markdown", html: "Web page", image: "Image", cbz: "Comic",
};

const dec = new TextDecoder("utf-8");
const MAX_IMG = 3_000_000;

// ---- detection --------------------------------------------------------------------------

export async function detectFormat(file) {
  const name = file.name.toLowerCase();
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const isPdf = head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46;
  if (isPdf || name.endsWith(".pdf")) return "pdf";
  const isZip = head[0] === 0x50 && head[1] === 0x4b;
  if (isZip) {
    if (name.endsWith(".epub")) return "epub";
    if (name.endsWith(".docx")) return "docx";
    if (name.endsWith(".cbz")) return "cbz";
    try {
      const z = new Zip(await file.arrayBuffer());
      if (z.has("META-INF/container.xml")) return "epub";
      if (z.has("word/document.xml")) return "docx";
      if (z.names().some((n) => IMAGE_MIME[extOf(n)])) return "cbz";
    } catch { /* fall through */ }
  }
  if (/\.(md|markdown)$/.test(name)) return "md";
  if (/\.(html?|xhtml)$/.test(name)) return "html";
  if (/\.(png|jpe?g|gif|webp|bmp|avif)$/.test(name) || file.type.startsWith("image/")) return "image";
  if (/\.(txt|text|log|rtf)$/.test(name) || file.type.startsWith("text/")) return "txt";
  return null;
}

// ---- shared helpers ---------------------------------------------------------------------

const el = (tag, attrs = {}, kids = []) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v);
  for (const k of [].concat(kids)) n.append(k);
  return n;
};
const slugId = (s, i) => `h${i}-${s.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 30)}`;

// Split a flat container into chapters at h1/h2 headings; returns [{title, nodes[]}].
function splitByHeadings(root, { max = 160 } = {}) {
  const chapters = [];
  let cur = { title: "", nodes: [] };
  const flush = () => { if (cur.nodes.length) chapters.push(cur); };
  for (const child of [...root.children]) {
    const isHead = /^H[12]$/.test(child.tagName);
    if (isHead && cur.nodes.length) { flush(); cur = { title: "", nodes: [] }; }
    else if (cur.nodes.length >= max) { flush(); cur = { title: "", nodes: [] }; }
    if (isHead && !cur.title) cur.title = textOf(child);
    cur.nodes.push(child);
  }
  flush();
  chapters.forEach((c, i) => { if (!c.title) c.title = i === 0 ? "Beginning" : `Part ${i + 1}`; });
  return chapters;
}

function modelFromContainer({ title, author, root }) {
  const parts = splitByHeadings(root);
  const chapters = parts.map((p, i) => ({
    id: `c${i}`, title: p.title,
    load: async () => { const d = el("div"); p.nodes.forEach((n) => d.append(n.cloneNode(true))); return d; },
  }));
  const toc = [];
  parts.forEach((p, i) => {
    toc.push({ title: p.title, chapter: i, anchor: "", depth: 0 });
    for (const h of p.nodes.flatMap((n) => (/^H[2-3]$/.test(n.tagName) ? [n] : [...n.querySelectorAll?.("h2,h3") || []]))) {
      if (h === p.nodes[0]) continue;
      const t = textOf(h);
      if (t) toc.push({ title: t, chapter: i, anchor: h.id || "", depth: h.tagName === "H2" ? 1 : 2 });
    }
  });
  return { kind: "flow", title, author, cover: "", chapters, toc };
}

function tagHeadings(root) {
  let n = 0;
  for (const h of root.querySelectorAll("h1,h2,h3,h4")) if (!h.id) h.id = slugId(textOf(h), n++);
}

// ---- plain text -------------------------------------------------------------------------

export async function openText(buffer, name) {
  const text = dec.decode(new Uint8Array(buffer)).replace(/\r\n?/g, "\n");
  const root = el("div");
  const blocks = text.split(/\n{2,}/);
  const headingRe = /^(chapter|part|book|prologue|epilogue|appendix|section)\b.{0,60}$/i;
  for (const b of blocks) {
    const t = b.trim();
    if (!t) continue;
    const single = !t.includes("\n");
    if (single && (headingRe.test(t) || (t.length < 50 && t === t.toUpperCase() && /[A-Z]{3}/.test(t)))) root.append(el("h2", {}, t));
    else if (/^[-*•] /.test(t)) root.append(el("ul", {}, t.split("\n").map((l) => el("li", {}, l.replace(/^[-*•]\s+/, "")))));
    else if (t.split("\n").every((l) => l.startsWith("    ") || l.startsWith("\t"))) root.append(el("pre", {}, t));
    else root.append(el("p", {}, t.replace(/\n/g, " ")));
  }
  tagHeadings(root);
  return modelFromContainer({ title: name.replace(/\.[^.]+$/, ""), author: "", root });
}

// ---- Markdown / HTML --------------------------------------------------------------------

export async function openMarkdown(buffer, name) {
  const md = renderMarkdown(dec.decode(new Uint8Array(buffer)));
  tagHeadings(md);
  const h1 = md.querySelector("h1");
  return modelFromContainer({ title: (h1 && textOf(h1)) || name.replace(/\.[^.]+$/, ""), author: "", root: md });
}

export async function openHtml(buffer, name) {
  const doc = new DOMParser().parseFromString(dec.decode(new Uint8Array(buffer)), "text/html");
  const clean = el("div");
  sanitizeChildren(doc.body, clean, { resolveImg: (s) => (s.startsWith("data:image/") ? s : null) });
  tagHeadings(clean);
  return modelFromContainer({ title: doc.title || name.replace(/\.[^.]+$/, ""), author: "", root: clean });
}

// ---- images & comic archives ------------------------------------------------------------

export async function openImage(buffer, name, type) {
  const mime = type || IMAGE_MIME[extOf(name)] || "image/png";
  const url = bytesToDataUrl(new Uint8Array(buffer), mime);
  return {
    kind: "flow", title: name.replace(/\.[^.]+$/, ""), author: "", cover: "",
    chapters: [{ id: "c0", title: "Image", load: async () => el("div", { class: "lib-imgpage" }, [Object.assign(el("img", { alt: name }), { src: url })]) }],
    toc: [{ title: "Image", chapter: 0, anchor: "", depth: 0 }],
  };
}

export async function openComic(buffer, name) {
  const zip = new Zip(buffer);
  const pages = zip.names().filter((n) => IMAGE_MIME[extOf(n)] && !n.includes("__MACOSX")).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (!pages.length) throw new Error("No images found in that archive.");
  const chapters = pages.map((p, i) => ({
    id: `c${i}`, title: `Page ${i + 1}`,
    load: async () => {
      const b = await zip.bytesOf(p);
      if (b.length > 8_000_000) return el("p", {}, "This page is too large to display.");
      return el("div", { class: "lib-imgpage" }, [Object.assign(el("img", { alt: `Page ${i + 1}` }), { src: bytesToDataUrl(b, IMAGE_MIME[extOf(p)]) })]);
    },
  }));
  return { kind: "flow", title: name.replace(/\.[^.]+$/, ""), author: "", cover: "", chapters, toc: chapters.map((c, i) => ({ title: c.title, chapter: i, anchor: "", depth: 0 })) };
}

// ---- EPUB -------------------------------------------------------------------------------

const xml = (text) => new DOMParser().parseFromString(text, "application/xml");
const q1 = (doc, sel) => doc.querySelector(sel);
const byLocal = (root, name) => [...root.getElementsByTagName("*")].filter((e) => e.localName === name);

export async function openEpub(buffer) {
  const zip = new Zip(buffer);
  const container = xml(await zip.text("META-INF/container.xml"));
  const opfPath = byLocal(container, "rootfile")[0]?.getAttribute("full-path");
  if (!opfPath) throw new Error("This EPUB has no content file.");
  const opf = xml(await zip.text(opfPath));
  const title = textOf(byLocal(opf, "title")[0] || { textContent: "" }) || "Untitled";
  const author = byLocal(opf, "creator").map(textOf).filter(Boolean).join(", ");

  const manifest = new Map();
  for (const it of byLocal(opf, "item")) manifest.set(it.getAttribute("id"), { href: it.getAttribute("href"), type: it.getAttribute("media-type") || "", props: it.getAttribute("properties") || "" });
  const spine = byLocal(opf, "itemref").map((r) => manifest.get(r.getAttribute("idref"))).filter((m) => m && /x?html|xml/i.test(m.type));
  if (!spine.length) throw new Error("This EPUB has no readable chapters.");
  const pathOf = (item) => resolvePath(opfPath, item.href);
  const fileToChapter = new Map(spine.map((m, i) => [pathOf(m), i]));

  // cover image
  let cover = "";
  try {
    const coverId = byLocal(opf, "meta").find((m) => m.getAttribute("name") === "cover")?.getAttribute("content");
    const item = (coverId && manifest.get(coverId)) || [...manifest.values()].find((m) => m.props.includes("cover-image"));
    if (item) { const b = await zip.bytesOf(pathOf(item)); if (b && b.length < MAX_IMG) cover = await thumb(bytesToDataUrl(b, IMAGE_MIME[extOf(item.href)] || "image/jpeg")); }
  } catch { /* no cover */ }

  const imageCache = new Map();
  async function imageData(base, src) {
    if (src.startsWith("data:image/")) return src;
    const path = resolvePath(base, src);
    if (!path) return null;
    if (imageCache.has(path)) return imageCache.get(path);
    let data = null;
    try {
      const b = await zip.bytesOf(path);
      const mime = IMAGE_MIME[extOf(path)];
      if (b && mime && b.length < MAX_IMG) data = bytesToDataUrl(b, mime);
    } catch { /* skip image */ }
    imageCache.set(path, data);
    return data;
  }

  const titles = new Map();
  const chapters = spine.map((m, i) => ({
    id: `c${i}`, title: "",
    load: async () => {
      const path = pathOf(m);
      const raw = await zip.text(path);
      let doc = new DOMParser().parseFromString(raw, "application/xhtml+xml");
      if (doc.querySelector("parsererror")) doc = new DOMParser().parseFromString(raw, "text/html");
      const body = doc.body || doc.documentElement;
      const srcs = new Map();
      for (const im of [...body.querySelectorAll("img")].map((n) => n.getAttribute("src")).concat([...body.querySelectorAll("image")].map((n) => n.getAttribute("xlink:href") || n.getAttribute("href")))) {
        if (im && !srcs.has(im)) srcs.set(im, await imageData(path, im));
      }
      const out = el("div");
      sanitizeChildren(body, out, {
        idPrefix: `c${i}-`,
        resolveImg: (s) => srcs.get(s) || null,
        resolveHref: (h) => {
          const target = resolvePath(path, h);
          const idx = target ? fileToChapter.get(target) : null;
          const anchor = h.includes("#") ? h.split("#")[1] : "";
          if (idx != null) return { chapter: idx, anchor: anchor ? `c${idx}-${anchor}` : "" };
          if (h.startsWith("#")) return { chapter: i, anchor: `c${i}-${h.slice(1)}` };
          return null;
        },
      });
      const h = out.querySelector("h1,h2,h3");
      if (h && !titles.has(i)) titles.set(i, textOf(h));
      return out;
    },
  }));

  // table of contents: EPUB 3 nav document, else EPUB 2 NCX
  let toc = [];
  try {
    const nav = [...manifest.values()].find((m) => m.props.includes("nav"));
    const ncx = [...manifest.values()].find((m) => /ncx/i.test(m.type));
    if (nav) {
      const navPath = pathOf(nav);
      const doc = new DOMParser().parseFromString(await zip.text(navPath), "application/xhtml+xml");
      const list = [...doc.querySelectorAll("nav")].find((n) => (n.getAttribute("epub:type") || n.getAttribute("type") || "").includes("toc")) || doc.querySelector("nav");
      const walk = (ol, depth) => {
        for (const li of ol.children) {
          const a = li.querySelector(":scope > a, :scope > span");
          if (a) toc.push(tocEntry(navPath, a.getAttribute("href"), textOf(a), depth));
          const sub = li.querySelector(":scope > ol");
          if (sub) walk(sub, depth + 1);
        }
      };
      const top = list?.querySelector("ol");
      if (top) walk(top, 0);
    } else if (ncx) {
      const ncxPath = pathOf(ncx);
      const doc = xml(await zip.text(ncxPath));
      const walk = (parent, depth) => {
        for (const np of [...parent.children].filter((c) => c.localName === "navPoint")) {
          const label = textOf(byLocal(np, "text")[0] || { textContent: "" });
          const src = byLocal(np, "content")[0]?.getAttribute("src");
          if (src) toc.push(tocEntry(ncxPath, src, label, depth));
          walk(np, depth + 1);
        }
      };
      const map = byLocal(doc, "navMap")[0];
      if (map) walk(map, 0);
    }
  } catch { /* fall back to chapter list */ }
  function tocEntry(basePath, href, label, depth) {
    const target = resolvePath(basePath, href);
    const idx = fileToChapter.get(target);
    const frag = href.includes("#") ? href.split("#")[1] : "";
    return idx == null ? null : { title: label, chapter: idx, anchor: frag ? `c${idx}-${frag}` : "", depth };
  }
  toc = toc.filter(Boolean);
  // chapter titles come from the TOC when it has them
  for (const t of toc) if (!t.anchor && !titles.has(t.chapter)) titles.set(t.chapter, t.title);
  chapters.forEach((c, i) => Object.defineProperty(c, "title", { get: () => titles.get(i) || `Section ${i + 1}`, enumerable: true }));
  if (!toc.length) toc = chapters.map((c, i) => ({ title: `Section ${i + 1}`, chapter: i, anchor: "", depth: 0 }));
  return { kind: "flow", title, author, cover, chapters, toc };
}

// ---- DOCX -------------------------------------------------------------------------------

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const wq = (node, name) => [...node.children].filter((c) => c.localName === name && c.namespaceURI === W);
const wfirst = (node, name) => wq(node, name)[0] || null;
const wattr = (node, name) => node?.getAttributeNS(W, name) ?? node?.getAttribute(`w:${name}`) ?? null;

export async function openDocx(buffer, name) {
  const zip = new Zip(buffer);
  const doc = xml(await zip.text("word/document.xml"));
  const styles = zip.has("word/styles.xml") ? xml(await zip.text("word/styles.xml")) : null;
  const rels = zip.has("word/_rels/document.xml.rels") ? xml(await zip.text("word/_rels/document.xml.rels")) : null;
  const relMap = new Map(rels ? byLocal(rels, "Relationship").map((r) => [r.getAttribute("Id"), { target: r.getAttribute("Target"), mode: r.getAttribute("TargetMode") }]) : []);

  const styleName = new Map();
  if (styles) for (const s of byLocal(styles, "style")) styleName.set(wattr(s, "styleId"), (wattr(wfirst(s, "name"), "val") || "").toLowerCase());

  const images = new Map();
  async function imageFor(rid) {
    if (images.has(rid)) return images.get(rid);
    const rel = relMap.get(rid);
    let data = null;
    if (rel && !rel.mode) {
      try {
        const path = resolvePath("word/document.xml", rel.target);
        const b = await zip.bytesOf(path);
        const mime = IMAGE_MIME[extOf(path)];
        if (b && mime && b.length < MAX_IMG) data = bytesToDataUrl(b, mime);
      } catch { /* skip */ }
    }
    images.set(rid, data);
    return data;
  }

  async function runs(p) {
    const frag = document.createDocumentFragment();
    for (const child of p.children) {
      if (child.localName === "hyperlink") {
        const a = el("a");
        const rid = child.getAttribute("r:id") || child.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
        const url = rid && relMap.get(rid)?.target;
        if (url && /^(https?:|mailto:)/i.test(url)) { a.href = url; a.target = "_blank"; a.rel = "noopener noreferrer nofollow"; }
        a.append(await runs(child));
        frag.append(a);
      } else if (child.localName === "r") {
        const rpr = wfirst(child, "rPr");
        let node = null;
        for (const rc of child.children) {
          if (rc.localName === "t") node = (node || document.createDocumentFragment()), node.append(document.createTextNode(rc.textContent));
          else if (rc.localName === "tab") (node ||= document.createDocumentFragment()).append(document.createTextNode(" "));
          else if (rc.localName === "br" || rc.localName === "cr") (node ||= document.createDocumentFragment()).append(el("br"));
          else if (rc.localName === "drawing" || rc.localName === "pict") {
            const blip = [...rc.getElementsByTagName("*")].find((e) => e.localName === "blip");
            const rid = blip?.getAttribute("r:embed") || blip?.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "embed");
            const data = rid && (await imageFor(rid));
            if (data) (node ||= document.createDocumentFragment()).append(Object.assign(el("img", { alt: "" }), { src: data }));
          }
        }
        if (!node) continue;
        const on = (n) => { const e = wfirst(rpr || document.createElement("x"), n); return e && wattr(e, "val") !== "0" && wattr(e, "val") !== "false"; };
        let out = node;
        const wrapIn = (tag) => { const w = el(tag); w.append(out); out = w; };
        if (rpr) {
          if (on("b")) wrapIn("strong");
          if (on("i")) wrapIn("em");
          if (wfirst(rpr, "u") && wattr(wfirst(rpr, "u"), "val") !== "none") wrapIn("u");
          if (on("strike")) wrapIn("s");
          const va = wattr(wfirst(rpr, "vertAlign"), "val");
          if (va === "superscript") wrapIn("sup"); else if (va === "subscript") wrapIn("sub");
        }
        frag.append(out);
      }
    }
    return frag;
  }

  const root = el("div");
  let list = null, listNum = null, headingN = 0;

  async function paragraph(p) {
    const ppr = wfirst(p, "pPr");
    const sid = wattr(wfirst(ppr || document.createElement("x"), "pStyle"), "val") || "";
    const sname = styleName.get(sid) || sid.toLowerCase();
    const outline = parseInt(wattr(wfirst(ppr || document.createElement("x"), "outlineLvl"), "val"), 10);
    let level = 0;
    const m = /heading\s*([1-6])/.exec(sname);
    if (m) level = Number(m[1]); else if (sname === "title") level = 1; else if (sname === "subtitle") level = 2; else if (!Number.isNaN(outline)) level = outline + 1;
    const numPr = ppr && wfirst(ppr, "numPr");
    const body = await runs(p);
    const isEmpty = !body.textContent.trim() && !body.querySelector?.("img");
    if (isEmpty) { list = null; return null; }
    if (level) {
      list = null;
      const h = el(`h${Math.min(6, level)}`);
      h.id = `d${headingN++}`;
      h.append(body);
      return h;
    }
    if (numPr) {
      const ordered = /number|decimal|ordered/.test(sname);
      const id = wattr(wfirst(numPr, "numId"), "val");
      if (!list || listNum !== id) { list = el(ordered ? "ol" : "ul"); listNum = id; const li = el("li"); li.append(body); list.append(li); return list; }
      const li = el("li"); li.append(body); list.append(li);
      return null;
    }
    list = null;
    const quote = /quote/.test(sname);
    const tag = quote ? "blockquote" : /code|preformatted/.test(sname) ? "pre" : "p";
    const node = el(tag);
    node.append(body);
    const jc = wattr(wfirst(ppr || document.createElement("x"), "jc"), "val");
    if (jc === "center") node.style.textAlign = "center";
    return node;
  }

  async function table(tbl) {
    const t = el("table");
    for (const tr of wq(tbl, "tr")) {
      const row = el("tr");
      for (const tc of wq(tr, "tc")) {
        const cell = el("td");
        for (const p of wq(tc, "p")) { const n = await paragraph(p); if (n) { if (n.tagName === "P") { const d = el("div"); d.append(...n.childNodes); cell.append(d); } else cell.append(n); } }
        row.append(cell);
      }
      t.append(row);
    }
    return t;
  }

  const bodyEl = byLocal(doc, "body")[0];
  for (const child of bodyEl.children) {
    if (child.localName === "p") { const n = await paragraph(child); if (n) root.append(n); }
    else if (child.localName === "tbl") { list = null; root.append(await table(child)); }
  }
  const first = root.querySelector("h1");
  let author = "";
  try { const core = zip.has("docProps/core.xml") ? xml(await zip.text("docProps/core.xml")) : null; author = core ? textOf(byLocal(core, "creator")[0] || { textContent: "" }) : ""; } catch { /* none */ }
  return modelFromContainer({ title: (first && textOf(first)) || name.replace(/\.[^.]+$/, ""), author, root });
}

// ---- entry point ------------------------------------------------------------------------

export async function openFlowBook(format, buffer, name, type) {
  switch (format) {
    case "epub": return openEpub(buffer);
    case "docx": return openDocx(buffer, name);
    case "md": return openMarkdown(buffer, name);
    case "html": return openHtml(buffer, name);
    case "image": return openImage(buffer, name, type);
    case "cbz": return openComic(buffer, name);
    default: return openText(buffer, name);
  }
}

// Downscale a data: image to a small JPEG for use as a shelf cover.
export function thumb(dataUrl, width = 220) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onerror = () => resolve("");
    img.onload = () => {
      const scale = Math.min(1, width / img.width);
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(img.width * scale));
      c.height = Math.max(1, Math.round(img.height * scale));
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL("image/jpeg", 0.8));
    };
    img.src = dataUrl;
  });
}

void q1;
