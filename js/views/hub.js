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

import { el, makeCombo } from "../components.js";
import { loadSave, writeSave, addBagItem, useBagItem, bagEntries, newMon } from "../storage.js";
import {
  hubSync, hubOp, getNpcs, getNpc, getWildList, getWildMon, listTrainers, getTrainerTeam, getFullTurn, dmAction,
  dmLogin, checkDmToken, getActiveCampaign, getRoster, sendToTrainer, getInbox, ackInbox,
} from "../network.js";
import { categorizeItem, SECTION_LABELS, SECTION_ORDER, tmMoveNames, tmName } from "../bagItems.js";
import { BALL_TYPES } from "../calc.js";
import { HEAL_ITEMS, STATUS_HEAL_ITEMS } from "../battleItems.js";
import { openIconPicker } from "../iconPicker.js";
import { addLogEntry } from "../log.js";
import { describeItem } from "../itemDescriptions.js";
import { itemIconSrc, MONEY } from "../bagIcon.js";
import { myEggs, hatch, EGG_ICON } from "../eggs.js";
import { hubSound } from "../hubSound.js";
import { rayquazaConstellation } from "../constellation.js";
import { nebulaLayer } from "../nebula.js";
import { cursorColorOf } from "../cursorColor.js";
import { listFiles, uploadFile, fileUrl } from "../network.js";
import { fetchMe, logout } from "../account.js";
import { getForcedTheme } from "../deviceSettings.js";
import { dexPanel, makeCard, fillCard, CARD_MIME } from "../hubDex.js";
import { NAV_ICONS } from "../navIcons.js";
import { refreshPullTabs } from "../logDrawer.js";
import { calcAllStats } from "../calc.js";
import { askLevel, askNumber } from "../levelAsk.js";
import { mountHubMap } from "../hubMap.js";
import { mountWheel, sheetDrag, spring } from "../mobile/wheel.js";
import { trainerSpriteUrl } from "../trainerSpritePicker.js";

// Buttons for the rest of the app. Beside the "Hub" title (a bar like the tool bar at the bottom): your trainer's
// pages, the Pokédex and Move Dex (one pull-out with both) and the stat calculator. Down the right-hand side: the
// shared tools. The Library, rulebook and so on are pull tabs on the right edge; Admin is in Settings.
const QUICK = [
  ["team", "My Team", "M5 8a3 3 0 1 0 6 0 3 3 0 0 0-6 0zM13 8a3 3 0 1 0 6 0 3 3 0 0 0-6 0zM9 16a3 3 0 1 0 6 0 3 3 0 0 0-6 0z"],
  ["bag", "Bag", "M6 8h12l1 12H5zM9 8V6a3 3 0 0 1 6 0v2M9 12h6"],
  ["trainer", "Trainer", "M4 5h16v14H4zM9 10a2 2 0 1 0 0-.01M6.5 15.5a3 3 0 0 1 5 0M14 9h4M14 12h4M14 15h3"],
  ["dex", "Dex", "M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h11M9 8h6"],
  ["statcalc", "Stats", "M5 20V10M10 20V4M15 20v-7M20 20v-12"],
];
const RIGHT_PAGES = [["mapeditor", "Map editor"], ["planner", "Whiteboard"], ["controlcentre", "Control Centre"]];
// line icons for the round page buttons, in the hub's style (the Whiteboard's comes from navIcons.js)
const PAGE_ICONS = {
  mapeditor: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6.5l6-2.5 6 2.5 6-2.5v13.5l-6 2.5-6-2.5-6 2.5zM9 4v13.5M15 6.5V20"/></svg>',
  controlcentre: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="17" r="2"/></svg>',
};

// The prop library: pictures to drop on the board (stored by name; drawn from this list).
export const PROPS = [
  ["tree", "🌲", "Pine"], ["oak", "🌳", "Tree"], ["bush", "🌿", "Grass"], ["flower", "🌸", "Flowers"], ["mushroom", "🍄", "Mushroom"],
  ["rock", "🪨", "Rock"], ["mountain", "⛰️", "Mountain"], ["water", "🌊", "Water"], ["fire", "🔥", "Fire"], ["cave", "🕳️", "Cave"],
  ["house", "🏠", "House"], ["center", "🏥", "Pokémon Center"], ["castle", "🏰", "Castle"], ["tent", "⛺", "Camp"], ["bridge", "🌉", "Bridge"],
  ["boat", "⛵", "Boat"], ["sign", "🪧", "Sign"], ["flag", "🚩", "Flag"], ["chest", "🧰", "Chest"], ["gem", "💎", "Gem"],
  ["key", "🗝️", "Key"], ["egg", "🥚", "Egg"], ["berry", "🍒", "Berries"], ["swords", "⚔️", "Fight"], ["shield", "🛡️", "Guard"],
  ["skull", "💀", "Danger"], ["ghost", "👻", "Haunted"], ["star", "⭐", "Star"], ["question", "❓", "Mystery"], ["exclaim", "❗", "Alert"],
];
const PROP_BY_ID = new Map(PROPS.map(([id, glyph, label]) => [id, { glyph, label }]));
const SHAPES = [["rect", "Box", "M4 6h16v12H4z"], ["ellipse", "Circle", "M12 5a8 6.5 0 1 0 .01 0z"], ["line", "Line", "M5 19L19 5"], ["arrow", "Arrow", "M5 19L19 5M10 5h9v9"]];
import { getPlan } from "../planner/store.js";
import { spriteUrl } from "../sprites.js";
import { setViewState } from "../viewState.js";
import { ensureDmToken, clearDmToken } from "../systems/dnd5e/dmAccess.js";

