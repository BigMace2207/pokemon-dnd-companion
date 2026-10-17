// DM directives for D&D characters. The DM's tools queue small changes on the
// server (the same transport the Pokémon system uses); each player's own browser
// polls for them and applies them to their active character, then acknowledges.

import { loadSave } from "../../storage.js";
import { getDirectives, ackDirectives } from "../../network.js";
import { addLogEntry } from "../../log.js";
import { getDnd, saveCharacter } from "./store.js";
import { peekCtx } from "./data.js";
import { derive, applyDamage, applyHeal, newItem } from "./engine/character.js";

let busy = false;

function targetChar(save, monId) {
  const d = getDnd(save);
  return d.characters.find((c) => c.id === monId) || d.characters.find((c) => c.id === d.activeId) || d.characters[0] || null;
}

export async function pollAndApplyDirectives() {
  if (busy) return false;
  busy = true;
  try {
    const save = loadSave();
    const list = (await getDirectives(save.networkId)) || [];
    if (!list.length) return false;
    const acked = [];
    let changed = false;
    for (const d of list) {
      const p = d.payload || {};
      const char = targetChar(save, p.monId);
      const ctx = char ? peekCtx(char.edition) : null;
      if (d.kind === "note") {
        addLogEntry(`Note from the DM: ${p.text}`);
        if (char) { char.journal.unshift({ id: String(d.ts || Date.now()), ts: Date.now(), text: `Note from the DM: ${p.text}` }); saveCharacter(char); }
        changed = true;
      } else if (!char || !ctx) {
        // Rules data hasn't loaded yet: leave it queued and try again next poll.
        continue;
      } else if (d.kind === "setHp") {
        const dv = derive(char, ctx);
        const before = dv.hp.current;
        if (p.absolute != null) char.hp.current = Math.max(0, Math.min(dv.hpMax, p.absolute));
        else if ((p.delta || 0) < 0) applyDamage(char, dv, Math.abs(p.delta));
        else applyHeal(char, dv, p.delta || 0);
        addLogEntry(`The DM changed ${char.name || "your character"}'s HP: ${before} → ${char.hp.current ?? dv.hpMax}`);
        saveCharacter(char);
        changed = true;
      } else if (d.kind === "setStatus") {
        const raw = String(p.status || "");
        const on = !raw.startsWith("-");
        const name = raw.replace(/^[+-]/, "");
        if (name && name !== "None") {
          char.conditions = (char.conditions || []).filter((c) => c !== name);
          if (on) char.conditions.push(name);
          addLogEntry(`The DM ${on ? "applied" : "removed"} ${name} ${on ? "to" : "from"} ${char.name || "your character"}.`);
        } else { char.conditions = []; addLogEntry("The DM cleared your conditions."); }
        saveCharacter(char);
        changed = true;
      } else if (d.kind === "giveItem") {
        const rec = ctx.equipmentByName?.get(String(p.name).toLowerCase());
        const item = newItem(rec || { name: p.name }, p.qty || 1);
        const have = char.inventory.find((i) => i.name === item.name && !i.equipped);
        if (have) have.qty += p.qty || 1; else char.inventory.push(item);
        addLogEntry(`The DM gave you ${p.qty || 1}× ${p.name}.`);
        saveCharacter(char);
        changed = true;
      } else if (d.kind === "setLevel") {
        addLogEntry(`The DM says ${char.name || "your character"} can advance to level ${p.level}.`);
        char.journal.unshift({ id: String(Date.now()), ts: Date.now(), text: `The DM says you can advance to level ${p.level}.` });
        saveCharacter(char);
        changed = true;
      }
      acked.push(d.id);
    }
    if (acked.length) await ackDirectives(save.networkId, acked);
    return changed;
  } finally {
    busy = false;
  }
}
