// Pinging the DM. Players get a button in the bottom-right dock (mountPingWidget); it never appears for the DM. The DM gets a PINGS
// pull tab (renderPingsTab) that lists everyone waiting, in the order they first pressed, with a count on the tab itself. A player who
// presses again while still waiting keeps their place (the server ignores it). The DM clears one ping, or all of them.

import { el } from "./components.js";
import { widgetDock, dockIcon } from "./widgetDock.js";
import { pingDm, getDmPings, clearDmPings } from "./network.js";
import { loadSave } from "./storage.js";

const DM_TOKEN_KEY = "pokemon-dnd-dm-token";
const POLL_MS = 3000;
const dmToken = () => { try { return localStorage.getItem(DM_TOKEN_KEY) || ""; } catch { return ""; } };

// the name the DM sees: the Pokémon trainer's name, or the D&D character's
async function myName() {
  const trainer = loadSave().trainer?.name;
  if (trainer) return trainer;
  try { const m = await import("./systems/dnd5e/store.js"); return m.activeCharacter?.()?.name || "A player"; } catch { return "A player"; }
}

// ---------------------------------------------------------------- the player's button
export function mountPingWidget() {
  if (document.getElementById("pingWidgetBtn")) return;
  const btn = el("button", { id: "pingWidgetBtn", class: "dice-widget-btn ping-widget-btn", title: "Get the DM's attention", "aria-label": "Ping the DM" }, [
    el("span", { class: "dock-text" }, "PING"),
    dockIcon("M12 3a6 6 0 0 0-6 6c0 4-2 5-2 6h16c0-1-2-2-2-6a6 6 0 0 0-6-6zM10 19a2 2 0 0 0 4 0"),
  ]);
  widgetDock().appendChild(btn);
  let busy = false;
  btn.addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    btn.classList.add("sent");
    btn.querySelector(".dock-text").textContent = "SENT";
    try { await pingDm(loadSave().networkId, await myName()); } catch { /* the DM just doesn't get it; try again */ }
    setTimeout(() => { btn.classList.remove("sent"); btn.querySelector(".dock-text").textContent = "PING"; busy = false; }, 3000);
  });
  // never for the DM (logDrawer.js says when this device is, or stops being, the DM's)
  const apply = (isDm) => { btn.hidden = !!isDm; };
  apply(!!dmToken());
  window.addEventListener("pkdnd-dm-changed", (e) => apply(e.detail?.isDm));
}

// ---------------------------------------------------------------- the DM's side
let last = [];
let timer = null;

function paintBadge() {
  const tab = document.querySelector('.pull-tab[aria-controls="pull-pings"]');
  if (tab) tab.dataset.count = last.length ? String(last.length) : "";
}

async function poll() {
  if (document.hidden) return;
  const token = dmToken();
  if (!token) { last = []; paintBadge(); return; }
  last = await getDmPings(token).catch(() => last);
  paintBadge();
  window.dispatchEvent(new CustomEvent("pkdnd-dm-pings", { detail: last }));
}

// keeps the count on the PINGS tab current (does nothing for a device that isn't the DM's)
export function startDmPings() {
  clearInterval(timer);
  timer = setInterval(poll, POLL_MS);
  window.addEventListener("pkdnd-dm-changed", () => setTimeout(poll, 200));
  poll();
}

const ago = (t) => {
  const s = Math.max(0, Math.round(Date.now() / 1000 - t));
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ago` : `${Math.floor(s / 3600)}h ago`;
};

export function renderPingsTab(host) {
  host.classList.add("dm-pings");
  const list = el("ol", { class: "dm-pings-list" });
  const clearAll = el("button", { type: "button", class: "btn secondary tiny" }, "Clear all");
  clearAll.addEventListener("click", async () => { await clearDmPings(dmToken()); poll(); });
  host.append(el("div", { class: "dm-pings-head" }, [el("span", { class: "dnd-muted" }, "In the order they pinged you"), clearAll]), list);
  const draw = () => {
    clearAll.hidden = !last.length;
    if (!last.length) { list.replaceChildren(el("li", { class: "dm-pings-empty" }, "No one is waiting.")); return; }
    list.replaceChildren(...last.map((p, i) => {
      const done = el("button", { type: "button", class: "dm-ping-done", "aria-label": `Answered ${p.name}`, title: "Answered" }, "✓");
      done.addEventListener("click", async () => { await clearDmPings(dmToken(), p.id); poll(); });
      return el("li", { class: "dm-ping" }, [el("span", { class: "dm-ping-n" }, String(i + 1)), el("span", { class: "dm-ping-who" }, [el("strong", {}, p.name), el("small", {}, ago(p.t))]), done]);
    }));
  };
  window.addEventListener("pkdnd-dm-pings", () => { if (host.isConnected) draw(); });
  draw();
  poll();
}
