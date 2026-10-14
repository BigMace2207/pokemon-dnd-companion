// Talks to the /api/* endpoints added to server.py — the same LAN server
// that serves the app doubles as the sync hub, so every device already
// pointed at it (for the calculators) can see each other with no extra
// setup. Everything here is best-effort: if the fetch fails (server
// restarted, phone lost Wi-Fi, someone's on a different network entirely)
// functions resolve to a safe empty value instead of throwing, so the rest
// of the app keeps working offline exactly as before.

// Everything below server.py's "campaign" boundary (trainers, battle, NPCs,
// saves, ...) is scoped to one campaign now (see js/views/campaignSelect.js)
// -- rather than touch every call site below, the active campaign is set
// once here and every request quietly carries it, the same way a save's
// networkId already rides along. Harmless on the handful of routes that
// don't need it (asset listings, campaign create/join themselves).
import { getSessionToken } from "./session.js";

let activeCampaignId = null;
export function setActiveCampaign(id) { activeCampaignId = id; }
export function getActiveCampaign() { return activeCampaignId; }

function withCampaign(path) {
  if (!activeCampaignId) return path;
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}campaignId=${encodeURIComponent(activeCampaignId)}`;
}

// The signed-in account's session token rides along on every request; the
// server only requires it for listing/creating/joining campaigns.
function authHeaders(extra = {}) {
  const token = getSessionToken();
  return token ? { ...extra, Authorization: `Bearer ${token}` } : extra;
}

async function getJSON(path) {
  try {
    const res = await fetch(withCampaign(path), { cache: "no-store", headers: authHeaders() });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
async function postJSON(path, body) {
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(activeCampaignId ? { campaignId: activeCampaignId, ...body } : body),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// --- Campaigns: create/join/list/manage. See js/views/campaignSelect.js
// (the gate screen shown before the main app) and Settings' Campaign
// section (owner management: rename, regenerate the invite code or DM
// password, remove a member, delete the campaign). ---
export async function listMyCampaigns(networkId) {
  const res = await getJSON(`/api/campaigns?networkId=${encodeURIComponent(networkId)}`);
  return res?.campaigns || [];
}
export function getCampaign(id, networkId) {
  return getJSON(`/api/campaign/${encodeURIComponent(id)}?networkId=${encodeURIComponent(networkId)}`);
}
export function createCampaign(name, networkId, system = "pokemon-dnd") {
  return postJSON("/api/campaigns", { name, networkId, system });
}
export function joinCampaign(code, networkId) {
  return postJSON("/api/campaigns/join", { code, networkId });
}
export function renameCampaign(id, name, networkId) {
  return postJSON(`/api/campaigns/${encodeURIComponent(id)}/rename`, { name, networkId });
}
export function regenerateInviteCode(id, networkId) {
  return postJSON(`/api/campaigns/${encodeURIComponent(id)}/regenerate-code`, { networkId });
}
export function regenerateDmPassword(id, networkId) {
  return postJSON(`/api/campaigns/${encodeURIComponent(id)}/regenerate-dm-password`, { networkId });
}
export function removeCampaignMember(id, memberId, networkId) {
  return postJSON(`/api/campaigns/${encodeURIComponent(id)}/remove-member`, { memberId, networkId });
}
export function transferCampaignOwnership(id, newOwnerId, networkId) {
  return postJSON(`/api/campaigns/${encodeURIComponent(id)}/transfer-owner`, { newOwnerId, networkId });
}
export function deleteCampaign(id, networkId) {
  return postJSON(`/api/campaigns/${encodeURIComponent(id)}/delete`, { networkId });
}

export function pingTrainer(id, name, team, sprite) {
  return postJSON("/api/trainer", { id, name, team, sprite });
}
export async function listTrainers(excludeId) {
  const res = await getJSON(`/api/trainers?exclude=${encodeURIComponent(excludeId)}`);
  return res?.trainers || [];
}
export async function getTrainerTeam(id) {
  return getJSON(`/api/trainer/${encodeURIComponent(id)}`);
}
export function sendToTrainer({ fromId, fromName, toId, type, payload }) {
  return postJSON("/api/send", { fromId, fromName, toId, type, payload });
}
export async function getInbox(id) {
  const res = await getJSON(`/api/inbox/${encodeURIComponent(id)}`);
  return res?.messages || [];
}
export function ackInbox(id, ids) {
  return postJSON(`/api/inbox/${encodeURIComponent(id)}/ack`, { ids });
}

// --- The DM's Full Turn console roster (full mon data per combatant). ---
export function getFullTurn() {
  return getJSON("/api/fullturn");
}

// A trainer resolving their own move on their own turn (no DM token
// needed) — see server.py's _handle_player_move for what's actually
// allowed here: HP/status changes and turn advancement on the existing
// roster, never adding/removing/restructuring combatants.
export function playMove(payload) {
  // The DM token (if this device has one) lets the DM move for an away player.
  let token;
  try { token = localStorage.getItem("pokemon-dnd-dm-token") || undefined; } catch { /* ignore */ }
  return postJSON("/api/fullturn/playermove", token ? { ...payload, token } : payload);
}

// --- Directives: DM-issued changes (HP/status/notes) that auto-apply on
// the target trainer's own device, no manual Accept needed (unlike Send). ---
export async function getDirectives(id) {
  const res = await getJSON(`/api/directives/${encodeURIComponent(id)}`);
  return res?.directives || [];
}
export function ackDirectives(id, ids) {
  return postJSON(`/api/directives/${encodeURIComponent(id)}/ack`, { ids });
}

// --- Battle Log: shared, visible to everyone, no password needed to post. ---
export async function getBattleLog() {
  const res = await getJSON("/api/battlelog");
  return res?.entries || [];
}
export function postBattleLog(fromName, text) {
  return postJSON("/api/battlelog", { fromName, text });
}

// --- Music board slots (DM-editable, everyone can read/play them). ---
export async function getMusicSlots() {
  const res = await getJSON("/api/music");
  return res?.slots || [];
}

// --- NPC Trainer / Wild Pokémon libraries (DM-curated, everyone can read
// them — e.g. the Combatant pickers in Control Centre need to — but only
// the DM can write, via dmAction below). ---
export async function getNpcs() {
  const res = await getJSON("/api/npcs");
  return res?.npcs || [];
}
export function getNpc(id) {
  return getJSON(`/api/npcs/${encodeURIComponent(id)}`);
}
export async function getWildList() {
  const res = await getJSON("/api/wild");
  return res?.wild || [];
}
export function getWildMon(id) {
  return getJSON(`/api/wild/${encodeURIComponent(id)}`);
}

// --- Sound effects: private to the campaign (server folder sfx/<campaign id>/).
// Audio elements can't send the session header, so a clip is fetched with it
// and played from a blob URL. ---
export async function getSfxFiles() {
  const res = await getJSON("/api/sfx");
  return res?.files || [];
}
export async function getSfxBlobUrl(name) {
  try {
    const res = await fetch(withCampaign(`/api/sfx/${encodeURIComponent(name)}`), { headers: authHeaders() });
    return res.ok ? URL.createObjectURL(await res.blob()) : null;
  } catch {
    return null;
  }
}

// --- Battle backgrounds: whatever .png files are sitting in
// app/sprites/backgrounds/, so the DM can swap the Battle screen's
// backdrop live without editing any code. ---
export async function getBackgroundFiles() {
  const res = await getJSON("/api/backgrounds");
  return res?.files || [];
}

// --- Trainer portraits: whatever .png files are sitting in
// app/sprites/trainers/ (see export_trainer_sprites.py) — selectable on a
// trainer's own character sheet or a DM's NPC Library entry. ---
export async function getTrainerSpriteFiles() {
  const res = await getJSON("/api/trainersprites");
  return res?.files || [];
}

// --- Item icons: { category: [filenames] } across every subfolder of
// app/sprites/icons/ (a bundled legacy icon set) — see js/itemIcons.js for
// how a bag entry's name gets matched to one. ---
export async function getIconIndex() {
  const res = await getJSON("/api/icons");
  return res?.categories || {};
}

// --- Note straight to the DM (any trainer can send; only the DM can read). ---
export function sendNoteToDm(fromName, text) {
  return postJSON("/api/dmnote", { fromName, text });
}
export async function getDmInbox(token) {
  const res = await getJSON(`/api/dm/inbox?token=${encodeURIComponent(token)}`);
  return res?.entries || [];
}

// --- DM Control Centre ---
export async function dmLogin(password) {
  return postJSON("/api/dm/login", { password });
}
export async function checkDmToken(token) {
  if (!token) return false;
  const res = await getJSON(`/api/dm/check?token=${encodeURIComponent(token)}`);
  return !!res?.ok;
}
export function dmAction(token, action, payload) {
  return postJSON("/api/dm/action", { token, action, ...payload });
}
