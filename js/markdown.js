// A small, safe Markdown renderer used by the rules reader, the compendium,
// the Pokémon D&D Rulebook and the Library's .md/.txt viewer. It builds DOM
// nodes directly (never innerHTML) and does not pass raw HTML through, so
// untrusted text -- an uploaded file, a note a player typed -- can't inject
// markup.
//
// Supported: # headings, paragraphs, **bold**, *italic*, `code`, ~~strike~~,
// ordered/unordered/nested lists, > quotes and Obsidian callouts
// (> [!note] Title), pipe tables, fenced code, horizontal rules, links,
// images (data: URIs and same-origin only) and [[wikilinks|alias]].

const SAFE_URL = /^(https?:|mailto:|#|\/|\.\/|\.\.\/|[a-z0-9_-]+(\/|\.|$))/i;
const SAFE_IMG = /^(data:image\/(png|jpe?g|gif|webp|svg\+xml);|\/|\.\/|[a-z0-9_-]+\/)/i;

function node(tag, attrs, children) {
  const n = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v);
  for (const c of [].concat(children ?? [])) if (c != null) n.append(c);
  return n;
}

// -------------------------------------------------------------- inline

// opts.wikilink(target, alias) -> { href?, title?, onClick? } | null
export function renderInline(text, opts = {}) {
  const frag = document.createDocumentFragment();
  const re = /(`[^`]+`)|(\*\*[^*]+?\*\*)|(__[^_]+?__)|(\*[^*\s][^*]*?\*)|(~~[^~]+?~~)|(!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\))|(\[\[([^\]|]+)(?:\|([^\]]+))?\]\])|(\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\))|(https?:\/\/[^\s<>)\]]+)/g;
  let last = 0, m;
  const str = String(text ?? "");
  while ((m = re.exec(str))) {
    if (m.index > last) frag.append(str.slice(last, m.index));
    if (m[1]) frag.append(node("code", null, m[1].slice(1, -1)));
    else if (m[2]) frag.append(node("strong", null, renderInline(m[2].slice(2, -2), opts)));
    else if (m[3]) frag.append(node("strong", null, renderInline(m[3].slice(2, -2), opts)));
    else if (m[4]) frag.append(node("em", null, renderInline(m[4].slice(1, -1), opts)));
    else if (m[5]) frag.append(node("del", null, m[5].slice(2, -2)));
    else if (m[6]) {
      const src = m[8];
      if (SAFE_IMG.test(src)) frag.append(node("img", { src: opts.resolveImage ? opts.resolveImage(src) : src, alt: m[7] || "", loading: "lazy" }));
      else frag.append(m[7] || "");
    } else if (m[9]) {
      const target = m[10].trim();
      const alias = (m[11] || target).trim();
      const res = opts.wikilink ? opts.wikilink(target, alias) : null;
      if (res && (res.href || res.onClick)) {
        const a = node("a", { href: res.href || "#", class: "md-wikilink", title: res.title || null }, alias);
        if (res.onClick) a.addEventListener("click", (e) => { e.preventDefault(); res.onClick(); });
        frag.append(a);
      } else frag.append(node("span", { class: "md-wikilink missing" }, alias));
    } else if (m[12]) {
      const href = m[14];
      if (SAFE_URL.test(href)) {
        const external = /^https?:/i.test(href);
        const a = node("a", { href, ...(external ? { target: "_blank", rel: "noopener noreferrer" } : {}) }, renderInline(m[13], opts));
        if (href.startsWith("#") && opts.onHash) a.addEventListener("click", (e) => { e.preventDefault(); opts.onHash(href.slice(1)); });
        frag.append(a);
      } else frag.append(m[13]);
    } else if (m[15]) {
      frag.append(node("a", { href: m[15], target: "_blank", rel: "noopener noreferrer" }, m[15]));
    }
    last = re.lastIndex;
  }
  if (last < str.length) frag.append(str.slice(last));
  return frag;
}

// -------------------------------------------------------------- blocks

const isTableRow = (l) => /^\s*\|.*\|\s*$/.test(l);
const isTableSep = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
const listMatch = (l) => /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(l);

function splitRow(line) {
  let t = line.trim();
  if (t.startsWith("|")) t = t.slice(1);
  if (t.endsWith("|")) t = t.slice(0, -1);
  return t.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
}

function renderTable(lines, opts) {
  const head = splitRow(lines[0]);
  const aligns = splitRow(lines[1]).map((c) => (c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : ""));
  const table = node("table", { class: "md-table" });
  const thead = node("thead", null, node("tr", null, head.map((h, i) => node("th", aligns[i] ? { style: `text-align:${aligns[i]}` } : null, renderInline(h, opts)))));
  const tbody = node("tbody");
  for (const line of lines.slice(2)) {
    const cells = splitRow(line);
    tbody.append(node("tr", null, head.map((_, i) => node("td", aligns[i] ? { style: `text-align:${aligns[i]}` } : null, renderInline(cells[i] ?? "", opts)))));
  }
  table.append(thead, tbody);
  return node("div", { class: "md-table-wrap" }, table);
}

function renderList(items, opts) {
  // items: [{ indent, ordered, text, children... }] flat; build nested structure
  const root = node(items[0].ordered ? "ol" : "ul", { class: "md-list" });
  const stack = [{ indent: items[0].indent, el: root }];
  let lastLi = null;
  for (const it of items) {
    let top = stack[stack.length - 1];
    if (it.indent > top.indent && lastLi) {
      const sub = node(it.ordered ? "ol" : "ul", { class: "md-list" });
      lastLi.append(sub);
      stack.push({ indent: it.indent, el: sub });
      top = stack[stack.length - 1];
    } else {
      while (stack.length > 1 && it.indent < top.indent) { stack.pop(); top = stack[stack.length - 1]; }
    }
    const li = node("li", null, renderInline(it.text, opts));
    top.el.append(li);
    lastLi = li;
  }
  return root;
}

// Obsidian-style callout: "> [!note] Title" followed by quoted lines.
function renderQuote(lines, opts) {
  const inner = lines.map((l) => l.replace(/^\s*>\s?/, ""));
  const callout = /^\[!([a-z-]+)\][+-]?\s*(.*)$/i.exec(inner[0]);
  if (callout) {
    const kind = callout[1].toLowerCase();
    const title = callout[2] || kind.charAt(0).toUpperCase() + kind.slice(1);
    const box = node("div", { class: `md-callout md-callout-${kind}` });
    box.append(node("div", { class: "md-callout-title" }, renderInline(title, opts)));
    const body = renderBlocks(inner.slice(1).join("\n"), opts);
    body.classList.add("md-callout-body");
    box.append(body);
    return box;
  }
  const bq = node("blockquote");
  bq.append(...renderBlocks(inner.join("\n"), opts).childNodes);
  return bq;
}

export function renderBlocks(src, opts = {}) {
  const out = node("div", { class: "md-blocks" });
  const lines = String(src ?? "").replace(/\r\n?/g, "\n").split("\n");
  let i = 0;
  const hid = opts.headingIds ? (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") : null;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    // fenced code
    const fence = /^\s*(```|~~~)\s*([\w-]*)/.exec(line);
    if (fence) {
      const buf = [];
      i++;
      while (i < lines.length && !new RegExp(`^\\s*${fence[1]}`).test(lines[i])) buf.push(lines[i++]);
      i++;
      if (fence[2] === "dataview") { out.append(node("p", { class: "md-note" }, "(dynamic list)")); continue; }
      out.append(node("pre", { class: "md-code" }, node("code", null, buf.join("\n"))));
      continue;
    }
    // heading
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) {
      const level = Math.min(6, h[1].length + (opts.headingOffset || 0));
      const hn = node(`h${level}`, hid ? { id: hid(h[2]) } : null, renderInline(h[2], opts));
      out.append(hn);
      i++;
      continue;
    }
    // horizontal rule
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { out.append(node("hr")); i++; continue; }
    // table
    if (isTableRow(line) && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const buf = [line, lines[i + 1]];
      i += 2;
      while (i < lines.length && isTableRow(lines[i])) buf.push(lines[i++]);
      out.append(renderTable(buf, opts));
      continue;
    }
    // quote / callout
    if (/^\s*>/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++]);
      out.append(renderQuote(buf, opts));
      continue;
    }
    // list
    if (listMatch(line)) {
      const items = [];
      while (i < lines.length) {
        const mm = listMatch(lines[i]);
        if (mm) { items.push({ indent: mm[1].replace(/\t/g, "    ").length, ordered: /\d/.test(mm[2]), text: mm[3] }); i++; }
        else if (/^\s{2,}\S/.test(lines[i]) && items.length && !listMatch(lines[i])) { items[items.length - 1].text += ` ${lines[i].trim()}`; i++; }
        else break;
      }
      out.append(renderList(items, opts));
      continue;
    }
    // paragraph (consecutive non-blank, non-special lines)
    const buf = [line];
    i++;
    while (i < lines.length && lines[i].trim() && !/^\s*(#{1,6}\s|>|```|~~~)/.test(lines[i]) && !listMatch(lines[i]) && !(isTableRow(lines[i]) && i + 1 < lines.length && isTableSep(lines[i + 1])) && !/^\s*([-*_])(\s*\1){2,}\s*$/.test(lines[i])) buf.push(lines[i++]);
    const p = node("p");
    buf.forEach((l, idx) => {
      if (idx) p.append(opts.softBreaks ? node("br") : " ");
      p.append(renderInline(l.trim().replace(/\s{2,}$/, ""), opts));
    });
    out.append(p);
  }
  return out;
}

