// The Generators tab body: pick a generator, set its options, and roll results as cards. Every card can be copied,
// saved as a planner note, or (for D&D) the full D&D generators page below it offers dungeons, taverns and more.

import { el, btn, chip, field, numInput, selectEl, checkbox, toast } from "../systems/dnd5e/ui.js";
import { textGenerators, resultText, OPTIONS } from "./textGens.js";
import { mutatePlan, newNote } from "./store.js";
import { getSettings } from "../systems/dnd5e/store.js";

export function renderQuickGenerators(panel, { system }) {
  const gens = textGenerators(system);
  const specs = OPTIONS[system] || {};
  let current = gens[0].id;
  const values = {};          // option values, remembered per generator
  const pills = el("div", { class: "dnd-row tight", role: "tablist", "aria-label": "Generators" });
  const form = el("div", { class: "dnd-row" });
  const results = el("div", { class: "dnd-stack" });
  const history = [];

  function drawPills() {
    pills.replaceChildren(...gens.map((g) => {
      const b = el("button", { type: "button", role: "tab", class: `pill-btn${g.id === current ? " active" : ""}`, "aria-selected": String(g.id === current) }, g.label);
      b.addEventListener("click", () => { current = g.id; drawPills(); drawForm(); });
      return b;
    }));
  }

  function drawForm() {
    const fields = specs[current] || [];
    const vals = (values[current] ||= Object.fromEntries(fields.map((f) => [f.key, f.value ?? (f.type === "select" ? f.options[0][0] : "")])));
    form.replaceChildren(
      ...fields.map((f) => {
        if (f.type === "select") return field(f.label, selectEl(f.options, vals[f.key], (v) => { vals[f.key] = v; }));
        if (f.type === "check") return checkbox(f.label, !!vals[f.key], (v) => { vals[f.key] = v; });
        return field(f.label, numInput(vals[f.key], (v) => { vals[f.key] = v; }, { min: f.min, max: f.max, ariaLabel: f.label }));
      }),
      btn("Generate", roll, "btn"),
      btn("Generate 3", async () => { for (let i = 0; i < 3; i++) await roll(); }, "btn secondary"),
    );
  }

  async function roll() {
    const g = gens.find((x) => x.id === current);
    try {
      const res = await g.run({ ...values[current], edition: getSettings().edition }, Math.random);
      history.unshift({ gen: g.label, res });
      history.length = Math.min(history.length, 12);
      drawResults();
    } catch (err) { toast(`Couldn't generate that: ${err.message || err}`, "bad"); }
  }

  function drawResults() {
    results.replaceChildren(...(history.length ? history.map(({ gen, res }) => card(gen, res)) : [el("p", { class: "view-sub" }, "Press Generate. Results appear here; the latest is at the top.")]));
  }

  function card(gen, res) {
    const body = el("div", { class: "pl-gen-body" }, res.lines.map((l) => (l.startsWith("#") ? el("h5", {}, l.replace(/^#\s?/, "")) : el("p", {}, l))));
    return el("div", { class: "card" }, [
      el("div", { class: "dnd-section-head" }, [el("h4", {}, res.title), chip(gen)]),
      body,
      el("div", { class: "dnd-row" }, [
        btn("Save as a note", () => { mutatePlan((p) => { p.notes.unshift(newNote(res.title, resultText(res).split("\n").slice(1).join("\n"))); }); toast("Saved to your notes.", "good"); }, "btn secondary tiny"),
        btn("Copy", () => { navigator.clipboard?.writeText(resultText(res)); toast("Copied.", "good"); }, "btn secondary tiny"),
      ]),
    ]);
  }

  panel.append(el("div", { class: "card" }, [pills, form]), results);
  drawPills(); drawForm(); drawResults();
  roll();
}