const SYNC_MS = 60;           // how often the page reports its cursor (and any stroke being drawn) while the mouse is moving
const IDLE_SYNC_MS = 500;     // and how often it checks in when nothing is moving (other people's cursors, board changes)
const GIFT_MS = 4000;         // how often it checks for things other players sent you
const NOTE_COLORS = ["#fff6c2", "#ffe0d6", "#dcf8e4", "#dcefff", "#efe3ff", "#ffffff"];   // light, so notes stand out on the dark board
const PEN_WIDTHS = [3, 6, 12];
const uid = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const SHORTCUTS = { v: "move", n: "note", d: "pen", t: "text", e: "erase", s: "shape", r: "prop", p: "ping" };
// The board's edge: you can pan (and zoom out) only as far as a margin around everything on it, and never less than the
// base area round the middle. Put something near the edge and the edge moves out with it.
const BASE_AREA = { x0: -2600, y0: -1700, x1: 2600, y1: 1700 };
const EDGE_PAD = 1300;   // board units of open space kept round the content
const typing = (t) => t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
const CARD_TYPES = new Set(["mon", "move", "item", "trainer"]);

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
  let shapeKind = "rect", shapeFill = false, propId = "tree", propSize = 72;
  let noteDm = false;             // the DM's note tool: the next note is one only the DM sees
  let wheel = null;               // the phone layout's radial wheel (js/mobile/wheel.js)
  let welcomeGone = false;

  // ------------------------------------------------------------------ layout
  const root = el("div", { class: "hub", style: `--me:${me.color}` });
  const backdropLayer = el("div", { class: "hub-backdrop", "aria-hidden": "true" });
  const dots = el("div", { class: "hub-dots", "aria-hidden": "true" });
  // The starfield belongs to the board, like the dots: four repeating star patterns (css/hub.css .hub-starfield) whose
  // position and size follow the pan and zoom, each fading in and out on its own rhythm so the stars twinkle.
  const stars = el("div", { class: "hub-stars", "aria-hidden": "true" }, [1, 2, 3, 4].map((n) => el("div", { class: `hub-starfield s${n}` })));
  // each layer: its tile size (css/hub.css) and how much of the pan it follows (parallax, the faintest slowest)
  const starLayers = [[520, 0.72], [430, 0.58], [610, 0.85], [370, 0.44]].map(([tile, par], i) => [stars.children[i], tile, par]);
  let shownK = null;
  // Rayquaza's constellation, far off: it follows a fifth of the pan, from wherever the board opened
  stars.prepend(nebulaLayer("hub-nebula"));   // violet smoke, light flares and drifting shards, behind the stars
  const constellation = rayquazaConstellation("hub-constellation");
  stars.append(constellation);
  // where each star layer (and the constellation) sits on screen: set from the board's pan and zoom in applyView
  const skyPos = starLayers.map(() => null);
  let conPos = null, lastView = null;
  const stage = el("div", { class: "hub-stage", tabindex: "0", "aria-label": "Shared hub board" });
  // The board's edge is a drifting white mist: it gathers on a side as you get near the edge there, and swirls up
  // brighter when you bump into it.
  const edgeGlow = el("div", { class: "hub-edge", "aria-hidden": "true" }, ["left", "right", "top", "bottom"].map((side) => el("span", { class: `hub-edge-${side}` }, [el("i"), el("i"), el("i")])));
  function updateMist() {
    const r = stage.getBoundingClientRect();
    if (!r.width) return;
    const near = (d) => Math.max(0, Math.min(1, 1 - d / 260)).toFixed(2);
    const k = view.k;
    const d = { left: view.x + bounds.x0 * k, right: r.width - (view.x + bounds.x1 * k), top: view.y + bounds.y0 * k, bottom: r.height - (view.y + bounds.y1 * k) };
    for (const side of ["left", "right", "top", "bottom"]) edgeGlow.querySelector(`.hub-edge-${side}`).style.setProperty("--m", near(-d[side]));
  }
  const world = el("div", { class: "hub-world" });
  const ink = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  ink.setAttribute("class", "hub-ink");
  const itemLayer = el("div", { class: "hub-items" });
  // Other players' cursors sit on the board itself (world coordinates), like everything else people put there, so they
  // stay exactly over the same spot while you zoom or pan; only their arrow and name are kept at screen size.
  const cursorLayer = el("div", { class: "hub-cursors", "aria-hidden": "true" });
  const draftInk = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  draftInk.setAttribute("class", "hub-ink hub-drafts");
  draftInk.setAttribute("aria-hidden", "true");
  world.append(ink, draftInk, itemLayer, cursorLayer);
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
    const b = el("button", { type: "button", class: `hub-round hub-page-btn${view === "controlcentre" ? " hub-dm-page" : ""}`, "aria-label": label, title: label, "data-view": view });
    b.innerHTML = `<span class="hub-page-icon">${PAGE_ICONS[view] || NAV_ICONS[view] || ""}</span>`;
    b.append(el("span", { class: "hub-page-label" }, label));
    b.addEventListener("click", () => openFromHub(view));
    return b;
  };
  const appBtns = el("div", { class: "hub-apps" }, RIGHT_PAGES.map(([v, l]) => pageBtn(v, l)));
  appBtns.querySelector('[data-view="controlcentre"]')?.setAttribute("hidden", "");   // shown once the server says you're a DM
  const quick = el("div", { class: "hub-quick", role: "toolbar", "aria-label": "Your trainer" }, QUICK.map(([view, label, d]) => {
    const b = el("button", { type: "button", class: "hub-tool", title: label, "data-view": view });
    b.innerHTML = glyph(d) + `<span>${label}</span>`;
    b.addEventListener("click", () => (view === "dex" ? toggleDex(dexOpen ? null : "pokemon") : view === "bag" ? toggleBag() : openFromHub(view)));
    return b;
  }));
  const topbar = el("div", { class: "hub-top" }, [
    el("div", { class: "hub-top-left" }, [el("div", { class: "hub-title" }, [el("span", { class: "hub-eyebrow" }, "Pokémon D&D"), el("strong", {}, "Hub")]), quick]),
    el("div", { class: "hub-top-right" }, [appBtns, people, ...(getForcedTheme() ? [] : [themeBtn]), settingsBtn, accountBtn]),   // a campaign's own theme has no toggle
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
  // the Pokédex and Move Dex: one pull-out (the Dex button), switching between the two inside it
  const dexHost = el("div", { class: "hub-dex-host" });
  let dexOpen = null, dexEl = null;
  function toggleDex(kind) {
    if (!kind) { closeDex(); return; }
    const already = dexOpen;
    dexOpen = kind;
    const panel = dexPanel(state, kind, {
      onSwitch: (k) => toggleDex(k),
      onClose: closeDex,
      openFull: () => openFromHub(kind === "pokemon" ? "pokedex" : "moves"),
      onPlace: (card) => { const r = stage.getBoundingClientRect(); placeCard(card, toWorld(r.left + r.width / 2, r.top + r.height / 2)); },
    });
    dexHost.replaceChildren(panel);
    dexEl = panel;
    sheetDrag(panel, closeDex);
    if (already) panel.classList.add("open");   // switching tabs: no slide
    else { void panel.offsetWidth; panel.classList.add("open"); }   // lay it out closed first, so it slides in
    panel.focusSearch();
    quick.querySelector('[data-view="dex"]').classList.add("on");
  }
  function closeDex() {
    dexOpen = null;
    const old = dexEl; dexEl = null;
    old?.classList.remove("open");
    setTimeout(() => { if (old && !old.classList.contains("open")) old.remove(); }, 300);
    quick.querySelector('[data-view="dex"]').classList.remove("on");
  }

  // ---- your team, bottom left: up to six sprites in party order, each with its health; drag one onto the board.
  // Above it, your trainer: portrait, name and money. Click it for the Trainer page; drag it onto the board for a card
  // with your character's details.
  const teamStrip = el("div", { class: "hub-team", role: "list", "aria-label": "Your team" });
  const meBadge = el("button", { type: "button", class: "hub-me", draggable: "true", title: "Your trainer: click for the Trainer page, drag onto the board for a card" });
  const leftDock = el("div", { class: "hub-left-dock" }, [meBadge, teamStrip]);
  let teamSig = "", meSig = "";
  const money = (n) => `£${(Number(n) || 0).toLocaleString()}`;
  function trainerFields(s) {
    const t = s.trainer || {};
    const party = (s.party || []).filter((m) => m && m.name);
    const bonus = t.abilityBonus || {};
    const score = (k) => { const v = t.abilities?.[k]; return v === null || v === undefined || v === "" ? null : Number(v) + (bonus.plus2 === k ? 2 : 0) + (bonus.plus1 === k ? 1 : 0); };
    return [
      ["Money", money(t.cash)], ["Badges", String(t.badges ?? 0)],
      ["Party", party.length ? party.map((m) => `${m.nickname || m.name} Lv ${m.level ?? "?"}`).join(", ") : "None yet"],
      ...["Strength", "Charisma", "Intelligence", "Pokémon"].map((k) => [k, score(k)]).filter(([, v]) => v !== null).map(([k, v]) => [k, String(v)]),
      ["Occupation", t.occupation], ["From", t.originRegion], ["Age", t.age], ["Gender", t.gender], ["Trainer ID", t.trainerId],
      ["Proficiency", t.proficiencyBonus ? `+${t.proficiencyBonus}` : ""],
      ["Skills", Object.entries(t.skillProficiencies || {}).filter(([, on]) => on).map(([k]) => k).join(", ")],
      ["PC box", (s.pc || []).filter((m) => m && m.name).length ? `${(s.pc || []).filter((m) => m && m.name).length} Pokémon` : ""],
    ].filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== "").map(([k, v]) => [k, String(v).slice(0, 200)]);
  }
  const trainerCard = (s) => ({
    type: "trainer", name: s.trainer?.name?.trim() || "Trainer", sprite: s.trainer?.sprite || "", fields: trainerFields(s),
    backstory: String(s.trainer?.backstory || "").slice(0, 1500),
    party: (s.party || []).filter((m) => m && m.name).slice(0, 6).map((m) => ({ name: m.name, dex: m.dex || state?.pokemonByName?.get(m.name)?.dex || 0, level: Number(m.level) || null })),
  });
  function drawMe() {
    const s = loadSave(), t = s.trainer || {};
    const sig = JSON.stringify([t.name, t.sprite, t.cash]);
    if (sig === meSig) return;
    meSig = sig;
    meBadge.replaceChildren(
      t.sprite ? el("img", { class: "hub-me-face", src: trainerSpriteUrl(t.sprite), alt: "", draggable: "false" }) : el("span", { class: "hub-me-face hub-me-initial" }, (t.name || "?")[0].toUpperCase()),
      el("span", { class: "hub-me-text" }, [el("strong", {}, t.name?.trim() || "Your trainer"), el("span", {}, money(t.cash))]),
    );
  }
  meBadge.addEventListener("click", () => openFromHub("trainer"));
  meBadge.addEventListener("dragstart", (e) => {
    e.dataTransfer.setData(CARD_MIME, JSON.stringify(trainerCard(loadSave())));
    e.dataTransfer.effectAllowed = "copy";
  });
  function drawTeam() {
    drawMe();
    const party = (loadSave().party || []).filter((m) => m && m.name).slice(0, 6);
    const rows = party.map((m) => {
      const species = state?.pokemonByName?.get(m.name);
      const level = Math.min(100, Math.max(1, Number(m.level) || 1));
      const max = species ? calcAllStats(species, level, 15, 0, 1).hp : null;
      const cur = m.currentHp === null || m.currentHp === undefined ? max : m.currentHp;
      return { m, dex: m.dex || species?.dex || null, max, cur, pct: max ? Math.max(0, Math.min(100, (cur / max) * 100)) : 100 };
    });
    const sig = JSON.stringify(rows.map((r) => [r.m.id, r.m.name, r.m.nickname, r.dex, r.cur, r.max, r.m.moves, r.m.item, r.m.level]));
    if (sig === teamSig) return;
    teamSig = sig;
    teamStrip.replaceChildren(...(rows.length ? rows.map(({ m, dex, max, cur, pct }) => {
      const name = m.nickname || m.name;
      const slot = el("div", { class: `hub-team-mon${cur === 0 ? " fainted" : ""}`, role: "listitem", draggable: "true", tabindex: "0",
        title: `${name} · Lv ${m.level ?? "?"} · ${max === null ? "HP unknown" : `${cur}/${max} HP`} — drag onto the board` }, [
        dex ? el("img", { src: spriteUrl(dex), alt: name, draggable: "false" }) : el("span", { class: "hub-team-q" }, "?"),
        el("span", { class: "hub-team-hp", "aria-label": max === null ? "HP unknown" : `${cur} of ${max} HP` }, el("span", { style: `width:${pct}%` })),
      ]);
      slot.addEventListener("dragstart", (e) => {
        const card = { type: "mon", name: m.name, dex, level: Number(m.level) || null, hp: max === null ? undefined : [cur, max], moves: (m.moves || []).filter(Boolean),
          nickname: m.nickname || "", held: m.item || "", ability: m.ability || "", status: m.status || "" };
        e.dataTransfer.setData(CARD_MIME, JSON.stringify(card));
        e.dataTransfer.effectAllowed = "copyMove";
        startOwnDrag({ kind: "mon", id: m.id, label: name });
      });
      slot.addEventListener("dragend", endOwnDrag);
      slot.addEventListener("pointerdown", (e) => e.stopPropagation());
      slot.addEventListener("click", () => openFromHub("team"));
      slot.addEventListener("keydown", (e) => { if (e.key === "Enter") openFromHub("team"); });
      return slot;
    }) : [el("button", { type: "button", class: "hub-team-empty" }, "Add Pokémon in My Team")]));
    teamStrip.querySelector(".hub-team-empty")?.addEventListener("click", () => openFromHub("team"));
  }
  window.addEventListener("pokemon-dnd-save-changed", function onSave() { if (!document.body.contains(root)) { window.removeEventListener("pokemon-dnd-save-changed", onSave); return; } drawTeam(); if (bagDrop.classList.contains("open")) drawBag(); });

  // ---- the Bag: a drop-down under its button. Every item (and your money, as a Key Item) can be dragged onto the board
  // as a card, or onto Send To to give it to another player.
  const bagDrop = el("div", { class: "hub-bag-drop", role: "dialog", "aria-label": "Bag" });
  for (const ev of ["pointerdown", "pointermove", "pointerup", "wheel"]) bagDrop.addEventListener(ev, (e) => e.stopPropagation(), { passive: true });
  // the item names the add box suggests (the site's own suggestion list, makeCombo, not the browser's)
  let itemNames = null;
  let bagSuggest = null;   // the add box's suggestion list, moved onto the page (drawBag)
  function fillItemOptions() {
    if (itemNames) return;
    const names = [MONEY, ...BALL_TYPES, ...HEAL_ITEMS.map((h) => h.name), ...STATUS_HEAL_ITEMS.map((h) => h.name), ...(state.items || []).map((it) => it.name), ...tmMoveNames(state).map((m) => tmName(m))];
    itemNames = [...new Set(names)];
  }
  async function drawBag() {
    fillItemOptions();
    const s = loadSave();
    const bySection = { ball: [], medicine: [], tm: [], held: [], key: [] };
    bagEntries(s).forEach(([name, count]) => bySection[categorizeItem(name, state)]?.push([name, count]));
    bySection.key.unshift([MONEY, Number(s.trainer?.cash) || 0]);
    // add an item (anything not in the rules becomes a Key Item; "Money" adds to your money)
    const nameCombo = makeCombo({ options: itemNames, placeholder: "Add an item…" });
    nameCombo.classList.add("hub-bag-combo");
    const nameIn = nameCombo.inputEl;
    nameIn.classList.add("hub-input");
    nameIn.setAttribute("aria-label", "Item to add");
    // The Bag clips what's inside it, so the suggestions live on the page instead, pinned under the box and as tall as
    // the room below it allows (they used to cut off after a couple of options).
    document.querySelectorAll(".hub-bag-suggest").forEach((n) => n.remove());   // last draw's (or a previous visit's)
    bagSuggest = nameCombo.querySelector(".combo-list");
    bagSuggest.classList.add("hub-bag-suggest");
    for (const ev of ["pointerdown", "pointermove", "pointerup", "wheel"]) bagSuggest.addEventListener(ev, (e) => e.stopPropagation(), { passive: true });
    document.body.append(bagSuggest);
    const placeSuggest = () => {
      if (!document.body.contains(nameIn)) { bagSuggest?.remove(); return; }
      const r = nameIn.getBoundingClientRect();
      Object.assign(bagSuggest.style, { left: `${r.left}px`, top: `${r.bottom + 4}px`, width: `${Math.max(r.width, 220)}px`, maxHeight: `${Math.min(440, Math.max(160, innerHeight - r.bottom - 16))}px` });
    };
    for (const ev of ["focus", "input", "keydown"]) nameIn.addEventListener(ev, placeSuggest);
    bagDrop.addEventListener("scroll", placeSuggest, { passive: true });
    const qtyIn = el("input", { type: "number", class: "hub-input hub-bag-qty", min: "1", value: "1", "aria-label": "How many" });
    const addBtn = el("button", { type: "button", class: "hub-pill solid" }, "Add");
    const add = () => {
      const name = nameIn.value.trim(), qty = Math.max(1, Math.round(Number(qtyIn.value) || 1));
      if (!name) { nameIn.focus(); return; }
      const sv = loadSave();
      if (name.toLowerCase() === MONEY.toLowerCase()) { sv.trainer.cash = (Number(sv.trainer.cash) || 0) + qty; addLogEntry(`Added £${qty} to your money.`); }
      else { addBagItem(sv, name, qty); addLogEntry(`Added ${qty}× ${name} to the Bag.`); }
      writeSave(sv); drawBag(); drawTeam();
      window.dispatchEvent(new CustomEvent("pokemon-dnd-save-changed"));
    };
    addBtn.addEventListener("click", add);
    nameIn.addEventListener("keydown", (e) => { if (e.key === "Enter") add(); e.stopPropagation(); });
    qtyIn.addEventListener("keydown", (e) => { if (e.key === "Enter") add(); e.stopPropagation(); });
    const sections = SECTION_ORDER.filter((sec) => bySection[sec].length).map((sec) => el("section", { class: "hub-bag-sec" }, [
      el("h4", {}, `${SECTION_LABELS[sec]} (${bySection[sec].length})`),
      el("div", { class: "hub-bag-grid" }, bySection[sec].sort((a2, b2) => (a2[0] === MONEY ? -1 : b2[0] === MONEY ? 1 : a2[0].localeCompare(b2[0]))).map(([name, count]) => {
        const img = el("img", { alt: "", draggable: "false" });
        const isMoney = name === MONEY;
        const tools = el("span", { class: "hub-bag-tools" });
        itemIconSrc(name, state, s.itemIcons || {}).then((src) => {
          img.src = src;
          if (!isMoney && src.includes("unknown-item")) {   // no picture found: offer to pick one
            const pick = el("button", { type: "button", class: "hub-bag-mini", title: "Pick an icon" }, "Icon");
            pick.addEventListener("click", (e) => { e.stopPropagation(); openIconPicker((picked) => { const sv = loadSave(); sv.itemIcons = sv.itemIcons || {}; sv.itemIcons[name] = picked; writeSave(sv); drawBag(); }); });
            tools.prepend(pick);
          }
        });
        if (!isMoney) {
          const use = el("button", { type: "button", class: "hub-bag-mini", title: "Use one / remove one" }, "−1");
          use.addEventListener("click", (e) => { e.stopPropagation(); const sv = loadSave(); useBagItem(sv, name, 1); writeSave(sv); drawBag(); window.dispatchEvent(new CustomEvent("pokemon-dnd-save-changed")); });
          tools.append(use);
        }
        const cell = el("div", { class: `hub-bag-item${isMoney ? " money" : ""}`, draggable: "true", tabindex: "0", role: "listitem",
          title: `${name}${isMoney ? "" : ` ×${count}`}: ${isMoney ? "your money" : describeItem(name, state)}\nDrag onto the board, onto a trainer's card, or onto Send To` }, [
          img, el("span", { class: "hub-bag-name" }, name), el("span", { class: "hub-bag-count" }, isMoney ? money(count) : `×${count}`), tools,
        ]);
        cell.addEventListener("dragstart", (e) => {
          e.stopPropagation();
          e.dataTransfer.setData(CARD_MIME, JSON.stringify({ type: "item", name }));
          e.dataTransfer.effectAllowed = "copyMove";
          startOwnDrag({ kind: isMoney ? "money" : "item", name, count, label: name });
        });
        cell.addEventListener("dragend", endOwnDrag);
        // a press on an item never reaches the board (no panning or drawing under the bag)
        cell.addEventListener("pointerdown", (e) => e.stopPropagation());
        return cell;
      }), ...(sec === "key" ? eggCells() : [])),
    ]));
    bagDrop.replaceChildren(
      el("div", { class: "hub-bag-head" }, [el("strong", {}, "Bag"), el("span", { class: "hub-menu-note" }, "Drag items onto the board, a trainer's card or Send To")]),
      el("div", { class: "hub-bag-add" }, [nameCombo, qtyIn, addBtn]),
      ...sections,
    );
  }
  // Mystery Eggs from the DM: Key Items you can't send on, only hatch (what's inside stays secret until then)
  function eggCells() {
    return myEggs().map((egg) => {
      const hatchBtn = el("button", { type: "button", class: "hub-bag-mini" }, "Hatch");
      hatchBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        hatchBtn.disabled = true;
        const r = await hatch(state, egg.id);
        say(r.text);
        if (r.ok) { drawBag(); drawTeam(); hubSound("hatch"); } else hatchBtn.disabled = false;
      });
      return el("div", { class: "hub-bag-item egg", role: "listitem", title: "A Mystery Egg from the DM. Something is moving inside..." }, [
        el("img", { src: EGG_ICON, alt: "", draggable: "false" }), el("span", { class: "hub-bag-name" }, "Mystery Egg"),
        el("span", { class: "hub-bag-count" }, "Ready to hatch"), el("span", { class: "hub-bag-tools" }, [hatchBtn]),
      ]);
    });
  }
  function toggleBag() {
    const btn = quick.querySelector('[data-view="bag"]');
    if (bagDrop.classList.contains("open")) { bagDrop.classList.remove("open"); btn.classList.remove("on"); return; }
    drawBag();
    const br = btn.getBoundingClientRect(), rr = root.getBoundingClientRect();
    bagDrop.style.left = `${Math.max(8, br.left - rr.left - 8)}px`;
    bagDrop.classList.add("open"); btn.classList.add("on");
  }
  document.addEventListener("pointerdown", function outsideBag(e) {
    if (!document.body.contains(root)) { document.removeEventListener("pointerdown", outsideBag); return; }
    // (its suggestion list lives outside the Bag window but belongs to it: picking an option mustn't close the Bag)
    if (!bagDrop.contains(e.target) && !e.target.closest?.('.hub-quick [data-view="bag"], .hub-bag-suggest')) { bagDrop.classList.remove("open"); quick.querySelector('[data-view="bag"]')?.classList.remove("on"); }
  });

  // ---- Send To: while you drag one of your own Pokémon or items, a target appears bottom right. Drop it there and pick
  // who gets it (any player in the campaign); for more than one of something, say how many. It leaves your save and
  // lands in theirs the next time their hub checks in.
  const sendZone = el("div", { class: "hub-sendto", "aria-hidden": "true" }, [
    el("span", { class: "hub-sendto-icon" }), el("span", { class: "hub-sendto-text" }, [el("strong", {}, "Send To"), el("span", {}, "Drop here to give it to a player")]),
  ]);
  sendZone.querySelector(".hub-sendto-icon").innerHTML = glyph("M4 12l16-8-6 16-2.5-6.5zM11.5 13.5L20 4");
  let ownDrag = null;
  function startOwnDrag(own) { ownDrag = own; sendZone.classList.add("show"); }
  function endOwnDrag() { setTimeout(() => { sendZone.classList.remove("show", "hot"); itemLayer.querySelectorAll(".hub-card.send-hot").forEach((x) => x.classList.remove("send-hot")); ownDrag = null; }, 0); }
  sendZone.addEventListener("dragover", (e) => { if (!ownDrag) return; e.preventDefault(); e.dataTransfer.dropEffect = "move"; sendZone.classList.add("hot"); });
  sendZone.addEventListener("dragleave", () => sendZone.classList.remove("hot"));
  sendZone.addEventListener("drop", (e) => {
    if (!ownDrag) return;
    e.preventDefault();
    const own = ownDrag;
    sendZone.classList.remove("show", "hot");
    openSendMenu(own);
  });
  async function openSendMenu(own) {
    menu.classList.remove("wide");
    menu.replaceChildren(el("p", { class: "hub-menu-title" }, `Send ${own.label} to…`), el("p", { class: "hub-menu-note" }, "Finding players…"));
    const zr = sendZone.getBoundingClientRect(), rr = root.getBoundingClientRect();
    // in the Send To box's own place: same right edge and bottom, growing upwards
    const atZone = () => { menu.style.left = `${zr.right - rr.left - menu.offsetWidth}px`; menu.style.top = `${Math.max(8, zr.bottom - rr.top - menu.offsetHeight)}px`; };
    menu.classList.add("show", "at-send"); atZone();
    const roster = (await getRoster()) || [];
    const others = roster.filter((t) => t.id !== me.id);
    menu.replaceChildren(el("p", { class: "hub-menu-title" }, `Send ${own.label} to…`), ...(others.length ? others.map((t) => {
      const b = el("button", { type: "button", class: "hub-menu-item hub-send-pick" }, [
        t.sprite ? el("img", { src: trainerSpriteUrl(t.sprite), alt: "" }) : el("span", { class: "hub-avatar small" }, (t.name || "?")[0].toUpperCase()),
        el("span", {}, t.name || "Trainer"), el("span", { class: `hub-send-dot${t.online ? " on" : ""}`, title: t.online ? "Online" : "Offline: they'll get it next time" }),
      ]);
      b.addEventListener("click", () => { closeMenu(); sendOwn(own, t, zr); });
      return b;
    }) : [el("p", { class: "hub-menu-note" }, "Nobody else is in this campaign yet.")]));
    atZone();
  }
  // Dropping something of yours on another player's trainer card: the same as Send To, after a check.
  function confirmSendTo(own, to, node) {
    const have = own.kind === "mon" ? 1 : own.kind === "money" ? Number(loadSave().trainer?.cash) || 0 : Number(loadSave().bag?.[own.name]) || 0;
    const qty = have > 1 ? el("input", { type: "number", class: "hub-input", min: "1", max: String(have), value: own.kind === "money" ? "" : "1", placeholder: own.kind === "money" ? "Amount (£)" : "How many", "aria-label": "How many" }) : null;
    const go = el("button", { type: "button", class: "hub-pill solid" }, "Send");
    const no = el("button", { type: "button", class: "hub-pill" }, "Cancel");
    menu.classList.remove("wide", "at-send");
    menu.replaceChildren(el("p", { class: "hub-menu-title" }, `Send ${own.label} to ${to.name}?`),
      el("p", { class: "hub-menu-note" }, own.kind === "mon" ? "It leaves your team and joins theirs." : `You have ${own.kind === "money" ? money(have) : have}.`),
      ...(qty ? [qty] : []), el("div", { class: "hub-menu-row" }, [no, go]));
    no.addEventListener("click", closeMenu);
    go.addEventListener("click", () => {
      const n = qty ? Math.round(Number(qty.value)) : 1;
      if (qty && !(n >= 1 && n <= have)) { qty.classList.add("bad"); qty.focus(); return; }
      closeMenu(); sendOwn(own, to, node.getBoundingClientRect(), n);
    });
    const r = node.getBoundingClientRect(), rr = root.getBoundingClientRect();
    openMenuAt(r.left - rr.left, r.bottom - rr.top + 8);
    setTimeout(() => (qty || go).focus(), 0);
  }
  async function sendOwn(own, to, at, preset = null) {
    const s = loadSave();
    let type, payload, done;
    if (own.kind === "mon") {
      const inParty = s.party.findIndex((m) => m.id === own.id), inPc = s.pc.findIndex((m) => m.id === own.id);
      const mon = inParty >= 0 ? s.party[inParty] : s.pc[inPc];
      if (!mon) { say("That Pokémon isn't in your team any more."); return; }
      type = "pokemon"; payload = JSON.parse(JSON.stringify(mon));
      done = () => { if (inParty >= 0) s.party.splice(inParty, 1); else s.pc.splice(inPc, 1); };
    } else {
      const have = own.kind === "money" ? Number(s.trainer?.cash) || 0 : Number(s.bag?.[own.name]) || 0;
      if (have < 1) { say(`You don't have any ${own.name} to send.`); return; }
      let n = preset || 1;
      if (preset && preset > have) { say(`You only have ${have}.`); return; }
      if (have > 1 && !preset) {
        n = await askNumber({ x: at.left - 120, y: at.top - 150, title: `Send ${own.name} to ${to.name}`, label: own.kind === "money" ? "How much? £" : "How many?", min: 1, max: have, initial: own.kind === "money" ? "" : 1, okLabel: "Send" });
        if (!n) return;
      }
      if (own.kind === "money") { type = "cash"; payload = { amount: n }; done = () => { s.trainer.cash = (Number(s.trainer.cash) || 0) - n; }; }
      else { type = "item"; payload = { name: own.name, count: n }; done = () => useBagItem(s, own.name, n); }
    }
    const res = await sendToTrainer({ fromId: me.id, fromName: me.name, toId: to.id, type, payload });
    if (!res || res.error) { say(res?.error ? `Couldn't send that: ${res.error}` : "Couldn't send that. Check your connection."); return; }
    done();
    writeSave(s);
    drawTeam(); if (bagDrop.classList.contains("open")) drawBag();
    window.dispatchEvent(new CustomEvent("pokemon-dnd-save-changed"));
    say(`Sent ${type === "cash" ? money(payload.amount) : type === "item" ? `${payload.count > 1 ? `${payload.count}× ` : ""}${payload.name}` : own.label} to ${to.name}.`);
  }

  // ---- gifts: what other players (or the DM) sent you lands in your save while the hub is open
  const APPLIED_KEY = "pkdnd-applied-gifts";
  async function checkGifts() {
    const msgs = await getInbox(me.id);
    if (!msgs?.length) return;
    let applied = [];
    try { applied = JSON.parse(localStorage.getItem(APPLIED_KEY) || "[]"); } catch { applied = []; }
    const s = loadSave();
    const said = [], ids = [];
    for (const m of msgs) {
      ids.push(m.id);
      if (applied.includes(m.id)) continue;   // already in the save (the acknowledgement didn't get through last time)
      applied.push(m.id);
      const from = m.fromName || "A trainer";
      if (m.type === "pokemon" && m.payload) {
        const mon = { ...newMon(), ...m.payload, id: newMon().id };
        if (s.party.length < 6) s.party.push(mon); else s.pc.push(mon);
        said.push(`${from} sent you ${mon.nickname || mon.name}${s.party.includes(mon) ? "" : " (in your PC)"}`);
      } else if (m.type === "cash") {
        s.trainer.cash = (Number(s.trainer.cash) || 0) + (Number(m.payload?.amount) || 0);
        said.push(`${from} sent you ${money(m.payload?.amount)}`);
      } else if (m.type === "item" && m.payload?.name) {
        addBagItem(s, m.payload.name, Math.max(1, Number(m.payload.count) || 1));
        said.push(`${from} sent you ${m.payload.count > 1 ? `${m.payload.count}× ` : ""}${m.payload.name}`);
      } else if (m.type === "note") {
        said.push(`${from}: ${m.payload?.text || ""}`);
      }
    }
    try { localStorage.setItem(APPLIED_KEY, JSON.stringify(applied.slice(-200))); } catch { /* storage full or blocked */ }
    if (said.length) {
      writeSave(s);
      drawTeam(); if (bagDrop.classList.contains("open")) drawBag();
      window.dispatchEvent(new CustomEvent("pokemon-dnd-save-changed"));
      say(said.join(" · "));
    }
    await ackInbox(me.id, ids);
  }

  // ---- who's here: the "N here" pill opens a small list of the trainers online and their teams
  const peopleDrop = el("div", { class: "hub-people-drop", role: "dialog", "aria-label": "Trainers online" });
  async function togglePeople() {
    if (peopleDrop.classList.contains("open")) { peopleDrop.classList.remove("open"); return; }
    peopleDrop.replaceChildren(el("p", { class: "hub-menu-note" }, "Finding trainers…"));
    if (innerWidth > 640) {   // hang it under the "N here" pill, wherever the top row puts it
      const pr = people.getBoundingClientRect(), rr = root.getBoundingClientRect();
      peopleDrop.style.right = `${Math.max(8, rr.right - pr.right)}px`;
    }
    peopleDrop.classList.add("open");
    const trainers = await listTrainers("");
    const rows = await Promise.all(trainers.map(async (t) => ({ t, team: (await getTrainerTeam(t.id))?.team || {} })));
    peopleDrop.replaceChildren(el("p", { class: "hub-menu-title" }, `Trainers online (${rows.length})`), ...(rows.length ? rows.map(({ t, team }) => {
      const party = (team.party || []).filter((m) => m && m.name).slice(0, 6);
      return el("div", { class: "hub-people-row" }, [
        t.sprite ? el("img", { class: "hub-people-sprite", src: trainerSpriteUrl(t.sprite), alt: "" }) : el("span", { class: "hub-avatar small" }, (t.name || "?")[0].toUpperCase()),
        el("div", { class: "hub-people-info" }, [
          el("strong", {}, `${t.name || "Trainer"}${t.id === me.id ? " (you)" : ""}`),
          el("div", { class: "hub-people-team" }, party.length ? party.map((m) => {
            const dex = m.dex || state?.pokemonByName?.get(m.name)?.dex;
            return dex ? el("img", { src: spriteUrl(dex), alt: m.name, title: `${m.nickname || m.name} · Lv ${m.level ?? "?"}` }) : el("span", { title: m.name }, "?");
          }) : [el("span", { class: "hub-menu-note" }, "No team yet")]),
        ]),
      ]);
    }) : [el("p", { class: "hub-menu-note" }, "Nobody else is online right now.")]));
  }
  people.addEventListener("click", (e) => { if (!e.target.closest(".hub-avatar:not(.self)")) togglePeople(); });
  people.setAttribute("role", "button"); people.tabIndex = 0;
  people.addEventListener("keydown", (e) => { if (e.key === "Enter") togglePeople(); });
  document.addEventListener("pointerdown", function outsidePeople(e) {
    if (!document.body.contains(root)) { document.removeEventListener("pointerdown", outsidePeople); return; }
    if (!peopleDrop.contains(e.target) && !people.contains(e.target)) peopleDrop.classList.remove("open");
  });

  root.append(backdropLayer, stars, dots, stage, edgeGlow, empty, topbar, peopleDrop, bagDrop, dexHost, leftDock, sendZone, subbar, toolbar, zoomBar, drawer, hover, menu, toast);
  root.classList.add("cosmic");
  window.addEventListener("layout-changed", function onLayout() { if (!document.body.contains(root)) { window.removeEventListener("layout-changed", onLayout); return; } drawSubbar(); });
  syncTheme();
  sheetDrag(bagDrop, () => { bagDrop.classList.remove("open"); quick.querySelector('[data-view="bag"]')?.classList.remove("on"); });
  sheetDrag(peopleDrop, () => peopleDrop.classList.remove("open"));
  sheetDrag(drawer, () => { drawer.classList.remove("open"); drawToolbar(); });
  sheetDrag(menu, () => closeMenu());
  // the minimap under the title (the DM's shared map, with the fog of war); click it for the full map
  let hubMap = null;
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
    for (const side of sides) edgeGlow.querySelector(`.hub-edge-${side}`)?.classList.add("on");   // the mist swirls up
    clearTimeout(glowTimer);
    glowTimer = setTimeout(() => edgeGlow.querySelectorAll("span").forEach((x) => x.classList.remove("on")), 450);
  }
  // the edge follows the content: a margin round everything on the board, at least the base area
  function updateBounds() {
    const b = { ...BASE_AREA };
    for (const it of items) {
      const pts = it.type === "stroke" ? it.pts : it.type === "shape" ? [[it.x, it.y], [it.x2, it.y2]] : null;
      if (pts) for (const [x, y] of pts) { b.x0 = Math.min(b.x0, x - EDGE_PAD); b.x1 = Math.max(b.x1, x + EDGE_PAD); b.y0 = Math.min(b.y0, y - EDGE_PAD); b.y1 = Math.max(b.y1, y + EDGE_PAD); }
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
    updateMist();
    world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.k})`;
    // Panning only moves layers (transform), so a drag never restyles or repaints anything: the CSS variables that
    // size the dot grid and the star tiles change only with the zoom, and only on those layers (a variable on the hub
    // itself would restyle every card on the board each frame).
    if (view.k !== shownK) {
      shownK = view.k;
      world.style.setProperty("--ik", String(1 / view.k));   // undoes the zoom for things that keep their size (cursors)
      dots.style.setProperty("--grid", `${28 * view.k}px`);
      stars.style.setProperty("--zk", String(view.k));        // the stars grow and shrink with the board
      zoomLabel.textContent = `${Math.round(view.k * 100)}%`;
    }
    const wrap = (v, size) => ((v % size) + size) % size - size;   // a tile's worth of offset, so the layer never runs out
    const g = 28 * view.k;
    dots.style.transform = `translate3d(${wrap(view.x, g).toFixed(2)}px, ${wrap(view.y, g).toFixed(2)}px, 0)`;
    // The sky zooms exactly like the board, about the same point (a pinch, the mouse wheel, the buttons), so the stars
    // grow and shrink in place; a plain pan moves each layer only part of the way (parallax: the sky is far off).
    const f = lastView ? view.k / lastView.k : 1;
    const follow = (pos, par, ox = 0, oy = 0) => {
      if (!pos || !lastView) return { x: view.x, y: view.y };
      if (f === 1) return { x: pos.x + (view.x - lastView.x) * par, y: pos.y + (view.y - lastView.y) * par };
      return { x: view.x - ox + (ox + pos.x - lastView.x) * f, y: view.y - oy + (oy + pos.y - lastView.y) * f };
    };
    starLayers.forEach(([node, tile, par], i) => {
      const at = skyPos[i] = follow(skyPos[i], par, -90, -90), t = tile * view.k;   // each layer's box starts 90px up and left
      node.style.translate = `${wrap(at.x, t).toFixed(2)}px ${wrap(at.y, t).toFixed(2)}px`;
    });
    // the constellation: its box's own place on the stage is the origin it scales from
    conPos = follow(conPos, 0.2, constellation.offsetLeft, constellation.offsetTop);
    if (!lastView) conPos = { x: 0, y: 0 };
    constellation.style.transform = `translate3d(${conPos.x.toFixed(2)}px, ${conPos.y.toFixed(2)}px, 0) scale(${view.k.toFixed(4)})`;
    lastView = { x: view.x, y: view.y, k: view.k };
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
  const screenX = (wx) => stage.getBoundingClientRect().left + view.x + wx * view.k;   // for panning sounds
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
    ["shape", "Shapes", "M4 4h7v7H4zM17.5 4a3.5 3.5 0 1 0 .01 0zM4 20l4-7 4 7z"],
    ["prop", "Props", "M12 3l2.5 5 5.5.8-4 3.9.9 5.5-4.9-2.6-4.9 2.6.9-5.5-4-3.9 5.5-.8z"],
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
  function setTool(id, dmNote = false) {
    if (id !== tool) hubSound("tick");
    tool = id;
    noteDm = id === "note" && dmNote;
    toolbar.querySelector(".hub-dmnote")?.classList.toggle("on", noteDm);
    toolbar.querySelectorAll(".hub-tool[data-tool]").forEach((b) => { b.classList.toggle("on", b.dataset.tool === id); b.setAttribute("aria-pressed", String(b.dataset.tool === id)); });
    stage.dataset.tool = id;
    moveThumb();
    drawSubbar();
    wheel?.refresh();
  }
  function drawToolbar() {
    toolbar.replaceChildren(thumb, ...TOOLS.map(([id, label, d]) => {
      const key = Object.keys(SHORTCUTS).find((k) => SHORTCUTS[k] === id);
      const b = el("button", { type: "button", class: `hub-tool${tool === id && !(id === "note" && noteDm) ? " on" : ""}`, "data-tool": id, title: `${label} (${key.toUpperCase()})`, "aria-pressed": String(tool === id) });
      b.innerHTML = icon(d) + `<span>${label}</span>`;
      b.addEventListener("click", () => setTool(id));
      return b;
    }), ...(dmToken ? [el("span", { class: "hub-sep" }), dmButton()] : []));
    stage.dataset.tool = tool;
    requestAnimationFrame(() => moveThumb(true));
  }
  function dmButton() {
    if (dmToken) {
      const b = el("button", { type: "button", class: `hub-tool hub-dm${drawer.classList.contains("open") ? " on" : ""}`, title: "Encounters" });
      b.innerHTML = icon("M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h6m6 0h6M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z") + "<span>Encounters</span>";
      b.addEventListener("click", () => { drawer.classList.toggle("open"); if (drawer.classList.contains("open")) drawDrawer(); drawToolbar(); });
      // a note only the DM can see (the server never sends it to players)
      const dn = el("button", { type: "button", class: `hub-tool hub-dmnote${noteDm ? " on" : ""}`, title: "DM note: a note only you can see" });
      dn.innerHTML = icon("M5 4h14v11l-5 5H5zM14 20v-5h5M9 9a3 3 0 1 1 6 0v2H9zM8 11h8") + "<span>DM note</span>";
      dn.addEventListener("click", () => setTool("note", true));
      const bd = el("button", { type: "button", class: "hub-tool", title: "Backdrop: a map behind the board" });
      bd.innerHTML = icon("M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14") + "<span>Backdrop</span>";
      bd.addEventListener("click", () => openBackdropMenu(bd));
      return el("span", { class: "hub-dm-tools" }, [b, dn, bd]);
    }
    return null;
  }
  // The pen's colours and sizes. On a phone they sit on a semicircle round the white dot (drawPenArc); on a computer in
  // the bar above the tools. Either way the brush size is one button showing the size you have, which opens out into
  // the three sizes when you press it.
  const PEN_COLORS = () => [me.color, "#f4f4f5", "#ff5a4e", "#ffd23f", "#6fdc6a", "#4ea8ff", "#e36bff"];
  let sizesOpen = false;
  const penArc = el("div", { class: "pen-arc", role: "toolbar", "aria-label": "Pen colour and size" });
  const phone = () => document.documentElement.classList.contains("m");
  function sizeButton(cls) {
    const wrap = el("div", { class: `${cls}${sizesOpen ? " open" : ""}` });
    const dotOf = (w) => el("span", { class: "pen-size-dot", style: `width:${w + 4}px;height:${w + 4}px` });
    const current = el("button", { type: "button", class: "pen-size-now", "aria-label": `Brush size (now ${penWidth}px)`, "aria-expanded": String(sizesOpen), title: "Brush size" }, dotOf(penWidth));
    current.addEventListener("click", () => { sizesOpen = !sizesOpen; hubSound("tick"); drawSubbar(); });
    const options = PEN_WIDTHS.map((w, i) => {
      const b = el("button", { type: "button", class: `pen-size-opt${penWidth === w ? " on" : ""}`, style: `--i:${i}`, "aria-label": `Brush size ${w}px`, tabindex: sizesOpen ? "0" : "-1" }, dotOf(w));
      b.addEventListener("click", () => { penWidth = w; sizesOpen = false; hubSound("tick"); drawSubbar(); });
      return b;
    });
    wrap.append(...options, current);
    return wrap;
  }
  function clearButton() {
    const clear = el("button", { type: "button", class: "hub-pill small pen-clear", title: dmToken ? "Clear all drawings" : "Clear my drawings" }, "Clear");
    clear.addEventListener("click", async () => { await op({ op: "clearDrawings" }); say(dmToken ? "Drawings cleared." : "Your drawings are cleared."); });
    return clear;
  }
  function drawPenArc() {
    if (!penArc.isConnected) root.append(penArc);
    const show = phone() && tool === "pen";
    penArc.classList.toggle("show", show);
    if (!show) {
      if (tool !== "pen") sizesOpen = false;   // leaving Draw closes the sizes; on a computer they live in the bar instead
      penArc.replaceChildren(); penArc.classList.remove("live", "sizing");
      return;
    }
    const colors = PEN_COLORS();
    // the colours come out of the dot only when Draw is picked, not every time one is chosen
    if (!penArc.classList.contains("live")) {
      penArc.classList.add("live", "enter");
      setTimeout(() => penArc.classList.remove("enter"), 450);
    }
    penArc.classList.toggle("sizing", sizesOpen);
    // seven colours spread over the top of a half circle round the dot, the size on its right end, Clear on its left
    penArc.replaceChildren(...colors.map((c, i) => {
      const a = (-162 + (i * 122) / (colors.length - 1)) * Math.PI / 180;   // leaves room low on the right for the size, clear of the bag button
      const b = el("button", { type: "button", class: `pen-arc-swatch${penColor === c ? " on" : ""}`, style: `--c:${c};--x:${(Math.cos(a) * 120).toFixed(1)}px;--y:${(Math.sin(a) * 120).toFixed(1)}px;--i:${i}`, "aria-label": `Pen colour ${c}` });
      b.addEventListener("click", () => { penColor = c; hubSound("tick"); drawSubbar(); });
      return b;
    }), sizeButton("pen-arc-size"), clearButton());
  }
  function drawSubbar() {
    subbar.replaceChildren();
    drawPenArc();
    subbar.classList.toggle("show", ["note", "erase", "ping", "shape", "prop"].includes(tool) || (tool === "pen" && !phone()));
    if (tool === "shape") {
      subbar.append(...SHAPES.map(([id, label, d]) => {
        const b = el("button", { type: "button", class: `hub-shape-pick${shapeKind === id ? " on" : ""}`, title: label, "aria-label": label });
        b.innerHTML = icon(d);
        b.addEventListener("click", () => { shapeKind = id; drawSubbar(); });
        return b;
      }), el("span", { class: "hub-sep" }), ...[me.color, "#f4f4f5", "#ff5a4e", "#ffd23f", "#6fdc6a", "#4ea8ff", "#e36bff"].map((c) => {
        const sw = el("button", { type: "button", class: `hub-swatch${penColor === c ? " on" : ""}`, style: `--c:${c}`, "aria-label": `Colour ${c}` });
        sw.addEventListener("click", () => { penColor = c; drawSubbar(); });
        return sw;
      }), el("span", { class: "hub-sep" }), (() => {
        const f = el("button", { type: "button", class: `hub-pill${shapeFill ? " solid" : ""}` }, shapeFill ? "Filled" : "Outline");
        f.addEventListener("click", () => { shapeFill = !shapeFill; drawSubbar(); });
        return f;
      })(), el("span", { class: "hub-hint" }, "Drag on the board to draw"));
    } else if (tool === "prop") {
      const size = el("input", { type: "range", min: "32", max: "200", value: String(propSize), "aria-label": "Prop size", class: "hub-prop-size" });
      size.addEventListener("input", () => { propSize = Number(size.value); });
      subbar.append(el("div", { class: "hub-prop-list" }, PROPS.map(([id, glyphChar, label]) => {
        const b = el("button", { type: "button", class: `hub-prop-pick${propId === id ? " on" : ""}`, title: label, "aria-label": label, draggable: "true" }, glyphChar);
        b.addEventListener("click", () => { propId = id; subbar.querySelectorAll(".hub-prop-pick").forEach((x) => x.classList.toggle("on", x === b)); });
        b.addEventListener("dragstart", (e) => { e.dataTransfer.setData(CARD_MIME, JSON.stringify({ type: "prop", prop: id, size: propSize })); });
        return b;
      })), el("span", { class: "hub-sep" }), el("label", { class: "hub-hint" }, ["Size ", size]));
    }
    if (tool === "ping") subbar.append(el("span", { class: "hub-hint" }, "Hover a note, card or button and click to ripple round it, or click anywhere to mark the spot (Alt+click works with any tool)"));
    if (tool === "pen" && !phone()) {
      subbar.append(...PEN_COLORS().map((c) => {
        const s = el("button", { type: "button", class: `hub-swatch${penColor === c ? " on" : ""}`, style: `--c:${c}`, "aria-label": `Pen colour ${c}` });
        s.addEventListener("click", () => { penColor = c; drawSubbar(); });
        return s;
      }), el("span", { class: "hub-sep" }), sizeButton("pen-bar-size"), clearButton());
    } else if (tool === "note") {
      subbar.append(el("span", { class: "hub-hint" }, noteDm ? "Click the board to stick a note only you (the DM) can see" : "Click the board to stick a note"), ...NOTE_COLORS.map((c) => {
        const s = el("button", { type: "button", class: `hub-swatch${noteColor === c ? " on" : ""}`, style: `--c:${c}`, "aria-label": `Note colour ${c}` });
        s.addEventListener("click", () => { noteColor = c; drawSubbar(); });
        return s;
      }));
    }
    if (tool === "erase") {
      subbar.append(el("span", { class: "hub-hint" }, dmToken ? "Click or drag across anything to remove it" : "Click or drag across your own notes and drawings to remove them"), clearButton());
    }
  }

  // DM access comes from the campaign owner (Settings -> Members), checked by the server on every sync: when it's
  // given, the DM tools appear; when it's taken away, they close at once (and the Control Centre button goes).
  async function becomeDm() {
    const t = await ensureDmToken();
    if (!t || dmToken) return;
    dmToken = t;
    applyDmUi();
    say("You're a DM in this campaign: the DM tools are in the bottom bar.");
  }
  function stopBeingDm() {
    if (!dmToken) return;
    dmToken = null;
    clearDmToken();
    drawer.classList.remove("open");
    if (tool === "note" && noteDm) setTool("move");
    applyDmUi();
    say("Your DM access was taken away.");
  }
  function applyDmUi() {
    drawToolbar(); drawSubbar(); rev = -1;
    appBtns.querySelector('[data-view="controlcentre"]')?.toggleAttribute("hidden", !dmToken);
    refreshPullTabs();   // the DM's SOUND and PARTY tabs
    hubMap?.refresh();   // the DM sees the whole map
    wheel?.refresh();    // and the wheel's DM options
    if (items.length) drawItems();
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
    const draft = gesture?.kind === "pen" && gesture.pts.length > 1 ? { pts: gesture.pts.slice(-400), color: penColor, width: penWidth } : null;
    const cursor = pointerWorld ? { x: pointerWorld.x, y: pointerWorld.y, name: me.name, color: me.color, down: clicked, ...(draft ? { draft } : {}) } : null;
    const ping = pendingPing;
    clicked = false; pendingPing = null;
    const res = await hubSync(me.id, rev, cursor, ping, dmToken);
    inFlight = false;
    if (again) { again = false; rev = -1; setTimeout(() => sync(true), 0); }
    if (!res || !alive) return;
    drawPeople(res.cursors || []);
    drawCursors(res.cursors || []);
    for (const pg of res.pings || []) {
      if (seenPings.has(pg.id)) continue;
      seenPings.add(pg.id);
      if (pg.by !== me.id) { showPing(pg); hubSound("pingOther", screenX(pg.x)); }
    }
    if ("backdrop" in res) setBackdrop(res.backdrop);
    if (res.isDm === true && !dmToken) becomeDm();
    else if (res.isDm === false && dmToken) stopBeingDm();
    if (res.items) { items = res.items; rev = res.rev; activeButton = res.activeButton; drawItems(); }
    else if (res.activeButton !== activeButton) { activeButton = res.activeButton; drawItems(); }
  }
  const timer = setInterval(() => {
    if (!document.body.contains(root)) { alive = false; clearInterval(timer); return; }
    if (!document.hidden) sync();
  }, SYNC_MS);

  // ------------------------------------------------------------------ cursors
  const cursorEls = new Map();   // player id -> element
  const draftPaths = new Map();  // player id -> the stroke they're drawing right now
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
    // strokes others are still drawing
    const drafting = new Set();
    for (const c of list) {
      if (!c.draft?.pts?.length) continue;
      drafting.add(c.id);
      let path = draftPaths.get(c.id);
      if (!path) { path = document.createElementNS("http://www.w3.org/2000/svg", "path"); draftInk.append(path); draftPaths.set(c.id, path); }
      path.setAttribute("d", c.draft.pts.map((p, i) => `${i ? "L" : "M"}${p[0]} ${p[1]}`).join(" "));
      path.setAttribute("stroke", c.draft.color);
      path.setAttribute("stroke-width", String(c.draft.width));
    }
    for (const [id, path] of draftPaths) if (!drafting.has(id)) { path.remove(); draftPaths.delete(id); }
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
    // drawings and shapes go in the SVG
    const strokes = items.filter((it) => it.type === "stroke");
    const shapes = items.filter((it) => it.type === "shape");
    ink.replaceChildren(...shapes.map((sh) => {
      const path = shapePath(sh);
      if (!knownStrokes.has(sh.id)) { knownStrokes.add(sh.id); if (rev > 0) path.classList.add("fresh"); }
      return path;
    }), ...strokes.map((s) => {
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
      if (it.type === "stroke" || it.type === "shape") continue;
      seen.add(it.id);
      let node = itemEls.get(it.id);
      const fresh = !node;
      if (fresh) {
        node = it.type === "note" ? makeNote(it) : it.type === "text" ? makeText(it) : CARD_TYPES.has(it.type) ? makeCard() : it.type === "prop" ? el("div", { class: "hub-prop" }) : makeButton(it);
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
        node.classList.toggle("dm-only", !!it.dmOnly);
        node.querySelector(".hub-note-by").textContent = it.dmOnly ? "DM only" : it.byName || "";
      } else if (it.type === "text") {
        node.style.color = it.color; node.style.fontSize = `${it.size}px`;
        if (!node.isContentEditable) node.textContent = it.text;
      } else if (CARD_TYPES.has(it.type)) {
        fillCard(node, it, state);
      } else if (it.type === "prop") {
        const prop = PROP_BY_ID.get(it.prop);
        node.textContent = prop?.glyph || "❔";
        node.title = prop?.label || it.prop;
        node.style.fontSize = `${it.size}px`;
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

  // A shape as one SVG path, in board units: a box, an ellipse, a line, or a line with an arrowhead.
  function shapePath(sh, el2 = null) {
    const path = el2 || document.createElementNS("http://www.w3.org/2000/svg", "path");
    const { x, y, x2, y2 } = sh;
    const l = Math.min(x, x2), t = Math.min(y, y2), w = Math.abs(x2 - x), h = Math.abs(y2 - y);
    let d;
    if (sh.shape === "rect") d = `M${l} ${t}h${w}v${h}h${-w}z`;
    else if (sh.shape === "ellipse") { const rx = w / 2, ry = h / 2; d = `M${l} ${t + ry}a${rx} ${ry} 0 1 0 ${w} 0a${rx} ${ry} 0 1 0 ${-w} 0z`; }
    else {
      d = `M${x} ${y}L${x2} ${y2}`;
      if (sh.shape === "arrow") {
        const a = Math.atan2(y2 - y, x2 - x), len = Math.max(12, sh.width * 3.5);
        const p = (da) => `${x2 - len * Math.cos(a + da)} ${y2 - len * Math.sin(a + da)}`;
        d += `M${p(0.45)}L${x2} ${y2}L${p(-0.45)}`;
      }
    }
    path.setAttribute("d", d);
    path.setAttribute("stroke", sh.color);
    path.setAttribute("stroke-width", String(sh.width));
    path.classList.add("hub-shape");
    path.style.fill = sh.fill && (sh.shape === "rect" || sh.shape === "ellipse") ? `${sh.color}40` : "none";
    if (sh.id) path.dataset.id = sh.id;
    return path;
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
    const portrait = it.preview?.portrait;
    node.className = `hub-btn kind-${it.source.kind}${activeButton === it.id ? " live" : ""}${portrait ? " has-portrait" : ""}`;
    const ic = node.querySelector(".hub-btn-icon");
    if (portrait) ic.style.backgroundImage = `url("${trainerSpriteUrl(portrait)}")`; else ic.style.backgroundImage = "";
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

  // ------------------------------------------------------------------ drag effects
  // Dragging something on the board: it lifts (css .dragging), leans with its speed so the motion hints where it's
  // heading, and leaves a short fading trail in its colour. Letting go hands the tilt and lift to springs that start
  // from where they are, with the speed they have, and settle with a little bounce because the drag carried momentum.
  const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  function dragFx(g, e) {
    if (calm()) return;
    const now = performance.now();
    g.hist.push([e.clientX, e.clientY, now]);
    while (g.hist.length > 2 && now - g.hist[0][2] > 90) g.hist.shift();
    const [x0, , t0] = g.hist[0];
    const vx = now > t0 ? ((e.clientX - x0) / (now - t0)) * 1000 : 0;   // px per second, across the screen
    const target = clamp(vx / 85, -9, 9);
    g.tilt += (target - g.tilt) * 0.35;
    g.node.style.rotate = `${g.tilt.toFixed(2)}deg`;
    // the trail: a fading dot every ~16px of travel, behind the item
    const n = g.node, cx = n.offsetLeft + n.offsetWidth / 2, cy = n.offsetTop + n.offsetHeight / 2;
    if (!g.trailAt) { g.trailAt = [cx, cy]; g.trailColor = getComputedStyle(n).getPropertyValue("--tc").trim() || "#ffffff"; return; }
    if (Math.hypot(cx - g.trailAt[0], cy - g.trailAt[1]) < 16 / view.k) return;
    g.trailAt = [cx, cy];
    const dot = el("span", { class: "hub-trail", style: `left:${cx}px;top:${cy}px;--c:${g.trailColor}`, "aria-hidden": "true" });
    itemLayer.insertBefore(dot, itemLayer.firstChild);
    setTimeout(() => dot.remove(), 650);
  }
  function landFx(g) {
    const n = g.node;
    if (calm()) { n.style.rotate = ""; n.style.scale = ""; return; }
    const [x0, , t0] = g.hist[0], [x1, , t1] = g.hist[g.hist.length - 1];
    const vx = t1 > t0 ? ((x1 - x0) / (t1 - t0)) * 1000 : 0;
    const tilt = spring({ from: g.tilt, to: 0, velocity: -vx / 40, damping: 0.55, response: 0.45,
      onUpdate: (v) => { n.style.rotate = `${v.toFixed(2)}deg`; }, onDone: () => { n.style.rotate = ""; } });
    const lift = spring({ from: 1.05, to: 1, velocity: -0.6, damping: 0.6, response: 0.35,
      onUpdate: (v) => { n.style.scale = v.toFixed(4); }, onDone: () => { n.style.scale = ""; } });
    n.__settle = [tilt, lift];
  }

  // ------------------------------------------------------------------ click effects
  function tapFx(node, at) {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    node.classList.remove("tap"); void node.offsetWidth; node.classList.add("tap");
    setTimeout(() => node.classList.remove("tap"), 520);
    const c = getComputedStyle(node).getPropertyValue("--tc").trim() || (node.classList.contains("hub-btn") ? "#ff5a4e" : "#ffffff");
    const burst = el("div", { class: "hub-burst", style: `left:${at.x}px;top:${at.y}px;--c:${c}` }, Array.from({ length: 10 }, (_, i) => el("i", { style: `--a:${i * 36 + Math.random() * 14}deg;--d:${34 + Math.random() * 30}px` })));
    burst.append(el("b"));
    itemLayer.append(burst);
    setTimeout(() => burst.remove(), 700);
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
    hubSound("ping", screenX(at.x));
    sync(true);
  }
  // what a ping would point at under the pointer: a note, text, card, encounter button or drawing
  function pingTargetOf(t) {
    const node = t?.closest?.(".hub-note, .hub-text, .hub-btn, .hub-card, .hub-prop");
    if (node && itemLayer.contains(node)) return node.dataset.id;
    return t?.closest?.(".hub-ink path")?.dataset?.id || null;
  }
  let lit = null, litClass = "ping-target";
  function highlight(id, cls = "ping-target") {
    const node = id ? itemEls.get(id) || ink.querySelector(`path[data-id="${CSS.escape(id)}"]`) : null;
    if (node === lit && cls === litClass) return;
    lit?.classList.remove(litClass);
    lit = node; litClass = cls;
    lit?.classList.add(cls);
  }
  // The eraser's target under the pointer: a note, text, card, prop or button, else the nearest drawing or shape within
  // a few pixels (thin lines are hard to hit exactly). Works while the pointer is captured, too.
  function eraseTargetAt(e) {
    const under = document.elementFromPoint(e.clientX, e.clientY);
    const node = under?.closest?.(".hub-note, .hub-text, .hub-btn, .hub-card, .hub-prop");
    if (node && itemLayer.contains(node)) return node.dataset.id;
    const p = toWorld(e.clientX, e.clientY), slack = 7 / view.k;
    const segDist = (px, py, ax, ay, bx, by) => {
      const dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy;
      const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
      return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    };
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      if (it.type === "stroke") {
        for (let j = 1; j < it.pts.length; j++) if (segDist(p.x, p.y, ...it.pts[j - 1], ...it.pts[j]) <= it.width / 2 + slack) return it.id;
      } else if (it.type === "shape") {
        const l = Math.min(it.x, it.x2), r = Math.max(it.x, it.x2), t = Math.min(it.y, it.y2), b = Math.max(it.y, it.y2), pad = it.width / 2 + slack;
        if (it.shape === "line" || it.shape === "arrow") { if (segDist(p.x, p.y, it.x, it.y, it.x2, it.y2) <= pad) return it.id; }
        else if (p.x >= l - pad && p.x <= r + pad && p.y >= t - pad && p.y <= b + pad && (it.fill || p.x <= l + pad || p.x >= r - pad || p.y <= t + pad || p.y >= b - pad)) return it.id;
      }
    }
    return null;
  }
  const erasable = (id) => { const it = id && items.find((x) => x.id === id); return it && (dmToken || (mine(it) && it.type !== "button")) ? id : null; };
  function eraseOne(id) {
    if (gesture?.erased?.has(id)) return;
    gesture?.erased?.add(id);
    (itemEls.get(id) || ink.querySelector(`path[data-id="${CSS.escape(id)}"]`))?.classList.add("erasing");
    op({ op: "delete", itemId: id });
  }
  // the world-space box round an item, for ripples that hug it
  function boxOf(id) {
    const node = itemEls.get(id);
    if (node) return { x: node.offsetLeft, y: node.offsetTop, w: node.offsetWidth, h: node.offsetHeight, node };
    const sh = items.find((x) => x.id === id && x.type === "shape");
    if (sh) {
      const pad = sh.width / 2 + 4;
      return { x: Math.min(sh.x, sh.x2) - pad, y: Math.min(sh.y, sh.y2) - pad, w: Math.abs(sh.x2 - sh.x) + pad * 2, h: Math.abs(sh.y2 - sh.y) + pad * 2, node: ink.querySelector(`path[data-id="${CSS.escape(id)}"]`) };
    }
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
    const face = pv.portrait ? el("img", { class: "hub-hover-portrait", src: trainerSpriteUrl(pv.portrait), alt: "" }) : null;
    const kind = it.source.kind === "npc" ? "Trainer" : it.source.kind === "wild" ? "Wild Pokémon" : "Encounter";
    hover.replaceChildren(
      ...[face, el("div", { class: "hub-hover-art" }, art)].filter(Boolean),
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
  function closeMenu() { menu.classList.remove("show", "at-send"); }
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
        { kind: "plan", id: `${b.id}:${n.id}`, title: n.title, sprite: n.identity?.sprite || "", mons: n.mons.map((m) => ({ name: m.name, level: m.level })) })), "Roll a wild encounter, trainer or gym leader on the Whiteboard and it shows up here."),
    );
  }
  async function addButton(payload, at) {
    // don't stack a new button exactly on top of another one
    let x = Math.round(at.x - 70), y = Math.round(at.y - 24);
    while (items.some((it) => it.type === "button" && Math.abs(it.x - x) < 40 && Math.abs(it.y - y) < 30)) { x += 34; y += 58; }
    await op({ op: "put", item: { type: "button", id: uid(), x, y, label: payload.label.slice(0, 60), reveal: "hidden", source: payload.source } });
    say("Encounter placed. Players can hover it to see the level.");
  }
  async function placeCard(card, at, screen = null) {
    if (card.type === "mon" && card.level === undefined) {
      const r = stage.getBoundingClientRect();
      const lvl = await askLevel({ x: screen?.x ?? r.left + r.width / 2, y: screen?.y ?? r.top + r.height / 2, name: card.name });
      if (lvl === undefined) return;   // cancelled
      card = { ...card, level: lvl };
    }
    if (card.type === "prop") { await op({ op: "put", item: { type: "prop", id: uid(), prop: card.prop, size: card.size || propSize, x: Math.round(at.x - (card.size || propSize) / 2), y: Math.round(at.y - (card.size || propSize) / 2) } }); return; }
    let x = Math.round(at.x - 110), y = Math.round(at.y - 40);
    while (items.some((it) => CARD_TYPES.has(it.type) && Math.abs(it.x - x) < 30 && Math.abs(it.y - y) < 30)) { x += 28; y += 28; }
    const { own, ...clean } = card; void own;
    await op({ op: "put", item: { ...clean, id: uid(), x, y, open: false } });
  }
  const trainerCardAt = (t) => { const c = t?.closest?.(".hub-card.kind-trainer"); return c && itemLayer.contains(c) && c.__item && c.__item.owner !== me.id ? c : null; };
  itemLayer.addEventListener("dragover", (e) => {
    const c = ownDrag && trainerCardAt(e.target);
    itemLayer.querySelectorAll(".hub-card.send-hot").forEach((x) => { if (x !== c) x.classList.remove("send-hot"); });
    if (!c) return;
    e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = "move";
    c.classList.add("send-hot");
  });
  itemLayer.addEventListener("drop", (e) => {
    const c = ownDrag && trainerCardAt(e.target);
    if (!c) return;
    e.preventDefault(); e.stopPropagation();
    c.classList.remove("send-hot");
    const own = ownDrag;
    confirmSendTo(own, { id: c.__item.owner, name: c.__item.name || "that trainer" }, c);
  });
  stage.addEventListener("dragover", (e) => {
    const t = e.dataTransfer.types;
    if (t.includes(CARD_MIME) || (dmToken && t.includes("application/x-hub-button"))) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }
  });
  stage.addEventListener("drop", (e) => {
    const card = e.dataTransfer.getData(CARD_MIME);
    if (card) { e.preventDefault(); try { placeCard(JSON.parse(card), toWorld(e.clientX, e.clientY), { x: e.clientX, y: e.clientY }); } catch { /* not ours */ } return; }
    const raw = e.dataTransfer.getData("application/x-hub-button");
    if (!raw || !dmToken) return;
    e.preventDefault();
    addButton(JSON.parse(raw), toWorld(e.clientX, e.clientY));
  });

  // ------------------------------------------------------------------ pointer: pan, drag, draw, place
  let gesture = null;
  let liveStroke = null;
  const capture = (id) => { try { stage.setPointerCapture(id); } catch { /* that pointer is already gone */ } };
  // Two fingers pinch to zoom and pan the board (touch screens). A second finger cancels whatever the first one began
  // (a stroke, a drag), and the point between the fingers stays under them as you zoom.
  const touches = new Map();
  let pinch = null;
  const pinchStart = () => {
    const [a, b] = [...touches.values()], r = stage.getBoundingClientRect();
    const mx = (a.x + b.x) / 2 - r.left, my = (a.y + b.y) / 2 - r.top;
    pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, k: view.k, wx: (mx - view.x) / view.k, wy: (my - view.y) / view.k };
  };
  stage.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "touch") return;
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size < 2) return;
    e.stopImmediatePropagation();
    if (touches.size > 2) return;
    if (gesture?.kind === "pen" || gesture?.kind === "shape") { liveStroke?.remove(); liveStroke = null; }
    if (gesture?.kind === "drag") { gesture.node.classList.remove("dragging"); drawItems(); }
    gesture = null;
    capture(e.pointerId);
    pinchStart();
  }, { capture: true });
  stage.addEventListener("pointermove", (e) => {
    if (!touches.has(e.pointerId)) return;
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!pinch || touches.size < 2) return;
    e.stopImmediatePropagation();
    const [a, b] = [...touches.values()], r = stage.getBoundingClientRect();
    const mx = (a.x + b.x) / 2 - r.left, my = (a.y + b.y) / 2 - r.top;
    view.k = clamp(pinch.k * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d, 0.25, 3);
    view.x = mx - pinch.wx * view.k; view.y = my - pinch.wy * view.k;
    applyView(true);
  }, { capture: true });
  const lift = (e) => {
    if (!touches.delete(e.pointerId) || !pinch) return;
    e.stopImmediatePropagation();
    if (touches.size >= 2) pinchStart(); else { pinch = null; gesture = null; }
  };
  stage.addEventListener("pointerup", lift, { capture: true });
  stage.addEventListener("pointercancel", lift, { capture: true });
  stage.addEventListener("pointermove", (e) => {
    const r = stage.getBoundingClientRect();
    pointerWorld = toWorld(e.clientX, e.clientY);
    dirtyCursor = true;
    myTag.style.transform = `translate(${e.clientX - r.left}px, ${e.clientY - r.top}px)`;
    myTag.classList.add("show");
    if (tool === "erase") highlight(erasable(eraseTargetAt(e)), "erase-target");
    else highlight(tool === "ping" || e.altKey ? pingTargetOf(e.target) : null);
    if (!gesture) return;
    if (gesture.kind === "erase") { const id = erasable(eraseTargetAt(e)); if (id) eraseOne(id); return; }
    const dx = e.clientX - gesture.sx, dy = e.clientY - gesture.sy;
    if (Math.hypot(dx, dy) > 4) gesture.moved = true;
    if (gesture.kind === "pan") { view.x = gesture.ox + dx; view.y = gesture.oy + dy; applyView(true); }
    else if (gesture.kind === "resize") {
      gesture.node.style.width = `${clamp(gesture.iw + dx / view.k, 140, 900)}px`;
      gesture.node.style.minHeight = `${clamp(gesture.ih + dy / view.k, 100, 900)}px`;
    } else if (gesture.kind === "drag" && gesture.moved) {
      const node = gesture.node;
      node.style.left = `${gesture.ix + dx / view.k}px`; node.style.top = `${gesture.iy + dy / view.k}px`;
      if (!node.classList.contains("dragging")) { node.classList.remove("pressed"); node.classList.add("dragging"); hubSound("pick", e.clientX); }
      else hubSound("move", e.clientX);
      dragFx(gesture, e);
    } else if (gesture.kind === "shape") {
      const p = toWorld(e.clientX, e.clientY);
      gesture.end = [Math.round(p.x), Math.round(p.y)];
      shapePath({ shape: shapeKind, x: gesture.start[0], y: gesture.start[1], x2: gesture.end[0], y2: gesture.end[1], color: penColor, width: penWidth, fill: shapeFill }, liveStroke);
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
    const itemNode = e.target.closest(".hub-note, .hub-text, .hub-btn, .hub-card, .hub-prop");
    if (tool === "shape" && e.button === 0) {
      const p = toWorld(e.clientX, e.clientY);
      gesture = { sx: e.clientX, sy: e.clientY, moved: false, kind: "shape", start: [Math.round(p.x), Math.round(p.y)], end: null };
      liveStroke = document.createElementNS("http://www.w3.org/2000/svg", "path");
      ink.append(liveStroke);
      capture(e.pointerId);
      return;
    }
    if (tool === "prop" && e.button === 0 && !itemNode) { placeCard({ type: "prop", prop: propId, size: propSize }, toWorld(e.clientX, e.clientY)); return; }
    if (e.target.classList.contains("hub-note-resize") && itemNode && canEdit(itemNode.__item)) {
      gesture = { sx: e.clientX, sy: e.clientY, moved: false, kind: "resize", node: itemNode, iw: itemNode.__item.w, ih: itemNode.__item.h };
      capture(e.pointerId);
      return;
    }
    const strokeId = e.target.closest?.("path")?.dataset?.id;
    const start = { sx: e.clientX, sy: e.clientY, moved: false, id: e.pointerId };
    if (e.button === 1) { gesture = { ...start, kind: "pan", ox: view.x, oy: view.y }; capture(e.pointerId); return; }
    if (tool === "erase") {
      gesture = { ...start, kind: "erase", erased: new Set() };
      capture(e.pointerId);
      const hit = eraseTargetAt(e);
      const id = erasable(hit);
      if (id) eraseOne(id);
      else if (hit) say("You can only remove your own notes and drawings.");
      void itemNode; void strokeId;
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
      gesture = { ...start, kind: movable ? "drag" : "click", node: itemNode, ix: it.x, iy: it.y, hist: [[e.clientX, e.clientY, performance.now()]], tilt: 0, trailAt: null };
      itemNode.__settle?.forEach((a) => a.stop());
      itemNode.classList.add("pressed");
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
    if (g.kind === "erase") return;
    if (g.kind === "shape") {
      liveStroke?.remove(); liveStroke = null;
      if (g.end && Math.hypot(g.end[0] - g.start[0], g.end[1] - g.start[1]) > 6) {
        await op({ op: "put", item: { type: "shape", id: uid(), shape: shapeKind, x: g.start[0], y: g.start[1], x2: g.end[0], y2: g.end[1], color: penColor, width: penWidth, fill: shapeFill } });
      }
      return;
    }
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
    g.node?.classList?.remove("pressed");
    if ((g.kind === "drag" || g.kind === "click") && !g.moved) {
      if (g.node.matches(".hub-card, .hub-btn, .hub-prop")) tapFx(g.node, toWorld(e.clientX, e.clientY));
      hubSound("click", e.clientX);
      if (g.node.classList.contains("hub-btn")) buttonClicked(g.node);
      else if (g.node.classList.contains("hub-note")) g.node.querySelector("textarea").focus();
      else if (g.node.classList.contains("hub-text") && canEdit(g.node.__item)) editExistingText(g.node);
      else if (g.node.classList.contains("hub-card") && canEdit(g.node.__item)) await op({ op: "put", item: { ...g.node.__item, open: !g.node.__item.open } });
      return;
    }
    if (g.kind === "drag" && g.moved) {
      const it = g.node.__item;
      g.node.classList.remove("dragging");
      hubSound("drop", e.clientX);
      landFx(g);
      await op({ op: "put", item: { ...it, x: Math.round(it.x + (e.clientX - g.sx) / view.k), y: Math.round(it.y + (e.clientY - g.sy) / view.k) } });
      return;
    }
    if (g.kind === "note" && !g.moved) {
      const p = toWorld(e.clientX, e.clientY);
      const id = uid();
      const res = await op({ op: "put", item: { type: "note", id, x: Math.round(p.x - 110), y: Math.round(p.y - 30), w: 220, h: 160, text: "", color: noteColor, ...(noteDm && dmToken ? { dmOnly: true } : {}) } });
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
  drawTeam();
  const teamTimer = setInterval(() => { if (!document.body.contains(root)) { clearInterval(teamTimer); return; } if (!document.hidden) drawTeam(); }, 4000);
  checkGifts();
  (function comets() {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const next = () => setTimeout(() => {
      if (!document.body.contains(root)) return;
      if (!document.hidden && root.classList.contains("cosmic")) {
        const r = root.getBoundingClientRect();
        const fromLeft = Math.random() < 0.6;
        const y = Math.random() * r.height * 0.55, len = 220 + Math.random() * 260, ang = 12 + Math.random() * 22;
        const comet = el("div", { class: `hub-comet${fromLeft ? "" : " rtl"}`, style: `top:${Math.round(y)}px;--len:${Math.round(len)}px;--ang:${fromLeft ? ang : -ang}deg;--dist:${Math.round(r.width + len * 2)}px;--dur:${(1.4 + Math.random() * 1.2).toFixed(2)}s` });
        stars.append(comet);
        setTimeout(() => comet.remove(), 3200);
      }
      next();
    }, 9000 + Math.random() * 22000);
    next();
  })();
  hubMap = mountHubMap(root, { me, getDmToken: () => dmToken, say });
  const quickD = (v) => QUICK.find((q) => q[0] === v)?.[2] || "";
  const ICON = {
    map: "M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14",
    people: "M9 11a3 3 0 1 0 0-.01M3 20a6 6 0 0 1 12 0M17 11a2.5 2.5 0 1 0 0-.01M15.5 15.5A5 5 0 0 1 21 20",
    fit: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5",
    board: "M9 4h6a1 1 0 0 1 1 1v1H8V5a1 1 0 0 1 1-1zM8 5H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2",
    control: "M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1",
    settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
    encounters: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h6m6 0h6M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
    dmnote: "M5 4h14v11l-5 5H5zM14 20v-5h5M9 9a3 3 0 1 1 6 0v2H9zM8 11h8",
    backdrop: "M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14",
    dm: "M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6zM9.5 12l2 2 3.5-4",
  };
  const TOOL_INFO = Object.fromEntries(TOOLS.map(([id, label, d]) => [id, { label, d }]));
  wheel = mountWheel(root, {
    getCurrent: () => (tool === "note" && noteDm ? { label: "DM note", d: ICON.dmnote } : TOOL_INFO[tool] || TOOL_INFO.move),
    getItems: () => [
      ...TOOLS.map(([id, label, d]) => ({ id, label, d, group: "On the board", on: tool === id && !(id === "note" && noteDm), run: () => setTool(id) })),
      { label: "My Team", group: "Your trainer", d: quickD("team"), run: () => openFromHub("team") },
      { label: "Bag", group: "Your trainer", d: quickD("bag"), run: () => { if (!bagDrop.classList.contains("open")) toggleBag(); } },
      { label: "Trainer", group: "Your trainer", d: quickD("trainer"), run: () => openFromHub("trainer") },
      { label: "Dex", group: "Your trainer", d: quickD("dex"), run: () => toggleDex("pokemon") },
      { label: "Stats", group: "Your trainer", d: quickD("statcalc"), run: () => openFromHub("statcalc") },
      { label: "Map", group: "The world", d: ICON.map, run: () => hubMap?.open() },
      { label: "Who's here", group: "The world", d: ICON.people, run: () => { if (!peopleDrop.classList.contains("open")) togglePeople(); } },
      { label: "Fit board", group: "The world", d: ICON.fit, run: () => fitAll() },
      { label: "Map editor", group: "The world", d: ICON.map, run: () => openFromHub("mapeditor") },
      { label: "Whiteboard", group: "The world", d: ICON.board, run: () => openFromHub("planner") },
      ...(dmToken ? [{ label: "Control", group: "Dungeon Master", d: ICON.control, run: () => openFromHub("controlcentre") }] : []),
      { label: "Settings", group: "The world", d: ICON.settings, run: () => openFromHub("settings") },
      ...(dmToken ? [
        { label: "Encounters", group: "Dungeon Master", d: ICON.encounters, run: () => { drawer.classList.add("open"); drawDrawer(); drawToolbar(); } },
        { label: "DM note", group: "Dungeon Master", d: ICON.dmnote, on: tool === "note" && noteDm, run: () => setTool("note", true) },
        { label: "Backdrop", group: "Dungeon Master", d: ICON.backdrop, run: () => openBackdropMenu(root.querySelector(".wheel-dot")) },
      ] : []),
    ],
  });
  try { if (sessionStorage.getItem("hub-open") === "bag") { sessionStorage.removeItem("hub-open"); setTimeout(toggleBag, 350); } } catch { /* storage blocked */ }
  const giftTimer = setInterval(() => { if (!document.body.contains(root)) { clearInterval(giftTimer); return; } if (!document.hidden) checkGifts(); }, GIFT_MS);
  requestAnimationFrame(() => { centre(); sync(true); });
  (async () => {
    const t = await ensureDmToken();
    if (t) { dmToken = t; applyDmUi(); } else applyDmUi();
  })();
  void getActiveCampaign;
}
