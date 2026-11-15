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
export const goTo = (view) => { location.hash = `#${view}`; };
const isPokemon = () => activeSystem()?.id === "pokemon-dnd";
export const goTeam = () => goTo(isPokemon() ? "team" : "dndCharacters");
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
// What is under the pointer can add to the menu: it listens for "pkdnd-context" and pushes items (the hub adds Copy / Duplicate / Remove
// for a note, widget or drawing; the whiteboard the same for a node). They come first, then the usual ones.
function contextItems(target, x, y) {
  const here = [];
  try { target?.dispatchEvent?.(new CustomEvent("pkdnd-context", { bubbles: true, detail: { target, x, y, items: here } })); } catch { /* nothing under it */ }
  const items = here.length ? [...here, "-"] : [];
  const picked = String(getSelection() || "").trim();
  if (picked) items.push({ label: "Copy", keys: "Ctrl+C", run: () => navigator.clipboard?.writeText(picked).catch(() => document.execCommand?.("copy")) }, "-");
  // where to go: the Pokémon side has a hub, a team and a trainer sheet; the D&D side its home page and characters
  if (isPokemon()) items.push({ label: "Hub", keys: "Alt+H", run: goHome }, { label: "My Team", keys: "Alt+T", run: () => goTo("team") }, { label: "Trainer", keys: "Alt+R", run: () => goTo("trainer") });
  else items.push({ label: "Home", keys: "Alt+H", run: goHome }, { label: "Characters", keys: "Alt+T", run: () => goTo("dndCharacters") });
  items.push({ label: "Settings", keys: "Ctrl+,", run: goSettings }, "-");
  if (document.getElementById("diceWidgetBtn")) items.push({ label: "Dice tray", keys: "Alt+D", run: () => document.getElementById("diceWidgetBtn")?.click() });
  const ping = document.getElementById("pingWidgetBtn");
  if (ping && !ping.hidden) items.push({ label: "Ping the DM", keys: "Alt+P", run: () => ping.click() });
  if (items[items.length - 1] !== "-") items.push("-");
  items.push({ label: "Hide the interface", keys: "F1", run: () => import("./shortcuts.js").then((m) => m.toggleUiHidden(true)) },
    { label: document.fullscreenElement ? "Leave full screen" : "Full screen", keys: "F11", run: toggleFullscreen },
    { label: "Reload", keys: "Ctrl+R", run: () => location.reload() });
  return items;
}

// ---------------------------------------------------------------- escape
// a dialog you can actually see (the hub keeps several panels in the page, invisible until opened)
function dialogOpen() {
  return [...document.querySelectorAll("dialog[open], [role='dialog']:not([hidden]):not(.hub-bag-drop)")].some((d) => {
    if (!d.getClientRects().length) return false;
    const c = getComputedStyle(d);
    return c.visibility !== "hidden" && Number(c.opacity) > 0.1 && c.pointerEvents !== "none";
  });
}
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
    openMenu(contextItems(e.target, e.clientX, e.clientY), { x: e.clientX, y: e.clientY });
  });

  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || e.ctrlKey || e.metaKey || e.altKey || current) return;
    if (isTyping(e.target) || dialogOpen()) return;
    if (document.documentElement.classList.contains("ui-hidden") || performance.now() - (window.__uiShownAt || 0) < 200) return;
    if (!document.getElementById("mainView") || document.querySelector(".start-page")) return;   // only inside a campaign
    // did anything on the page react to this Esc? If nothing changes within a moment, nobody used it.
    // (only changes to things that open and close count: a board that keeps redrawing itself must not stop the menu from opening)
    let changed = false;
    const closable = "[class*='pull-'], [class*='drawer'], [class*='menu'], [class*='drop'], [class*='fly'], [class*='panel'], [class*='modal'], [class*='popup'], [class*='dialog'], [class*='tool'], [role='dialog'], dialog, [aria-expanded]";
    const watch = new MutationObserver((list) => {
      for (const m of list) {
        if (m.type === "attributes" && m.target.getAttribute(m.attributeName) === m.oldValue) continue;   // (set to what it already was)
        const nodes = [m.target, ...m.addedNodes, ...m.removedNodes].filter((n) => n.nodeType === 1);
        if (nodes.some((n) => !n.closest?.(".am-layer") && (n.matches?.(closable) || n.closest?.(closable)))) { changed = true; return; }
      }
    });
    watch.observe(document.body, { subtree: true, childList: true, attributes: true, attributeOldValue: true });
    setTimeout(() => { watch.disconnect(); if (!changed && !current) openPause(); }, 90);
  });
}
