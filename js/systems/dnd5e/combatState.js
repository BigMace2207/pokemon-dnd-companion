// The DM's combat tracker state. It lives in the DM's own save (systemData.dnd5e.dm.combat)
// so it is private and survives reloads; when the DM publishes it, only a *public view*
// (initiative order, names, how hurt monsters look, PC hit points) is uploaded to the
// campaign's shared encounter slot for players to watch.

import { getDm, updateDm } from "./store.js";
import {
  newCombat, monsterCombatant, orderedCombatants, healthStatus, currentCombatant, cid,
} from "./engine/encounter.js";
import { dmAction, getFullTurn } from "../../network.js";

export function getCombat() {
  const dm = getDm();
  return dm.combat || newCombat();
}

export function mutateCombat(fn) {
  updateDm((dm) => {
    dm.combat ||= newCombat();
    fn(dm.combat);
  });
}

export function resetCombat() {
  updateDm((dm) => { dm.combat = newCombat(); });
}

// Adds `count` copies of a monster, numbering duplicates ("Goblin 1", "Goblin 2").
export function addMonsterToCombat(m, count = 1, opts = {}) {
  mutateCombat((combat) => {
    const same = combat.combatants.filter((c) => c.monsterId === m.id).length;
    for (let i = 0; i < count; i++) {
      const c = monsterCombatant(m, { hpMode: opts.hpMode || "average" });
      if (same + count > 1) c.name = `${m.name} ${same + i + 1}`;
      combat.combatants.push(c);
    }
    // number the first copy too if more were added alongside an existing single
    if (same === 1 && count >= 1) {
      const first = combat.combatants.find((c) => c.monsterId === m.id && c.name === m.name);
      if (first) first.name = `${m.name} 1`;
    }
  });
}

// What players may see. Hidden combatants are left out entirely; monsters show only how
// hurt they look, never their numbers.
export function publicView(combat) {
  const order = orderedCombatants(combat).filter((c) => !c.hidden);
  const cur = currentCombatant(combat);
  const idx = cur ? order.findIndex((c) => c.id === cur.id) : -1;
  return {
    system: "dnd5e",
    phase: combat.started ? "live" : "draft",
    round: combat.round,
    currentIndex: Math.max(0, idx),
    combatants: order.map((c) => ({
      id: c.id, kind: c.kind, name: c.name, init: c.init, dead: !!c.dead || (c.kind === "monster" && c.hp <= 0),
      status: healthStatus(c), conditions: c.conditions || [], concentrating: !!c.concentration,
      ...(c.kind === "pc" ? { hp: c.hp, maxHp: c.maxHp, tempHp: c.tempHp, ac: c.ac, pcId: c.pcId, owner: c.owner || null, deathSaves: c.hp === 0 ? c.deathSaves : null } : {}),
      ...(c.kind === "npc" ? {} : {}),
      active: cur?.id === c.id,
    })),
  };
}

// Upload the public view (needs the DM token).
export async function publishCombat(token, combat = getCombat()) {
  const pub = publicView(combat);
  return dmAction(token, "fullTurnSave", {
    combatants: pub.combatants, currentIndex: pub.currentIndex, round: pub.round, phase: pub.phase,
  });
}

export async function endPublishedCombat(token) {
  return dmAction(token, "fullTurnSave", { combatants: [], currentIndex: 0, round: 1, phase: "draft" });
}

// Players: the encounter as the DM last published it, or null.
export async function fetchPublicCombat() {
  const ft = await getFullTurn();
  if (!ft || !Array.isArray(ft.combatants)) return null;
  const looksLikeDnd = ft.combatants.length === 0 || ft.combatants.every((c) => c && (c.kind === "pc" || c.kind === "monster" || c.kind === "npc"));
  if (!looksLikeDnd) return null;
  return ft;
}

export { cid };
