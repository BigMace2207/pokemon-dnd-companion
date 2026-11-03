// The Hub: the Pokémon campaign's shared whiteboard, the page every player lands on. Everyone can pan around, leave
// sticky notes, write and draw, and sees everyone else's cursor (in that player's colour from Settings, with their
// name above it, faded so it doesn't get in the way). The DM drags encounter buttons onto it: an NPC trainer or a wild
// Pokémon from the DM's libraries, or an encounter generated in the Campaign Planner. Hovering one shows its first
// Pokémon's level (and its sprite, if the DM allows it; otherwise a question mark). Buttons are the only way into
// the Battle screen: a player's click opens it, the DM's click starts that battle and opens Battle Control.
//
// The board lives on the server (server.py "The Pokémon hub"); this page syncs a few times a second while it's open,
// sending its own cursor and receiving everyone else's, and the board itself only when it changed.
//
// Extras: Ping (or Alt+click) sends a "look here" ripple everyone sees; a click shows as a ripple on your cursor for
// the others; notes can be recoloured and resized; the corner buttons zoom and fit the board; clicking someone's
// avatar jumps to their cursor; Ctrl+Z takes back the last thing you added. Shortcuts: V move, N note, D draw,
// T text, E erase, P ping, F fit, Esc closes menus.
//
// The hub is a full-screen page: the app's top bar is hidden here and its controls (menu, theme, settings, account) are
// buttons along the top of the board. The DM can put one of their uploaded maps behind the board as a blurred backdrop
// that fades in under the dot grid (Backdrop button); without one, the hub is "cosmic": white stars twinkle behind the
// dots. Text is typed straight onto the board where you click. The Pokédex and Move Dex slide out from the left (the
// buttons under the menu); drag a Pokémon or a move from them onto the board as a card. With Ping, hovering something on
// the board highlights it and clicking it sends ripples round it for everyone.

import { el } from "../components.js";
import { loadSave } from "../storage.js";
import {
  hubSync, hubOp, getNpcs, getNpc, getWildList, getWildMon, listTrainers, getTrainerTeam, getFullTurn, dmAction,
  dmLogin, checkDmToken, getActiveCampaign,
} from "../network.js";
import { cursorColorOf } from "../cursorColor.js";
import { listFiles, uploadFile, fileUrl } from "../network.js";
import { fetchMe, logout } from "../account.js";
import { getForcedTheme } from "../deviceSettings.js";
import { dexPanel, makeCard, fillCard, CARD_MIME } from "../hubDex.js";
import { NAV_ICONS } from "../navIcons.js";

// The pages that used to be in the sidebar, as buttons on the hub: [view, label]. Left column (under the Pokédex and
// Move Dex pull-outs): your trainer and the calculators. Right column (under the account button): the shared tools.
const LEFT_PAGES = [["team", "My Team"], ["bag", "Bag"], ["trainer", "Trainer Sheet"], ["trainersOnline", "Trainers Online"], ["statcalc", "Stat Calculator"], ["damagecalc", "Damage Calculator"]];
const RIGHT_PAGES = [["planner", "Campaign Planner"], ["library", "Library"], ["controlcentre", "Control Centre"]];
import { getPlan } from "../planner/store.js";
import { spriteUrl } from "../sprites.js";
import { setViewState } from "../viewState.js";
import { getDmToken, DM_TOKEN_KEY } from "../systems/dnd5e/dmAccess.js";

const SYNC_MS = 140;          // how often the page reports its cursor while the mouse is moving
const IDLE_SYNC_MS = 1500;    // and how often it checks in when nothing is moving
const NOTE_COLORS = ["#fff6c2", "#ffe0d6", "#dcf8e4", "#dcefff", "#efe3ff", "#ffffff"];   // light, so notes stand out on the dark board
const PEN_WIDTHS = [3, 6, 12];
const uid = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const SHORTCUTS = { v: "move", n: "note", d: "pen", t: "text", e: "erase", p: "ping" };
// The board's edge: you can pan (and zoom out) only as far as a margin around everything on it, and never less than the
// base area round the middle. Put something near the edge and the edge moves out with it.
const BASE_AREA = { x0: -1400, y0: -900, x1: 1400, y1: 900 };
const EDGE_PAD = 900;   // board units of open space kept round the content
const typing = (t) => t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);

// Opens a page the router only allows from here (the Battle screen). js/app.js listens for this.
export function openFromHub(view) {
  window.dispatchEvent(new CustomEvent("app-open-view", { detail: { view, via: "hub" } }));
}

// A small arrow in the player's colour, as the real mouse cursor on the board.
function cursorCss(color) {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='26' height='30' viewBox='0 0 26 30'><path d='M3 2l19 12.5-8.6 1.2-4.6 9.3z' fill='${color}' stroke='%23000' stroke-opacity='.55' stroke-width='1.5' stroke-linejoin='round'/></svg>`;
  return `url("data:image/svg+xml,${svg.replace(/#/g, "%23").replace(/"/g, "'")}") 3 2, default`;
}

