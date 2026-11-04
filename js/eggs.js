// Eggs: a Key Item the DM gives (Control Centre -> DM Tools -> Give: Egg) with a Pokémon of their choosing inside. The
// player's save only knows there is an egg (save.eggs: [{ id, received }]); the server keeps what's in it. Hatching asks
// the server, which reveals it once, and the Pokémon joins the party (or the PC) at level 1 with its level-1 moves.

import { loadSave, writeSave, newMon } from "./storage.js";
import { hatchEgg } from "./network.js";
import { startingMoves } from "./levelUp.js";
import { addLogEntry } from "./log.js";

export const EGG_ICON = "sprites/icons/key-item/mystery-egg.png";
export const myEggs = () => (Array.isArray(loadSave().eggs) ? loadSave().eggs : []);

// Resolves to { ok, text, mon } — the text says what happened, for a toast.
export async function hatch(state, eggId) {
  const save = loadSave();
  const res = await hatchEgg(save.networkId, eggId);
  if (!res || (res.error && !res.species)) return { ok: false, text: res?.error || "Couldn't reach the server. Try again in a moment." };
  const name = res.species;
  const species = state.pokemonByName.get(name);
  const mon = { ...newMon(), name, dex: species?.dex ?? null, level: 1, currentHp: null, moves: [...startingMoves(state, name, 1), "", "", "", ""].slice(0, 4) };
  save.eggs = (save.eggs || []).filter((e) => e.id !== eggId);
  const toParty = save.party.filter((m) => m.name).length < 6;
  if (toParty) save.party.push(mon); else save.pc.push(mon);
  writeSave(save);
  window.dispatchEvent(new CustomEvent("pokemon-dnd-save-changed"));
  const text = `Your Egg hatched into ${name}!${toParty ? "" : " It's in your PC."}`;
  addLogEntry(text);
  return { ok: true, text, mon };
}
