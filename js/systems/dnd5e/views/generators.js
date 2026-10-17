// Generators: names, NPCs, taverns, shops, rumours and hooks, weather, loot, dungeon rooms
// and wild magic surges. NPCs and taverns can be saved straight into Campaign Notes.

import { el, btn, chip, section, tabs, selectEl, numInput, field, toast, checkbox } from "../ui.js";
import { dungeonTab } from "./dungeonGen.js";
import { pageTitle } from "./common.js";
import { updateDm } from "../store.js";
import { uid } from "../engine/character.js";
import {
  NAME_STYLES, genName, genNpc, genTavern, genShop, genRumor, genHook, genWeather, genLoot, genRoom, genWildMagic,
} from "../engine/generators.js";

const rng = Math.random;
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export function renderGenerators(container) {
  container.replaceChildren();
  container.append(...pageTitle("Generators", "Instant NPCs, taverns, loot, weather and more. Everything is original table content — reroll until it sparks something."));
  const t = tabs([
    { id: "npc", label: "NPCs", render: npcTab }, { id: "names", label: "Names", render: namesTab },
    { id: "tavern", label: "Taverns", render: tavernTab }, { id: "shop", label: "Shops", render: shopTab },
    { id: "hooks", label: "Rumours & Hooks", render: hooksTab }, { id: "weather", label: "Weather", render: weatherTab },
    { id: "loot", label: "Loot", render: lootTab }, { id: "dungeon", label: "Dungeons", render: dungeonTab }, { id: "room", label: "Single rooms", render: roomTab }, { id: "wild", label: "Wild magic", render: wildTab },
  ], { stateKey: "dnd:gen:tab", initial: "npc" });
  container.append(t.bar, t.panel);
}

// A generate-and-show panel: render() builds the result node each time.
function generator(panel, { button = "Generate", build, save = null, count = 1 }) {
  const out = el("div", { class: "dnd-stack" });
  let last = [];
  const run = () => {
    last = Array.from({ length: count }, () => build());
    out.replaceChildren(...last.map(({ node, data }) => el("div", { class: "card" }, [node, save ? btn("Save to notes", () => { save(data); toast("Saved to Campaign Notes.", "good"); }, "btn secondary tiny") : null].filter(Boolean))));
  };
  panel.append(el("div", { class: "dnd-row", style: "margin-bottom:12px" }, [btn(button, run, "btn")]), out);
  run();
  return { run, out };
}

const kv = (rows) => el("table", { class: "data-table dnd-kv" }, rows.filter(([, v]) => v).map(([k, v]) => el("tr", {}, [el("th", {}, k), el("td", {}, v)])));

function npcTab(panel) {
  generator(panel, {
    button: "Roll a new NPC",
    build: () => { const n = genNpc(rng); return { data: n, node: el("div", {}, [el("h3", {}, n.name), el("p", { class: "dnd-muted" }, `${cap(n.age)} ${n.race} ${n.occupation}`), kv([["Looks", n.appearance], ["Mannerism", n.mannerism], ["Personality", n.trait], ["Wants", n.wants], ["Secret", n.secret], ["Attitude", n.attitude]])]) }; },
    save: (n) => updateDm((dm) => dm.npcs.unshift({ id: uid(), name: n.name, role: `${n.race} ${n.occupation}`, attitude: n.attitude, notes: `${cap(n.age)}. ${cap(n.appearance)}; ${n.mannerism}. ${cap(n.trait)}. Wants ${n.wants}. Secret: ${n.secret}.`, created: Date.now() })),
  });
}

function namesTab(panel) {
  const style = selectEl(NAME_STYLES.map((s) => [s, cap(s)]), "human", () => draw());
  const count = numInput(10, () => draw(), { min: 1, max: 40, ariaLabel: "How many names" });
  const list = el("div", { class: "dnd-chip-row" });
  const draw = () => list.replaceChildren(...Array.from({ length: Number(count.value) || 10 }, () => { const n = genName(style.value, rng); const b = el("button", { type: "button", class: "dnd-chip dnd-pickable", title: "Copy" }, n); b.addEventListener("click", () => { navigator.clipboard?.writeText(n); toast(`Copied ${n}`, "good"); }); return b; }));
  panel.append(el("div", { class: "card" }, [el("div", { class: "dnd-row" }, [field("Style", style), field("How many", count), btn("Generate", draw, "btn")]), list]));
  draw();
}

