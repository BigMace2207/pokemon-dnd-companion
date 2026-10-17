// DM-only pages share the Control Centre's session: the campaign's DM password
// is exchanged for a token (kept in localStorage) that the server checks on every
// DM action. This gate shows the password prompt when there is no valid token.

import { el, field } from "../../components.js";
import { dmLogin, checkDmToken } from "../../network.js";

export const DM_TOKEN_KEY = "pokemon-dnd-dm-token";

export const getDmToken = () => { try { return localStorage.getItem(DM_TOKEN_KEY) || null; } catch { return null; } };
export const clearDmToken = () => { try { localStorage.removeItem(DM_TOKEN_KEY); } catch { /* ignore */ } };

// Calls build(token) once the user is verified as the DM; otherwise renders a login card into `host`.
export async function withDm(host, build, { title = "Dungeon Master access" } = {}) {
  const token = getDmToken();
  if (token && await checkDmToken(token)) return build(token);
  if (token) clearDmToken();
  host.replaceChildren();
  const pw = el("input", { type: "password", placeholder: "DM password", autocomplete: "current-password" });
  const msg = el("p", { class: "view-sub", style: "color:var(--bad);display:none" }, "That password didn't work.");
  const go = el("button", { class: "btn", type: "button" }, "Enter");
  const attempt = async () => {
    go.disabled = true;
    const res = await dmLogin(pw.value);
    go.disabled = false;
    if (res?.ok) { try { localStorage.setItem(DM_TOKEN_KEY, res.token); } catch { /* ignore */ } withDm(host, build, { title }); }
    else msg.style.display = "block";
  };
  go.addEventListener("click", attempt);
  pw.addEventListener("keydown", (e) => { if (e.key === "Enter") attempt(); });
  host.append(el("div", { class: "card" }, [
    el("h4", {}, title),
    el("p", { class: "view-sub" }, "Enter this campaign's DM password (the campaign owner can see it in Settings → Campaign)."),
    field("Password", pw), go, msg,
  ]));
  return null;
}
