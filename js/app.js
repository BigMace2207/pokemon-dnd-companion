import { renderSettings } from "./views/settings.js";
import { el } from "./components.js";
import "./systems/index.js"; // registers every game system
import { setActiveSystem, activeSystem, viewsOf } from "./systems/registry.js";
import { clearAllIntervals } from "./intervals.js";
import { loadSave, pullFromServer } from "./storage.js";
import { pingTrainer, getCampaign, setActiveCampaign } from "./network.js";
import { renderCampaignSelect } from "./views/campaignSelect.js";
import { renderLoginGate, renderServerUnreachable } from "./views/loginGate.js";
import { checkSession } from "./account.js";
import { mountAccountChip } from "./accountChip.js";
import { mountLogDrawer } from "./logDrawer.js";
import { mountDiceWidget } from "./diceWidget.js";
import { startTrainerPresenceWatcher } from "./trainerPresence.js";
import { mountShortcuts } from "./shortcuts.js";
import { NAV_ICONS } from "./navIcons.js";
import {
  applyTheme, getHiddenViews, onHiddenViewsChanged,
  getSelectedCampaignId, setSelectedCampaignId, clearSelectedCampaignId,
} from "./deviceSettings.js";

// The router's lookup table, rebuilt for whichever game system the active
// campaign uses (see js/systems/). Settings is shared by every system.
let VIEWS = {};
let DIRECTIVE_SENSITIVE_VIEWS = new Set();

const appEl = document.getElementById("app");
const mainView = document.getElementById("mainView");
const sideNav = document.getElementById("sideNav");
const navToggle = document.getElementById("navToggle");

let state = null;
let current = null;

function setView(name) {
  if (!VIEWS[name] || !state) return;
  clearAllIntervals();
  current = name;
  document.querySelectorAll(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
  sideNav.classList.remove("open");
  mainView.dataset.view = name; // lets the stylesheet lay each page out for wide screens
  VIEWS[name].render(mainView, state);
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
  const groups = [...system.nav, { label: "App", views: [{ id: "settings", label: "Settings", render: renderSettings }] }];
  VIEWS = viewsOf({ nav: groups });
  DIRECTIVE_SENSITIVE_VIEWS = new Set(system.directiveViews || []);
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
  const brandText = document.querySelector(".brand-text");
  if (brandText && system.brand?.title) brandText.textContent = system.brand.title;
  const brandLogo = document.querySelector(".brand-logo");
  if (brandLogo && system.brand?.logo) brandLogo.src = system.brand.logo;
  if (system.brand?.title) document.title = system.brand.title;
  updateNavVisibility();
}
navToggle.addEventListener("click", () => sideNav.classList.toggle("open"));

window.addEventListener("hashchange", () => {
  const name = location.hash.replace("#", "");
  if (VIEWS[name]) setView(name);
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
    if (check?.id) setActiveSystem(check.system);
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
      appEl.classList.remove("gate-mode");
      await startApp();
    });
    return;
  }
  await startApp();
}

async function startApp() {
  // Pull this device's save down from the server's durable copy before
  // anything reads loadSave() -- the very first view rendered below (My
  // Team, Trainer Sheet, Bag, ...) needs it already in place, not a moment
  // later, or it'd flash the stale/empty local copy first.
  await pullFromServer();
  const system = activeSystem();
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
  const startView = location.hash.replace("#", "");
  setView(VIEWS[startView] ? startView : system.defaultView);
  mountAccountChip(signedInAccount, { onOpenSettings: () => setView("settings") });

  // The floating Quick Console (Bag/Level Up/Heal), the log drawer (My
  // Log/Battle Log), and the dice tray all live outside the router —
  // mounted once, present no matter which view is open.
  system.mount?.(state);
  mountLogDrawer(document.body);
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
