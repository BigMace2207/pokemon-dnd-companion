import { renderSettings } from "./views/settings.js";
import { renderLibrary } from "./views/library.js";
import { renderPlanner } from "./views/planner.js";
import { renderAdmin } from "./views/admin.js";
import { el } from "./components.js";
import "./systems/index.js"; // registers every game system
import { setActiveSystem, activeSystem, viewsOf } from "./systems/registry.js";
import { clearAllIntervals } from "./intervals.js";
import { loadSave, writeSave, pullFromServer } from "./storage.js";
import { pingTrainer, getCampaign, setActiveCampaign } from "./network.js";
import { renderCampaignSelect } from "./views/campaignSelect.js";
import { renderLoginGate, renderServerUnreachable } from "./views/loginGate.js";
import { checkSession } from "./account.js";
import { mountAccountChip } from "./accountChip.js";
import { mountLogDrawer } from "./logDrawer.js";
import { mountDiceWidget } from "./diceWidget.js";
import { startTrainerPresenceWatcher } from "./trainerPresence.js";
import { mountShortcuts } from "./shortcuts.js";
import { installTooltips } from "./tooltip.js";
import { mountCosmicParallax } from "./cosmicParallax.js";
import { watchLayout } from "./mobileMode.js";
import { NAV_ICONS } from "./navIcons.js";
import { mountLavaToggle, goToFloor } from "./lavaTheme.js";
import {
  applyTheme, getTheme, setTheme, getHiddenViews, onHiddenViewsChanged,
  getSelectedCampaignId, setSelectedCampaignId, clearSelectedCampaignId, setForcedTheme,
} from "./deviceSettings.js";

// The router's lookup table, rebuilt for whichever game system the active
// campaign uses (see js/systems/). Settings is shared by every system.
let VIEWS = {};
let DIRECTIVE_SENSITIVE_VIEWS = new Set();
// Pages that aren't in the sidebar and only open from inside the app (the Pokémon Battle screen opens only from an
// encounter button on the hub). A typed address or the back button lands on the system's default page instead.
let GATED_VIEWS = new Set();
let gatePass = null;

const appEl = document.getElementById("app");
const mainView = document.getElementById("mainView");
const sideNav = document.getElementById("sideNav");
const navToggle = document.getElementById("navToggle");

let state = null;
let current = null;

// Phone layout: page changes run through a view transition (supported by Safari and Chrome), so the old page fades into
// the new one and the white dot glides between pages instead of vanishing (it has the same view-transition-name on
// every page: the hub's wheel dot, and #mDot elsewhere). Skipped on first load and for reduced motion.
function setView(name, opts = {}) {
  const phone = document.documentElement.classList.contains("m");
  if (phone && !opts.initial && !document.hidden && document.startViewTransition && !matchMedia("(prefers-reduced-motion: reduce)").matches && VIEWS[name] && name !== current) {
    // the page change never waits on the animation: if the transition hasn't swapped the page within 400ms (no frames
    // being drawn, say), it happens anyway
    let done = false;
    const go = () => { if (done) return; done = true; setViewNow(name, opts); };
    try { document.startViewTransition(go); } catch { go(); }
    setTimeout(go, 400);
    return;
  }
  setViewNow(name, opts);
}

// The phone layout's dot on pages other than the hub: the same white circle, in the same place, taking you back to the
// hub (the hub's own dot opens the wheel). Not on the full-screen Whiteboard or Battle screens, which have their own
// controls at the bottom.
const DOT_HOME = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11l9-7 9 7M5 10v10h5v-6h4v6h5V10"/></svg>';
function syncPhoneDot(name) {
  let dot = document.getElementById("mDot");
  const want = document.documentElement.classList.contains("m") && !["hub", "planner", "battleview"].includes(name);
  if (!want) { dot?.remove(); return; }
  if (!dot) {
    dot = el("button", { id: "mDot", type: "button", class: "wheel-dot m-dot", "aria-label": "Back to the hub" });
    dot.innerHTML = DOT_HOME;
    dot.addEventListener("click", () => setView("hub"));
    document.body.append(dot);
  }
}
window.addEventListener("layout-changed", () => syncPhoneDot(current));

