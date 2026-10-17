// A spell's full description card, with a "roll damage / healing" control that
// scales by slot level (or by character level for cantrips). Used by the Spells
// compendium, the character sheet's spell lists and the DM tools.

import { el, btn, selectEl, chip } from "../ui.js";
import { renderDesc } from "../../../markdown.js";
import { damageRoll } from "../rolls.js";
import { scaleDice } from "../engine/dice.js";
import { ordinal } from "../engine/rules.js";

export function spellLevelText(s) {
  return s.level === 0 ? `${s.school} cantrip` : `${ordinal(s.level)}-level ${s.school.toLowerCase()}${s.ritual ? " (ritual)" : ""}`;
}

export function componentsText(s) {
  const parts = (s.components || []).join(", ");
  return s.material ? `${parts} (${s.material})` : parts;
}

// Dice for a damage/heal table at a given cast level; falls back sensibly when the table lacks the level.
export function diceAtLevel(table, slotLevel) {
  if (!table) return null;
  const keys = Object.keys(table).map(Number).sort((a, b) => a - b);
  if (!keys.length) return null;
  let pick = keys[0];
  for (const k of keys) if (k <= slotLevel) pick = k;
  return table[String(pick)];
}

// The damage expression for a spell (cantrips scale with character level).
export function spellDice(spell, { slot = spell.level, charLevel = 1 } = {}) {
  const dmg = spell.damage;
  if (dmg) {
    if (spell.level === 0) {
      if (dmg.byLevel) return diceAtLevel(dmg.byLevel, charLevel);
      const base = diceAtLevel(dmg.bySlot, 0);
      if (!base) return null;
      const tier = charLevel >= 17 ? 4 : charLevel >= 11 ? 3 : charLevel >= 5 ? 2 : 1;
      return scaleDice(base, tier);
    }
    return diceAtLevel(dmg.bySlot, slot);
  }
  if (spell.heal) return diceAtLevel(spell.heal, slot);
  return null;
}

// opts: { charLevel, who, extra: [elements], showDesc: true }
export function spellDetail(spell, opts = {}) {
  const wrap = el("div", { class: "dnd-spell" });
  wrap.append(
    el("h3", { class: "dnd-detail-title" }, spell.name),
    el("div", { class: "dnd-detail-sub" }, spellLevelText(spell)),
    el("div", { class: "dnd-spell-meta" }, [
      prop("Casting Time", spell.castingTime), prop("Range", spell.range),
      prop("Components", componentsText(spell)), prop("Duration", `${spell.concentration && !/^concentration/i.test(spell.duration) ? "Concentration, " : ""}${spell.duration}`),
    ]),
  );
  wrap.append(renderDesc(spell.desc));
  if (spell.higherLevel?.length) {
    wrap.append(el("p", { class: "dnd-prop" }, [el("b", {}, spell.level === 0 ? "Cantrip Upgrade. " : "At Higher Levels. "), spell.higherLevel.join(" ")]));
  }
  const tags = [];
  if (spell.save) tags.push(chip(`${spell.save.ability} save${spell.save.success ? ` (${spell.save.success} on success)` : ""}`, "warn"));
  if (spell.attack) tags.push(chip(`${spell.attack} spell attack`, "accent"));
  if (spell.area) tags.push(chip(`${spell.area.size ? spell.area.size + "-ft " : ""}${spell.area.type}`));
  if (spell.concentration) tags.push(chip("Concentration", "gold"));
  if (spell.ritual) tags.push(chip("Ritual", "gold"));
  if (tags.length) wrap.append(el("div", { class: "dnd-chip-row", style: "margin:8px 0" }, tags));
  if ((spell.classes || []).length) wrap.append(el("p", { class: "dnd-prop" }, [el("b", {}, "Classes: "), spell.classes.join(", ")]));

  if (spell.damage || spell.heal) {
    const levels = spell.level === 0 ? [] : Object.keys((spell.damage?.bySlot || spell.heal) || {}).map(Number);
    const slotSel = spell.level === 0 || levels.length < 2 ? null : selectEl(levels.map((l) => [l, `${ordinal(l)} level`]), String(spell.level), () => update());
    const out = el("span", { class: "dnd-muted dnd-small" }, "");
    const go = btn("", () => {
      const slot = slotSel ? Number(slotSel.value) : spell.level;
      const expr = spellDice(spell, { slot, charLevel: opts.charLevel || 1 });
      if (expr) damageRoll({ label: `${spell.name} ${spell.heal && !spell.damage ? "healing" : "damage"}`, expr, who: opts.who || "", kind: spell.heal && !spell.damage ? "heal" : "damage" });
    }, "btn small");
    function update() {
      const slot = slotSel ? Number(slotSel.value) : spell.level;
      const expr = spellDice(spell, { slot, charLevel: opts.charLevel || 1 });
      go.textContent = `Roll ${expr || "damage"}${spell.damage?.type ? ` ${spell.damage.type.toLowerCase()}` : ""}`;
      out.textContent = spell.level === 0 && opts.charLevel ? `at character level ${opts.charLevel}` : "";
    }
    update();
    wrap.append(el("div", { class: "dnd-row", style: "margin-top:10px" }, [go, slotSel, out].filter(Boolean)));
  }
  for (const x of opts.extra || []) wrap.append(x);
  return wrap;
}

function prop(label, value) {
  return el("div", { class: "dnd-prop" }, [el("b", {}, `${label}: `), String(value ?? "—")]);
}
