// Monster stat block in the familiar layout, with clickable rolls: abilities
// roll a check, an attack rolls to hit (adv/dis from shift/ctrl), and each
// damage expression rolls (with a crit button doubling the dice).

import { el } from "../ui.js";
import { abilityMod, crLabel, CR_XP, ABILITY_KEYS } from "../engine/rules.js";
import { d20Test, damageRoll } from "../rolls.js";
import { fmtMod } from "../engine/dice.js";
import { renderInline } from "../../../markdown.js";

const signed = (n) => (n >= 0 ? `+${n}` : `−${Math.abs(n)}`);

export function speedText(speed) {
  const parts = Object.entries(speed || {}).map(([k, v]) => (k === "walk" ? v : `${k} ${v}`));
  return parts.join(", ") || "—";
}

export function sensesText(senses) {
  const s = senses || {};
  const parts = Object.entries(s).filter(([k]) => k !== "passive_perception").map(([k, v]) => `${k} ${v}`);
  if (s.passive_perception != null) parts.push(`passive Perception ${s.passive_perception}`);
  return parts.join(", ") || "—";
}

export function acText(m) {
  return (m.ac || []).map((a) => `${a.value}${a.type ? ` (${a.type}${a.desc ? `, ${a.desc}` : ""})` : a.desc ? ` (${a.desc})` : ""}`).join(", ") || "—";
}

export function crText(m) {
  const xp = m.xp ?? CR_XP[m.cr] ?? 0;
  return `${crLabel(m.cr)} (${xp.toLocaleString()} XP${m.xpInLair ? `, or ${m.xpInLair.toLocaleString()} XP in lair` : ""})`;
}

function prop(label, value) {
  if (value == null || value === "" || (Array.isArray(value) && !value.length)) return null;
  return el("div", { class: "prop" }, [el("b", {}, `${label} `), value]);
}

function rollBtn(label, onClick, title) {
  const b = el("button", { type: "button", title: title || null }, label);
  b.addEventListener("click", (e) => onClick(e));
  return b;
}

function entry(m, a, opts) {
  const who = opts.who || m.name;
  const rolls = [];
  if (a.attackBonus != null) rolls.push(rollBtn(`${signed(a.attackBonus)} to hit`, (e) => d20Test({ label: `${m.name}: ${a.name}`, mod: a.attackBonus, who, kind: "attack", mode: e.shiftKey ? "adv" : e.ctrlKey || e.altKey ? "dis" : "normal" }), "Shift = advantage, Ctrl/Alt = disadvantage"));
  for (const d of a.damage || []) {
    rolls.push(rollBtn(`${d.dice} ${String(d.type || "").toLowerCase()}`.trim(), () => damageRoll({ label: `${m.name}: ${a.name}`, expr: d.dice, who })));
    rolls.push(rollBtn("crit", () => damageRoll({ label: `${m.name}: ${a.name}`, expr: d.dice, who, crit: true }), "Critical hit damage"));
  }
  const nameText = a.usage ? `${a.name} (${a.usage}).` : `${a.name}.`;
  const p = el("div", { class: "entry" }, [
    el("span", { class: "nm" }, nameText), " ", renderInline(a.desc || ""),
    rolls.length ? el("span", { class: "rolls" }, rolls) : null,
  ]);
  return p;
}

// opts: { who, actions: [elements], onSpell(name), compact }
export function statBlock(m, opts = {}) {
  const sub = [m.size, m.type + (m.subtype ? ` (${m.subtype})` : ""), m.alignment].filter(Boolean).join(" ");
  const root = el("div", { class: "dnd-statblock" });
  root.append(el("h3", {}, m.name), el("div", { class: "sub" }, sub.charAt(0).toUpperCase() + sub.slice(1)), el("hr"));
  root.append(prop("Armor Class", acText(m)), prop("Hit Points", `${m.hp ?? "—"}${m.hpRoll ? ` (${m.hpRoll})` : m.hitDice ? ` (${m.hitDice})` : ""}`), prop("Speed", speedText(m.speed)), el("hr"));
  const abil = el("div", { class: "abilities" }, ABILITY_KEYS.map((k) => {
    const score = m.abilities?.[k] ?? 10;
    const mod = abilityMod(score);
    const b = el("button", { type: "button", title: `Roll a ${k} check` }, [el("b", {}, k), `${score} (${signed(mod)})`]);
    b.addEventListener("click", (e) => d20Test({ label: `${m.name}: ${k} check`, mod, who: opts.who || m.name, mode: e.shiftKey ? "adv" : e.ctrlKey || e.altKey ? "dis" : "normal" }));
    return el("div", {}, b);
  }));
  root.append(abil, el("hr"));
  const saves = Object.entries(m.saves || {});
  const skills = Object.entries(m.skills || {});
  root.append(
    prop("Saving Throws", saves.length ? saves.map(([k, v]) => `${k} ${signed(v)}`).join(", ") : null),
    prop("Skills", skills.length ? skills.map(([k, v]) => `${k} ${signed(v)}`).join(", ") : null),
    prop("Damage Vulnerabilities", (m.vulnerabilities || []).join("; ")),
    prop("Damage Resistances", (m.resistances || []).join("; ")),
    prop("Damage Immunities", (m.immunities || []).join("; ")),
    prop("Condition Immunities", (m.conditionImmunities || []).join(", ")),
    prop("Senses", sensesText(m.senses)),
    prop("Languages", m.languages || "—"),
    prop("Challenge", crText(m)),
    prop("Proficiency Bonus", m.pb != null ? signed(m.pb) : null),
  );
  root.append(el("hr"));
  for (const t of m.traits || []) {
    const e = entry(m, t, opts);
    if (t.spellcasting?.spells?.length && opts.onSpell) {
      const list = el("div", { class: "dnd-chip-row", style: "margin-top:4px" }, t.spellcasting.spells.map((s) => {
        const c = el("button", { type: "button", class: "dnd-chip" }, `${s.name}${s.level != null ? ` (${s.level === 0 ? "cantrip" : `L${s.level}`})` : ""}`);
        c.addEventListener("click", () => opts.onSpell(s.name));
        return c;
      }));
      e.append(list);
    }
    root.append(e);
  }
  const section = (title, list) => {
    if (!list?.length) return;
    root.append(el("h5", {}, title), ...list.map((a) => entry(m, a, opts)));
  };
  section("Actions", m.actions);
  section("Bonus Actions", m.bonusActions);
  section("Reactions", m.reactions);
  if (m.legendary?.length) {
    root.append(el("h5", {}, "Legendary Actions"), el("p", { class: "dnd-small" }, `The ${m.name.toLowerCase()} can take 3 legendary actions, choosing from the options below. Only one legendary action can be used at a time and only at the end of another creature's turn. Spent legendary actions are regained at the start of its turn.`));
    for (const a of m.legendary) root.append(entry(m, a, opts));
  }
  if (m.desc) root.append(el("p", { class: "dnd-small dnd-muted", style: "margin-top:10px" }, m.desc));
  if (opts.actions?.length) root.append(el("div", { class: "dnd-row", style: "margin-top:12px" }, opts.actions));
  return root;
}

// A one-line summary for lists.
export function monsterLine(m) {
  return `CR ${crLabel(m.cr)} · ${m.type}`;
}

export { fmtMod };
