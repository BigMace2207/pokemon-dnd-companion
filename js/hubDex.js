// The hub's Pokédex and Move Dex pull-outs, and the cards they put on the board. A pull-out slides in from the left:
// search, filter by type, open a row for its details, and drag any row onto the board (or press + to drop it in the
// middle) to make a card everyone sees. Cards keep only a name (and dex number) on the server; everything shown on them
// comes from the app's own rules data, so they're always up to date.

import { el, typePill, statBars } from "./components.js";
import { spriteUrl } from "./sprites.js";
import { TYPE_COLORS } from "./data.js";

export const CARD_MIME = "application/x-hub-card";
const LIMIT = 120;

const monByName = (state, name) => state?.pokemonByName?.get(name) || null;
const moveByName = (state, name) => {
  const i = state?.moveByName?.get(name);
  return i === undefined ? (state?.moves || []).find((m) => m.name === name) || null : state.moves[i];
};
const dice = (m) => (m?.diceCount && m?.dieSize ? `${m.diceCount}d${m.dieSize}` : "");
const abilities = (p) => [p.ability1, p.ability2, p.hiddenAbility && `${p.hiddenAbility} (hidden)`].filter(Boolean).join(" · ");

// ------------------------------------------------------------------ the pull-out
// kind: "pokemon" | "moves". onPlace(card) drops a card in the middle of the board; openFull() goes to the full page.
export function dexPanel(state, kind, { onPlace, onClose, openFull }) {
  const isMon = kind === "pokemon";
  const search = el("input", { type: "search", class: "hub-input", placeholder: isMon ? "Search Pokémon…" : "Search moves…", "aria-label": "Search", autocomplete: "off" });
  const types = Object.keys(state?.typeChart?.rows || {}).sort();
  const typeSel = el("select", { class: "hub-select", "aria-label": "Type" }, [el("option", { value: "" }, "All types"), ...types.map((t) => el("option", { value: t }, t))]);
  const list = el("div", { class: "hub-dex-list", role: "list" });
  const count = el("span", { class: "hub-dex-count" });
  const close = el("button", { type: "button", class: "hub-round small", "aria-label": "Close", title: "Close" }, "×");
  close.addEventListener("click", onClose);
  const full = el("button", { type: "button", class: "hub-pill" }, "Full page ↗");
  full.addEventListener("click", openFull);
  let opened = null;

  function rows() {
    const q = search.value.trim().toLowerCase(), t = typeSel.value;
    const all = isMon ? state.pokemon : state.moves.filter((m) => !m.stub);
    const hits = all.filter((x) => (!q || x.name.toLowerCase().includes(q)) && (!t || (isMon ? x.type1 === t || x.type2 === t : x.type === t)));
    count.textContent = `${hits.length > LIMIT ? `${LIMIT} of ` : ""}${hits.length}`;
    return hits.slice(0, LIMIT);
  }
  function draw() {
    list.replaceChildren(...rows().map((x) => {
      const card = isMon ? { type: "mon", name: x.name, dex: x.dex } : { type: "move", name: x.name };
      const add = el("button", { type: "button", class: "hub-dex-add", "aria-label": `Put ${x.name} on the board`, title: "Put it on the board" }, "+");
      add.addEventListener("click", (e) => { e.stopPropagation(); onPlace(card); });
      const head = isMon
        ? [el("img", { class: "hub-dex-sprite", src: spriteUrl(x.dex), alt: "", loading: "lazy", draggable: "false" }), el("span", { class: "hub-dex-name" }, [el("strong", {}, x.name), el("span", {}, `#${x.dex}`)]), el("span", { class: "hub-dex-types" }, [typePill(x.type1), typePill(x.type2)].filter(Boolean))]
        : [el("span", { class: "hub-dex-name" }, [el("strong", {}, x.name), el("span", {}, [x.category, x.power ? `${x.power} power` : "", dice(x)].filter(Boolean).join(" · "))]), el("span", { class: "hub-dex-types" }, typePill(x.type))];
      const row = el("div", { class: `hub-dex-row${opened === x.name ? " open" : ""}`, role: "listitem", draggable: "true", tabindex: "0", title: "Drag onto the board" }, [el("div", { class: "hub-dex-head" }, [...head, add])]);
      if (opened === x.name) row.append(isMon ? monDetail(x) : moveDetail(x));
      row.addEventListener("dragstart", (e) => { e.dataTransfer.setData(CARD_MIME, JSON.stringify(card)); e.dataTransfer.effectAllowed = "copy"; row.classList.add("lifted"); });
      row.addEventListener("dragend", () => row.classList.remove("lifted"));
      const toggle = () => { opened = opened === x.name ? null : x.name; draw(); };
      row.addEventListener("click", toggle);
      row.addEventListener("keydown", (e) => { if (e.key === "Enter") toggle(); });
      return row;
    }));
  }
  search.addEventListener("input", () => { opened = null; draw(); });
  typeSel.addEventListener("change", () => { opened = null; draw(); });
  draw();
  const panel = el("aside", { class: "hub-dex", "aria-label": isMon ? "Pokédex" : "Move Dex" }, [
    el("div", { class: "hub-dex-top" }, [el("strong", {}, isMon ? "Pokédex" : "Move Dex"), count, el("span", { class: "hub-grow" }), full, close]),
    el("div", { class: "hub-dex-filters" }, [search, typeSel]),
    el("p", { class: "hub-dex-hint" }, "Drag onto the board, or press +"),
    list,
  ]);
  panel.focusSearch = () => search.focus();
  return panel;
}

