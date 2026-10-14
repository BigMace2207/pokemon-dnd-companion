// Thin localStorage wrapper for the app's save data (trainer sheet, party,
// PC boxes). Everything here is per-device/per-browser — there's no
// account or server sync, matching the rest of the app (no login, works
// offline). Each player using their own phone/browser gets their own save.
//
// Wrapped in try/catch throughout: private browsing, cleared site data, or
// a browser blocking storage should degrade to "nothing saved yet" rather
// than crashing the app.

import { getActiveCampaign } from "./network.js";
import { getSessionToken } from "./session.js";

const KEY = "pokemon-dnd-save-v1";

// This module makes its own raw fetch() calls below rather than going
// through network.js's getJSON/postJSON (storage.js is lower-level and
// predates the campaign system) -- every server.py playersave route needs
// a campaignId now, so each call site here appends it manually the same
// way those helpers do internally.
function withCampaign(path) {
  const cid = getActiveCampaign();
  if (!cid) return path;
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}campaignId=${encodeURIComponent(cid)}`;
}

// Every campaign request needs the signed-in session (see server.py): the
// server decides who you are from it, not from the id in the request.
function authHeaders(extra = {}) {
  const token = getSessionToken();
  return token ? { ...extra, Authorization: `Bearer ${token}` } : extra;
}

function emptyMon() {
  return {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2),
    dex: null, name: "", nickname: "", level: 5, currentHp: null,
    item: "", ability: "", status: "None",
    moves: ["", "", "", ""],
  };
}

function newNetworkId() {
  return "trainer-" + (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now());
}

function defaultSave() {
  return {
    version: 1,
    networkId: newNetworkId(),
    trainer: {
      name: "", trainerId: "", gender: "", age: "", occupation: "", originRegion: "",
      cash: 500, badges: 0, proficiencyBonus: 2,
      abilities: { Strength: null, Charisma: null, Intelligence: null, Pokémon: null },
      // Baldur's Gate 3-style bonus assignment: at most one ability gets
      // +2, at most one (different) ability gets +1, added on top of the
      // rolled/typed score below rather than stored into it -- see
      // renderAbilities in js/views/trainer.js.
      abilityBonus: { plus2: "", plus1: "" },
      skillProficiencies: {},
      backstory: "",
      sprite: "", // filename in sprites/trainers/ (see export_trainer_sprites.py), "" = none picked
    },
    party: [],
    pc: [],
    initiative: { combatants: [], currentIndex: 0, round: 1, synced: false },
    bag: {}, // itemName -> count, e.g. { "Potion": 2, "Poké Ball": 5 } — see addBagItem/useBagItem below
    systemData: {}, // systemId -> that game system's own per-player data (see getSystemData); Pokémon D&D's fields above predate this and stay top-level
    itemIcons: {}, // itemName -> { category, filename } in sprites/icons/ — manual overrides from the Bag page's "Assign Icon" picker
  };
}

export function loadSave() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) {
      // Persist immediately, not just return it -- app.js pings the server
      // with this save's networkId every few seconds, and without writing
      // it here first, every one of those calls would find nothing saved
      // and generate a brand new random networkId, each one registering as
      // a distinct "new trainer" on the server (see js/trainerPresence.js's
      // online toast) every few seconds, forever, until something else
      // happened to call writeSave() first.
      const fresh = defaultSave();
      writeSave(fresh);
      return fresh;
    }
    const parsed = JSON.parse(raw);
    // shallow-merge onto defaults so new fields added later don't crash old saves
    const base = defaultSave();
    return {
      ...base, ...parsed,
      trainer: { ...base.trainer, ...(parsed.trainer || {}), abilities: { ...base.trainer.abilities, ...(parsed.trainer?.abilities || {}) } },
      party: Array.isArray(parsed.party) ? parsed.party : [],
      pc: Array.isArray(parsed.pc) ? parsed.pc : [],
      initiative: { ...base.initiative, ...(parsed.initiative || {}) },
      bag: { ...(parsed.bag || {}) },
      itemIcons: { ...(parsed.itemIcons || {}) },
      systemData: { ...(parsed.systemData || {}) },
    };
  } catch {
    return defaultSave();
  }
}

function hasPlayerData(save) {
  return !!(
    save.trainer?.name?.trim() ||
    save.party?.some((m) => m?.name) || save.pc?.some((m) => m?.name) ||
    Object.keys(save.bag || {}).length
  );
}

// Points this device at a different networkId -- used when signing in to an
// account whose identity lives under another id (see js/account.js). Nothing
// is lost: whatever trainer is on this device right now is first kept as a
// named save (the "Saved characters" list on the Trainer Sheet), and nothing
// is pushed to the server under the new id here, so an existing server-side
// save for that id is never clobbered by this device's data -- the next
// pullFromServer() (app startup) brings that save down instead.
// Returns true if the id actually changed.
export function switchNetworkId(newId) {
  const current = loadSave();
  if (!newId || current.networkId === newId) return false;
  if (hasPlayerData(current)) {
    const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
    saveAsNamed(`before sign-in ${stamp}`);
  }
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...current, networkId: newId }));
  } catch {
    return false;
  }
  return true;
}

export function writeSave(save) {
  try {
    localStorage.setItem(KEY, JSON.stringify(save));
  } catch {
    // fall through to the server push anyway -- localStorage failing
    // (private browsing, quota, blocked storage) shouldn't also skip the
    // durable copy, which is the whole point of that copy existing.
  }
  pushToServer(save);
  return true;
}

// --- Server-side durable copy ---------------------------------------------
// localStorage alone isn't durable enough (see the incognito webview bug
// this replaced -- a wiped browser profile used to silently erase a whole
// campaign). server.py now mirrors every save to a file on disk, keyed by
// this save's own networkId, autosaved the same way as the rest of its
// state. This device's localStorage is still read/written first for instant,
// offline-safe UI, but every write also pushes here, and app startup pulls
// from here first (see pullFromServer below) so the file wins if the two
// ever disagree -- e.g. this browser's storage got cleared but the server
// file didn't.
let _pushTimer = null;
function pushToServer(save) {
  if (!save?.networkId) return;
  clearTimeout(_pushTimer);
  _pushTimer = setTimeout(() => {
    fetch("/api/playersave", {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ id: save.networkId, save, campaignId: getActiveCampaign() }),
    }).catch(() => {
      // offline / server not reachable (e.g. a build with no backend) --
      // localStorage already has it, nothing more to do here.
    });
  }, 600);
}

// Called once at startup (see app.js). Pulls this device's save down from
// the server file and, if one exists there, makes it the active localStorage
// save -- the server copy is treated as the source of truth since it's the
// one that actually survives a wiped browser profile. Also mirrors any
// server-side named saves into this browser's named-save keys so the
// existing "Saved characters" picker (below) keeps working unchanged.
export async function pullFromServer() {
  const local = loadSave();
  if (!local.networkId) return local;
  try {
    const res = await fetch(withCampaign(`/api/playersave?id=${encodeURIComponent(local.networkId)}`), { headers: authHeaders() });
    if (!res.ok) return local;
    const { current, named } = await res.json();
    if (current) {
      localStorage.setItem(KEY, JSON.stringify(current));
    }
    if (named && typeof named === "object") {
      for (const [name, save] of Object.entries(named)) {
        try { localStorage.setItem(namedKey(name), JSON.stringify(save)); } catch { /* ignore */ }
      }
    }
    return current || local;
  } catch {
    return local; // server unreachable -- keep going with whatever's local
  }
}

// --- Export / Import as a file ---------------------------------------------
// The user-controlled backup: independent of both localStorage AND the
// server file, since it's a plain file the player saves wherever they like.
// Bundles the active save AND every named "saved character" slot (see
// getAllNamedSaves below) -- "just the current trainer" would silently
// drop the others on a restore.
const BACKUP_KIND = "pokemon-dnd-full-backup-v1";

export function exportSaveToFile(save) {
  const bundle = { kind: BACKUP_KIND, current: save, named: getAllNamedSaves() };
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const nameSlug = (save?.trainer?.name || "trainer").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "trainer";
  const a = document.createElement("a");
  a.href = url;
  a.download = `pokemon-dnd-save-${nameSlug}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function importSaveFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        // Two shapes accepted: a full bundle from exportSaveToFile above
        // (kind === BACKUP_KIND, {current, named}), or a bare save object
        // -- e.g. an older export, or one hand-edited/generated elsewhere.
        const isBundle = parsed && parsed.kind === BACKUP_KIND && parsed.current;
        const current = isBundle ? parsed.current : parsed;
        if (!current || typeof current !== "object" || !Array.isArray(current.party)) {
          reject(new Error("That file doesn't look like a save (missing a party list)."));
          return;
        }
        // Keep this browser's existing networkId rather than the imported
        // file's -- that id is how the server tells devices' saves apart,
        // and reusing an old one (e.g. imported on a different computer)
        // would make this device silently overwrite that other save.
        const existing = loadSave();
        const merged = { ...current, networkId: existing.networkId };
        writeSave(merged);
        if (isBundle && parsed.named && typeof parsed.named === "object") {
          for (const [name, namedSave] of Object.entries(parsed.named)) {
            try { localStorage.setItem(namedKey(name), JSON.stringify(namedSave)); } catch { /* ignore */ }
            if (merged.networkId) {
              fetch("/api/playersave/named", {
                method: "POST",
                headers: authHeaders({ "Content-Type": "application/json" }),
                body: JSON.stringify({ id: merged.networkId, name: name.trim().toLowerCase(), save: namedSave, campaignId: getActiveCampaign() }),
              }).catch(() => {});
            }
          }
        }
        resolve(merged);
      } catch (e) {
        reject(e);
      }
    };
    reader.onerror = () => reject(reader.error || new Error("Couldn't read that file."));
    reader.readAsText(file);
  });
}

