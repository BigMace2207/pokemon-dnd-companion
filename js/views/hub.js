// The Hub: the Pokémon campaign's shared whiteboard, the page every player lands on. Everyone can pan around, leave
// sticky notes, write and draw, and sees everyone else's cursor (in that player's colour from Settings, with their
// name above it, faded so it doesn't get in the way). The DM drags encounter buttons onto it: an NPC trainer or a wild
// Pokémon from the DM's libraries, or an encounter generated in the Campaign Planner. Hovering one shows its first
// Pokémon's level (and its sprite, if the DM allows it; otherwise a question mark). Buttons are the only way into
// the Battle screen: a player's click opens it, the DM's click starts that battle and opens Battle Control.
//
// The board lives on the server (server.py "The Pokémon hub"); this page syncs a few times a second while it's open,
// sending its own cursor and receiving everyone else's, and the board itself only when it changed.

import { el } from "../components.js";
import { loadSave } from "../storage.js";
import {
  hubSync, hubOp, getNpcs, getNpc, getWildList, getWildMon, listTrainers, getTrainerTeam, getFullTurn, dmAction,
  dmLogin, checkDmToken, getActiveCampaign,
} from "../network.js";
import { cursorColorOf } from "../cursorColor.js";
import { getPlan } from "../planner/store.js";
import { spriteUrl } from "../sprites.js";
import { setViewState } from "../viewState.js";
import { getDmToken, DM_TOKEN_KEY } from "../systems/dnd5e/dmAccess.js";

