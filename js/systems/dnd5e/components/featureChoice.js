// Dialogs for class features that ask you to choose something: a Fighting Style, Eldritch
// Invocations, Metamagic, Expertise skills, a Favored Enemy, and so on. The choices are
// stored on the character (char.choices[featureId]) and read back by the rules engine.

import { el, modal, chip } from "../ui.js";
import { renderDesc } from "../../../markdown.js";
import { pickMany } from "./choiceUi.js";
import { SKILLS } from "../engine/rules.js";

// How many options the feature wants right now.
export function choiceCount(S, f) {
  if (f.choose) return f.choose;
  const part = S.d.parts.find((p) => p.id === f.classId);
  const cs = part?.cls?.levels?.find((l) => l.level === part.level)?.cs || {};
  if (/invocation/i.test(f.name)) return cs.invocations_known ?? cs.eldritch_invocations ?? 1;
  if (/metamagic/i.test(f.name)) return cs.metamagic_known ?? 2;
  return 1;
}

export function chosenNames(S, f) {
  const ids = S.char.choices?.[f.id] || [];
  if (f.options) return ids.map((id) => f.options.find((o) => o.id === id)?.name || id);
  return ids;
}

// Opens the right dialog for a feature; calls onDone() after saving.
export function openFeatureChoice(S, f, onDone) {
  if (f.options?.length) return optionsDialog(S, f, onDone);
  if (f.pick) return pickDialog(S, f, onDone);
  if (f.expertise) return expertiseDialog(S, f, onDone);
  return null;
}

function optionsDialog(S, f, onDone) {
  const { char } = S;
  const need = choiceCount(S, f);
  const cur = char.choices[f.id] || [];
  const level = S.d.level;
  const meets = (o) => (o.prereq || []).every((p) => {
    const m = /^Level (\d+)\+/.exec(p);
    if (m) return level >= Number(m[1]);
    return true; // spell/pact prerequisites are shown but left to the player
  });
  const opts = f.options.map((o) => ({ value: o.id, label: o.name, o }));
  let selected = [...cur];
  const detail = el("div", { class: "dnd-pick-detail-box" });
  const showDetail = (o) => detail.replaceChildren(el("h4", {}, o.name), o.prereq?.length ? el("p", { class: "dnd-small dnd-muted" }, `Prerequisite: ${o.prereq.join(", ")}`) : null, renderDesc(o.desc));
  const picker = pickMany(opts, need, selected, (v) => { selected = v; }, { disabled: opts.filter((o) => !meets(o.o)).map((o) => o.value) });
  picker.addEventListener("mouseover", (e) => { const b = e.target.closest("button"); if (b) { const o = opts.find((x) => x.label === b.textContent); if (o) showDetail(o.o); } });
  picker.addEventListener("focusin", (e) => { const b = e.target.closest("button"); if (b) { const o = opts.find((x) => x.label === b.textContent); if (o) showDetail(o.o); } });
  modal({
    title: `${f.name}: choose ${need}`, wide: true,
    body: [el("p", { class: "dnd-small dnd-muted" }, "Hover or focus an option to read it."), picker, detail],
    actions: [{ label: "Cancel" }, { label: "Save", cls: "btn", onClick: () => { char.choices[f.id] = selected; S.commit(); onDone?.(); } }],
  });
}

function pickDialog(S, f, onDone) {
  const { char } = S;
  const cur = char.choices[f.id] || [];
  let selected = [...cur];
  const labelFor = f.pick.kind === "enemy" ? "favored enemy type" : "favored terrain";
  modal({
    title: `${f.name}: choose ${f.pick.choose} ${labelFor}`,
    body: [pickMany(f.pick.from.map((x) => ({ value: x, label: x[0].toUpperCase() + x.slice(1) })), f.pick.choose, selected, (v) => { selected = v; })],
    actions: [{ label: "Cancel" }, { label: "Save", cls: "btn", onClick: () => { char.choices[f.id] = selected; S.commit(); onDone?.(); } }],
  });
}

function expertiseDialog(S, f, onDone) {
  const { char } = S;
  const key = `${f.id}:expertise`;
  const prev = char.choices[key] || [];
  const proficient = SKILLS.map((s) => s.name).filter((n) => (char.skills[n] || 0) >= 1 || prev.includes(n));
  const allowed = f.expertise.from?.length ? proficient.filter((n) => f.expertise.from.includes(n)) : proficient;
  let selected = [...prev];
  if (!allowed.length) { modal({ title: "Expertise", body: [el("p", {}, "Choose skill proficiencies first — expertise doubles your bonus in skills you're proficient with.")], actions: [{ label: "OK" }] }); return; }
  modal({
    title: `${f.name}: choose ${f.expertise.choose} skills`,
    body: [el("p", { class: "dnd-small dnd-muted" }, "Your proficiency bonus is doubled for these skills."), pickMany(allowed, f.expertise.choose, selected, (v) => { selected = v; })],
    actions: [{ label: "Cancel" }, {
      label: "Save", cls: "btn", onClick: () => {
        for (const n of prev) if (!selected.includes(n) && char.skills[n] === 2) char.skills[n] = 1;
        for (const n of selected) char.skills[n] = 2;
        char.choices[key] = selected;
        S.commit(); onDone?.();
      },
    }],
  });
}

export { chip };