function monDetail(p) {
  return el("div", { class: "hub-dex-detail" }, [statBars(p), el("p", {}, abilities(p)), el("p", { class: "hub-dex-meta" }, `Base total ${p.total} · catch rate ${p.catchRate} · gen ${p.gen}`)]);
}
function moveDetail(m) {
  return el("div", { class: "hub-dex-detail" }, [
    el("p", { class: "hub-dex-meta" }, [`${m.category}`, m.power ? `power ${m.power}` : "", m.accuracy ? `accuracy ${m.accuracy}` : "", m.pp ? `${m.pp} PP` : "", dice(m) ? `damage ${dice(m)}` : "", m.tier ? `${m.tier} tier` : ""].filter(Boolean).join(" · ")),
    m.effect ? el("p", {}, m.effect) : null,
  ].filter(Boolean));
}

// ------------------------------------------------------------------ cards on the board
export function makeCard() {
  return el("div", { class: "hub-card" });
}
export function fillCard(node, it, state) {
  const isMon = it.type === "mon";
  node.className = `hub-card kind-${it.type}${it.open ? " open" : ""}`;
  if (node.dataset.sig === `${it.name}|${it.open}`) return;   // nothing changed: leave it alone (no flicker)
  node.dataset.sig = `${it.name}|${it.open}`;
  if (isMon) {
    const p = monByName(state, it.name);
    node.style.setProperty("--tc", typeColor(p?.type1));
    node.replaceChildren(...[
      el("div", { class: "hub-card-head" }, [
        el("img", { class: "hub-card-sprite", src: spriteUrl(p?.dex || it.dex), alt: "", draggable: "false" }),
        el("div", { class: "hub-card-title" }, [el("strong", {}, it.name), el("span", {}, `#${p?.dex || it.dex || "?"}`), el("span", { class: "hub-dex-types" }, [typePill(p?.type1), typePill(p?.type2)].filter(Boolean))]),
      ]),
      it.open && p ? monDetail(p) : null,
    ].filter(Boolean));
  } else {
    const m = moveByName(state, it.name);
    node.style.setProperty("--tc", typeColor(m?.type));
    node.replaceChildren(...[
      el("div", { class: "hub-card-head" }, [
        el("div", { class: "hub-card-title" }, [el("strong", {}, it.name), el("span", {}, m ? [m.category, m.power ? `${m.power} power` : "", dice(m)].filter(Boolean).join(" · ") : "")]),
        typePill(m?.type),
      ].filter(Boolean)),
      it.open && m ? moveDetail(m) : null,
    ].filter(Boolean));
  }
}
const typeColor = (t) => TYPE_COLORS[t] || "#a1a1aa";