const SYNC_MS = 140;          // how often the page reports its cursor while the mouse is moving
const IDLE_SYNC_MS = 1500;    // and how often it checks in when nothing is moving
const NOTE_COLORS = ["#ffe58a", "#ffb4a2", "#b5f0c4", "#a8d8ff", "#e2c4ff", "#f4f4f5"];
const PEN_WIDTHS = [3, 6, 12];
const uid = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

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
  let pointerWorld = null;        // where my cursor is on the board (null when it's off the board)
  let lastSent = 0, dirtyCursor = false, inFlight = false, again = false, alive = true;

  // ------------------------------------------------------------------ layout
  const root = el("div", { class: "hub", style: `--me:${me.color}` });
  const stage = el("div", { class: "hub-stage", tabindex: "0", "aria-label": "Shared hub board" });
  const world = el("div", { class: "hub-world" });
  const ink = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  ink.setAttribute("class", "hub-ink");
  const itemLayer = el("div", { class: "hub-items" });
  world.append(ink, itemLayer);
  const cursorLayer = el("div", { class: "hub-cursors", "aria-hidden": "true" });
  const myTag = el("div", { class: "hub-mytag", "aria-hidden": "true" }, me.name);
  stage.append(world, cursorLayer, myTag);
  stage.style.cursor = cursorCss(me.color);

  const people = el("div", { class: "hub-people" });
  const topbar = el("div", { class: "hub-top" }, [
    el("div", { class: "hub-title" }, [el("span", { class: "hub-eyebrow" }, "Pokémon D&D"), el("strong", {}, "Hub")]),
    people,
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
  root.append(stage, empty, topbar, subbar, toolbar, drawer, hover, menu, toast);
  container.append(root);

  let toastTimer = null;
  function say(text) {
    toast.textContent = text;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
  }

  // ------------------------------------------------------------------ view (pan / zoom)
  function applyView() {
    world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.k})`;
    stage.style.setProperty("--k", String(view.k));
    root.style.setProperty("--grid", `${28 * view.k}px`);
    root.style.setProperty("--gx", `${view.x}px`);
    root.style.setProperty("--gy", `${view.y}px`);
    placeCursors();
  }
  const toWorld = (cx, cy) => {
    const r = stage.getBoundingClientRect();
    return { x: (cx - r.left - view.x) / view.k, y: (cy - r.top - view.y) / view.k };
  };
  const toScreen = (wx, wy) => ({ x: wx * view.k + view.x, y: wy * view.k + view.y });
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
    applyView();
  }, { passive: false });

  // ------------------------------------------------------------------ toolbar
  const TOOLS = [
    ["move", "Move", "M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20"],
    ["note", "Note", "M5 4h14v11l-5 5H5zM14 20v-5h5"],
    ["pen", "Draw", "M4 20l4-1L19 8l-3-3L5 16zM14 7l3 3"],
    ["text", "Text", "M5 6V4h14v2M12 4v16M9 20h6"],
    ["erase", "Erase", "M7 20h12M5 15l8-8 6 6-5 5H9z"],
  ];
  const icon = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
  function drawToolbar() {
    toolbar.replaceChildren(...TOOLS.map(([id, label, d]) => {
      const b = el("button", { type: "button", class: `hub-tool${tool === id ? " on" : ""}`, title: label, "aria-pressed": String(tool === id) });
      b.innerHTML = icon(d) + `<span>${label}</span>`;
      b.addEventListener("click", () => { tool = id; drawToolbar(); drawSubbar(); stage.dataset.tool = id; });
      return b;
    }), el("span", { class: "hub-sep" }), dmButton());
    stage.dataset.tool = tool;
  }
  function dmButton() {
    if (dmToken) {
      const b = el("button", { type: "button", class: `hub-tool hub-dm${drawer.classList.contains("open") ? " on" : ""}`, title: "Encounters" });
      b.innerHTML = icon("M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h6m6 0h6M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z") + "<span>Encounters</span>";
      b.addEventListener("click", () => { drawer.classList.toggle("open"); if (drawer.classList.contains("open")) drawDrawer(); drawToolbar(); });
      return b;
    }
    const b = el("button", { type: "button", class: "hub-tool", title: "I'm the DM" });
    b.innerHTML = icon("M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6zM9.5 12l2 2 3.5-4") + "<span>DM</span>";
    b.addEventListener("click", askDmPassword);
    return b;
  }
  function drawSubbar() {
    subbar.replaceChildren();
    subbar.classList.toggle("show", tool === "pen" || tool === "note" || tool === "erase");
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
    const res = await hubOp(me.id, body, dmToken);
    if (!res) { say("Couldn't save that. Check your connection."); return null; }
    if (res.error) { say(res.error); return null; }
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
    const res = await hubSync(me.id, rev, pointerWorld ? { x: pointerWorld.x, y: pointerWorld.y, name: me.name, color: me.color } : null);
    inFlight = false;
    if (again) { again = false; rev = -1; setTimeout(() => sync(true), 0); }
    if (!res || !alive) return;
    drawPeople(res.cursors || []);
    drawCursors(res.cursors || []);
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
        node = el("div", { class: "hub-cursor" }, [el("span", { class: "hub-cursor-arrow" }), el("span", { class: "hub-cursor-name" })]);
        cursorLayer.append(node);
        cursorEls.set(c.id, node);
      }
      node.style.setProperty("--c", c.color);
      node.querySelector(".hub-cursor-name").textContent = c.name;
    }
    for (const [id, node] of cursorEls) if (!seen.has(id)) { node.remove(); cursorEls.delete(id); }
    placeCursors();
  }
  function placeCursors() {
    for (const c of cursorData) {
      const node = cursorEls.get(c.id);
      if (!node) continue;
      const p = toScreen(c.x, c.y);
      node.style.transform = `translate(${p.x}px, ${p.y}px)`;
    }
  }
  function drawPeople(list) {
    const all = [{ id: me.id, name: me.name, color: me.color, self: true }, ...list];
    people.replaceChildren(...[...all.slice(0, 9).map((p) => el("span", { class: `hub-avatar${p.self ? " self" : ""}`, style: `--c:${p.color}`, title: p.self ? `${p.name} (you)` : p.name }, (p.name || "?").slice(0, 1).toUpperCase())),
      all.length > 9 ? el("span", { class: "hub-avatar more" }, `+${all.length - 9}`) : null,
      el("span", { class: "hub-online" }, `${all.length} here`)].filter(Boolean));
  }

  // ------------------------------------------------------------------ items
  const itemEls = new Map();
  const mine = (it) => it.owner === me.id;
  const canEdit = (it) => !!dmToken || (mine(it) && it.type !== "button");

  function drawItems() {
    empty.classList.toggle("gone", items.length > 0);
    // drawings go in the SVG
    const strokes = items.filter((it) => it.type === "stroke");
    ink.replaceChildren(...strokes.map((s) => {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
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
        node = it.type === "note" ? makeNote(it) : it.type === "text" ? makeText(it) : makeButton(it);
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
      } else if (it.type === "text") {
        node.style.color = it.color; node.style.fontSize = `${it.size}px`;
        node.textContent = it.text;
      } else {
        fillButton(node, it);
      }
    }
    for (const [id, node] of itemEls) if (!seen.has(id)) { node.remove(); itemEls.delete(id); }
  }

  function makeNote(it) {
    const ta = el("textarea", { class: "hub-note-text", spellcheck: "true", "aria-label": "Note", placeholder: "Write something…" });
    let saveTimer = null;
    ta.addEventListener("input", () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => { const cur = node.__item; op({ op: "put", item: { ...cur, text: ta.value } }); }, 500);
    });
    const node = el("div", { class: "hub-note" }, [el("div", { class: "hub-note-grip", "aria-hidden": "true" }), ta]);
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
    if (!menu.contains(e.target) && !e.target.closest(".hub-btn") && !e.target.closest(".hub-tool")) closeMenu();
  });

  function buttonClicked(node) {
    const it = node.__item;
    hideHover();
    if (!dmToken) { openFromHub("battleview"); return; }
    const row = (label, fn, cls = "") => { const b = el("button", { type: "button", class: `hub-menu-item ${cls}` }, label); b.addEventListener("click", () => { closeMenu(); fn(); }); return b; };
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
    const node = planEncounter(src.id);
    const mons = node?.mons?.length ? node.mons : src.mons;
    const out = [];
    for (const m of mons || []) {
      const species = state?.pokemonByName?.get(m.name);
      const mon = {
        id: crypto.randomUUID ? crypto.randomUUID() : uid(), dex: species?.dex ?? null, name: m.name, nickname: "", level: m.level || 5, currentHp: null,
        item: "", ability: m.ability || "", status: "None", moves: [...(m.moves || []), "", "", "", ""].slice(0, 4),
      };
      const res = await dmAction(dmToken, "wildSave", { mon });
      if (res?.wildId) out.push(combatant("wild", res.wildId, `Wild ${m.name}`, { ...mon, id: res.wildId }, "B"));
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
      group("From your planner", plan.map(({ b, n }) => entry(n.title.replace(/^Wild encounter — /, "").slice(0, 48), `${n.genLabel || "Encounter"} · ${n.mons.length} Pokémon`, n.gen === "wild" ? "wild" : "npc",
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
  stage.addEventListener("dragover", (e) => { if (dmToken && e.dataTransfer.types.includes("application/x-hub-button")) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; } });
  stage.addEventListener("drop", (e) => {
    const raw = e.dataTransfer.getData("application/x-hub-button");
    if (!raw || !dmToken) return;
    e.preventDefault();
    addButton(JSON.parse(raw), toWorld(e.clientX, e.clientY));
  });

  // ------------------------------------------------------------------ pointer: pan, drag, draw, place
  let gesture = null;
  let liveStroke = null;
  stage.addEventListener("pointermove", (e) => {
    const r = stage.getBoundingClientRect();
    pointerWorld = toWorld(e.clientX, e.clientY);
    dirtyCursor = true;
    myTag.style.transform = `translate(${e.clientX - r.left}px, ${e.clientY - r.top}px)`;
    myTag.classList.add("show");
    if (!gesture) return;
    const dx = e.clientX - gesture.sx, dy = e.clientY - gesture.sy;
    if (Math.hypot(dx, dy) > 4) gesture.moved = true;
    if (gesture.kind === "pan") { view.x = gesture.ox + dx; view.y = gesture.oy + dy; applyView(); }
    else if (gesture.kind === "drag" && gesture.moved) {
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
    const itemNode = e.target.closest(".hub-note, .hub-text, .hub-btn");
    const strokeId = e.target.closest?.("path")?.dataset?.id;
    const start = { sx: e.clientX, sy: e.clientY, moved: false, id: e.pointerId };
    if (e.button === 1) { gesture = { ...start, kind: "pan", ox: view.x, oy: view.y }; stage.setPointerCapture(e.pointerId); return; }
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
      stage.setPointerCapture(e.pointerId);
      return;
    }
    if (itemNode && e.target.tagName === "TEXTAREA" && !e.target.readOnly) return;   // typing in a note
    if (itemNode) {
      const it = itemNode.__item;
      const movable = it && (it.type === "button" ? !!dmToken : canEdit(it));
      gesture = { ...start, kind: movable ? "drag" : "click", node: itemNode, ix: it.x, iy: it.y };
      stage.setPointerCapture(e.pointerId);
      return;
    }
    if (tool === "note" || tool === "text") { gesture = { ...start, kind: tool }; return; }
    gesture = { ...start, kind: "pan", ox: view.x, oy: view.y };
    stage.setPointerCapture(e.pointerId);
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
    if ((g.kind === "drag" || g.kind === "click") && !g.moved) {
      if (g.node.classList.contains("hub-btn")) buttonClicked(g.node);
      else if (g.node.classList.contains("hub-note")) g.node.querySelector("textarea").focus();
      else if (g.node.classList.contains("hub-text") && canEdit(g.node.__item)) {
        const it = g.node.__item;
        const text = prompt("Edit the text", it.text);
        if (text !== null) await op(text.trim() ? { op: "put", item: { ...it, text: text.trim() } } : { op: "delete", itemId: it.id });
      }
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
      const res = await op({ op: "put", item: { type: "note", id: uid(), x: Math.round(p.x - 110), y: Math.round(p.y - 30), w: 220, h: 160, text: "", color: noteColor } });
      if (res) { tool = "move"; drawToolbar(); drawSubbar(); }
      return;
    }
    if (g.kind === "text" && !g.moved) {
      const text = prompt("Text to put on the board");
      const p = toWorld(e.clientX, e.clientY);
      if (text && text.trim()) await op({ op: "put", item: { type: "text", id: uid(), x: Math.round(p.x), y: Math.round(p.y), text: text.trim().slice(0, 400), size: 28, color: me.color } });
    }
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
    e.preventDefault(); applyView();
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