// renderMarkdown(src, opts) -> <div class="md"> ... </div>
export function renderMarkdown(src, opts = {}) {
  const text = stripFrontMatter(String(src ?? ""));
  const root = renderBlocks(text, opts);
  root.className = "md";
  return root;
}

export function stripFrontMatter(text) {
  const m = /^---\s*\n[\s\S]*?\n---\s*(\n|$)/.exec(text);
  return m ? text.slice(m[0].length) : text;
}

// Frontmatter key/values (very small YAML subset) for the rulebook exporter on the JS side.
export function frontMatter(text) {
  const m = /^---\s*\n([\s\S]*?)\n---\s*(\n|$)/.exec(text);
  if (!m) return {};
  const out = {};
  for (const line of m[1].split("\n")) {
    const kv = /^([\w-]+):\s*(.*)$/.exec(line);
    if (kv) out[kv[1]] = kv[2].replace(/^\[|\]$/g, "").trim();
  }
  return out;
}

// SRD data stores descriptions as an array of paragraph strings where list items
// ("- ...") and table rows ("| ... |") are separate entries. Rejoin runs of those
// so the Markdown parser sees one list/table.
export function joinParagraphs(arr) {
  if (!Array.isArray(arr)) return String(arr ?? "");
  let out = "";
  let prevKind = "";
  for (const raw of arr) {
    const s = String(raw);
    const kind = /^\s*[-*+]\s/.test(s) ? "list" : /^\s*\|/.test(s) ? "table" : "para";
    if (!out) out = s;
    else out += (kind !== "para" && kind === prevKind ? "\n" : "\n\n") + s;
    prevKind = kind;
  }
  return out;
}

export function renderDesc(arr, opts = {}) {
  const root = renderBlocks(joinParagraphs(arr), opts);
  root.className = "md";
  return root;
}

// Plain text of a markdown string (for search indexes and snippets).
export function plainText(src) {
  return String(src ?? "")
    .replace(/^---[\s\S]*?\n---\s*/, "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[\[([^\]|]+)\|?([^\]]*)\]\]/g, (_, a, b) => b || a)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`~|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
