// DM-only pages share one DM token per device (kept in localStorage), which the server checks on every DM action. DM
// access belongs to your account: the campaign owner is always a DM and can make other members DMs (or stop them being
// one) in Settings -> Members. There is no DM password: ensureDmToken() just asks the server, and gets a token only if
// your account has DM access.

import { el } from "../../components.js";
import { dmLogin, checkDmToken } from "../../network.js";

export const DM_TOKEN_KEY = "pokemon-dnd-dm-token";

export const getDmToken = () => { try { return localStorage.getItem(DM_TOKEN_KEY) || null; } catch { return null; } };
export const clearDmToken = () => { try { localStorage.removeItem(DM_TOKEN_KEY); } catch { /* ignore */ } };

// A valid DM token for this campaign, or null if this account isn't a DM here.
export async function ensureDmToken() {
  const token = getDmToken();
  if (token && await checkDmToken(token)) return token;
  if (token) clearDmToken();
  const res = await dmLogin();
  if (res?.ok && res.token) { try { localStorage.setItem(DM_TOKEN_KEY, res.token); } catch { /* ignore */ } return res.token; }
  return null;
}

export const NO_DM_TEXT = "Only the campaign's DMs can use this. The campaign owner can make you a DM in Settings, Members.";

// Calls build(token) if this account is a DM here; otherwise explains who can give DM access.
export async function withDm(host, build, { title = "Dungeon Master access" } = {}) {
  const token = await ensureDmToken();
  if (token) return build(token);
  host.replaceChildren(el("div", { class: "card" }, [el("h4", {}, title), el("p", { class: "view-sub" }, NO_DM_TEXT)]));
  return null;
}