function setViewNow(name, { initial = false } = {}) {
  if (!VIEWS[name] || !state) return;
  if (GATED_VIEWS.has(name) && gatePass !== name) name = activeSystem().defaultView;
  gatePass = null;
  clearAllIntervals();
  current = name;
  document.documentElement.classList.toggle("planner-full", name === "planner");   // the whiteboard is a full-screen page, no tower behind it
  document.documentElement.classList.toggle("hub-full", name === "hub");
  document.documentElement.classList.toggle("mapeditor-full", name === "mapeditor");   // full screen, like the hub
  document.documentElement.classList.toggle("admin-full", name === "admin");
  // every page is a floor of the Lava Tower, in menu order: the first page is the roof
  const floorBtn = sideNav.querySelector(`.nav-item[data-view="${name}"]`);
  if (floorBtn) goToFloor(Number(floorBtn.dataset.floor) || 0, sideNav.querySelectorAll(".nav-item").length, initial);
  document.querySelectorAll(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
  sideNav.classList.remove("open");
  mainView.dataset.view = name; // lets the stylesheet lay each page out for wide screens
  // the page's entrance (css/vvd.css: the title blurs in) plays only when you open a page, never when it redraws itself
  mainView.classList.remove("v-enter"); void mainView.offsetWidth; mainView.classList.add("v-enter");
  clearTimeout(setView.enterTimer); setView.enterTimer = setTimeout(() => mainView.classList.remove("v-enter"), 900);
  VIEWS[name].render(mainView, state);
  syncPhoneDot(current);
  window.scrollTo(0, 0);
  mainView.scrollTop = 0; // the page scrolls inside <main>, so a long page would otherwise leave the next one scrolled down
  playViewEnter();
  location.hash = name;
}

// A short fade-in on page changes only. Added after the render and removed
// again right away, so the periodic re-renders inside a page (battle polling,
// tab content, ...) never flicker, and it never blocks input: opacity and
// transform only, ~0.2s, skipped entirely for prefers-reduced-motion in CSS.
let enterTimer = null;
function playViewEnter() {
  clearTimeout(enterTimer);
  mainView.classList.remove("view-enter");
  void mainView.offsetWidth; // restart the animation if one was already running
  mainView.classList.add("view-enter");
  enterTimer = setTimeout(() => mainView.classList.remove("view-enter"), 450);
}

// Builds the sidebar from the active system's nav (plus the shared
// Settings page), so a different game system gets its own pages.
function buildNav(system) {
  sideNav.innerHTML = "";
  // a system can move these out of the sidebar (system.onHub: the Pokémon hub has buttons for them instead); they stay reachable
  const shared = [{ id: "planner", label: "Whiteboard", render: renderPlanner }, { id: "library", label: "Library", render: renderLibrary }, { id: "settings", label: "Settings", render: renderSettings }];
  const onHub = new Set(system.onHub || []);
  const appViews = shared.filter((v) => !onHub.has(v.id));
  const groups = [...system.nav, ...(appViews.length ? [{ label: "App", views: appViews }] : [])];
  VIEWS = viewsOf({ nav: [...groups, { label: null, views: [...(system.gatedViews || []), ...(system.hiddenViews || []), ...shared.filter((v) => onHub.has(v.id)), ...(signedInAccount?.perms?.admin ? [{ id: "admin", label: "Admin", render: renderAdmin }] : [])] }] });   // Admin lives in Settings; #admin still opens it full-page
  GATED_VIEWS = new Set((system.gatedViews || []).map((v) => v.id));
  DIRECTIVE_SENSITIVE_VIEWS = new Set(system.directiveViews || []);
  let floor = 0;
  for (const group of groups) {
    if (group.label) {
      const sep = document.createElement("div");
      sep.className = "nav-sep";
      sep.textContent = group.label;
      sideNav.appendChild(sep);
    }
    for (const v of group.views) {
      const btn = document.createElement("button");
      btn.className = "nav-item";
      btn.dataset.view = v.id;
      btn.dataset.floor = String(floor++);
      btn.textContent = v.label;
      btn.addEventListener("click", () => setView(v.id));
      const icon = NAV_ICONS[v.id];
      if (icon) {
        const span = document.createElement("span");
        span.className = "nav-icon";
        span.innerHTML = icon;
        btn.prepend(span);
      }
      sideNav.appendChild(btn);
    }
  }
  // A system without a sidebar (Pokémon: everything is on its hub) turns the menu button into a "back to the hub" button.
  document.documentElement.classList.toggle("no-sidebar", !!system.noSidebar);
  navToggle.innerHTML = system.noSidebar ? '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11l9-7 9 7M5 10v10h5v-6h4v6h5V10"/></svg>' : "☰";
  navToggle.setAttribute("aria-label", system.noSidebar ? "Back to the hub" : "Toggle navigation");
  navToggle.title = system.noSidebar ? "Back to the hub" : "";
  const brandText = document.querySelector(".brand-text");
  if (brandText && system.brand?.title) brandText.textContent = system.brand.title;
  const brandLogo = document.querySelector(".brand-logo");
  if (brandLogo && system.brand?.logo) brandLogo.src = system.brand.logo;
  if (system.brand?.title) document.title = system.brand.title;
  // each game can have its own tab icon (the page ships with the Pokéball)
  const icon = document.querySelector('link[rel="icon"]');
  if (icon) {
    if (!icon.dataset.original) icon.dataset.original = icon.getAttribute("href");
    icon.setAttribute("href", system.brand?.favicon || icon.dataset.original);
    icon.setAttribute("type", system.brand?.favicon ? "image/svg+xml" : "");
  }
  updateNavVisibility();
}
const NAV_KEY = "pokemon-dnd-nav-collapsed";
try { if (localStorage.getItem(NAV_KEY) === "1") document.documentElement.classList.add("nav-collapsed"); } catch { /* storage blocked */ }
navToggle.addEventListener("click", () => {
  if (activeSystem()?.noSidebar) { setView(activeSystem().defaultView); return; }   // no sidebar: this is the way home
  if (window.innerWidth > 780) {   // desktop: fold the menu away or bring it back
    const on = document.documentElement.classList.toggle("nav-collapsed");
    try { localStorage.setItem(NAV_KEY, on ? "1" : "0"); } catch { /* storage blocked */ }
    navToggle.setAttribute("aria-expanded", String(!on));
    window.dispatchEvent(new Event("resize"));   // the lava layer and any canvas re-measure
  } else sideNav.classList.toggle("open");
});

// A page asking to open another one (the hub's encounter buttons open the gated Battle screen this way).
window.addEventListener("app-open-view", (e) => {
  const view = e.detail?.view;
  if (!VIEWS[view]) return;
  if (GATED_VIEWS.has(view) && e.detail?.via === "hub") gatePass = view;
  setView(view);
});

window.addEventListener("hashchange", () => {
  const name = location.hash.replace("#", "");
  // setView() itself sets the hash, which lands here again: only react to a genuine change (back/forward, a typed URL)
  if (VIEWS[name] && name !== current) setView(name);
});

// Per-device sidebar page visibility (Settings → Sidebar Pages). "settings"
// itself is exempt — hiding your own way back into Settings would be a
// dead end. A `.nav-sep` group header hides too once every page under it
// is hidden, so there's never an empty section label left behind.
function updateNavVisibility() {
  const hidden = getHiddenViews();
  let sep = null;
  let members = [];
  function closeGroup() {
    if (sep) sep.classList.toggle("nav-hidden", members.length > 0 && members.every((m) => m.classList.contains("nav-hidden")));
  }
  [...sideNav.children].forEach((child) => {
    if (child.classList.contains("nav-sep")) {
      closeGroup();
      sep = child;
      members = [];
    } else if (child.classList.contains("nav-item")) {
      const key = child.dataset.view;
      child.classList.toggle("nav-hidden", key !== "settings" && hidden.has(key));
      members.push(child);
    }
  });
  closeGroup();
}
onHiddenViewsChanged(updateNavVisibility);
applyTheme();
mountLavaToggle({ get: getTheme, set: setTheme });
installTooltips();
// No browser right-click menu anywhere in the app (it reads as a web page, and the board has its own menus). Text
// boxes keep it, so copy and paste still work there.
document.addEventListener("contextmenu", (e) => {
  if (e.target.closest?.("input, textarea, [contenteditable=''], [contenteditable='true']")) return;
  e.preventDefault();
});
mountCosmicParallax();
watchLayout();   // the phone layout follows the device (js/mobileMode.js)

// Every trainer/battle/NPC/etc. endpoint is scoped to one campaign now (see
// server.py) -- nothing past this point can run until one is selected.
// gate-mode (see style.css) hides the sidebar/nav while the campaign-select
// screen has mainView instead of the real app.
let signedInAccount = null;

async function init() {
  // Nothing -- campaigns included -- is shown until someone is signed in.
  const session = await checkSession();
  if (session.offline) {
    appEl.classList.add("gate-mode");
    mountAccountChip(null);
    renderServerUnreachable(mainView, init);
    return;
  }
  if (!session.signedIn) {
    appEl.classList.add("gate-mode");
    mountAccountChip(null);
    renderLoginGate(mainView, init);
    return;
  }
  appEl.classList.remove("gate-mode");
  signedInAccount = session.account;
  mountAccountChip(signedInAccount); // no Settings link until the real app is mounted (startApp)

  const save = loadSave();
  let campaignId = getSelectedCampaignId();
  if (campaignId) {
    setActiveCampaign(campaignId);
    const check = await getCampaign(campaignId, save.networkId);
    if (check?.id) { setActiveSystem(check.system); activeSystem()?.applyCampaign?.(check); setForcedTheme(activeSystem()?.theme); applyTheme(); }
    if (!check?.id) {
      // Deleted, or this device was removed as a member -- don't get stuck
      // pointed at a campaign that no longer accepts it.
      campaignId = null;
      clearSelectedCampaignId();
      setActiveCampaign(null);
    }
  }
  if (!campaignId) {
    appEl.classList.add("gate-mode");
    await renderCampaignSelect(mainView, save.networkId, async (chosenId) => {
      setSelectedCampaignId(chosenId);
      setActiveCampaign(chosenId);
      const picked = await getCampaign(chosenId, save.networkId);
      setActiveSystem(picked?.system);
      activeSystem()?.applyCampaign?.(picked);
      setForcedTheme(activeSystem()?.theme);
      applyTheme();
      appEl.classList.remove("gate-mode");
      await startApp();
    });
    return;
  }
  await startApp();
}

// A required "what's your character called?" screen. Resolves once a name is saved.
function askCharacterName() {
  return new Promise((resolve) => {
    appEl.classList.add("gate-mode");
    const input = el("input", { type: "text", maxlength: "40", placeholder: "e.g. Mia Hart", "aria-label": "Character name", autocomplete: "off" });
    const go = el("button", { class: "btn", type: "button" }, "Continue");
    const msg = el("p", { class: "view-sub", role: "status" });
    const done = () => {
      const name = input.value.trim();
      if (!name) { msg.textContent = "Your character needs a name to join."; input.focus(); return; }
      const save = loadSave();
      save.trainer.name = name.slice(0, 40);
      writeSave(save);
      appEl.classList.remove("gate-mode");
      resolve();
    };
    go.addEventListener("click", done);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") done(); });
    mainView.replaceChildren(el("div", { class: "card name-gate" }, [
      el("h1", { class: "view-title" }, "Who are you playing?"),
      el("p", { class: "view-sub" }, "Give your character a name. It's how the DM and the other players will see you; you can change it later on the Trainer Sheet."),
      el("label", { class: "field" }, [el("span", {}, "Character name"), input]),
      go, msg,
    ]));
    setTimeout(() => input.focus(), 0);
  });
}

async function startApp() {
  // Pull this device's save down from the server's durable copy before
  // anything reads loadSave() -- the very first view rendered below (My
  // Team, Trainer Sheet, Bag, ...) needs it already in place, not a moment
  // later, or it'd flash the stale/empty local copy first.
  await pullFromServer();
  const system = activeSystem();
  // Pokémon campaigns: everyone needs a character name before they come in (the first time they join or make a
  // campaign; it's what the hub, the DM and everyone else see)
  if (system?.id === "pokemon-dnd" && !String(loadSave().trainer?.name || "").trim()) await askCharacterName();
  buildNav(system);
  try {
    state = await system.loadData();
  } catch (err) {
    mainView.replaceChildren(el("div", { class: "card" }, [
      el("strong", {}, "Failed to load data."), el("br"), String(err.message), el("br"), el("br"),
      "Make sure the app's data files exist (for Pokémon D&D, run ", el("code", {}, "python tools/export_data.py"), " first) and that you're viewing this through the server, not by double-clicking index.html.",
    ]));
    return;
  }
  // Opening a campaign, new or old (or reloading one), always starts on its home page: the hub for Pokémon D&D. A page
  // left in the address (#planner, #team, ...) is not reopened.
  setView(system.defaultView, { initial: true });
  mountAccountChip(signedInAccount, { onOpenSettings: () => setView("settings") });

  // The floating Quick Console (Bag/Level Up/Heal), the log drawer (My
  // Log/Battle Log), and the dice tray all live outside the router —
  // mounted once, present no matter which view is open.
  system.mount?.(state);
  mountLogDrawer(document.body, { tabs: system.pullTabs || [], state });   // LOG plus the system's own pull tabs
  mountDiceWidget();
  mountShortcuts();
  startTrainerPresenceWatcher(loadSave().networkId);
  window.addEventListener("pokemon-dnd-save-changed", () => {
    if (DIRECTIVE_SENSITIVE_VIEWS.has(current)) VIEWS[current].render(mainView, state);
  });

  // Runs for the lifetime of the page, independent of view switching (NOT
  // cleared by clearAllIntervals) — a DM action should land even if you're
  // looking at the Pokédex when it happens.
  setInterval(async () => {
    const changed = await system.applyDirectives?.(state);
    if (changed && DIRECTIVE_SENSITIVE_VIEWS.has(current)) {
      VIEWS[current].render(mainView, state);
    }
  }, 3000);

  // Also global and never cleared: keeps this trainer's name and team
  // visible to everyone else (Trainers Online, the DM's Control Centre)
  // up to date at all times — not just while the Trainers Online page
  // itself happens to be open. Without this, editing your name/team
  // anywhere else (My Team, Trainer Sheet) wouldn't reach the server until
  // you next visited Trainers Online, so others — and the DM — could keep
  // seeing a stale name (e.g. still "Trainer") or an outdated roster.
  setInterval(() => {
    const save = loadSave();
    pingTrainer(save.networkId, save.trainer.name || "Trainer", system.presence ? system.presence(save) : {}, save.trainer.sprite);
  }, 5000);
}

init();