export function renderHub(container, state) {
  container.replaceChildren();
  const save = loadSave();
  const me = { id: save.networkId, name: save.trainer?.name?.trim() || "Trainer", color: cursorColorOf(save) };
  let dmToken = null;
  let items = [];                 // the board, as the server last sent it
  let rev = -1, activeButton = null;
  let tool = "move", penColor = me.color, penWidth = PEN_WIDTHS[0], noteColor = NOTE_COLORS[0];
  const view = { x: 0, y: 0, k: 1 };
  let bounds = { ...BASE_AREA };
  let pointerWorld = null;        // where my cursor is on the board (null when it's off the board)
  let lastSent = 0, dirtyCursor = false, inFlight = false, again = false, alive = true;
  let pendingPing = null, clicked = false;   // sent with the next sync
  const seenPings = new Set(), knownStrokes = new Set(), knownPeople = new Set();
  const undoStack = [];                      // ids of things I added, newest last
  let backdrop = null, shownBackdrop = "";   // the DM's map behind the board: {fileId, blur, dim}
  let welcomeGone = false;

  // ------------------------------------------------------------------ layout
  const root = el("div", { class: "hub", style: `--me:${me.color}` });
  const backdropLayer = el("div", { class: "hub-backdrop", "aria-hidden": "true" });
  const dots = el("div", { class: "hub-dots", "aria-hidden": "true" });
  // The starfield belongs to the board, like the dots: four repeating star patterns (css/hub.css .hub-starfield) whose
  // position and size follow the pan and zoom, each fading in and out on its own rhythm so the stars twinkle.
  const stars = el("div", { class: "hub-stars", "aria-hidden": "true" }, [1, 2, 3, 4].map((n) => el("div", { class: `hub-starfield s${n}` })));
  const stage = el("div", { class: "hub-stage", tabindex: "0", "aria-label": "Shared hub board" });
  const edgeGlow = el("div", { class: "hub-edge", "aria-hidden": "true" }, ["left", "right", "top", "bottom"].map((side) => el("span", { class: `hub-edge-${side}` })));
  const world = el("div", { class: "hub-world" });
  const ink = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  ink.setAttribute("class", "hub-ink");
  const itemLayer = el("div", { class: "hub-items" });
  // Other players' cursors sit on the board itself (world coordinates), like everything else people put there, so they
  // stay exactly over the same spot while you zoom or pan; only their arrow and name are kept at screen size.
  const cursorLayer = el("div", { class: "hub-cursors", "aria-hidden": "true" });
  world.append(ink, itemLayer, cursorLayer);
  const myTag = el("div", { class: "hub-mytag", "aria-hidden": "true" }, me.name);
  stage.append(world, myTag);
  stage.style.cursor = cursorCss(me.color);

  const people = el("div", { class: "hub-people" });
  const glyph = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
  const roundBtn = (label, d, fn, cls = "") => {
    const b = el("button", { type: "button", class: `hub-round ${cls}`, "aria-label": label, title: label });
    b.innerHTML = glyph(d);
    b.addEventListener("click", fn);
    return b;
  };
  const themeBtn = roundBtn("Lava Tower theme", "M12 3c1 3 4 4.5 4 8.5a4 4 0 0 1-8 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 0-7.5zM8 19h8", () => {
    document.getElementById("themeToggle")?.click();
    setTimeout(syncTheme, 50);
  });
  const syncTheme = () => themeBtn.classList.toggle("on", document.documentElement.dataset.theme === "lava");
  const settingsBtn = roundBtn("Settings", "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z", () => openFromHub("settings"), "hub-gear");
  const accountBtn = el("button", { type: "button", class: "hub-round hub-account", "aria-label": "Account", title: "Account" }, "?");
  accountBtn.addEventListener("click", () => openAccountMenu());
  fetchMe().then((acc) => { if (acc) { accountBtn.textContent = (acc.email || "?")[0].toUpperCase(); accountBtn.dataset.email = acc.email || ""; } });
  // the Campaign Planner and the Library: buttons down the right-hand side, under the account button
  // a page button: the page's own icon (the same sprites the sidebar used), its name sliding out on hover
  const pageBtn = (view, label) => {
    const b = el("button", { type: "button", class: "hub-round hub-page-btn", "aria-label": label, title: label });
    b.innerHTML = `<span class="hub-page-icon">${NAV_ICONS[view] || ""}</span>`;
    b.append(el("span", { class: "hub-page-label" }, label));
    b.addEventListener("click", () => openFromHub(view));
    return b;
  };
  const appBtns = el("div", { class: "hub-apps" }, RIGHT_PAGES.map(([v, l]) => pageBtn(v, l)));
  fetchMe().then((acc) => { if (acc?.perms?.admin) appBtns.append(pageBtn("admin", "Admin")); });
  const topbar = el("div", { class: "hub-top" }, [
    el("div", { class: "hub-top-left" }, [el("div", { class: "hub-title" }, [el("span", { class: "hub-eyebrow" }, "Pokémon D&D"), el("strong", {}, "Hub")])]),
    el("div", { class: "hub-top-right" }, [people, ...(getForcedTheme() ? [] : [themeBtn]), settingsBtn, accountBtn]),   // a campaign's own theme has no toggle
  ]);
  const toolbar = el("div", { class: "hub-toolbar", role: "toolbar", "aria-label": "Board tools" });
  const subbar = el("div", { class: "hub-subbar" });
  const drawer = el("aside", { class: "hub-drawer", "aria-label": "Encounters" });
  const hover = el("div", { class: "hub-hover", role: "tooltip" });
  const menu = el("div", { class: "hub-menu", role: "menu" });
  const toast = el("div", { class: "hub-toast", role: "status", "aria-live": "polite" });
  const empty = el("div", { class: "hub-empty" }, [
    el("h2", {}, "Welcome to the hub"),
    el("p", {}, "Everyone in the campaign is here. Leave notes, draw, and watch for the DM's encounter buttons: they're your way into battle."),
  ]);
  const zoomLabel = el("span", { class: "hub-zoom-label", "aria-live": "polite" }, "100%");
  const zoomBtn = (label, aria, fn) => { const b = el("button", { type: "button", class: "hub-zoom-btn", "aria-label": aria, title: aria }, label); b.addEventListener("click", fn); return b; };
  const zoomBar = el("div", { class: "hub-zoom" }, [
    zoomBtn("−", "Zoom out", () => zoomAt(1 / 1.25)), zoomLabel, zoomBtn("+", "Zoom in", () => zoomAt(1.25)),
    zoomBtn("⤢", "Fit everything (F)", () => fitAll()),
  ]);
  // the Pokédex and Move Dex pull-outs (buttons under the menu button)
  const sideBtns = el("div", { class: "hub-side" });
  const dexHost = el("div", { class: "hub-dex-host" });
  let dexOpen = null, dexEl = null;
  function toggleDex(kind) {
    if (dexOpen === kind) { closeDex(); return; }
    dexOpen = kind;
    const panel = dexPanel(state, kind, {
      onClose: closeDex,
      openFull: () => openFromHub(kind === "pokemon" ? "pokedex" : "moves"),
      onPlace: (card) => { const r = stage.getBoundingClientRect(); placeCard(card, toWorld(r.left + r.width / 2, r.top + r.height / 2)); },
    });
    dexHost.replaceChildren(panel);
    dexEl = panel;
    void panel.offsetWidth;   // lay it out closed first, so it slides in
    panel.classList.add("open");
    panel.focusSearch();
    sideBtns.querySelectorAll(".hub-round").forEach((b) => b.classList.toggle("on", b.dataset.kind === kind));
  }
  function closeDex() {
    dexOpen = null;
    const old = dexEl; dexEl = null;
    old?.classList.remove("open");
    setTimeout(() => { if (old && !old.classList.contains("open")) old.remove(); }, 300);
    sideBtns.querySelectorAll(".hub-round").forEach((b) => b.classList.remove("on"));
  }
  const dexBtn = (kind, label, d) => { const b = roundBtn(label, d, () => toggleDex(kind)); b.dataset.kind = kind; return b; };
  sideBtns.append(
    dexBtn("pokemon", "Pokédex", "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h6m6 0h6M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z"),
    dexBtn("moves", "Move Dex", "M13 2L4 14h7l-1 8 9-12h-7z"),
    el("span", { class: "hub-side-gap", "aria-hidden": "true" }),
    ...LEFT_PAGES.map(([v, l]) => pageBtn(v, l)),
  );
  sideBtns.querySelectorAll(".hub-page-label").forEach((x) => x.classList.add("right"));   // the left column's names slide out to the right
  root.append(backdropLayer, stars, dots, stage, edgeGlow, empty, topbar, sideBtns, appBtns, dexHost, subbar, toolbar, zoomBar, drawer, hover, menu, toast);
  root.classList.add("cosmic");
  syncTheme();
  // the welcome goes away the first time anyone clicks anywhere on the hub
  root.addEventListener("pointerdown", () => { if (!welcomeGone) { welcomeGone = true; empty.classList.add("gone"); } }, { capture: true });
  container.append(root);

  let toastTimer = null;
  function say(text) {
    toast.textContent = text;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
  }

  // ------------------------------------------------------------------ view (pan / zoom)
  // Keeps the view inside the board's edge. When the edge is bigger than the screen you can pan up to it; when it's
  // smaller (zoomed far out) it's centred. Returns the sides it had to stop at.
  function clampView() {
    const r = stage.getBoundingClientRect();
    const W = r.width, H = r.height;
    if (!W || !H) return [];
    const kMin = clamp(Math.min(W / (bounds.x1 - bounds.x0), H / (bounds.y1 - bounds.y0)), 0.25, 1);
    view.k = clamp(view.k, kMin, 3);
    const hit = [];
    const fit = (pos, size, lo, hi, a, b) => {
      const span = (hi - lo) * view.k;
      if (span <= size) return [(size - (lo + hi) * view.k) / 2, null];
      const min = size - hi * view.k, max = -lo * view.k;
      if (pos > max) return [max, a];
      if (pos < min) return [min, b];
      return [pos, null];
    };
    let side;
    [view.x, side] = fit(view.x, W, bounds.x0, bounds.x1, "left", "right"); if (side) hit.push(side);
    [view.y, side] = fit(view.y, H, bounds.y0, bounds.y1, "top", "bottom"); if (side) hit.push(side);
    return hit;
  }
  let glowTimer = null;
  function bump(sides) {
    if (!sides.length) return;
    for (const side of sides) edgeGlow.querySelector(`.hub-edge-${side}`)?.classList.add("on");
    clearTimeout(glowTimer);
    glowTimer = setTimeout(() => edgeGlow.querySelectorAll("span").forEach((x) => x.classList.remove("on")), 450);
  }
  // the edge follows the content: a margin round everything on the board, at least the base area
  function updateBounds() {
    const b = { ...BASE_AREA };
    for (const it of items) {
      if (it.type === "stroke") for (const [x, y] of it.pts) { b.x0 = Math.min(b.x0, x - EDGE_PAD); b.x1 = Math.max(b.x1, x + EDGE_PAD); b.y0 = Math.min(b.y0, y - EDGE_PAD); b.y1 = Math.max(b.y1, y + EDGE_PAD); }
      else {
        const w = it.w || 260, h = it.h || 120;
        b.x0 = Math.min(b.x0, it.x - EDGE_PAD); b.x1 = Math.max(b.x1, it.x + w + EDGE_PAD);
        b.y0 = Math.min(b.y0, it.y - EDGE_PAD); b.y1 = Math.max(b.y1, it.y + h + EDGE_PAD);
      }
    }
    bounds = b;
  }

  function applyView(gesture = false) {
    const hit = clampView();
    if (gesture) bump(hit);
    world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.k})`;
    world.style.setProperty("--ik", String(1 / view.k));   // undoes the zoom for things that keep their size (cursors)
    stage.style.setProperty("--k", String(view.k));
    root.style.setProperty("--grid", `${28 * view.k}px`);
    root.style.setProperty("--zk", String(view.k));   // the starfield's tiles scale with the board
    root.style.setProperty("--gx", `${view.x}px`);
    root.style.setProperty("--gy", `${view.y}px`);
    zoomLabel.textContent = `${Math.round(view.k * 100)}%`;
    backdropLayer.style.transform = `translate(${(view.x * 0.03).toFixed(1)}px, ${(view.y * 0.03).toFixed(1)}px)`;
  }
  // a smooth move for jumps (zoom buttons, fit, going to a player); dragging and the wheel stay instant
  let glideTimer = null;
  function glide(fn) {
    root.classList.add("gliding");
    fn(); applyView();
    clearTimeout(glideTimer);
    glideTimer = setTimeout(() => root.classList.remove("gliding"), 380);
  }
  function zoomAt(factor) {
    const r = stage.getBoundingClientRect();
    const c = toWorld(r.left + r.width / 2, r.top + r.height / 2);
    glide(() => { view.k = clamp(view.k * factor, 0.25, 3); view.x = r.width / 2 - c.x * view.k; view.y = r.height / 2 - c.y * view.k; });
  }
  function lookAt(wx, wy, k = view.k) {
    const r = stage.getBoundingClientRect();
    glide(() => { view.k = k; view.x = r.width / 2 - wx * k; view.y = r.height / 2 - wy * k; });
  }
  function fitAll() {
    const boxes = items.map((it) => it.type === "stroke"
      ? it.pts.reduce((b, [x, y]) => [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)], [Infinity, Infinity, -Infinity, -Infinity])
      : [it.x, it.y, it.x + (it.w || 200), it.y + (it.h || 60)]);
    if (!boxes.length) { lookAt(0, 0, 1); return; }
    const [x0, y0, x1, y1] = boxes.reduce((a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]);
    const r = stage.getBoundingClientRect();
    const k = clamp(Math.min((r.width - 160) / Math.max(1, x1 - x0), (r.height - 220) / Math.max(1, y1 - y0)), 0.25, 1.5);
    lookAt((x0 + x1) / 2, (y0 + y1) / 2, k);
  }
  const toWorld = (cx, cy) => {
    const r = stage.getBoundingClientRect();
    return { x: (cx - r.left - view.x) / view.k, y: (cy - r.top - view.y) / view.k };
  };
  function centre() {
    const r = stage.getBoundingClientRect();
    view.x = r.width / 2; view.y = r.height / 2;
    applyView();
  }
  stage.addEventListener("wheel", (e) => {
    e.preventDefault();
    const r = stage.getBoundingClientRect();
    const before = toWorld(e.clientX, e.clientY);
    view.k = clamp(view.k * Math.exp(-e.deltaY * 0.0015), 0.25, 3);
    view.x = e.clientX - r.left - before.x * view.k;
    view.y = e.clientY - r.top - before.y * view.k;
    applyView(true);
  }, { passive: false });

  // ------------------------------------------------------------------ toolbar
  const TOOLS = [
    ["move", "Move", "M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20"],
    ["note", "Note", "M5 4h14v11l-5 5H5zM14 20v-5h5"],
    ["pen", "Draw", "M4 20l4-1L19 8l-3-3L5 16zM14 7l3 3"],
    ["text", "Text", "M5 6V4h14v2M12 4v16M9 20h6"],
    ["erase", "Erase", "M7 20h12M5 15l8-8 6 6-5 5H9z"],
    ["ping", "Ping", "M12 12m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0M12 12m-6 0a6 6 0 1 0 12 0a6 6 0 1 0-12 0M12 12m-10 0a10 10 0 1 0 20 0"],
  ];
  const icon = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
  const thumb = el("span", { class: "hub-thumb", "aria-hidden": "true" });
  function moveThumb(instant = false) {
    const on = toolbar.querySelector(`.hub-tool[data-tool="${tool}"]`);
    if (!on) return;
    thumb.classList.toggle("instant", instant);
    thumb.style.width = `${on.offsetWidth}px`;
    thumb.style.transform = `translateX(${on.offsetLeft}px)`;
  }
  function setTool(id) {
    tool = id;
    toolbar.querySelectorAll(".hub-tool[data-tool]").forEach((b) => { b.classList.toggle("on", b.dataset.tool === id); b.setAttribute("aria-pressed", String(b.dataset.tool === id)); });
    stage.dataset.tool = id;
    moveThumb();
    drawSubbar();
  }
  function drawToolbar() {
    toolbar.replaceChildren(thumb, ...TOOLS.map(([id, label, d]) => {
      const key = Object.keys(SHORTCUTS).find((k) => SHORTCUTS[k] === id);
      const b = el("button", { type: "button", class: `hub-tool${tool === id ? " on" : ""}`, "data-tool": id, title: `${label} (${key.toUpperCase()})`, "aria-pressed": String(tool === id) });
      b.innerHTML = icon(d) + `<span>${label}</span>`;
      b.addEventListener("click", () => setTool(id));
      return b;
    }), el("span", { class: "hub-sep" }), dmButton());
    stage.dataset.tool = tool;
    requestAnimationFrame(() => moveThumb(true));
  }
  function dmButton() {
    if (dmToken) {
      const b = el("button", { type: "button", class: `hub-tool hub-dm${drawer.classList.contains("open") ? " on" : ""}`, title: "Encounters" });
      b.innerHTML = icon("M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h6m6 0h6M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z") + "<span>Encounters</span>";
      b.addEventListener("click", () => { drawer.classList.toggle("open"); if (drawer.classList.contains("open")) drawDrawer(); drawToolbar(); });
      const bd = el("button", { type: "button", class: "hub-tool", title: "Backdrop: a map behind the board" });
      bd.innerHTML = icon("M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14") + "<span>Backdrop</span>";
      bd.addEventListener("click", () => openBackdropMenu(bd));
      return el("span", { class: "hub-dm-tools" }, [b, bd]);
    }
    const b = el("button", { type: "button", class: "hub-tool", title: "I'm the DM" });
    b.innerHTML = icon("M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6zM9.5 12l2 2 3.5-4") + "<span>DM</span>";
    b.addEventListener("click", askDmPassword);
    return b;
  }
  function drawSubbar() {
    subbar.replaceChildren();
    subbar.classList.toggle("show", tool === "pen" || tool === "note" || tool === "erase" || tool === "ping");
    if (tool === "ping") subbar.append(el("span", { class: "hub-hint" }, "Hover a note, card or button and click to ripple round it, or click anywhere to mark the spot (Alt+click works with any tool)"));
    if (tool === "pen") {
      subbar.append(...[me.color, "#f4f4f5", "#ff5a4e", "#ffd23f", "#6fdc6a", "#4ea8ff", "#e36bff"].map((c) => {
        const s = el("button", { type: "button", class: `hub-swatch${penColor === c ? " on" : ""}`, style: `--c:${c}`, "aria-label": `Pen colour ${c}` });
        s.addEventListener("click", () => { penColor = c; drawSubbar(); });
        return s;
      }), el("span", { class: "hub-sep" }), ...PEN_WIDTHS.map((w) => {
        const s = el("button", { type: "button", class: `hub-width${penWidth === w ? " on" : ""}`, "aria-label": `Pen size ${w}` }, el("span", { style: `width:${w + 2}px;height:${w + 2}px` }));
        s.addEventListener("click", () => { penWidth = w; drawSubbar(); });
        return s;
      }));
    } else if (tool === "note") {
      subbar.append(el("span", { class: "hub-hint" }, "Click the board to stick a note"), ...NOTE_COLORS.map((c) => {
        const s = el("button", { type: "button", class: `hub-swatch${noteColor === c ? " on" : ""}`, style: `--c:${c}`, "aria-label": `Note colour ${c}` });
        s.addEventListener("click", () => { noteColor = c; drawSubbar(); });
        return s;
      }));
    }
    if (tool === "erase" || tool === "pen") {
      const clear = el("button", { type: "button", class: "hub-pill" }, dmToken ? "Clear all drawings" : "Clear my drawings");
      clear.addEventListener("click", async () => { await op({ op: "clearDrawings" }); say(dmToken ? "Drawings cleared." : "Your drawings are cleared."); });
      if (tool === "erase") subbar.append(el("span", { class: "hub-hint" }, dmToken ? "Click anything to remove it" : "Click your own notes or drawings to remove them"));
      subbar.append(clear);
    }
  }

  async function askDmPassword() {
    menu.classList.remove("wide");
    menu.replaceChildren();
    const pw = el("input", { type: "password", class: "hub-input", placeholder: "DM password", autocomplete: "current-password" });
    const go = el("button", { type: "button", class: "hub-pill solid" }, "Unlock");
    const attempt = async () => {
      go.disabled = true;
      const res = await dmLogin(pw.value);
      go.disabled = false;
      if (res?.ok) {
        try { localStorage.setItem(DM_TOKEN_KEY, res.token); } catch { /* ignore */ }
        dmToken = res.token; closeMenu(); drawToolbar(); drawSubbar(); rev = -1; say("DM tools unlocked. Open Encounters to place buttons.");
      } else { pw.value = ""; pw.placeholder = "That didn't work"; }
    };
    go.addEventListener("click", attempt);
    pw.addEventListener("keydown", (e) => { if (e.key === "Enter") attempt(); if (e.key === "Escape") closeMenu(); });
    menu.append(el("p", { class: "hub-menu-title" }, "Dungeon Master"), el("p", { class: "hub-menu-note" }, "The campaign owner can see the DM password in Settings → Campaign."), pw, go);
    const r = toolbar.getBoundingClientRect(), rr = root.getBoundingClientRect();
    openMenuAt(r.right - rr.left - 260, r.top - rr.top - 170);
    setTimeout(() => pw.focus(), 0);
  }

  // ------------------------------------------------------------------ server
  async function op(body) {
    const isNew = body.op === "put" && body.item && !items.some((it) => it.id === body.item.id);
    const res = await hubOp(me.id, body, dmToken);
    if (!res) { say("Couldn't save that. Check your connection."); return null; }
    if (res.error) { say(res.error); return null; }
    if (isNew) { undoStack.push(body.item.id); if (undoStack.length > 40) undoStack.shift(); }
    rev = -1;   // pull the board again on the next sync
    sync(true);
    return res;
  }

  async function sync(force = false) {
    if (!alive) return;
    if (inFlight) { if (force) again = true; return; }   // a change of mine is waiting: ask again as soon as this answer lands
    const now = Date.now();
    if (!force && !dirtyCursor && now - lastSent < IDLE_SYNC_MS) return;
    inFlight = true; dirtyCursor = false; lastSent = now;
    const cursor = pointerWorld ? { x: pointerWorld.x, y: pointerWorld.y, name: me.name, color: me.color, down: clicked } : null;
    const ping = pendingPing;
    clicked = false; pendingPing = null;
    const res = await hubSync(me.id, rev, cursor, ping);
    inFlight = false;
    if (again) { again = false; rev = -1; setTimeout(() => sync(true), 0); }
    if (!res || !alive) return;
    drawPeople(res.cursors || []);
    drawCursors(res.cursors || []);
    for (const pg of res.pings || []) {
      if (seenPings.has(pg.id)) continue;
      seenPings.add(pg.id);
      if (pg.by !== me.id) showPing(pg);
    }
    if ("backdrop" in res) setBackdrop(res.backdrop);
    if (res.items) { items = res.items; rev = res.rev; activeButton = res.activeButton; drawItems(); }
    else if (res.activeButton !== activeButton) { activeButton = res.activeButton; drawItems(); }
  }
  const timer = setInterval(() => {
    if (!document.body.contains(root)) { alive = false; clearInterval(timer); return; }
    if (!document.hidden) sync();
  }, SYNC_MS);

  // ------------------------------------------------------------------ cursors
  const cursorEls = new Map();   // player id -> element
  let cursorData = [];
  function drawCursors(list) {
    cursorData = list;
    const seen = new Set();
    for (const c of list) {
      seen.add(c.id);
      let node = cursorEls.get(c.id);
      if (!node) {
        node = el("div", { class: "hub-cursor" }, el("div", { class: "hub-cursor-inner" }, [el("span", { class: "hub-cursor-arrow" }), el("span", { class: "hub-cursor-name" })]));
        cursorLayer.append(node);
        cursorEls.set(c.id, node);
      }
      node.style.setProperty("--c", c.color);
      node.querySelector(".hub-cursor-name").textContent = c.name;
      if (c.down) { node.classList.remove("click"); void node.offsetWidth; node.classList.add("click"); }
    }
    for (const [id, node] of cursorEls) if (!seen.has(id)) { node.remove(); cursorEls.delete(id); }
    placeCursors();
  }
  function placeCursors() {
    for (const c of cursorData) {
      const node = cursorEls.get(c.id);
      if (!node) continue;
      node.style.transform = `translate(${c.x}px, ${c.y}px)`;
    }
  }
  function drawPeople(list) {
    const all = [{ id: me.id, name: me.name, color: me.color, self: true }, ...list];
    const avatar = (p) => {
      const isNew = !knownPeople.has(p.id);
      knownPeople.add(p.id);
      const b = el("button", { type: "button", class: `hub-avatar${p.self ? " self" : ""}${isNew ? " pop" : ""}`, style: `--c:${p.color}`, title: p.self ? `${p.name} (you)` : `Go to ${p.name}`, "aria-label": p.self ? `${p.name} (you)` : `Go to ${p.name}'s cursor` }, (p.name || "?").slice(0, 1).toUpperCase());
      if (!p.self) b.addEventListener("click", () => lookAt(p.x, p.y));
      return b;
    };
    people.replaceChildren(...[...all.slice(0, 9).map(avatar),
      all.length > 9 ? el("span", { class: "hub-avatar more" }, `+${all.length - 9}`) : null,
      el("span", { class: "hub-online" }, `${all.length} here`)].filter(Boolean));
  }

  // ------------------------------------------------------------------ items
  const itemEls = new Map();
  const mine = (it) => it.owner === me.id;
  const canEdit = (it) => !!dmToken || (mine(it) && it.type !== "button");

  function drawItems() {
    updateBounds();
    applyView();
    empty.classList.toggle("gone", welcomeGone || items.length > 0);
    // drawings go in the SVG
    const strokes = items.filter((it) => it.type === "stroke");
    ink.replaceChildren(...strokes.map((s) => {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      if (!knownStrokes.has(s.id)) { knownStrokes.add(s.id); if (rev > 0) path.classList.add("fresh"); }
      path.setAttribute("d", s.pts.map((p, i) => `${i ? "L" : "M"}${p[0]} ${p[1]}`).join(" "));
      path.setAttribute("stroke", s.color);
      path.setAttribute("stroke-width", String(s.width));
      path.dataset.id = s.id;
      return path;
    }));
    const seen = new Set();
    for (const it of items) {
      if (it.type === "stroke") continue;
      seen.add(it.id);
      let node = itemEls.get(it.id);
      const fresh = !node;
      if (fresh) {
        node = it.type === "note" ? makeNote(it) : it.type === "text" ? makeText(it) : it.type === "mon" || it.type === "move" ? makeCard() : makeButton(it);
        node.dataset.id = it.id;
        node.classList.add("hub-enter");
        itemLayer.append(node);
        itemEls.set(it.id, node);
        setTimeout(() => node.classList.remove("hub-enter"), 500);
      }
      node.__item = it;
      node.style.left = `${it.x}px`; node.style.top = `${it.y}px`;
      if (it.type === "note") {
        node.style.setProperty("--note", it.color);
        node.style.width = `${it.w}px`; node.style.minHeight = `${it.h}px`;
        const ta = node.querySelector("textarea");
        if (document.activeElement !== ta) ta.value = it.text;
        ta.readOnly = !canEdit(it);
        node.classList.toggle("editable", canEdit(it));
        node.querySelector(".hub-note-by").textContent = it.byName || "";
      } else if (it.type === "text") {
        node.style.color = it.color; node.style.fontSize = `${it.size}px`;
        if (!node.isContentEditable) node.textContent = it.text;
      } else if (it.type === "mon" || it.type === "move") {
        fillCard(node, it, state);
      } else {
        fillButton(node, it);
      }
    }
    for (const [id, node] of itemEls) {
      if (seen.has(id)) continue;
      itemEls.delete(id);
      node.classList.add("hub-leave");
      setTimeout(() => node.remove(), 220);
    }
  }

  function makeNote(it) {
    const ta = el("textarea", { class: "hub-note-text", spellcheck: "true", "aria-label": "Note", placeholder: "Write something…" });
    let saveTimer = null;
    ta.addEventListener("input", () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => { const cur = node.__item; op({ op: "put", item: { ...cur, text: ta.value } }); }, 500);
    });
    const dots = el("div", { class: "hub-note-tools" }, [
      ...NOTE_COLORS.map((c) => {
        const d = el("button", { type: "button", class: "hub-note-dot", style: `--c:${c}`, "aria-label": "Note colour", title: "Colour" });
        d.addEventListener("click", (e) => { e.stopPropagation(); op({ op: "put", item: { ...node.__item, color: c } }); });
        return d;
      }),
      (() => { const x = el("button", { type: "button", class: "hub-note-del", "aria-label": "Delete note", title: "Delete" }, "×"); x.addEventListener("click", (e) => { e.stopPropagation(); op({ op: "delete", itemId: node.__item.id }); }); return x; })(),
    ]);
    const node = el("div", { class: "hub-note" }, [
      el("div", { class: "hub-note-grip" }, [el("span", { class: "hub-note-by" }), dots]),
      ta, el("span", { class: "hub-note-resize", "aria-hidden": "true" }),
    ]);
    void it;
    return node;
  }
  const makeText = () => el("div", { class: "hub-text" });

  function makeButton() {
    return el("button", { type: "button", class: "hub-btn" }, [el("span", { class: "hub-btn-icon", "aria-hidden": "true" }), el("span", { class: "hub-btn-label" }), el("span", { class: "hub-btn-live" }, "Battle live")]);
  }
  function fillButton(node, it) {
    node.className = `hub-btn kind-${it.source.kind}${activeButton === it.id ? " live" : ""}`;
    node.querySelector(".hub-btn-label").textContent = it.label;
    node.setAttribute("aria-label", `${it.label}: ${activeButton === it.id ? "battle in progress, open it" : dmToken ? "start this battle" : "open the battle"}`);
  }

  // ------------------------------------------------------------------ backdrop (the DM's map, blurred, behind the dots)
  async function setBackdrop(bd) {
    backdrop = bd || null;
    const key = backdrop ? `${backdrop.fileId}|${backdrop.blur}|${backdrop.dim}` : "";
    if (key === shownBackdrop) return;
    shownBackdrop = key;
    backdropLayer.style.setProperty("--blur", `${backdrop?.blur ?? 12}px`);
    backdropLayer.style.setProperty("--dim", String((backdrop?.dim ?? 35) / 100));
    const current = backdropLayer.querySelector("img.in");
    if (current && current.dataset.file === backdrop?.fileId) return;   // only the blur or dim changed
    const old = [...backdropLayer.querySelectorAll("img")];
    const retire = () => old.forEach((img) => { img.classList.remove("in"); setTimeout(() => img.remove(), 1600); });
    root.classList.toggle("cosmic", !backdrop);
    if (!backdrop) { retire(); return; }
    const url = await fileUrl(backdrop.fileId);
    if (!url || shownBackdrop !== key) return;
    const img = el("img", { class: "hub-backdrop-img", alt: "", "data-file": backdrop.fileId, src: url });
    img.addEventListener("load", () => { requestAnimationFrame(() => { img.classList.add("in"); retire(); }); }, { once: true });
    backdropLayer.append(img);
  }

  async function openBackdropMenu(anchor) {
    const list = el("div", { class: "hub-bd-list" }, el("p", { class: "hub-menu-note" }, "Loading your maps…"));
    const blur = el("input", { type: "range", min: "0", max: "30", value: String(backdrop?.blur ?? 12), "aria-label": "Blur" });
    const dim = el("input", { type: "range", min: "0", max: "80", value: String(backdrop?.dim ?? 35), "aria-label": "Darken" });
    const file = el("input", { type: "file", accept: "image/*", hidden: "" });
    let chosen = backdrop?.fileId || null, timer = null;
    const send = () => { clearTimeout(timer); timer = setTimeout(() => op(chosen ? { op: "backdrop", fileId: chosen, blur: Number(blur.value), dim: Number(dim.value) } : { op: "backdrop", fileId: null }), 250); };
    blur.addEventListener("input", () => { backdropLayer.style.setProperty("--blur", `${blur.value}px`); if (chosen) send(); });
    dim.addEventListener("input", () => { backdropLayer.style.setProperty("--dim", String(dim.value / 100)); if (chosen) send(); });
    const upload = el("button", { type: "button", class: "hub-pill" }, "Upload a map…");
    upload.addEventListener("click", () => file.click());
    file.addEventListener("change", async () => {
      const f = file.files[0]; if (!f) return;
      upload.textContent = "Uploading…"; upload.disabled = true;
      const res = await uploadFile("map", f, { name: f.name });
      upload.textContent = "Upload a map…"; upload.disabled = false;
      if (res.error) { say(res.error); return; }
      chosen = res.file.id; send(); drawList();
    });
    async function drawList() {
      const res = await listFiles("map");
      const files = res?.files || [];
      const cosmic = el("button", { type: "button", class: `hub-bd-pick cosmic${chosen ? "" : " on"}`, "aria-label": "Cosmic: twinkling stars, no map" }, el("span", {}, "Cosmic"));
      cosmic.addEventListener("click", () => { chosen = null; send(); list.querySelectorAll(".hub-bd-pick").forEach((x) => x.classList.toggle("on", x === cosmic)); });
      list.replaceChildren(cosmic, ...(files.length ? files.map((f) => {
        const b = el("button", { type: "button", class: `hub-bd-pick${f.id === chosen ? " on" : ""}`, title: f.name, "aria-label": `Use ${f.name}` }, el("span", {}, f.name.replace(/\.[^.]+$/, "")));
        fileUrl(f.id).then((url) => { if (url) b.style.backgroundImage = `url("${url}")`; });
        b.addEventListener("click", () => { chosen = f.id; send(); list.querySelectorAll(".hub-bd-pick").forEach((x) => x.classList.toggle("on", x === b)); });
        return b;
      }) : [el("p", { class: "hub-menu-note" }, "No maps yet. Upload one, or add them in the Campaign Planner's Maps.")]));
    }
    menu.replaceChildren(
      el("p", { class: "hub-menu-title" }, "Backdrop"),
      el("p", { class: "hub-menu-note" }, "Cosmic stars, or one of your maps blurred behind the board. Everyone sees it."),
      list,
      el("label", { class: "hub-range" }, [el("span", {}, "Blur"), blur]),
      el("label", { class: "hub-range" }, [el("span", {}, "Darken"), dim]),
      el("div", { class: "hub-menu-row" }, [upload]), file,
    );
    menu.classList.add("wide");
    const r = anchor.getBoundingClientRect(), rr = root.getBoundingClientRect();
    openMenuAt(r.left - rr.left - 120, r.top - rr.top - 470);
    drawList();
  }

  function openAccountMenu() {
    const item = (label, fn, cls = "") => { const b = el("button", { type: "button", class: `hub-menu-item ${cls}` }, label); b.addEventListener("click", () => { closeMenu(); fn(); }); return b; };
    menu.classList.remove("wide");
    menu.replaceChildren(
      el("p", { class: "hub-menu-title" }, accountBtn.dataset.email || "Account"),
      item("Settings", () => openFromHub("settings")),
      item("Sign out", async () => { await logout(); location.reload(); }, "danger"),
    );
    const r = accountBtn.getBoundingClientRect(), rr = root.getBoundingClientRect();
    openMenuAt(r.right - rr.left - 260, r.bottom - rr.top + 8);
  }

  // ------------------------------------------------------------------ text, typed where you click
  function editText(node, onDone) {
    node.contentEditable = "plaintext-only";
    if (node.contentEditable !== "plaintext-only") node.contentEditable = "true";   // older browsers
    node.classList.add("editing");
    node.focus();
    const range = document.createRange(); range.selectNodeContents(node); range.collapse(false);
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
    let done = false;
    const finish = (keep) => {
      if (done) return; done = true;
      node.contentEditable = "false"; node.classList.remove("editing");
      onDone(keep ? node.innerText.replace(/\n$/, "").trim().slice(0, 400) : null);
    };
    node.addEventListener("keydown", function keys(e) {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); node.removeEventListener("keydown", keys); node.blur(); }
      else if (e.key === "Escape") { e.preventDefault(); node.removeEventListener("keydown", keys); finish(false); node.blur(); }
      e.stopPropagation();
    });
    node.addEventListener("blur", () => finish(true), { once: true });
  }
  function newTextAt(p) {
    const node = el("div", { class: "hub-text draft", style: `left:${Math.round(p.x)}px;top:${Math.round(p.y - 16)}px;color:${me.color};font-size:28px` });
    itemLayer.append(node);
    editText(node, async (text) => {
      node.remove();
      if (text) await op({ op: "put", item: { type: "text", id: uid(), x: Math.round(p.x), y: Math.round(p.y - 16), text, size: 28, color: me.color } });
    });
  }
  function editExistingText(node) {
    const it = node.__item;
    editText(node, async (text) => {
      if (text === null) { node.textContent = it.text; return; }
      if (text === it.text) return;
      await op(text ? { op: "put", item: { ...it, text } } : { op: "delete", itemId: it.id });
    });
  }

  // ------------------------------------------------------------------ pings
  function showPing(pg) {
    const box = pg.item ? boxOf(pg.item) : null;
    if (box) {
      const ring = el("div", { class: "hub-ping-box", style: `left:${box.x}px;top:${box.y}px;width:${box.w}px;height:${box.h}px;--c:${pg.color}` }, [
        el("span", { class: "hub-ping-frame" }), el("span", { class: "hub-ping-frame f2" }), el("span", { class: "hub-ping-frame f3" }),
        el("span", { class: "hub-ping-name" }, pg.name),
      ]);
      itemLayer.append(ring);
      box.node?.classList.add("pinged");
      box.node?.style.setProperty("--pc", pg.color);
      setTimeout(() => { ring.remove(); box.node?.classList.remove("pinged"); }, 2600);
      return;
    }
    const node = el("div", { class: "hub-ping", style: `left:${pg.x}px;top:${pg.y}px;--c:${pg.color}` }, [
      el("span", { class: "hub-ping-ring" }), el("span", { class: "hub-ping-ring r2" }), el("span", { class: "hub-ping-dot" }),
      el("span", { class: "hub-ping-name" }, pg.name),
    ]);
    itemLayer.append(node);
    setTimeout(() => node.remove(), 2400);
  }
  function ping(at, target = null) {
    pendingPing = { x: Math.round(at.x), y: Math.round(at.y), ...(target ? { item: target } : {}) };
    showPing({ ...pendingPing, color: me.color, name: me.name });
    sync(true);
  }
  // what a ping would point at under the pointer: a note, text, card, encounter button or drawing
  function pingTargetOf(t) {
    const node = t?.closest?.(".hub-note, .hub-text, .hub-btn, .hub-card");
    if (node && itemLayer.contains(node)) return node.dataset.id;
    return t?.closest?.(".hub-ink path")?.dataset?.id || null;
  }
  let lit = null;
  function highlight(id) {
    const node = id ? itemEls.get(id) || ink.querySelector(`path[data-id="${CSS.escape(id)}"]`) : null;
    if (node === lit) return;
    lit?.classList.remove("ping-target");
    lit = node;
    lit?.classList.add("ping-target");
  }
  // the world-space box round an item, for ripples that hug it
  function boxOf(id) {
    const node = itemEls.get(id);
    if (node) return { x: node.offsetLeft, y: node.offsetTop, w: node.offsetWidth, h: node.offsetHeight, node };
    const it = items.find((x) => x.id === id && x.type === "stroke");
    if (!it) return null;
    const xs = it.pts.map((p) => p[0]), ys = it.pts.map((p) => p[1]);
    const pad = it.width / 2 + 4;
    return { x: Math.min(...xs) - pad, y: Math.min(...ys) - pad, w: Math.max(...xs) - Math.min(...xs) + pad * 2, h: Math.max(...ys) - Math.min(...ys) + pad * 2, node: ink.querySelector(`path[data-id="${CSS.escape(id)}"]`) };
  }

  // ------------------------------------------------------------------ hover card on encounter buttons
  function showHover(node) {
    const it = node.__item, pv = it.preview || {};
    const species = pv.name ? state?.pokemonByName?.get(pv.name) : null;
    const art = species?.dex ? el("img", { class: "hub-hover-sprite", src: spriteUrl(species.dex), alt: pv.name }) : el("span", { class: "hub-hover-q", "aria-hidden": "true" }, "?");
    const kind = it.source.kind === "npc" ? "Trainer" : it.source.kind === "wild" ? "Wild Pokémon" : "Encounter";
    hover.replaceChildren(
      el("div", { class: "hub-hover-art" }, art),
      el("div", { class: "hub-hover-body" }, [
        el("span", { class: "hub-hover-kind" }, kind),
        el("strong", { class: "hub-hover-level" }, pv.level ? `Lv. ${pv.level}` : "Lv. ?"),
        el("span", { class: "hub-hover-note" }, pv.missing ? "No longer in the DM's library" : pv.name ? (pv.count > 1 ? `${pv.name} and ${pv.count - 1} more` : pv.name) : pv.count > 1 ? `${it.source.kind === "npc" ? "Lead Pokémon" : "First Pokémon"} · ${pv.count} in all` : "A mystery"),
        activeButton === it.id ? el("span", { class: "hub-hover-live" }, "Battle in progress") : null,
      ].filter(Boolean)),
    );
    const r = node.getBoundingClientRect(), rr = root.getBoundingClientRect();
    hover.style.left = `${r.left - rr.left + r.width / 2}px`;
    hover.style.top = `${r.top - rr.top}px`;
    hover.classList.add("show");
  }
  const hideHover = () => hover.classList.remove("show");
  itemLayer.addEventListener("pointerover", (e) => { const b = e.target.closest(".hub-btn"); if (b && e.pointerType === "mouse") showHover(b); });
  itemLayer.addEventListener("pointerout", (e) => { const b = e.target.closest(".hub-btn"); if (b && !b.contains(e.relatedTarget)) hideHover(); });

  // ------------------------------------------------------------------ button menu (DM) and clicks
  function openMenuAt(x, y) {
    const rr = root.getBoundingClientRect();
    menu.style.left = `${clamp(x, 8, rr.width - 280)}px`;
    menu.style.top = `${clamp(y, 8, rr.height - 60)}px`;
    menu.classList.add("show");
  }
  function closeMenu() { menu.classList.remove("show"); }
  document.addEventListener("pointerdown", function outside(e) {
    if (!document.body.contains(root)) { document.removeEventListener("pointerdown", outside); return; }
    if (!menu.contains(e.target) && !e.target.closest(".hub-btn") && !e.target.closest(".hub-tool") && !e.target.closest(".hub-account")) closeMenu();
  });

  function buttonClicked(node) {
    const it = node.__item;
    hideHover();
    if (!dmToken) { openFromHub("battleview"); return; }
    const row = (label, fn, cls = "") => { const b = el("button", { type: "button", class: `hub-menu-item ${cls}` }, label); b.addEventListener("click", () => { closeMenu(); fn(); }); return b; };
    menu.classList.remove("wide");
    menu.replaceChildren(...[
      el("p", { class: "hub-menu-title" }, it.label),
      row(activeButton === it.id ? "Restart this battle" : "Start this battle", () => startBattle(it), "primary"),
      activeButton === it.id ? row("Open Battle Control", () => { setViewState("controlcentre:tab", "Battle Control"); openFromHub("controlcentre"); }) : null,
      activeButton === it.id ? row("Mark the battle as over", () => op({ op: "activate", itemId: null })) : null,
      row(it.reveal === "sprite" ? "Hide the Pokémon on hover (show ?)" : "Show the Pokémon on hover", () => op({ op: "put", item: { ...it, reveal: it.reveal === "sprite" ? "hidden" : "sprite" } })),
      row("Rename", () => {
        const name = prompt("Button name", it.label);
        if (name && name.trim()) op({ op: "put", item: { ...it, label: name.trim().slice(0, 60) } });
      }),
      row("Remove from the hub", () => op({ op: "delete", itemId: it.id }), "danger"),
    ].filter(Boolean));
    const r = node.getBoundingClientRect(), rr = root.getBoundingClientRect();
    openMenuAt(r.left - rr.left, r.bottom - rr.top + 8);
  }

  // ------------------------------------------------------------------ starting a battle (DM)
  const cloneMon = (m) => JSON.parse(JSON.stringify(m));
  const combatant = (sourceKind, sourceId, sourceLabel, mon, side) => ({
    id: `${Date.now()}${Math.random()}`, sourceKind, sourceId, sourceLabel, mon: cloneMon(mon),
    priority: false, tiebreak: null, megaEvolved: false, megaFrom: null, side,
  });

  function planEncounter(sourceId) {
    const [boardId, nodeId] = String(sourceId || "").split(":");
    const board = getPlan().boards.find((b) => b.id === boardId);
    return board?.nodes.find((n) => n.id === nodeId) || null;
  }

  async function enemyCombatants(it) {
    const src = it.source;
    if (src.kind === "npc") {
      const npc = await getNpc(src.id);
      const lead = (npc?.team?.party || []).find((m) => m?.name);
      return lead ? [combatant("npc", src.id, npc.name || "NPC", lead, "B")] : [];
    }
    if (src.kind === "wild") {
      const mon = await getWildMon(src.id);
      return mon?.name ? [combatant("wild", src.id, mon.nickname || mon.name, mon, "B")] : [];
    }
    // A planner encounter: each Pokémon becomes a Wild Library entry, so damage and catches land somewhere real.
    // A trainer or gym leader from the planner brings their whole team in the order the DM set; a wild group, all of it.
    const node = planEncounter(src.id);
    const mons = node?.mons?.length ? node.mons : src.mons;
    const owner = node?.identity?.name || (node && node.gen !== "wild" ? node.title : "");
    const out = [];
    for (const m of mons || []) {
      const species = state?.pokemonByName?.get(m.name);
      const mon = {
        id: crypto.randomUUID ? crypto.randomUUID() : uid(), dex: m.dex ?? species?.dex ?? null, name: m.name, nickname: m.nickname || "", level: m.level || 5, currentHp: null,
        item: m.item || "", ability: m.ability || "", status: "None", moves: [...(m.moves || []), "", "", "", ""].slice(0, 4),
      };
      const res = await dmAction(dmToken, "wildSave", { mon });
      if (res?.wildId) out.push(combatant("wild", res.wildId, owner || `Wild ${m.name}`, { ...mon, id: res.wildId }, "B"));
    }
    return out;
  }

  async function startBattle(it) {
    say("Setting up the battle…");
    const current = await getFullTurn();
    if (current?.combatants?.length && activeButton !== it.id && !confirm("A battle is already set up. Replace it with this one?")) return;
    const enemies = await enemyCombatants(it);
    if (!enemies.length) { say("That encounter has no Pokémon. Add some in the DM's library or planner first."); return; }
    // every trainer who's online brings their lead Pokémon (the DM can change the line-up in Battle Control)
    const players = [];
    for (const t of await listTrainers(me.id)) {
      const team = await getTrainerTeam(t.id);
      const lead = (team?.team?.party || []).find((m) => m?.name && m.currentHp !== 0);
      if (lead) players.push(combatant("player", t.id, t.name || "A trainer", lead, "A"));
    }
    const res = await dmAction(dmToken, "fullTurnSave", {
      combatants: [...players, ...enemies], currentIndex: 0, round: 1,
      background: current?.background || "", spreadHitsAllies: !!current?.spreadHitsAllies, phase: "vs",
    });
    if (!res?.ok) { say("Couldn't start the battle. Unlock DM tools again."); return; }
    await op({ op: "activate", itemId: it.id });
    setViewState("controlcentre:tab", "Battle Control");
    openFromHub("controlcentre");
  }

  // ------------------------------------------------------------------ the DM's encounter drawer
  async function drawDrawer() {
    drawer.replaceChildren(el("div", { class: "hub-drawer-head" }, [el("strong", {}, "Encounters"), el("span", {}, "Drag one onto the board")]), el("p", { class: "hub-drawer-note" }, "Loading…"));
    const [npcs, wild] = await Promise.all([getNpcs(), getWildList()]);
    const plan = [];
    for (const b of getPlan().boards) for (const n of b.nodes) if (n.type === "gen" && ["wild", "trainer", "gym"].includes(n.gen) && n.mons?.length) plan.push({ b, n });
    const entry = (label, meta, kind, source) => {
      const row = el("div", { class: `hub-src kind-${kind}`, draggable: "true", role: "button", tabindex: "0" }, [
        el("span", { class: "hub-btn-icon", "aria-hidden": "true" }), el("span", { class: "hub-src-text" }, [el("strong", {}, label), el("span", {}, meta)]),
      ]);
      const payload = { label, source };
      row.addEventListener("dragstart", (e) => { e.dataTransfer.setData("application/x-hub-button", JSON.stringify(payload)); e.dataTransfer.effectAllowed = "copy"; });
      const placeHere = () => { const r = stage.getBoundingClientRect(); addButton(payload, toWorld(r.left + r.width / 2, r.top + r.height / 2)); };
      row.addEventListener("keydown", (e) => { if (e.key === "Enter") placeHere(); });
      row.addEventListener("dblclick", placeHere);
      return row;
    };
    const group = (title, rows, emptyText) => el("section", { class: "hub-drawer-group" }, [el("h3", {}, title), ...(rows.length ? rows : [el("p", { class: "hub-drawer-note" }, emptyText)])]);
    drawer.replaceChildren(
      el("div", { class: "hub-drawer-head" }, [el("strong", {}, "Encounters"), el("span", {}, "Drag one onto the board, or double-click it")]),
      group("NPC trainers", npcs.map((n) => entry(n.name || "NPC", `${n.partyCount} Pokémon`, "npc", { kind: "npc", id: n.id })), "Add trainers in Control Centre → NPC Library."),
      group("Wild Pokémon", wild.map((w) => entry(w.name || "Wild Pokémon", w.level ? `Lv. ${w.level}` : "", "wild", { kind: "wild", id: w.id })), "Add Pokémon in Control Centre → Wild Library."),
      group("From your planner", plan.map(({ b, n }) => entry((n.identity?.name || n.title.replace(/^Wild encounter — /, "")).slice(0, 48), `${n.genLabel || "Encounter"} · ${n.mons.length} Pokémon`, n.gen === "wild" ? "wild" : "npc",
        { kind: "plan", id: `${b.id}:${n.id}`, title: n.title, mons: n.mons.map((m) => ({ name: m.name, level: m.level })) })), "Roll a wild encounter, trainer or gym leader on a Campaign Planner whiteboard and it shows up here."),
    );
  }
  async function addButton(payload, at) {
    // don't stack a new button exactly on top of another one
    let x = Math.round(at.x - 70), y = Math.round(at.y - 24);
    while (items.some((it) => it.type === "button" && Math.abs(it.x - x) < 40 && Math.abs(it.y - y) < 30)) { x += 34; y += 58; }
    await op({ op: "put", item: { type: "button", id: uid(), x, y, label: payload.label.slice(0, 60), reveal: "hidden", source: payload.source } });
    say("Encounter placed. Players can hover it to see the level.");
  }
  async function placeCard(card, at) {
    let x = Math.round(at.x - 110), y = Math.round(at.y - 40);
    while (items.some((it) => (it.type === "mon" || it.type === "move") && Math.abs(it.x - x) < 30 && Math.abs(it.y - y) < 30)) { x += 28; y += 28; }
    await op({ op: "put", item: { ...card, id: uid(), x, y, open: false } });
  }
  stage.addEventListener("dragover", (e) => {
    const t = e.dataTransfer.types;
    if (t.includes(CARD_MIME) || (dmToken && t.includes("application/x-hub-button"))) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }
  });
  stage.addEventListener("drop", (e) => {
    const card = e.dataTransfer.getData(CARD_MIME);
    if (card) { e.preventDefault(); try { placeCard(JSON.parse(card), toWorld(e.clientX, e.clientY)); } catch { /* not ours */ } return; }
    const raw = e.dataTransfer.getData("application/x-hub-button");
    if (!raw || !dmToken) return;
    e.preventDefault();
    addButton(JSON.parse(raw), toWorld(e.clientX, e.clientY));
  });

  // ------------------------------------------------------------------ pointer: pan, drag, draw, place
  let gesture = null;
  let liveStroke = null;
  const capture = (id) => { try { stage.setPointerCapture(id); } catch { /* that pointer is already gone */ } };
  stage.addEventListener("pointermove", (e) => {
    const r = stage.getBoundingClientRect();
    pointerWorld = toWorld(e.clientX, e.clientY);
    dirtyCursor = true;
    myTag.style.transform = `translate(${e.clientX - r.left}px, ${e.clientY - r.top}px)`;
    myTag.classList.add("show");
    highlight(tool === "ping" || e.altKey ? pingTargetOf(e.target) : null);
    if (!gesture) return;
    const dx = e.clientX - gesture.sx, dy = e.clientY - gesture.sy;
    if (Math.hypot(dx, dy) > 4) gesture.moved = true;
    if (gesture.kind === "pan") { view.x = gesture.ox + dx; view.y = gesture.oy + dy; applyView(true); }
    else if (gesture.kind === "resize") {
      gesture.node.style.width = `${clamp(gesture.iw + dx / view.k, 140, 900)}px`;
      gesture.node.style.minHeight = `${clamp(gesture.ih + dy / view.k, 100, 900)}px`;
    } else if (gesture.kind === "drag" && gesture.moved) {
      gesture.node.style.left = `${gesture.ix + dx / view.k}px`; gesture.node.style.top = `${gesture.iy + dy / view.k}px`;
      gesture.node.classList.add("dragging");
    } else if (gesture.kind === "pen") {
      gesture.pts.push([Math.round(pointerWorld.x), Math.round(pointerWorld.y)]);
      liveStroke.setAttribute("d", gesture.pts.map((p, i) => `${i ? "L" : "M"}${p[0]} ${p[1]}`).join(" "));
    }
  });
  stage.addEventListener("pointerleave", () => { pointerWorld = null; dirtyCursor = true; myTag.classList.remove("show"); });

  stage.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 && e.button !== 1) return;
    closeMenu();
    clicked = true; dirtyCursor = true;
    if (e.button === 0 && (tool === "ping" || e.altKey)) { ping(toWorld(e.clientX, e.clientY), pingTargetOf(e.target)); return; }
    if (e.target.closest(".hub-note-tools") || e.target.isContentEditable) return;
    const itemNode = e.target.closest(".hub-note, .hub-text, .hub-btn, .hub-card");
    if (e.target.classList.contains("hub-note-resize") && itemNode && canEdit(itemNode.__item)) {
      gesture = { sx: e.clientX, sy: e.clientY, moved: false, kind: "resize", node: itemNode, iw: itemNode.__item.w, ih: itemNode.__item.h };
      capture(e.pointerId);
      return;
    }
    const strokeId = e.target.closest?.("path")?.dataset?.id;
    const start = { sx: e.clientX, sy: e.clientY, moved: false, id: e.pointerId };
    if (e.button === 1) { gesture = { ...start, kind: "pan", ox: view.x, oy: view.y }; capture(e.pointerId); return; }
    if (tool === "erase") {
      const id = itemNode?.dataset.id || strokeId;
      const it = items.find((x) => x.id === id);
      if (it && (dmToken || (mine(it) && it.type !== "button"))) op({ op: "delete", itemId: id });
      else if (it) say("You can only remove your own notes and drawings.");
      return;
    }
    if (tool === "pen") {
      const p = toWorld(e.clientX, e.clientY);
      gesture = { ...start, kind: "pen", pts: [[Math.round(p.x), Math.round(p.y)]] };
      liveStroke = document.createElementNS("http://www.w3.org/2000/svg", "path");
      liveStroke.setAttribute("stroke", penColor); liveStroke.setAttribute("stroke-width", String(penWidth));
      ink.append(liveStroke);
      capture(e.pointerId);
      return;
    }
    if (itemNode && e.target.tagName === "TEXTAREA" && !e.target.readOnly) return;   // typing in a note
    if (itemNode) {
      const it = itemNode.__item;
      const movable = it && (it.type === "button" ? !!dmToken : canEdit(it));
      gesture = { ...start, kind: movable ? "drag" : "click", node: itemNode, ix: it.x, iy: it.y };
      capture(e.pointerId);
      return;
    }
    if (tool === "note" || tool === "text") { gesture = { ...start, kind: tool }; return; }
    gesture = { ...start, kind: "pan", ox: view.x, oy: view.y };
    capture(e.pointerId);
  });

  stage.addEventListener("pointerup", async (e) => {
    const g = gesture; gesture = null;
    if (!g) return;
    try { stage.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
    if (g.kind === "pen") {
      const pts = simplify(g.pts);
      if (pts.length >= 2) await op({ op: "put", item: { type: "stroke", id: uid(), pts, color: penColor, width: penWidth } });
      liveStroke?.remove(); liveStroke = null;
      return;
    }
    if (g.kind === "resize") {
      const it = g.node.__item;
      await op({ op: "put", item: { ...it, w: Math.round(clamp(g.iw + (e.clientX - g.sx) / view.k, 140, 900)), h: Math.round(clamp(g.ih + (e.clientY - g.sy) / view.k, 100, 900)) } });
      return;
    }
    if ((g.kind === "drag" || g.kind === "click") && !g.moved) {
      if (g.node.classList.contains("hub-btn")) buttonClicked(g.node);
      else if (g.node.classList.contains("hub-note")) g.node.querySelector("textarea").focus();
      else if (g.node.classList.contains("hub-text") && canEdit(g.node.__item)) editExistingText(g.node);
      else if (g.node.classList.contains("hub-card") && canEdit(g.node.__item)) await op({ op: "put", item: { ...g.node.__item, open: !g.node.__item.open } });
      return;
    }
    if (g.kind === "drag" && g.moved) {
      const it = g.node.__item;
      g.node.classList.remove("dragging");
      await op({ op: "put", item: { ...it, x: Math.round(it.x + (e.clientX - g.sx) / view.k), y: Math.round(it.y + (e.clientY - g.sy) / view.k) } });
      return;
    }
    if (g.kind === "note" && !g.moved) {
      const p = toWorld(e.clientX, e.clientY);
      const id = uid();
      const res = await op({ op: "put", item: { type: "note", id, x: Math.round(p.x - 110), y: Math.round(p.y - 30), w: 220, h: 160, text: "", color: noteColor } });
      if (res) { setTool("move"); setTimeout(() => itemEls.get(id)?.querySelector("textarea")?.focus(), 400); }
      return;
    }
    if (g.kind === "text" && !g.moved) newTextAt(toWorld(e.clientX, e.clientY));
  });

  // shortcuts anywhere on the page while the hub is open (never while typing)
  document.addEventListener("keydown", function keys(e) {
    if (!document.body.contains(root)) { document.removeEventListener("keydown", keys); return; }
    if (typing(e.target)) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      while (undoStack.length) {
        const id = undoStack.pop();
        if (items.some((it) => it.id === id)) { e.preventDefault(); op({ op: "delete", itemId: id }); say("Undone."); return; }
      }
      return;
    }
    if (e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (SHORTCUTS[k]) { setTool(SHORTCUTS[k]); e.preventDefault(); }
    else if (k === "f") { fitAll(); e.preventDefault(); }
    else if (k === "escape") { closeMenu(); drawer.classList.remove("open"); hideHover(); closeDex(); }
  });

  function simplify(pts) {
    const out = [];
    for (const p of pts) { const last = out[out.length - 1]; if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) >= 3) out.push(p); }
    if (out.length <= 600) return out;
    const step = out.length / 600;
    return Array.from({ length: 600 }, (_, i) => out[Math.floor(i * step)]);
  }

  // keyboard: arrows pan, +/- zoom, 0 recentres
  stage.addEventListener("keydown", (e) => {
    if (e.target !== stage) return;
    const step = 60;
    if (e.key === "ArrowLeft") view.x += step; else if (e.key === "ArrowRight") view.x -= step;
    else if (e.key === "ArrowUp") view.y += step; else if (e.key === "ArrowDown") view.y -= step;
    else if (e.key === "+" || e.key === "=") view.k = clamp(view.k * 1.15, 0.25, 3);
    else if (e.key === "-") view.k = clamp(view.k / 1.15, 0.25, 3);
    else if (e.key === "0") { view.k = 1; centre(); return; }
    else return;
    e.preventDefault(); applyView(true);
  });

  // ------------------------------------------------------------------ start
  drawToolbar(); drawSubbar();
  requestAnimationFrame(() => { centre(); sync(true); });
  (async () => {
    const t = getDmToken();
    if (t && await checkDmToken(t)) { dmToken = t; drawToolbar(); drawSubbar(); if (items.length) drawItems(); }
  })();
  void getActiveCampaign;
}