function tavernTab(panel) {
  generator(panel, {
    button: "Build a tavern",
    build: () => { const t = genTavern(rng); return { data: t, node: el("div", {}, [el("h3", {}, t.name), el("p", { class: "dnd-muted" }, `A ${t.quality} establishment run by ${t.owner.name}, ${t.owner.age} ${t.owner.race.toLowerCase()}, ${t.owner.trait}.`), kv([["Known for", t.feature], ["On tap", t.drink], ["Kitchen", t.food], ["Prices", t.price], ["Rumour", t.rumor]]), el("h5", {}, "Patrons"), el("ul", {}, t.patrons.map((p) => el("li", {}, p)))]) }; },
    save: (t) => updateDm((dm) => dm.locations.unshift({ id: uid(), name: t.name, kind: "Tavern", notes: `${cap(t.quality)}. Owner: ${t.owner.name}. Known for ${t.feature}. Drink: ${t.drink}. Food: ${t.food}. Rumour: ${t.rumor}`, created: Date.now() })),
  });
}

function shopTab(panel) {
  generator(panel, {
    button: "Open a shop",
    build: () => { const s = genShop(rng); return { data: s, node: el("div", {}, [el("h3", {}, s.name), kv([["Type", cap(s.type)], ["Keeper", `${s.keeper.name} — ${s.keeper.trait}`], ["Prices", cap(s.prices)], ["Hook", `The shop ${s.hook}.`]])]) }; },
    save: (s) => updateDm((dm) => dm.locations.unshift({ id: uid(), name: s.name, kind: "Shop", notes: `${cap(s.type)} run by ${s.keeper.name}. Prices: ${s.prices}. Hook: ${s.hook}.`, created: Date.now() })),
  });
}

function hooksTab(panel) {
  panel.append(el("div", { class: "dnd-grid-2" }, [
    el("div", {}, [el("h4", {}, "Rumours"), (() => { const h = el("div"); generator(h, { button: "Hear a rumour", count: 3, build: () => ({ node: el("p", {}, `“${genRumor(rng)}”`), data: null }) }); return h; })()]),
    el("div", {}, [el("h4", {}, "Adventure hooks"), (() => { const h = el("div"); generator(h, { button: "Pitch a hook", count: 3, build: () => ({ node: el("p", {}, genHook(rng)), data: null }) }); return h; })()]),
  ]));
}

function weatherTab(panel) {
  const season = selectEl([["spring", "Spring"], ["summer", "Summer"], ["autumn", "Autumn"], ["winter", "Winter"]], "spring", () => draw());
  const out = el("div", { class: "card" });
  const days = el("div", { class: "dnd-grid-auto" });
  function draw() {
    const w = genWeather(rng, season.value);
    out.replaceChildren(el("h3", {}, cap(w.sky)), el("p", {}, `${w.tempC}°C / ${w.tempF}°F with ${w.wind}.`), w.effects.length ? el("ul", {}, w.effects.map((e) => el("li", {}, e))) : el("p", { class: "dnd-muted" }, "No mechanical effects."));
    days.replaceChildren(...Array.from({ length: 5 }, (_, i) => { const x = genWeather(rng, season.value); return el("div", { class: "card" }, [el("strong", {}, `Day ${i + 2}`), el("div", {}, `${cap(x.sky)}, ${x.tempC}°C`), el("div", { class: "dnd-muted dnd-small" }, x.wind)]); }));
  }
  panel.append(el("div", { class: "dnd-row", style: "margin-bottom:12px" }, [field("Season", season), btn("Forecast", draw, "btn")]), out, el("h4", {}, "The next five days"), days);
  draw();
}

function lootTab(panel) {
  const cr = numInput(3, () => {}, { min: 0, max: 30, ariaLabel: "Average CR" });
  const hoard = checkbox("Treasure hoard (3× coins, more items)", false, () => {});
  const out = el("div", { class: "card" });
  function draw() {
    const l = genLoot(Number(cr.value) || 0, { hoard: hoard.querySelector("input").checked, rng });
    const coins = Object.entries(l.coins).filter(([, n]) => n).map(([k, n]) => chip(`${n.toLocaleString()} ${k}`, "gold"));
    out.replaceChildren(el("h4", {}, "Treasure"), el("div", { class: "dnd-row" }, coins.length ? coins : [el("span", { class: "dnd-muted" }, "No coins")]), l.items.length ? el("ul", {}, l.items.map((i) => el("li", {}, cap(i)))) : null, ...l.magic.map((m) => el("p", { class: "dnd-strong" }, m)));
  }
  panel.append(el("div", { class: "dnd-row", style: "margin-bottom:12px" }, [field("Average CR of the defeated", cr), hoard, btn("Roll loot", draw, "btn")]), out);
  draw();
}

function roomTab(panel) {
  generator(panel, {
    button: "Generate a room", count: 3,
    build: () => { const r = genRoom(rng); return { data: r, node: el("div", {}, [el("h4", {}, cap(r.type)), kv([["Notable", cap(r.feature)], ["Inside", r.occupant], ["Trap", r.trap], ["Exits", String(r.exits)]])]) }; },
  });
}

function wildTab(panel) {
  generator(panel, { button: "Surge!", build: () => ({ node: el("p", { style: "font-size:calc(20px * var(--s))" }, genWildMagic(rng)), data: null }) });
  void section;
}