// A game system's own slice of the save (e.g. a D&D character), kept apart
// from the Pokémon fields so systems never collide. Mutates `save`; call
// writeSave(save) afterwards as usual.
export function getSystemData(save, systemId, defaults = {}) {
  if (!save.systemData) save.systemData = {};
  if (!save.systemData[systemId]) save.systemData[systemId] = { ...defaults };
  return save.systemData[systemId];
}

export function newMon() {
  return emptyMon();
}

// --- Bag (item counts) ------------------------------------------------
// A simple per-trainer inventory, local to this save — separate from the
// DM's Full Turn/Control Centre bag tools, which treat Poké Balls and
// healing items as always-available GM resources (see js/battleItems.js).
// This is the trainer's OWN counted supply, used by the floating Quick
// Console (js/console.js) so "quick heal" only offers items you actually
// have, and decrements them as they're used.

export function addBagItem(save, itemName, qty = 1) {
  if (!itemName || !qty) return;
  save.bag[itemName] = (save.bag[itemName] || 0) + qty;
  if (save.bag[itemName] <= 0) delete save.bag[itemName];
}

// Returns true if an item was actually available to consume.
export function useBagItem(save, itemName, qty = 1) {
  const have = save.bag[itemName] || 0;
  if (have < qty) return false;
  const left = have - qty;
  if (left <= 0) delete save.bag[itemName];
  else save.bag[itemName] = left;
  return true;
}

