import { el } from "../components.js";

export function renderTierGuide(container, state) {
  container.innerHTML = "";
  container.appendChild(el("h1", { class: "view-title" }, "Move Tier Guide"));

  const { table, examples } = state.tierGuide;

  const t = el("table", { class: "data-table" }, [
    el("thead", {}, el("tr", {}, ["Tier", "Dice", "Min", "Avg", "Max", "Power Range", "# of Moves"].map((h) => el("th", {}, h)))),
    el("tbody", {}, table.map((r) => el("tr", {}, [
      r.tier, r.dice, r.minRoll, r.avgRoll, r.maxRoll, r.powerRange, r.moveCount,
    ].map((v) => el("td", {}, String(v)))))),
  ]);
  container.appendChild(el("div", { class: "card table-wrap" }, [t])); // scrolls sideways on a phone instead of widening the page

  container.appendChild(el("h4", {}, "Example Moves by Tier"));
  const exCard = el("div", { class: "card" });
  examples.forEach((e) => {
    exCard.appendChild(el("p", {}, [el("strong", {}, e.tier + ": "), e.examples.join(", ")]));
  });
  container.appendChild(exCard);
}
