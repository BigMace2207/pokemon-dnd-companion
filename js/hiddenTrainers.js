// A per-device "hide this trainer from my Trainers Online list" preference.
// This never touches the trainer's own registration server-side (they'll
// still show up for everyone else, and reappear here too if you unhide
// them) -- it's purely local, so it survives closing and reopening the app
// on this device without affecting anyone else's name/team.

const KEY = "pokemon-dnd-hidden-trainers";

export function getHiddenTrainerIds() {
  try {
    return new Set(JSON.parse(localStorage.getItem(KEY) || "[]"));
  } catch {
    return new Set();
  }
}

function save(set) {
  try { localStorage.setItem(KEY, JSON.stringify([...set])); } catch { /* storage blocked — just skip */ }
}

export function hideTrainerId(id) {
  const set = getHiddenTrainerIds();
  set.add(id);
  save(set);
}

export function unhideTrainerId(id) {
  const set = getHiddenTrainerIds();
  set.delete(id);
  save(set);
}
