// Turns untrusted book markup (EPUB XHTML, HTML files) into a clean DOM subtree.
// It builds new elements from an allow-list rather than cleaning the original in place:
// no scripts, styles, event handlers, forms, frames or remote resources can survive.
// Images are only kept when the caller resolves them to data: URIs (the CSP forbids the rest).

const KEEP = new Set("p div span h1 h2 h3 h4 h5 h6 ul ol li blockquote pre code em strong b i u s del ins sub sup br hr a img table thead tbody tfoot tr td th caption figure figcaption dl dt dd small cite abbr q mark kbd samp var time".split(" "));
const FLATTEN = new Set("section article aside header footer main nav body html center font label details summary address hgroup colgroup".split(" "));
const DROP = new Set("script style link meta head title iframe frame frameset object embed applet form input button select textarea option svg math canvas audio video source track noscript template base map area".split(" "));

const SAFE_URL = /^(https?:|mailto:)/i;

// ctx: { resolveImg(src) -> dataURL|null, resolveHref(href) -> {chapter, anchor}|null, idPrefix }
export function sanitizeChildren(src, dest, ctx = {}) {
  for (const node of src.childNodes) {
    if (node.nodeType === 3) { dest.appendChild(document.createTextNode(node.nodeValue)); continue; }
    if (node.nodeType !== 1) continue;
    const tag = node.localName.toLowerCase();
    if (DROP.has(tag)) {
      // an SVG cover page is common in EPUBs: keep its <image> as a normal picture
      if (tag === "svg") {
        const im = node.querySelector("image");
        const href = im && (im.getAttribute("xlink:href") || im.getAttribute("href"));
        const data = href && ctx.resolveImg?.(href);
        if (data) { const img = document.createElement("img"); img.src = data; img.alt = "Cover"; dest.appendChild(img); }
      }
      continue;
    }
    if (FLATTEN.has(tag) || !KEEP.has(tag)) { sanitizeChildren(node, dest, ctx); continue; }
    if (tag === "img") {
      const data = ctx.resolveImg?.(node.getAttribute("src") || "");
      if (!data) continue;
      const img = document.createElement("img");
      img.src = data;
      img.alt = node.getAttribute("alt") || "";
      img.loading = "lazy";
      dest.appendChild(img);
      continue;
    }
    const out = document.createElement(tag);
    const id = node.getAttribute("id");
    if (id) out.id = `${ctx.idPrefix || ""}${id}`;
    if (tag === "a") {
      const href = node.getAttribute("href") || "";
      if (SAFE_URL.test(href)) { out.href = href; out.target = "_blank"; out.rel = "noopener noreferrer nofollow"; }
      else if (href) {
        const hit = ctx.resolveHref?.(href);
        if (hit) { out.href = "#"; out.dataset.chapter = String(hit.chapter); if (hit.anchor) out.dataset.anchor = hit.anchor; }
      }
    }
    if (tag === "td" || tag === "th") {
      for (const a of ["colspan", "rowspan"]) { const v = parseInt(node.getAttribute(a), 10); if (v > 1 && v < 50) out.setAttribute(a, String(v)); }
    }
    sanitizeChildren(node, out, ctx);
    dest.appendChild(out);
  }
  return dest;
}

export function bytesToDataUrl(bytes, mime) {
  let bin = "";
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return `data:${mime};base64,${btoa(bin)}`;
}

export const IMAGE_MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp", avif: "image/avif" };
export const extOf = (name) => (/\.([a-z0-9]+)(?:[?#].*)?$/i.exec(name) || [])[1]?.toLowerCase() || "";
// resolve a relative href against a base file path inside an archive
export function resolvePath(base, href) {
  const clean = decodeURIComponent(href.split("#")[0].split("?")[0]);
  if (/^[a-z]+:/i.test(clean)) return null;
  const parts = (clean.startsWith("/") ? clean.slice(1) : `${base.includes("/") ? base.slice(0, base.lastIndexOf("/") + 1) : ""}${clean}`).split("/");
  const out = [];
  for (const p of parts) { if (p === "..") out.pop(); else if (p && p !== ".") out.push(p); }
  return out.join("/");
}

export function textOf(node) { return (node.textContent || "").replace(/\s+/g, " ").trim(); }
