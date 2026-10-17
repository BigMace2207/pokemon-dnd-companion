// Sheet > Features: everything the character gets from class, subclass, race,
// background and feats, with the pending choices (fighting style, invocations,
// expertise...) handled in place.

import { el, btn, chip, section, modal, field, textInput, selectEl, toast, confirmDialog } from "../../ui.js";
import { renderDesc } from "../../../../markdown.js";
import { loadSet } from "../../data.js";
import { pendingChoices } from "../../engine/character.js";
import { openFeatureChoice, chosenNames, choiceCount } from "../../components/featureChoice.js";

const GROUPS = [["class", "Class features"], ["subclass", "Subclass features"], ["race", "Race / species traits"], ["background", "Background"], ["feat", "Feats"]];

export function renderFeaturesTab(panel, S) {
  const { char, d } = S;
  const pending = pendingChoices(char, S.ctx);
  if (pending.length) {
    panel.append(el("div", { class: "dnd-alert" }, [el("strong", {}, "Choices waiting: "), pending.map((p) => `${p.feature.name}${p.expertise ? " (expertise)" : ""}: ${p.have}/${p.need}`).join(", ")]));
  }
  const q = el("input", { type: "text", placeholder: "Filter features…", "aria-label": "Filter features", autocomplete: "off" });
  const host = el("div");
  panel.append(el("div", { class: "card" }, [el("div", { class: "dnd-row between" }, [el("div", { class: "dnd-grow" }, q), btn("+ Add feat", () => openAddFeat(S), "btn small")])]), host);

  function draw() {
    const needle = q.value.trim().toLowerCase();
    const blocks = [];
    for (const [kind, title] of GROUPS) {
      const items = d.features.filter((f) => f.kind === kind && (!needle || `${f.name} ${f.desc.join(" ")}`.toLowerCase().includes(needle)));
      if (!items.length) continue;
      blocks.push(section(title, items.map((f) => featureBlock(S, f, draw))));
    }
    if (!blocks.length) blocks.push(el("div", { class: "card" }, el("p", { class: "view-sub" }, needle ? "No feature matches." : "No features yet — gain a level or pick a class.")));
    host.replaceChildren(...blocks);
  }
  q.addEventListener("input", draw);
  draw();
}

function featureBlock(S, f, redraw) {
  const { char } = S;
  const head = [el("strong", {}, f.name), " ", el("span", { class: "dnd-muted dnd-small" }, f.source)];
  const extra = [];
  if (f.options?.length && f.kind !== "race") {
    const need = choiceCount(S, f);
    const names = chosenNames(S, f);
    extra.push(el("div", { class: "dnd-row", style: "margin:6px 0" }, [
      ...(names.length ? names.map((n) => chip(n, "accent")) : [el("span", { class: "dnd-small dnd-muted" }, "Nothing chosen yet")]),
      btn(names.length ? "Change" : `Choose ${need}`, () => openFeatureChoice(S, f, redraw), "btn tiny"),
    ]));
  }
  if (f.pick) {
    const cur = char.choices[f.id] || [];
    extra.push(el("div", { class: "dnd-row", style: "margin:6px 0" }, [...cur.map((n) => chip(n, "accent")), btn(cur.length ? "Change" : "Choose", () => openFeatureChoice(S, f, redraw), "btn tiny")]));
  }
  if (f.expertise) {
    const cur = char.choices[`${f.id}:expertise`] || [];
    extra.push(el("div", { class: "dnd-row", style: "margin:6px 0" }, [...cur.map((n) => chip(`${n} (expertise)`, "accent")), btn(cur.length ? "Change" : "Choose expertise", () => openFeatureChoice(S, f, redraw), "btn tiny")]));
  }
  const removable = f.kind === "feat" ? btn("Remove", async () => { if (await confirmDialog(`Remove the ${f.name} feat?`, { ok: "Remove", danger: true })) { char.feats = char.feats.filter((x) => `feat:${x.id}` !== f.id); S.commit(); } }, "btn secondary tiny") : null;
  return el("details", { class: "dnd-fold dnd-feature" }, [
    el("summary", {}, head),
    ...extra,
    f.desc.length ? renderDesc(f.desc) : el("p", { class: "dnd-small dnd-muted" }, "No description in the SRD."),
    removable,
  ].filter(Boolean));
}

async function openAddFeat(S) {
  const { char } = S;
  const { list } = await loadSet(char.edition, "feats");
  const sel = selectEl([["", "— pick an SRD feat —"], ...list.map((f) => [f.id, `${f.name}${f.prerequisite ? ` (${f.prerequisite})` : ""}`])], "", () => {});
  const name = textInput("", () => {}, { placeholder: "Or type any feat's name" });
  const desc = textInput("", () => {}, { multiline: true, rows: 4, placeholder: "Description (optional)" });
  modal({
    title: "Add a feat",
    body: [field("SRD feats", sel), el("p", { class: "dnd-small dnd-muted" }, "The SRD includes only a few feats. If your book has others, add them by name with your own description."), field("Custom feat name", name), field("Description", desc)],
    actions: [{ label: "Cancel" }, {
      label: "Add", cls: "btn", onClick: () => {
        if (sel.value) { const f = list.find((x) => x.id === sel.value); char.feats.push({ id: f.id, name: f.name, src: "Feat" }); }
        else if (name.value.trim()) char.feats.push({ id: `custom-${Date.now().toString(36)}`, name: name.value.trim(), src: "Custom feat", desc: desc.value.trim() ? desc.value.trim().split(/\n+/) : [] });
        else { toast("Pick a feat or type a name.", "bad"); return false; }
        S.commit();
        return true;
      },
    }],
  });
}
