// The hub's Pokédex and Move Dex pull-outs, and the cards they put on the board. A pull-out slides in from the left:
// search, filter by type, open a row for its details, and drag any row onto the board (or press + to drop it in the
// middle) to make a card everyone sees. Cards keep only a name (and dex number) on the server; everything shown on them
// comes from the app's own rules data, so they're always up to date.

import { el, typePill, statBars } from "./components.js";
import { spriteUrl } from "./sprites.js";
import { TYPE_COLORS } from "./data.js";
import { calcAllStats } from "./calc.js";
import { categorizeItem, SECTION_LABELS } from "./bagItems.js";
import { describeItem } from "./itemDescriptions.js";
import { itemIconSrc, MONEY } from "./bagIcon.js";
import { trainerSpriteUrl } from "./trainerSpritePicker.js";

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
// onSwitch(kind), when given, puts a Pokédex / Move Dex switch in the header (the hub's single Dex pull-out).
export function dexPanel(state, kind, { onPlace, onClose, openFull, onSwitch }) {
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
    el("div", { class: "hub-dex-top" }, [onSwitch ? switcher(kind, onSwitch) : el("strong", {}, isMon ? "Pokédex" : "Move Dex"), count, el("span", { class: "hub-grow" }), full, close]),
    el("div", { class: "hub-dex-filters" }, [search, typeSel]),
    el("p", { class: "hub-dex-hint" }, "Drag onto the board, or press +"),
    list,
  ]);
  panel.focusSearch = () => search.focus();
  return panel;
}

