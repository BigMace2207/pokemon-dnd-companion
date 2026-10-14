// The signed-in account, top right of the title bar: a small button showing
// who you are, opening a menu with Account settings and Sign Out. Shown on
// every screen while signed in (including the campaign-select screen), hidden
// on the login screen. See index.html's #accountChip and init() in js/app.js.

import { el } from "./components.js";
import { logout } from "./account.js";

let closeMenu = null;

// account: the signed-in account, or null to hide the chip.
// onOpenSettings: optional; omitted on screens that have no Settings page yet
// (the campaign-select screen), which hides that menu item.
export function mountAccountChip(account, { onOpenSettings } = {}) {
  const host = document.getElementById("accountChip");
  if (!host) return;
  closeMenu?.();
  host.innerHTML = "";
  if (!account) return;

  const label = account.email || "Account";
  const button = el("button", { class: "account-chip-btn", "aria-haspopup": "true", "aria-expanded": "false", title: label }, [
    el("span", { class: "account-chip-avatar" }, label.charAt(0).toUpperCase()),
    el("span", { class: "account-chip-label" }, label),
  ]);
  const menu = el("div", { class: "account-chip-menu", role: "menu", hidden: "" }, [
    el("div", { class: "account-chip-who" }, [el("span", {}, "Signed in as"), el("strong", {}, label)]),
  ]);
  if (onOpenSettings) {
    const settingsBtn = el("button", { class: "account-chip-item", role: "menuitem" }, "Account settings");
    settingsBtn.addEventListener("click", () => { close(); onOpenSettings(); });
    menu.appendChild(settingsBtn);
  }
  const signOut = el("button", { class: "account-chip-item", role: "menuitem" }, "Sign Out");
  signOut.addEventListener("click", async () => { await logout(); location.reload(); });
  menu.appendChild(signOut);

  function onOutside(e) { if (!host.contains(e.target)) close(); }
  function onKey(e) { if (e.key === "Escape") close(); }
  function open() {
    menu.hidden = false;
    button.setAttribute("aria-expanded", "true");
    document.addEventListener("click", onOutside);
    document.addEventListener("keydown", onKey);
  }
  function close() {
    menu.hidden = true;
    button.setAttribute("aria-expanded", "false");
    document.removeEventListener("click", onOutside);
    document.removeEventListener("keydown", onKey);
  }
  closeMenu = close;
  button.addEventListener("click", () => (menu.hidden ? open() : close()));

  host.append(button, menu);
}