export function bagEntries(save) {
  return Object.entries(save.bag || {}).filter(([, count]) => count > 0);
}

// --- Named save slots ------------------------------------------------------
// The default save above always "just works" with no name needed (one save
// per browser). This is an *additional*, opt-in layer on top of that: save
// your current trainer under their name, and reload that exact save later —
// handy on a shared computer, or for keeping more than one character.
const NAME_PREFIX = "pokemon-dnd-save-name-";

function namedKey(name) {
  return NAME_PREFIX + name.trim().toLowerCase();
}

export function saveAsNamed(name) {
  if (!name || !name.trim()) return false;
  const save = loadSave();
  try {
    localStorage.setItem(namedKey(name), JSON.stringify(save));
  } catch {
    // still push to the server below -- see writeSave's comment
  }
  if (save.networkId) {
    // Same slug deleteNamedSave below derives from the localStorage key,
    // so a save/delete round-trip addresses the same server-side entry.
    fetch("/api/playersave/named", {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ id: save.networkId, name: name.trim().toLowerCase(), save, campaignId: getActiveCampaign() }),
    }).catch(() => {});
  }
  return true;
}

// Makes a previously-named save the active one (overwrites the current
// default save with it) — call loadSave() again afterward to pick it up.
export function loadNamed(name) {
  try {
    const raw = localStorage.getItem(namedKey(name));
    if (!raw) return false;
    localStorage.setItem(KEY, raw);
    return true;
  } catch {
    return false;
  }
}

export function listNamedSaves() {
  const out = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(NAME_PREFIX)) continue;
      let displayName = k.slice(NAME_PREFIX.length);
      try {
        const parsed = JSON.parse(localStorage.getItem(k));
        if (parsed?.trainer?.name) displayName = parsed.trainer.name;
      } catch {
        // fall back to the slug already assigned above
      }
      out.push({ key: k, name: displayName });
    }
  } catch {
    // storage blocked — just report nothing saved
  }
  return out;
}

// slug -> parsed save object, for every named slot -- used by
// exportSaveToFile so a backup carries every saved character, not just the
// one currently active.
function getAllNamedSaves() {
  const out = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(NAME_PREFIX)) continue;
      try { out[k.slice(NAME_PREFIX.length)] = JSON.parse(localStorage.getItem(k)); } catch { /* skip a corrupt entry */ }
    }
  } catch {
    // storage blocked
  }
  return out;
}

export function deleteNamedSave(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    // still tell the server below
  }
  const save = loadSave();
  if (save.networkId && key.startsWith(NAME_PREFIX)) {
    fetch("/api/playersave/named/delete", {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ id: save.networkId, name: key.slice(NAME_PREFIX.length), campaignId: getActiveCampaign() }),
    }).catch(() => {});
  }
  return true;
}
