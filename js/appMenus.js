// Two menus, one look.
//  - Right-click anywhere (outside a text box, which keeps the browser's own menu so copy and paste work): a small menu of things
//    worth a click, each with its keyboard shortcut beside it.
//  - Escape, when Esc has nothing else to close (no panel, drawer, popup or text box took it): a pause menu with Resume, Settings
//    and Quit. "Nothing else took it" is decided by watching the page for a moment after the key: if nothing on it changed, the
//    menu opens, so every existing Esc behaviour keeps working untouched.
import { el } from "./components.js";
import { activeSystem } from "./systems/registry.js";
import { clearSelectedCampaignId } from "./deviceSettings.js";

const inApp = () => typeof window.pywebview !== "undefined";
const isTyping = (t) => !!t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));
const visible = (e) => !!e && e.getClientRects().length > 0 && !e.hidden;

// ---------------------------------------------------------------- actions (each also a keyboard shortcut, see shortcuts.js)
export function goHome() { location.hash = `#${activeSystem()?.defaultView || "hub"}`; }
export function goSettings() { location.hash = "#settings"; }
export function toggleFullscreen() {
  if (inApp()) { try { window.pywebview.api.toggle_fullscreen(); } catch { /* not ready */ } return; }
  if (document.fullscreenElement) document.exitFullscreen?.(); else document.documentElement.requestFullscreen?.();
}
function leaveCampaign() { clearSelectedCampaignId(); location.hash = ""; location.reload(); }
function quitApp() { try { window.pywebview.api.close(); } catch { leaveCampaign(); } }

// ---------------------------------------------------------------- the menu itself
let current = null;
export function closeMenu() { current?.remove(); current = null; window.removeEventListener("keydown", onMenuKey, true); }
function onMenuKey(e) {
  if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeMenu(); }
}

function item(spec) {
  if (spec === "-") return el("div", { class: "am-sep", role: "separator" });
  const b = el("button", { type: "button", role: "menuitem", class: `am-item${spec.danger ? " danger" : ""}` }, [el("span", {}, spec.label), spec.keys ? el("kbd", {}, spec.keys) : null].filter(Boolean));
  b.addEventListener("click", () => { closeMenu(); spec.run(); });
  return b;
}

function openMenu(items, { x, y, title = null, center = false } = {}) {
  closeMenu();
  const menu = el("div", { class: `am-menu${center ? " center" : ""}`, role: "menu" }, [title ? el("h2", { class: "am-title" }, title) : null, ...items.map(item)].filter(Boolean));
  const layer = el("div", { class: `am-layer${center ? " dim" : ""}` }, menu);
  layer.addEventListener("pointerdown", (e) => { if (e.target === layer) closeMenu(); });
  layer.addEventListener("contextmenu", (e) => { e.preventDefault(); if (e.target === layer) closeMenu(); });
  document.body.append(layer);
  if (!center) {   // beside the pointer, kept on screen
    const r = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(x, innerWidth - r.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, innerHeight - r.height - 8))}px`;
  }
  window.addEventListener("keydown", onMenuKey, true);
  menu.querySelector(".am-item")?.focus({ preventScroll: true });
  current = layer;
}

// ---------------------------------------------------------------- right click
function contextItems() {
  const items = [];
  const picked = String(getSelection() || "").trim();
  if (picked) items.push({ label: "Copy", keys: "Ctrl+C", run: () => navigator.clipboard?.writeText(picked).catch(() => document.execCommand?.("copy")) }, "-");
  const search = [...document.querySelectorAll('main input[type="text"], main input[type="search"]')].find(visible);
  if (search) items.push({ label: "Search this page", keys: "/", run: () => { search.focus(); search.select?.(); } });
  if (document.getElementById("diceWidgetBtn")) items.push({ label: "Dice tray", keys: "Alt+D", run: () => document.getElementById("diceWidgetBtn")?.click() });
  const ping = document.getElementById("pingWidgetBtn");
  if (ping && !ping.hidden) items.push({ label: "Ping the DM", keys: "Alt+P", run: () => ping.click() });
  if (items.length && items[items.length - 1] !== "-") items.push("-");
  items.push({ label: "Home", keys: "Alt+H", run: goHome }, { label: "Settings", keys: "Ctrl+,", run: goSettings }, "-",
    { label: document.fullscreenElement ? "Leave full screen" : "Full screen", keys: "F11", run: toggleFullscreen },
    { label: "Reload", keys: "Ctrl+R", run: () => location.reload() });
  return items;
}

// ---------------------------------------------------------------- escape
function openPause() {
  openMenu([
    { label: "Resume", keys: "Esc", run: () => {} },
    { label: "Settings", keys: "Ctrl+,", run: goSettings },
    "-",
    { label: "Quit to campaigns", run: leaveCampaign },
    ...(inApp() ? [{ label: "Quit the app", danger: true, run: quitApp }] : []),
  ], { title: "Paused", center: true });
}

export function mountAppMenus() {
  document.addEventListener("contextmenu", (e) => {
    if (isTyping(e.target) || e.target.closest?.("[contenteditable='']")) return;   // text boxes keep the browser's menu: copy and paste
    e.preventDefault();
    openMenu(contextItems(), { x: e.clientX, y: e.clientY });
  });

  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || e.ctrlKey || e.metaKey || e.altKey || current) return;
    if (isTyping(e.target) || document.querySelector("dialog[open], [role='dialog']:not([hidden]):not(.hub-bag-drop)")) return;
    if (!document.getElementById("mainView") || document.querySelector(".start-page")) return;   // only inside a campaign
    // did anything on the page react to this Esc? If nothing changes within a moment, nobody used it.
    // (only changes to things that open and close count: a board that keeps redrawing itself must not stop the menu from opening)
    let changed = false;
    const closable = "[class*='pull-'], [class*='drawer'], [class*='menu'], [class*='drop'], [class*='fly'], [class*='panel'], [class*='modal'], [class*='popup'], [class*='dialog'], [class*='tool'], [role='dialog'], dialog, [aria-expanded]";
    const watch = new MutationObserver((list) => {
      for (const m of list) {
        const nodes = [m.target, ...m.addedNodes, ...m.removedNodes].filter((n) => n.nodeType === 1);
        if (nodes.some((n) => !n.closest?.(".am-layer") && (n.matches?.(closable) || n.closest?.(closable)))) { changed = true; return; }
      }
    });
    watch.observe(document.body, { subtree: true, childList: true, attributes: true });
    setTimeout(() => { watch.disconnect(); if (!changed && !current) openPause(); }, 90);
  });
}
