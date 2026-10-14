import { el, field, makeCombo } from "../components.js";
import { calcAllStats } from "../calc.js";
import { NATURE_OPTIONS } from "../calc.js";
import { makeSavedMonPicker } from "../savedMonPicker.js";
import { getViewState, setViewState } from "../viewState.js";
import { consumePendingStatCalc } from "../navState.js";

export function renderStatCalc(container, state) {
  container.innerHTML = "";
  container.appendChild(el("h1", { class: "view-title" }, "Pokémon Stat Calculator"));

  // Arrived here via a "View in Stat Calculator" link (My Team, NPC/Wild
  // Library) — that species+level takes priority over whatever was open
  // here before.
  const pending = consumePendingStatCalc();
  const rememberedName = getViewState("statcalc:pokemon", null);
  let selected = (pending && state.pokemonByName.get(pending.name)) || (rememberedName && state.pokemonByName.get(rememberedName)) || state.pokemonByName.get("Bulbasaur") || state.pokemon[0];
  const levelInput = el("input", { type: "number", min: "1", max: "100", value: String(pending?.level ?? getViewState("statcalc:level", 5)) });
  const ivInput = el("input", { type: "number", min: "0", max: "31", value: String(getViewState("statcalc:iv", 15)) });
  const evInput = el("input", { type: "number", min: "0", max: "252", value: String(getViewState("statcalc:ev", 0)) });
  const natureSelect = el("select", {}, NATURE_OPTIONS.map((n) => el("option", { value: n.value }, n.label)));
  natureSelect.value = getViewState("statcalc:nature", "1");
  if (pending) { setViewState("statcalc:pokemon", selected.name); setViewState("statcalc:level", levelInput.value); }

  const combo = makeCombo({
    options: state.pokemon.map((p) => p.name),
    initial: selected.name,
    onSelect: (name) => { selected = state.pokemonByName.get(name); setViewState("statcalc:pokemon", name); update(); },
  });

  container.appendChild(makeSavedMonPicker({
    title: "Load From…",
    onPick: (mon) => {
      const species = state.pokemonByName.get(mon.name);
      if (!species) return;
      selected = species;
      combo.setValue(species.name);
      setViewState("statcalc:pokemon", species.name);
      levelInput.value = mon.level || 5;
      setViewState("statcalc:level", levelInput.value);
      update();
    },
  }));

  const form = el("div", { class: "card" }, [
    el("div", { class: "grid-2" }, [
      field("Pokémon Name", combo),
      field("Nature (0.9 / 1.0 / 1.1)", natureSelect),
    ]),
    el("div", { class: "grid-3" }, [
      field("Level (1–100)", levelInput),
      field("IV (0–31, same for all stats)", ivInput),
      field("EV (0–252, same for all stats)", evInput),
    ]),
  ]);
  container.appendChild(form);

  const resultCard = el("div", { class: "card" });
  container.appendChild(resultCard);

  const tableCard = el("div", { class: "card" });
  container.appendChild(tableCard);

  function clampedInputs() {
    const level = Math.min(100, Math.max(1, Number(levelInput.value) || 1));
    const iv = Math.min(31, Math.max(0, Number(ivInput.value) || 0));
    const ev = Math.min(252, Math.max(0, Number(evInput.value) || 0));
    const nature = Number(natureSelect.value);
    return { level, iv, ev, nature };
  }

  function update() {
    const { level, iv, ev, nature } = clampedInputs();
    const stats = calcAllStats(selected, level, iv, ev, nature);
    const base = selected;

    resultCard.innerHTML = "";
    resultCard.appendChild(el("h4", {}, "Calculated Stats"));
    resultCard.appendChild(el("table", { class: "data-table" }, [
      el("thead", {}, el("tr", {}, ["Stat", "Base", "Value at this Level"].map((h) => el("th", {}, h)))),
      el("tbody", {}, [
        ["HP", base.hp, stats.hp], ["Attack", base.atk, stats.atk], ["Defense", base.def, stats.def],
        ["Sp. Atk", base.spa, stats.spa], ["Sp. Def", base.spd, stats.spd], ["Speed", base.spe, stats.spe],
      ].map(([label, b, v]) => el("tr", {}, [el("td", {}, label), el("td", {}, String(b)), el("td", {}, String(v))]))),
    ]));
    resultCard.appendChild(el("div", { class: "formula-note" }, [
      "HP = INT((2×Base + IV + INT(EV/4)) × Level / 100) + Level + 10", el("br"),
      "Other Stats = INT((INT((2×Base + IV + INT(EV/4)) × Level / 100) + 5) × Nature)",
    ]));

    tableCard.innerHTML = "";
    tableCard.appendChild(el("h4", {}, `Full Level 1–100 Table — ${selected.name}`));
    const wrap = el("div", { class: "table-wrap" });
    const rows = [];
    for (let lvl = 1; lvl <= 100; lvl++) {
      const s = calcAllStats(base, lvl, iv, ev, nature);
      rows.push(el("tr", { class: lvl === level ? "hi" : "" }, [
        lvl, s.hp, s.atk, s.def, s.spa, s.spd, s.spe,
      ].map((v) => el("td", {}, String(v)))));
    }
    wrap.appendChild(el("table", { class: "data-table" }, [
      el("thead", {}, el("tr", {}, ["Level", "HP", "Attack", "Defense", "Sp. Atk", "Sp. Def", "Speed"].map((h) => el("th", {}, h)))),
      el("tbody", {}, rows),
    ]));
    tableCard.appendChild(wrap);
  }

  levelInput.addEventListener("input", () => { setViewState("statcalc:level", levelInput.value); update(); });
  ivInput.addEventListener("input", () => { setViewState("statcalc:iv", ivInput.value); update(); });
  evInput.addEventListener("input", () => { setViewState("statcalc:ev", evInput.value); update(); });
  natureSelect.addEventListener("input", () => { setViewState("statcalc:nature", natureSelect.value); update(); });
  update();
}
