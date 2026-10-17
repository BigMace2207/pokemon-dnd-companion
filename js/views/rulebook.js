// The Pokémon D&D rulebook: the pages written in the Obsidian vault, exported to
// data/pokemon-dnd/rulebook.json by tools/export_rulebook.py and rendered here.
// A contents list, full-text search, next/previous, and shortcuts to the matching calculators.

import { el } from "../components.js";
import { renderMarkdown } from "../markdown.js";
import { getViewState, setViewState } from "../viewState.js";

let dataPromise = null;
const load = () => (dataPromise ||= fetch("data/pokemon-dnd/rulebook.json").then((r) => { if (!r.ok) throw new Error(`Couldn't load the rulebook (${r.status}). Run tools/export_rulebook.py.`); return r.json(); }).catch((e) => { dataPromise = null; throw e; }));

// Which app pages are relevant to which rulebook pages.
const TOOLS = {
  "types-and-stats": [["statcalc", "Stat Calculator"], ["typechart", "Type Chart"]],
  "types-and-stats-continued": [["statcalc", "Stat Calculator"], ["tierguide", "Move Tier Guide"]],
  "how-a-turn-works": [["damagecalc", "Damage Calculator"], ["moves", "Move Dex"]],
  "make-your-trainer": [["trainer", "Trainer Sheet"]],
  "make-your-trainer-continued": [["trainer", "Trainer Sheet"], ["team", "My Team"]],
  "formulas": [["damagecalc", "Damage Calculator"], ["statcalc", "Stat Calculator"]],
  "glossary": [["pokedex", "Pokédex"], ["moves", "Move Dex"]],
  "type-chart": [["typechart", "Type Chart"], ["damagecalc", "Damage Calculator"]],
};

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function renderRulebook(container) {
  container.replaceChildren(el("h1", { class: "view-title" }, "Rulebook"), el("p", { class: "view-sub" }, "Loading the rulebook…"));
  load().then((book) => build(container, book)).catch((err) => {
    container.replaceChildren(el("h1", { class: "view-title" }, "Rulebook"), el("div", { class: "card" }, el("p", { class: "view-sub" }, err.message)));
  });
}

function build(container, book) {
  const pages = book.pages;
  const byId = new Map(pages.map((p) => [p.id, p]));
  const byName = new Map();
  for (const p of pages) { byName.set(norm(p.file), p); byName.set(norm(p.file.replace(/^\d+\s*/, "")), p); byName.set(norm(p.title), p); }
  let current = getViewState("rulebook:page", null);
  if (!byId.has(current)) current = pages.find((p) => p.id !== "contents")?.id || pages[0].id;

  const nav = el("nav", { class: "rb-nav", "aria-label": "Rulebook contents" });
  const body = el("div", { class: "card rb-page" });
  const search = el("input", { type: "search", placeholder: "Search the rulebook…", autocomplete: "off", "aria-label": "Search the rulebook" });
  const results = el("div", { class: "rb-results" });

  const wikilink = (target, alias) => {
    const name = target.split("/").pop();
    const page = byName.get(norm(name));
    if (!page) return null;
    return { href: "#", title: page.title, onClick: () => show(page.id) };
  };

  function drawNav() {
    nav.replaceChildren(...pages.map((p) => {
      const b = el("button", { type: "button", class: `rb-nav-item${p.id === current ? " active" : ""}`, "aria-current": p.id === current ? "page" : null }, [p.icon ? el("span", { class: "rb-icon", "aria-hidden": "true" }, p.icon) : null, p.title].filter(Boolean));
      b.addEventListener("click", () => show(p.id));
      return b;
    }));
  }

  function show(id, { scroll = true } = {}) {
    const page = byId.get(id);
    if (!page) return;
    current = id;
    setViewState("rulebook:page", id);
    drawNav();
    const parts = page.md.split("::contents::");
    const nodes = [];
    nodes.push(renderMarkdown(parts[0], { wikilink, headingIds: true }));
    if (parts.length > 1) {
      nodes.push(el("div", { class: "rb-contents" }, pages.filter((p) => p.id !== "contents").map((p) => {
        const b = el("button", { type: "button", class: "rb-contents-item" }, [p.icon ? el("span", { class: "rb-icon", "aria-hidden": "true" }, p.icon) : null, el("span", {}, p.title)].filter(Boolean));
        b.addEventListener("click", () => show(p.id));
        return b;
      })), renderMarkdown(parts[1], { wikilink }));
    }
    const i = pages.findIndex((p) => p.id === id);
    const prev = pages[i - 1], next = pages[i + 1];
    const tools = TOOLS[id] || [];
    body.replaceChildren(
      ...nodes,
      tools.length ? el("div", { class: "rb-tools" }, [el("strong", {}, "Related tools: "), ...tools.map(([view, label]) => { const b = el("button", { class: "btn secondary" }, label); b.addEventListener("click", () => { location.hash = view; }); return b; })]) : null,
      el("div", { class: "rb-pager" }, [
        prev ? pagerBtn("←", prev) : el("span"),
        next ? pagerBtn("→", next) : el("span"),
      ]),
    );
    if (scroll) { container.closest("main")?.scrollTo?.(0, 0); body.scrollIntoView({ block: "start" }); }
  }
  const pagerBtn = (arrow, p) => { const b = el("button", { class: "btn secondary" }, arrow === "←" ? `← ${p.title}` : `${p.title} →`); b.addEventListener("click", () => show(p.id)); return b; };

  function runSearch() {
    const q = search.value.trim().toLowerCase();
    results.replaceChildren();
    if (q.length < 2) return;
    const hits = [];
    for (const p of pages) {
      const text = p.md.replace(/[#>*`|\[\]]/g, " ").replace(/\s+/g, " ");
      const low = text.toLowerCase();
      let at = low.indexOf(q);
      if (at < 0 && !p.title.toLowerCase().includes(q)) continue;
      hits.push({ p, snippet: at >= 0 ? `…${text.slice(Math.max(0, at - 50), at + q.length + 90)}…` : "" });
    }
    results.replaceChildren(...(hits.length ? hits.map(({ p, snippet }) => {
      const b = el("button", { type: "button", class: "rb-result" }, [el("strong", {}, `${p.icon || ""} ${p.title}`), snippet ? el("span", { class: "view-sub" }, snippet) : null].filter(Boolean));
      b.addEventListener("click", () => { show(p.id); search.value = ""; results.replaceChildren(); });
      return b;
    }) : [el("p", { class: "view-sub" }, "Nothing in the rulebook matches that.")]));
  }
  search.addEventListener("input", runSearch);

  container.replaceChildren(
    el("h1", { class: "view-title" }, book.title || "Rulebook"),
    el("p", { class: "view-sub" }, `The ${pages.length - 1}-page rules reference for this game. Last updated ${book.exported}.`),
    el("div", { class: "rb-layout" }, [
      el("div", { class: "rb-side" }, [el("div", { class: "card rb-side-card" }, [search, results, nav])]),
      body,
    ]),
  );
  drawNav();
  show(current, { scroll: false });
}
