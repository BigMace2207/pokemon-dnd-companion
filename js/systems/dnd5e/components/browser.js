// A searchable, filterable list with a detail pane -- the shape every compendium
// page (spells, monsters, items, classes, ...) shares.
//
//   browser({
//     items,                         // array
//     id: (item) => string,          // stable id
//     label: (item) => string,       // list text
//     meta: (item) => string,        // small right-aligned text
//     search: (item) => string,      // text the search box matches (defaults to label)
//     group: (item) => string,       // optional group header
//     groupOrder: [..],              // optional header ordering
//     filters: [{ key, label, options: [[value,label]], test: (item, value) => bool }],
//     toggles: [{ key, label, test: (item) => bool }],
//     sorts: [{ id, label, cmp }],
//     detail: (item, helpers) => Node,
//     stateKey: "dnd:spells",        // remembers search/filters/selection while you navigate
//   })

import { el, field, selectEl, checkbox } from "../ui.js";
import { getViewState, setViewState } from "../../../viewState.js";

export function browser(cfg) {
  const sk = cfg.stateKey;
  const saved = (sk && getViewState(sk, null)) || {};
  const st = { q: saved.q || "", filters: saved.filters || {}, toggles: saved.toggles || {}, sort: saved.sort || cfg.sorts?.[0]?.id, sel: saved.sel || null };
  const persist = () => { if (sk) setViewState(sk, st); };

  const searchInput = el("input", { type: "text", placeholder: cfg.placeholder || "Search…", value: st.q, autocomplete: "off", "aria-label": "Search" });
  const filterEls = (cfg.filters || []).map((f) => {
    const sel = selectEl([["", `Any ${f.label.toLowerCase()}`], ...f.options], st.filters[f.key] || "", (v) => { st.filters[f.key] = v; persist(); render(); });
    return field(f.label, sel);
  });
  const toggleEls = (cfg.toggles || []).map((t) => checkbox(t.label, !!st.toggles[t.key], (v) => { st.toggles[t.key] = v; persist(); render(); }));
  const sortEl = cfg.sorts?.length > 1 ? field("Sort", selectEl(cfg.sorts.map((s) => [s.id, s.label]), st.sort, (v) => { st.sort = v; persist(); render(); })) : null;

  const countEl = el("p", { class: "dnd-list-count dnd-muted dnd-small" }, "");
  const listEl = el("div", { class: "dnd-list", role: "listbox", tabindex: "0" });
  const detailEl = el("div", { class: "card dnd-detail" });
  const left = el("div", {}, [
    el("div", { class: "card", style: "margin-bottom:12px" }, [
      field("Search", searchInput),
      el("div", { class: "dnd-filters" }, [...filterEls, sortEl].filter(Boolean)),
      toggleEls.length ? el("div", { class: "dnd-row" }, toggleEls) : null,
    ].filter(Boolean)),
    countEl, listEl,
  ]);
  const root = el("div", { class: "dnd-split" }, [left, detailEl]);

  let visible = [];
  function matches(item) {
    const q = st.q.trim().toLowerCase();
    if (q) {
      const hay = (cfg.search ? cfg.search(item) : cfg.label(item)).toLowerCase();
      if (!q.split(/\s+/).every((w) => hay.includes(w))) return false;
    }
    for (const f of cfg.filters || []) { const v = st.filters[f.key]; if (v && !f.test(item, v)) return false; }
    for (const t of cfg.toggles || []) if (st.toggles[t.key] && !t.test(item)) return false;
    return true;
  }

  function render() {
    visible = cfg.items.filter(matches);
    const sort = cfg.sorts?.find((s) => s.id === st.sort);
    if (sort) visible.sort(sort.cmp);
    countEl.textContent = `${visible.length} of ${cfg.items.length}`;
    const rows = [];
    let lastGroup = null;
    const groups = cfg.group ? new Map() : null;
    if (groups) {
      for (const it of visible) { const g = cfg.group(it); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(it); }
      const order = cfg.groupOrder || [...groups.keys()];
      for (const g of order) {
        if (!groups.has(g)) continue;
        rows.push(el("div", { class: "dnd-list-group" }, g));
        for (const it of groups.get(g)) rows.push(row(it));
      }
      for (const g of groups.keys()) if (!order.includes(g)) { rows.push(el("div", { class: "dnd-list-group" }, g)); for (const it of groups.get(g)) rows.push(row(it)); }
    } else for (const it of visible) rows.push(row(it));
    void lastGroup;
    if (!rows.length) rows.push(el("p", { class: "view-sub", style: "padding:14px" }, cfg.empty || "Nothing matches."));
    listEl.replaceChildren(...rows);
    if (!visible.some((i) => cfg.id(i) === st.sel)) { st.sel = visible[0] ? cfg.id(visible[0]) : null; }
    showDetail(false);
  }

  function row(it) {
    const id = cfg.id(it);
    const b = el("button", { class: `dnd-list-item${id === st.sel ? " active" : ""}`, type: "button", role: "option", "data-id": id, "aria-selected": String(id === st.sel) }, [
      el("span", { class: "dnd-grow" }, cfg.label(it)),
      cfg.meta ? el("span", { class: "meta" }, cfg.meta(it)) : null,
    ].filter(Boolean));
    b.addEventListener("click", () => select(id, true));
    return b;
  }

  function showDetail(scroll) {
    const item = cfg.items.find((i) => cfg.id(i) === st.sel);
    detailEl.replaceChildren(item ? cfg.detail(item, { select, refresh: () => showDetail(false) }) : el("p", { class: "view-sub" }, cfg.emptyDetail || "Pick something from the list."));
    listEl.querySelectorAll(".dnd-list-item").forEach((b) => { const on = b.dataset.id === st.sel; b.classList.toggle("active", on); b.setAttribute("aria-selected", String(on)); });
    if (scroll && window.innerWidth <= 1000) detailEl.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function select(id, scroll = false) {
    st.sel = id; persist();
    if (!visible.some((i) => cfg.id(i) === id)) { st.q = ""; searchInput.value = ""; st.filters = {}; render(); filterEls.forEach((f) => { const s = f.querySelector("select"); if (s) s.value = ""; }); }
    showDetail(scroll);
    listEl.querySelector(`[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest" });
  }

  searchInput.addEventListener("input", () => { st.q = searchInput.value; persist(); render(); });
  listEl.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const i = visible.findIndex((x) => cfg.id(x) === st.sel);
    const n = visible[Math.max(0, Math.min(visible.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))];
    if (n) select(cfg.id(n));
  });

  render();
  return { root, select, refresh: render, state: st };
}
