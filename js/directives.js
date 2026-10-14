// Applies DM-issued directives (HP changes, status changes, notes) to this
// trainer's own save, automatically — unlike a Trainers Online "Send"
// gift, these are meant to land immediately without a manual Accept, since
// they're coming from the person running the session. app.js polls this
// continuously (not tied to whichever view is open) so a DM action lands
// even if you're looking at the Pokédex when it happens.

import { loadSave, writeSave, addBagItem } from "./storage.js";
import { getDirectives, ackDirectives, getFullTurn } from "./network.js";
import { addLogEntry } from "./log.js";
import { handleLevelUp } from "./levelUp.js";
import { monIsLiveCombatant } from "./battleGate.js";

function findMon(save, monId) {
  return save.party.find((m) => m.id === monId) || save.pc.find((m) => m.id === monId) || null;
}

// state is optional (only needed for setLevel's move-learn prompt) so
// callers that can't easily supply it yet don't hard-fail — a level grant
// still applies the number, just skips the "new move?" prompt if state is
// missing.
//
// A setLevel directive can block on the move-learn prompt (js/levelUp.js's
// modal) for as long as the trainer takes to respond — easily longer than
// app.js's 3s poll interval. Without a guard, the next tick would call in
// again, re-fetch the same not-yet-acked directive, and stack a second
// (identical) modal on top of the first, repeating every tick until the
// trainer catches up. inFlight makes an overlapping call a no-op instead.
let inFlight = false;

export async function pollAndApplyDirectives(state) {
  if (inFlight) return false;
  inFlight = true;
  try {
    return await applyDirectives(state);
  } finally {
    inFlight = false;
  }
}

async function applyDirectives(state) {
  const save = loadSave();
  const id = save.networkId;
  const directives = (await getDirectives(id)) || [];

  // Locally-queued self-level-ups (My Team / Quick Console blocked one mid-
  // battle — see battleGate.js) waiting for the fight to end, plus any
  // pending DM-granted setLevel directive, both need to know whether the
  // relevant mon is still a live combatant — fetch fullTurn once and reuse
  // it for both checks rather than once per mon/directive.
  const queuedMons = [...save.party, ...save.pc].filter((m) => m.queuedLevel != null);
  const needsFullTurn = queuedMons.length > 0 || directives.some((d) => d.kind === "setLevel");
  const fullTurn = needsFullTurn ? await getFullTurn() : null;

  let changed = false;
  for (const mon of queuedMons) {
    if (monIsLiveCombatant(fullTurn, id, mon.id)) continue; // still fighting — try again next poll
    const from = mon.level;
    const to = mon.queuedLevel;
    mon.queuedLevel = null;
    mon.level = to;
    if (to > from && state) await handleLevelUp(state, mon, from, to);
    addLogEntry(`${mon.nickname || mon.name} is now Level ${to} (queued mid-battle, applied now that the fight's over).`);
    changed = true;
  }

  if (!directives.length) {
    if (changed) writeSave(save);
    return changed;
  }

  const appliedIds = [];
  for (const d of directives) {
    if (d.kind === "setHp") {
      const mon = findMon(save, d.payload.monId);
      if (mon) {
        const before = mon.currentHp ?? 0;
        mon.currentHp = d.payload.absolute !== null && d.payload.absolute !== undefined
          ? Math.max(0, d.payload.absolute)
          : Math.max(0, before + (d.payload.delta || 0));
        addLogEntry(`The DM changed ${mon.nickname || mon.name}'s HP: ${before} → ${mon.currentHp}`);
      }
    } else if (d.kind === "setStatus") {
      const mon = findMon(save, d.payload.monId);
      if (mon) {
        mon.status = d.payload.status;
        addLogEntry(`The DM set ${mon.nickname || mon.name}'s status to ${d.payload.status}`);
      }
    } else if (d.kind === "setLevel") {
      const mon = findMon(save, d.payload.monId);
      if (mon) {
        if (monIsLiveCombatant(fullTurn, id, d.payload.monId)) continue; // held — leave un-acked, retry once the encounter's over
        const from = mon.level;
        const to = Math.min(100, Math.max(1, Number(d.payload.level) || from));
        mon.level = to;
        if (to > from && state) await handleLevelUp(state, mon, from, to);
        addLogEntry(`The DM leveled up ${mon.nickname || mon.name}: ${from} → ${to}`);
      }
    } else if (d.kind === "giveItem") {
      addBagItem(save, d.payload.name, d.payload.qty || 1);
      addLogEntry(`The DM gave you ${d.payload.qty || 1}× ${d.payload.name}.`);
    } else if (d.kind === "note") {
      addLogEntry(`Note from the DM: ${d.payload.text}`);
    }
    appliedIds.push(d.id);
  }

  writeSave(save);
  await ackDirectives(id, appliedIds);
  return true;
}
