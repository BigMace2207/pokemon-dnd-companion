// Campaign planner data. Everything lives in the player's own save under save.planner[campaignId], so it is
// mirrored to the server like the rest of the save and follows the player to a new device. Two things are
// different from other save data:
//   - A *player's* notes and checklists are also pushed to the campaign (POST /api/plan) so the DM can read
//     them. A DM's own planner (scenarios, prep lists, notes) is never pushed: it stays private.
//   - Map images are too big for the save; they live in IndexedDB on the device (see mapStore.js). Only the
//     map's name and labels are saved here.

import { loadSave, writeSave, getSystemData } from "../storage.js";
import { getActiveCampaign, sharePlan } from "../network.js";
import { normalizeBoard, defaultBounds } from "./board.js";

export const uid = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

const empty = () => ({ notes: [], lists: [], scenarios: [], maps: [], boards: [], updated: 0, displayName: "", legacyImported: false });

function normalize(p) {
  const base = empty();
  if (!p || typeof p !== "object") return base;
  for (const k of ["notes", "lists", "scenarios", "maps"]) base[k] = Array.isArray(p[k]) ? p[k] : [];
  base.boards = Array.isArray(p.boards) ? p.boards.map(normalizeBoard) : [];
  base.updated = Number(p.updated) || 0;
  base.displayName = typeof p.displayName === "string" ? p.displayName.slice(0, 60) : "";
  base.legacyImported = !!p.legacyImported;
  return base;
}

const campaignKey = () => getActiveCampaign() || "local";

export function getPlan() {
  const save = loadSave();
  return normalize(save.planner?.[campaignKey()]);
}

// The DM's planner is private. The planner view sets this once it knows who is looking.
let dmMode = false;
export const setDmMode = (v) => { dmMode = !!v; };
export const isDmMode = () => dmMode;

let shareTimer = null;
function scheduleShare() {
  if (dmMode) return;
  clearTimeout(shareTimer);
  shareTimer = setTimeout(pushShared, 1200);
}

// What a player shares: notes, checklists and whiteboards (a board's uploaded background stays on the device).
export function sharedPart(plan) {
  return { notes: plan.notes, lists: plan.lists, boards: plan.boards, updated: plan.updated };
}

export function displayName(save = loadSave()) {
  const t = save.trainer?.name?.trim();
  if (t) return t;
  const d = getSystemData(save, "dnd5e", {});
  const active = (d.characters || []).find((c) => c.id === d.activeId) || (d.characters || [])[0];
  return active?.name?.trim() || "Player";
}

// Saves typed edits shortly after the typing stops. Every edit queued in the meantime is applied (not just the last
// one), and all pending edits are flushed when the page is hidden or the view changes, so nothing is lost.
const pending = new Set();
export function batched(commit, ms = 450) {
  let queue = [], timer = null;
  const run = () => { clearTimeout(timer); timer = null; const fns = queue; queue = []; pending.delete(push); if (fns.length) commit(fns); };
  const push = (fn) => { queue.push(fn); pending.add(push); clearTimeout(timer); timer = setTimeout(run, ms); };
  push.flush = run;
  return push;
}
export const flushPending = () => { for (const f of [...pending]) f.flush(); };
if (typeof window !== "undefined") {   // (the logic above is also exercised in Node tests)
  window.addEventListener("pagehide", flushPending);
  window.addEventListener("hashchange", flushPending);
  document.addEventListener("visibilitychange", () => { if (document.hidden) flushPending(); });
}

export async function pushShared() {
  if (dmMode) return;
  const save = loadSave();
  if (!save.networkId || !getActiveCampaign()) return;
  const plan = normalize(save.planner?.[campaignKey()]);
  if (!plan.notes.length && !plan.lists.length && !plan.boards.length) return;
  try { await sharePlan(save.networkId, plan.displayName?.trim() || displayName(save), sharedPart(plan)); } catch { /* offline: it will go next time */ }
}

// Change the plan inside fn(plan); it is saved, and (for a player) shared with the DM shortly afterwards.
export function mutatePlan(fn) {
  const save = loadSave();
  save.planner = save.planner || {};
  const plan = normalize(save.planner[campaignKey()]);
  fn(plan);
  plan.updated = Date.now();
  save.planner[campaignKey()] = plan;
  writeSave(save);
  scheduleShare();
  window.dispatchEvent(new CustomEvent("planner-changed"));
  return plan;
}

// ---- small constructors -------------------------------------------------------------------

export const newNote = (title = "", body = "") => ({ id: uid(), title, body, tags: [], pinned: false, created: Date.now(), updated: Date.now() });
export const newList = (title = "New checklist", items = []) => ({ id: uid(), title, items: items.map((t) => (typeof t === "string" ? { id: uid(), text: t, done: false } : { id: uid(), done: false, ...t })), created: Date.now(), updated: Date.now() });
export const newScene = (title = "New scene", kind = "social") => ({ id: uid(), title, kind, location: "", readAloud: "", body: "", npcs: "", foes: "", secrets: "", rewards: "", branches: "", done: false });
export const newScenario = (title = "Untitled scenario") => ({ id: uid(), title, status: "draft", level: "", players: "", hook: "", summary: "", tags: [], scenes: [newScene("Opening", "social")], created: Date.now(), updated: Date.now() });
export const newMap = (name = "New map") => ({ id: uid(), name, w: 0, h: 0, hasImage: false, pins: [], created: Date.now() });

export function listProgress(list) {
  const total = list.items.length, done = list.items.filter((i) => i.done).length;
  return { total, done, pct: total ? Math.round((done / total) * 100) : 0 };
}

export const newBoard = (name = "Whiteboard") => normalizeBoard({ id: uid(), name, bounds: defaultBounds(), created: Date.now() });
