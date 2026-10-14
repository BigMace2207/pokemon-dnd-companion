import { el, field } from "../components.js";

function cellClass(v) {
  if (v === 0) return "tc-0";
  if (v === 0.25) return "tc-0.25";
  if (v === 0.5) return "tc-0.5";
  if (v === 2) return "tc-2";
  if (v === 4) return "tc-4";
  return "tc-1";
}

function effLabel(v) {
  if (v === 0) return "No effect (immune)";
  if (v < 1) return "Not very effective";
  if (v > 1) return "Super effective";
  return "Normal effectiveness";
}

export function renderTypeChart(container, state) {
  container.innerHTML = "";
  container.appendChild(el("h1", { class: "view-title" }, "Type Effectiveness Chart"));

  const { defTypes, rows } = state.typeChart;
  const attackTypes = Object.keys(rows);

  // Quick single-pair lookup — much easier to use than the full matrix on
  // a phone, where scrolling an 18x18 table is a pain.
  const atkSelect = el("select", {}, attackTypes.map((t) => el("option", { value: t }, t)));
  const defSelect = el("select", {}, defTypes.map((t) => el("option", { value: t }, t)));
  const lookupResult = el("div", { class: "result-banner neutral" }, "—");

  function updateLookup() {
    const atk = atkSelect.value, def = defSelect.value;
    const v = rows[atk][defTypes.indexOf(def)];
    lookupResult.className = "result-banner " + (v === 0 ? "bad" : v > 1 ? "good" : "neutral");
    lookupResult.textContent = `${v}× — ${effLabel(v)}`;
  }
  atkSelect.addEventListener("change", updateLookup);
  defSelect.addEventListener("change", updateLookup);

  container.appendChild(el("div", { class: "card" }, [
    el("h4", {}, "Quick Lookup"),
    el("div", { class: "grid-2" }, [field("Attacking Type", atkSelect), field("Defending Type", defSelect)]),
    lookupResult,
  ]));
  updateLookup();

  const table = el("table", { class: "tc-table" });
  table.appendChild(el("thead", {}, el("tr", {}, [el("th", {}, "Atk ↓ / Def →"), ...defTypes.map((t) => el("th", {}, t))])));
  const tbody = el("tbody");
  attackTypes.forEach((atk) => {
    const vals = rows[atk];
    tbody.appendChild(el("tr", {}, [
      el("th", {}, atk),
      ...vals.map((v) => el("td", { class: cellClass(v) }, v === 1 ? "1" : String(v))),
    ]));
  });
  table.appendChild(tbody);
  container.appendChild(el("h4", {}, "Full Chart"));
  container.appendChild(el("div", { class: "table-wrap card" }, [table]));
  container.appendChild(el("div", { class: "formula-note" }, "0 = immune · 0.25/0.5 = not very effective · 1 = neutral · 2/4 = super effective"));
}