function switcher(kind, onSwitch) {
  return el("div", { class: "hub-dex-switch", role: "tablist" }, [["pokemon", "Pokédex"], ["moves", "Move Dex"]].map(([k, label]) => {
    const b = el("button", { type: "button", role: "tab", class: k === kind ? "on" : "", "aria-selected": String(k === kind) }, label);
    if (k !== kind) b.addEventListener("click", () => onSwitch(k));
    return b;
  }));
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
// mon: a Pokédex card; with a level, its stats at that level. From a player's team it also carries that Pokémon's own
// health, moves and held item. move: a Move Dex card. item: something from a bag. trainer: a player's character card.
export function makeCard() {
  return el("div", { class: "hub-card" });
}
const cardSig = (it) => JSON.stringify([it.type, it.name, it.open, it.level, it.hp, it.moves, it.nickname, it.held, it.status, it.sprite, it.fields, it.backstory, it.party]);
export function fillCard(node, it, state) {
  node.className = `hub-card kind-${it.type}${it.open ? " open" : ""}`;
  const sig = cardSig(it);
  if (node.dataset.sig === sig) return;   // nothing changed: leave it alone (no flicker)
  node.dataset.sig = sig;
  if (it.type === "mon") fillMon(node, it, state);
  else if (it.type === "item") fillItem(node, it, state);
  else if (it.type === "trainer") fillTrainer(node, it);
  else fillMove(node, it, state);
}

function fillMon(node, it, state) {
  const p = monByName(state, it.name);
  node.style.setProperty("--tc", typeColor(p?.type1));
  const fromTeam = Array.isArray(it.hp) || Array.isArray(it.moves);
  const sub = [`#${p?.dex || it.dex || "?"}`, it.level ? `Lv ${it.level}` : "", fromTeam && it.nickname ? it.name : ""].filter(Boolean).join(" · ");
  const hp = Array.isArray(it.hp) && it.hp[1] ? it.hp : null;
  const pct = hp ? Math.max(0, Math.min(100, (hp[0] / hp[1]) * 100)) : 0;
  node.replaceChildren(...[
    el("div", { class: "hub-card-head" }, [
      el("img", { class: "hub-card-sprite", src: spriteUrl(p?.dex || it.dex), alt: "", draggable: "false" }),
      el("div", { class: "hub-card-title" }, [el("strong", {}, (fromTeam && it.nickname) || it.name), el("span", {}, sub), el("span", { class: "hub-dex-types" }, [typePill(p?.type1), typePill(p?.type2)].filter(Boolean))]),
    ]),
    hp ? el("div", { class: "hub-card-hp" }, [
      el("span", { class: "hub-card-hpbar" }, el("span", { class: pct > 50 ? "good" : pct > 20 ? "warn" : "bad", style: `width:${pct}%` })),
      el("span", {}, `${hp[0]}/${hp[1]} HP${it.status && it.status !== "None" ? ` · ${it.status}` : ""}`),
    ]) : null,
    it.moves?.length ? el("div", { class: "hub-card-moves" }, it.moves.map((m) => {
      const mv = moveByName(state, m);
      return el("span", { style: `--mc:${typeColor(mv?.type)}`, title: mv ? [mv.type, mv.category, mv.power ? `${mv.power} power` : "", dice(mv)].filter(Boolean).join(" · ") : "" }, m);
    })) : null,
    it.held ? el("p", { class: "hub-card-held" }, `Holding ${it.held}`) : null,
    it.open && p ? (it.level ? levelDetail(p, it.level) : monDetail(p)) : null,
  ].filter(Boolean));
}

// a Pokémon's stats at a level (average IVs, no EVs, neutral nature: what the stat calculator starts from)
function levelDetail(p, level) {
  const at = calcAllStats(p, level, 15, 0, 1);
  const top = calcAllStats({ hp: 255, atk: 255, def: 255, spa: 255, spd: 255, spe: 255 }, level, 15, 0, 1);
  const rows = [["HP", "hp"], ["Attack", "atk"], ["Defense", "def"], ["Sp. Atk", "spa"], ["Sp. Def", "spd"], ["Speed", "spe"]];
  return el("div", { class: "hub-dex-detail" }, [
    el("div", { class: "stat-bars" }, rows.map(([label, k]) => el("div", { class: "row" }, [
      el("div", {}, label),
      el("div", { class: "bar-bg" }, [el("div", { class: "bar-fill", style: `width:${Math.min(100, (at[k] / top[k]) * 100)}%` })]),
      el("div", {}, String(at[k])),
    ]))),
    el("p", {}, abilities(p)),
    el("p", { class: "hub-dex-meta" }, `Stats at level ${level} · average IVs, no EVs · catch rate ${p.catchRate}`),
  ]);
}

function fillMove(node, it, state) {
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

function fillItem(node, it, state) {
  node.style.setProperty("--tc", it.name === MONEY ? "#facc15" : "#8b9bb4");
  const img = el("img", { class: "hub-card-icon", alt: "", draggable: "false" });
  itemIconSrc(it.name, state).then((src) => { img.src = src; });
  const section = it.name === MONEY ? "key" : categorizeItem(it.name, state);
  node.replaceChildren(...[
    el("div", { class: "hub-card-head" }, [img, el("div", { class: "hub-card-title" }, [el("strong", {}, it.name), el("span", {}, SECTION_LABELS[section] || "Item")])]),
    it.open ? el("p", { class: "hub-card-desc" }, it.name === MONEY ? "A trainer's money." : describeItem(it.name, state)) : null,
  ].filter(Boolean));
}

function fillTrainer(node, it) {
  node.style.setProperty("--tc", "#a78bfa");
  const face = it.sprite ? el("img", { class: "hub-card-sprite trainer", src: trainerSpriteUrl(it.sprite), alt: "", draggable: "false" }) : el("span", { class: "hub-card-initial" }, (it.name || "?")[0].toUpperCase());
  const rows = (it.fields || []).filter(([k]) => k !== "Party");
  node.replaceChildren(...[
    el("div", { class: "hub-card-head" }, [face, el("div", { class: "hub-card-title" }, [el("strong", {}, it.name), el("span", {}, "Trainer · drop a Pokémon or item here to send it")])]),
    it.party?.length ? el("div", { class: "hub-card-party" }, it.party.map((m) => el("span", { title: `${m.name}${m.level ? ` · Lv ${m.level}` : ""}` }, [m.dex ? el("img", { src: spriteUrl(m.dex), alt: m.name, draggable: "false" }) : el("b", {}, "?"), m.level ? el("small", {}, String(m.level)) : null].filter(Boolean)))) : null,
    el("dl", { class: "hub-card-fields" }, rows.flatMap(([k, v]) => [el("dt", {}, k), el("dd", {}, v)])),
    it.backstory ? el("div", { class: "hub-card-story" }, [el("span", {}, "Backstory"), el("p", { class: it.open ? "" : "clamped" }, it.backstory)]) : null,
  ].filter(Boolean));
}

const typeColor = (t) => TYPE_COLORS[t] || "#a1a1aa";
