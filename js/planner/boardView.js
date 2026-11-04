// The Whiteboard (once the Campaign Planner), and its whole interface. An endless pan/zoom canvas fills the page; a bar
// at the bottom middle (like the hub's tool bar) holds the nodes you can add (notes, checklists, sticky notes, dungeons, every generator), and drawers on the
// right hold the longer tools (maps, scenarios, party plans). The paper grows when a node nears an edge (board.js), the
// background can be swapped or uploaded, and "sessions" are drawn round groups of nodes (box or freehand). A node can sit
// in several sessions, and each session has its own colour and label.
//
// readonly mode is the DM looking at a player's boards: same canvas, no editing, no rail.
//
// Slots (Pokémon campaigns): trainer, gym leader and wild encounter nodes have a Trainer slot and a Team slot, like the
// inputs on a Scratch block. The Libraries button brings the DM's NPC trainers and wild Pokémon onto the board as cards;
// drag a card (or a library entry straight from the list) into a slot and it snaps in: a trainer gives the node its
// name, sprite and team, a Pokémon joins the team. Team rows drag to reorder, into another node's team, or back out onto
// the board as a card again.

import { el, btn, chip, field, selectEl, numInput, textInput, toast, confirmDialog, promptDialog, modal } from "../systems/dnd5e/ui.js";
import { textGenerators, OPTIONS } from "./textGens.js";
import { getPlan, mutatePlan, batched, flushPending, newBoard, uid } from "./store.js";
import { getSettings } from "../systems/dnd5e/store.js";
import { growBounds, coverBounds, boxFrom, simplify, addSession, removeSession, syncSessions, nodesInShape, BACKGROUNDS, isPreset, MAX_NODES, addLink, removeLinksOf, edgePoints, RELATIONS, suggestRelation, relationText } from "./board.js";
import { putImage, getImage, deleteImage, readAsDataUrl, imageSize } from "./mapStore.js";
import { icon } from "./icons.js";
import { openMapLink } from "./mapLink.js";
import { KINDS, kindOf } from "./kinds.js";
import { cleanMon, TEAM_MAX } from "./board.js";
import { getNpcs, getNpc, getWildList, getWildMon } from "../network.js";
import { spriteUrl } from "../sprites.js";
import { trainerSpriteUrl, openTrainerPortraitPicker } from "../trainerSpritePicker.js";
import { dexPanel, CARD_MIME } from "../hubDex.js";
import { pokemonState } from "./textGens.js";
import { generateMon } from "./pokeGenerators.js";
import { askLevel } from "../levelAsk.js";

const SIZE = { note: [300, 240], list: [280, 300], gen: [320, 260], text: [210, 150], dungeon: [380, 320], libmon: [230, 190], libtrainer: [260, 240] };
const SLOT_KINDS = new Set(["trainer", "gym", "wildmon"]);
const MON_LINE = /^[A-Z][^()]*\(Lv \d+/;   // a generated "Pidgey (Lv 6, Normal/Flying) — ..." line, shown as a team row instead
const DUNGEON_OPEN = [820, 640];
const SVGNS = "http://www.w3.org/2000/svg";
const svg = (tag, attrs = {}) => { const n = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };
const capture = (node, id) => { try { node.setPointerCapture(id); } catch { /* the pointer is already gone */ } };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// extras: [{ id, label, icon, render(host) }] become buttons that open a drawer over the board.
export function renderBoardApp(panel, { system, readonly = false, boards = null, extras = [] }) {
  let list = readonly ? boards : getPlan().boards;
  let board = null;
  let tool = "move";          // move | box | free
  let zTop = 10;
  let bgUrl = null;           // uploaded background for the open board (device-local)
  let inited = false;
  let flyout = null;          // which rail flyout is open

  const gens = textGenerators(system);
  const pokemon = system !== "dnd5e";
  const hasSlots = (n) => pokemon && n.type === "gen" && SLOT_KINDS.has(kindOf(n));
  const specs = OPTIONS[system] || {};
  const nodeEls = new Map();

  // ---- saving --------------------------------------------------------------------------------
  function edit(fn) {
    if (readonly || !board) return;
    const id = board.id, keep = { view: board.view, bounds: board.bounds };
    mutatePlan((p) => { const b = p.boards.find((x) => x.id === id); if (b) { fn(b); b.bounds = union(b.bounds, keep.bounds); } });
    board = getPlan().boards.find((x) => x.id === id) || board;
    board.view = keep.view; board.bounds = union(board.bounds, keep.bounds);
  }
  const union = (a, b) => { const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y); return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }; };
  const saveSoon = batched((fns) => edit((b) => fns.forEach((f) => f(b))), 500);
  const saveView = batched((fns) => edit((b) => fns.forEach((f) => f(b))), 800);
  const nodeOf = (b, id) => b.nodes.find((n) => n.id === id);
  const grow = (b) => { const r = growBounds(b.bounds, b.nodes); if (r.grew) b.bounds = r.bounds; };

  // ---- layout --------------------------------------------------------------------------------
  const full = !readonly;
  const topbar = el("div", { class: "pl-top" });
  const rail = el("nav", { class: "pl-rail", "aria-label": "Add to the board" });
  const flyEl = el("div", { class: "pl-fly", hidden: "" });
  const drawer = el("aside", { class: "pl-drawer", hidden: "", "aria-label": "Planner tool" });
  const vp = el("div", { class: "pl-viewport", tabindex: "0", "aria-label": "Whiteboard. Drag to move around, scroll to zoom." });
  const stage = el("div", { class: "pl-stage" });
  const paper = el("div", { class: "pl-paper pl-bg-parchment" });
  const sessLayer = svg("svg", { class: "pl-sessions", width: "1", height: "1" });
  const nodeLayer = el("div", { class: "pl-nodes" });
  const linkLayer = svg("svg", { class: "pl-links", width: "1", height: "1" });
  const draw = svg("svg", { class: "pl-draw", width: "1", height: "1" });
  const legend = el("div", { class: "pl-legend", "aria-label": "Sessions" });
  let focusId = null;
  const focusBar = el("div", { class: "pl-focusbar", hidden: "" });
  const bgPanel = el("div", { class: "pl-bgpanel", hidden: "" });
  const hint = el("div", { class: "pl-hint" });
  stage.append(paper, sessLayer, nodeLayer, linkLayer, draw);
  vp.append(stage, hint);
  const shell = el("div", { class: `pl-wb${full ? " full" : " readonly"}` });
  if (full) shell.append(vp, topbar, rail, flyEl, legend, focusBar, bgPanel, drawer);
  else shell.append(topbar, el("div", { class: "pl-wb-frame" }, [vp, legend, focusBar]));
  panel.append(shell);

  const view = () => board.view;
  const toWorld = (cx, cy) => { const r = vp.getBoundingClientRect(); return [(cx - r.left - view().x) / view().z, (cy - r.top - view().y) / view().z]; };
  function applyView() {
    stage.style.transform = `translate(${view().x}px, ${view().y}px) scale(${view().z})`;
    vp.style.setProperty("--z", String(view().z));
  }
  function setView(x, y, z) {
    const v = view();
    v.z = clamp(z, 0.15, 2.5); v.x = x; v.y = y;
    applyView();
    ensureCover();
  }
  // the paper always fills the screen: when the view reaches its edge (or the window grows) the board grows
  function ensureCover() {
    const v = view(), W = vp.clientWidth, H = vp.clientHeight;
    if (!W || !H) return;
    const c = coverBounds(board.bounds, -v.x / v.z, -v.y / v.z, (W - v.x) / v.z, (H - v.y) / v.z);
    if (c.grew) { board.bounds = c.bounds; applyBounds(); }
    const keep = { x: v.x, y: v.y, z: v.z }, bounds = { ...board.bounds };
    saveView((bd) => { bd.view = keep; bd.bounds = union(bd.bounds, bounds); });
  }
  function zoomAt(cx, cy, factor) {
    const r = vp.getBoundingClientRect();
    const px = cx - r.left, py = cy - r.top, v = view();
    const z = clamp(v.z * factor, 0.15, 2.5);
    setView(px - ((px - v.x) / v.z) * z, py - ((py - v.y) / v.z) * z, z);
  }
  const zoomMid = (f) => { const r = vp.getBoundingClientRect(); zoomAt(r.left + vp.clientWidth / 2, r.top + vp.clientHeight / 2, f); };
  function fit(only = null) {
    const ns = only || board.nodes;
    const W = vp.clientWidth, H = vp.clientHeight;
    if (!ns.length) { setView(W / 2, H / 2, 0.8); return; }
    const x0 = Math.min(...ns.map((n) => n.x)), y0 = Math.min(...ns.map((n) => n.y));
    const x1 = Math.max(...ns.map((n) => n.x + n.w)), y1 = Math.max(...ns.map((n) => n.y + n.h));
    const z = clamp(Math.min((W - 200) / (x1 - x0), (H - 200) / (y1 - y0)), 0.15, 1.2);
    setView(W / 2 - ((x0 + x1) / 2) * z, H / 2 - ((y0 + y1) / 2) * z, z);
  }
  function applyBounds() {
    const b = board.bounds;
    Object.assign(paper.style, { left: `${b.x}px`, top: `${b.y}px`, width: `${b.w}px`, height: `${b.h}px` });
  }
  function applyBg() {
    const bg = board.bg;
    const useImg = bg.kind === "image" && bgUrl;
    paper.className = `pl-paper ${useImg ? "pl-bg-image" : `pl-bg-${isPreset(bg.id) && bg.kind === "preset" ? bg.id : "parchment"}`}`;
    paper.style.backgroundImage = useImg ? `url("${bgUrl}")` : "";
    paper.style.backgroundSize = useImg ? (bg.fit === "fill" ? "cover" : "900px auto") : "";
    paper.style.backgroundRepeat = useImg ? (bg.fit === "fill" ? "no-repeat" : "repeat") : "";
  }

  // ---- nodes ---------------------------------------------------------------------------------
  const sessionById = (id) => board.sessions.find((s) => s.id === id);
  const iconBtn = (name, label, fn) => {
    const b = el("button", { type: "button", class: "pl-ibtn", title: label, "aria-label": label }, icon(name, 16));
    b.addEventListener("click", fn); b.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    return b;
  };

  function drawNodes() {
    flushPending();
    nodeLayer.replaceChildren();
    nodeEls.clear();
    for (const n of board.nodes) { const e = nodeEl(n); nodeEls.set(n.id, e); nodeLayer.append(e); }
    drawSessions(); drawLinks();
    hint.textContent = board.nodes.length ? "" : readonly ? "This board is empty." : "Add a node from the left: drag it onto the board, or click it.";
  }
  const place = (e, n) => Object.assign(e.style, { left: `${n.x}px`, top: `${n.y}px`, width: `${n.w}px`, height: `${n.h}px` });

  // Every session a node is in shows as a coloured ring and a label tag.
  function paintSession(e, n) {
    const ss = (n.sessions || []).map(sessionById).filter(Boolean);
    e.classList.toggle("in-session", ss.length > 0);
    e.style.setProperty("--rings", String(Math.max(1, Math.min(4, ss.length))));
    const tags = e.querySelector(".pl-session-tags");
    tags.replaceChildren(...ss.map((s) => el("span", { class: "pl-session-tag", style: `background:${s.color}` }, `Session ${s.n}`)));
    e.style.boxShadow = ss.length ? [...ss.slice(0, 4).map((s, i) => `0 0 0 ${(i + 1) * 4}px ${s.color}`), "6px 6px 0 rgba(0, 0, 0, .35)"].join(", ") : "";
  }

  function nodeEl(n) {
    const kind = kindOf(n), meta = KINDS[kind] || KINDS[n.type] || KINDS.note;
    const typeLabel = n.type === "gen" ? (n.genLabel || meta.label) : meta.label;
    const title = el("input", { class: "pl-node-title", type: "text", value: n.title || "", "aria-label": `${typeLabel} title`, ...(readonly ? { readonly: "" } : {}) });
    title.addEventListener("input", () => saveSoon((b) => { const x = nodeOf(b, n.id); if (x) x.title = title.value.slice(0, 120); }));
    const head = el("div", { class: "pl-node-head" }, [icon(meta.icon, 16), el("span", { class: "pl-node-kind" }, typeLabel), title]);
    const acts = el("div", { class: "pl-node-acts" });
    if (!readonly) {
      acts.append(iconBtn("pin", n.mapLink ? "Linked to a place on a map" : "Link to a place on a map", () => openMapLink({ node: n, edit, drawNodes, openMap: (link) => openDrawer(extras.find((x) => x.id === "maps"), link), getPlan, mutatePlan, uid })));
      if (n.type === "gen") acts.append(iconBtn("refresh", "Roll again", () => reroll(n)));
      if (n.type === "dungeon") acts.append(iconBtn(n.expanded ? "collapse" : "expand", n.expanded ? "Collapse" : "Expand to see every room and add notes", () => toggleDungeon(n)));
      acts.append(iconBtn("close", "Remove from the board", async () => {
        if (!(await confirmDialog(`Remove "${n.title || typeLabel}" from the board?`, { ok: "Remove", danger: true }))) return;
        edit((b) => { b.nodes = b.nodes.filter((x) => x.id !== n.id); removeLinksOf(b, n.id); });
        drawNodes();
      }));
    } else if (n.type === "dungeon") acts.append(iconBtn(n.expanded ? "collapse" : "expand", n.expanded ? "Collapse" : "Expand", () => { n.expanded = !n.expanded; if (n.expanded) { n.w = Math.max(n.w, DUNGEON_OPEN[0]); n.h = Math.max(n.h, DUNGEON_OPEN[1]); } drawNodes(); }));
    head.append(acts);

    const body = el("div", { class: "pl-node-body" });
    fillBody(body, n);
    const handle = readonly ? null : el("div", { class: "pl-resize", title: "Drag to resize", "aria-hidden": "true" });
    const plug = n.type === "libmon" || n.type === "libtrainer" ? el("span", { class: "pl-plug", "aria-hidden": "true" }) : null;
    const e = el("div", { class: `pl-node type-${n.type}${n.expanded ? " open" : ""}${hasSlots(n) ? " has-slots" : ""}`, "data-id": n.id, "data-kind": kind }, [el("div", { class: "pl-session-tags" }), plug, head, body, handle]);
    place(e, n); paintSession(e, n);
    if (n.type === "text") e.style.setProperty("--sticky", n.color || "#f6e27a");
    e.addEventListener("pointerdown", () => { e.style.zIndex = String(++zTop); });
    if (!readonly) { dragNode(e, head, n); resizeNode(e, handle, n); }
    return e;
  }

  function textArea(value, onInput, { ph = "", cls = "" } = {}) {
    const t = el("textarea", { class: `pl-node-text ${cls}`, placeholder: ph, "aria-label": ph || "Text", ...(readonly ? { readonly: "" } : {}) });
    t.value = value || "";
    t.addEventListener("input", () => onInput(t.value));
    return t;
  }

  function fillBody(body, n) {
    if (n.type === "note" || n.type === "text") {
      body.append(textArea(n.body, (v) => saveSoon((b) => { const x = nodeOf(b, n.id); if (x) x.body = v.slice(0, 20000); }), { ph: n.type === "text" ? "Quick thought..." : "Write here..." }));
    } else if (n.type === "libmon") {
      body.append(...[monCard(n.mon), readonly ? null : el("p", { class: "pl-plug-hint" }, "Drag me into a trainer's Team slot")].filter(Boolean));
    } else if (n.type === "libtrainer") {
      body.append(...[trainerCard(n), readonly ? null : el("p", { class: "pl-plug-hint" }, "Drag me into a trainer or gym leader's Trainer slot")].filter(Boolean));
    } else if (n.type === "gen") {
      const kind = kindOf(n);
      const slots = hasSlots(n);
      if (slots) body.append(slotsEl(n));
      // the slots show the team (and who the trainer is), so the generated text doesn't repeat or contradict them
      const shown = (n.lines || []).filter((l) => !(slots && n.mons?.length && (MON_LINE.test(l) || /^#.*team/i.test(l))) && !(n.identity && /^Leader:/.test(l)));
      const lines = shown.map((l) => (l.startsWith("#") ? el("h5", {}, l.replace(/^#\s?/, "")) : el("p", {}, l)));
      if (kind === "npc") body.append(el("div", { class: "pl-avatar", "aria-hidden": "true" }, ((n.title || "?").trim()[0] || "?").toUpperCase()));
      if (kind === "name") body.append(el("div", { class: "pl-pills" }, (n.lines || []).filter((l) => !l.startsWith("#")).map((l) => el("span", { class: "pl-pill" }, l))));
      else body.append(...lines);
    } else if (n.type === "list") {
      const items = el("div", { class: "pl-items" });
      const drawItems = () => {
        const cur = nodeOf(board, n.id) || n;
        items.replaceChildren(...cur.items.map((it) => {
          const cb = el("input", { type: "checkbox", "aria-label": "Done", ...(readonly ? { disabled: "" } : {}) });
          cb.checked = !!it.done;
          cb.addEventListener("change", () => { edit((b) => { const i = nodeOf(b, n.id)?.items.find((x) => x.id === it.id); if (i) i.done = cb.checked; }); drawItems(); });
          const tx = el("input", { class: `pl-item-text${it.done ? " done" : ""}`, type: "text", value: it.text, "aria-label": "Item", ...(readonly ? { readonly: "" } : {}) });
          tx.addEventListener("input", () => saveSoon((b) => { const i = nodeOf(b, n.id)?.items.find((x) => x.id === it.id); if (i) i.text = tx.value.slice(0, 300); }));
          const rm = readonly ? null : iconBtn("close", "Remove item", () => { edit((b) => { const x = nodeOf(b, n.id); if (x) x.items = x.items.filter((i) => i.id !== it.id); }); drawItems(); });
          return el("div", { class: "pl-item" }, [cb, tx, rm]);
        }));
      };
      drawItems();
      body.append(items);
      if (!readonly) {
        const add = el("input", { class: "pl-item-add", type: "text", placeholder: "Add an item and press Enter", "aria-label": "Add an item" });
        add.addEventListener("keydown", (ev) => {
          if (ev.key !== "Enter" || !add.value.trim()) return;
          const text = add.value.trim().slice(0, 300);
          edit((b) => { nodeOf(b, n.id)?.items.push({ id: uid(), text, done: false }); });
          add.value = ""; drawItems();
        });
        body.append(add);
      }
    } else if (n.type === "dungeon") fillDungeon(body, n);
  }

  // ---- dungeons ------------------------------------------------------------------------------
  async function fillDungeon(body, n) {
    const mod = await import("../systems/dnd5e/views/dungeonGen.js");
    const d = n.dungeon;
    const open = (id) => { const t = body.querySelector(`details[data-room="${id}"]`); if (t) { t.open = true; t.scrollIntoView({ block: "nearest" }); } };
    const map = mod.dungeonMap(d, (id) => { if (!n.expanded) { if (readonly) { n.expanded = true; n.w = Math.max(n.w, DUNGEON_OPEN[0]); n.h = Math.max(n.h, DUNGEON_OPEN[1]); drawNodes(); } else toggleDungeon(n); } open(id); });
    const facts = el("div", { class: "dnd-row tight" }, [chip(`${d.rooms.length} rooms`), chip(`${d.loops} loop${d.loops === 1 ? "" : "s"}`), d.secrets ? chip(`${d.secrets} secret`, "gold") : null]);
    if (!n.expanded) { body.replaceChildren(map, facts, el("p", { class: "dnd-small dnd-muted" }, "Expand to read every room and add your own notes.")); return; }
    const rooms = el("div", { class: "pl-rooms" }, d.rooms.map((r) => {
      const note = (n.roomNotes || {})[String(r.id)] || "";
      const ta = textArea(note, (v) => saveSoon((b) => { const x = nodeOf(b, n.id); if (x) { x.roomNotes = x.roomNotes || {}; x.roomNotes[String(r.id)] = v.slice(0, 4000); } }), { ph: `Your notes for room ${r.id}...`, cls: "room-note" });
      return el("details", { class: `pl-room${note ? " has-note" : ""}`, "data-room": r.id }, [
        el("summary", {}, [`${r.id}. ${r.type.charAt(0).toUpperCase()}${r.type.slice(1)}`, note ? chip("notes", "gold") : null]),
        mod.roomCard(d, r), ta,
      ]);
    }));
    const head = el("div", { class: "pl-dungeon-top" }, [facts, readonly ? null : btn("Copy as text", () => { navigator.clipboard?.writeText(mod.dungeonText(d)); toast("Copied.", "good"); }, "btn secondary tiny")]);
    body.replaceChildren(el("div", { class: "pl-dungeon-grid" }, [el("div", { class: "pl-dungeon-map" }, [head, map]), rooms]));
  }
  function toggleDungeon(n) {
    edit((b) => {
      const x = nodeOf(b, n.id); if (!x) return;
      x.expanded = !x.expanded;
      if (x.expanded) { x.cw = x.w; x.ch = x.h; x.w = Math.max(x.w, DUNGEON_OPEN[0]); x.h = Math.max(x.h, DUNGEON_OPEN[1]); }
      else { x.w = x.cw || SIZE.dungeon[0]; x.h = x.ch || SIZE.dungeon[1]; }
      grow(b);
    });
    applyBounds(); drawNodes();
  }

  // ---- moving and resizing nodes -------------------------------------------------------------
  function dragNode(e, handleEl, n) {
    handleEl.addEventListener("pointerdown", (ev) => {
      if (ev.target.closest("input, button")) return;
      ev.preventDefault(); ev.stopPropagation();
      capture(handleEl, ev.pointerId);
      const sx = ev.clientX, sy = ev.clientY, ox = n.x, oy = n.y, z = view().z;
      e.classList.add("dragging");
      const plug = n.type === "libmon" || n.type === "libtrainer";
      let hot = null;
      if (plug) nodeLayer.classList.add(`carrying-${n.type}`);
      const move = (m) => {
        n.x = Math.round(ox + (m.clientX - sx) / z); n.y = Math.round(oy + (m.clientY - sy) / z); place(e, n); drawLinks();
        if (!plug) return;
        const s = slotAt(m.clientX, m.clientY, e, n.type);
        if (s !== hot) { hot?.classList.remove("hot"); hot = s; hot?.classList.add("hot"); }
      };
      const up = (m) => {
        handleEl.removeEventListener("pointermove", move); handleEl.removeEventListener("pointerup", up); handleEl.removeEventListener("pointercancel", up);
        e.classList.remove("dragging");
        nodeLayer.classList.remove("carrying-libmon", "carrying-libtrainer");
        hot?.classList.remove("hot");
        if (plug && hot && m?.type === "pointerup") { snapInto(hot, n, m.clientY); return; }
        const { x, y } = n;
        edit((b) => { const t = nodeOf(b, n.id); if (t) { t.x = x; t.y = y; syncSessions(b, t); } grow(b); });
        applyBounds(); drawSessions();
        if (x !== ox || y !== oy) shake(e);   // put down somewhere new
      };
      handleEl.addEventListener("pointermove", move); handleEl.addEventListener("pointerup", up); handleEl.addEventListener("pointercancel", up);
    });
  }
  function resizeNode(e, handleEl, n) {
    handleEl.addEventListener("pointerdown", (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      capture(handleEl, ev.pointerId);
      const sx = ev.clientX, sy = ev.clientY, ow = n.w, oh = n.h, z = view().z;
      const move = (m) => { n.w = Math.max(170, Math.round(ow + (m.clientX - sx) / z)); n.h = Math.max(110, Math.round(oh + (m.clientY - sy) / z)); place(e, n); drawLinks(); };
      const up = () => {
        handleEl.removeEventListener("pointermove", move); handleEl.removeEventListener("pointerup", up); handleEl.removeEventListener("pointercancel", up);
        const { w, h } = n;
        edit((b) => { const t = nodeOf(b, n.id); if (t) { t.w = w; t.h = h; syncSessions(b, t); } grow(b); });
        applyBounds(); drawSessions();
      };
      handleEl.addEventListener("pointermove", move); handleEl.addEventListener("pointerup", up); handleEl.addEventListener("pointercancel", up);
    });
  }

  // ---- creating nodes ------------------------------------------------------------------------
  const defaults = (gen) => Object.fromEntries((specs[gen] || []).map((f) => [f.key, f.value ?? (f.type === "select" ? f.options[0][0] : "")]));

  async function build(spec) {
    const base = { id: uid(), type: spec.type, title: "", w: 0, h: 0 };
    if (spec.type === "note") return { ...base, title: "Note", body: "" };
    if (spec.type === "text") return { ...base, title: "Sticky", body: "", color: ["#f6e27a", "#9fd8ff", "#b5eab0", "#ffb8c8", "#d9c2ff"][Math.floor(Math.random() * 5)] };
    if (spec.type === "list") return { ...base, title: "Checklist", items: [] };
    if (spec.type === "clone") {
      const p = getPlan();
      if (spec.from === "note") { const s = p.notes.find((x) => x.id === spec.id); return s && { ...base, type: "note", title: s.title, body: s.body }; }
      const s = p.lists.find((x) => x.id === spec.id);
      return s && { ...base, type: "list", title: s.title, items: s.items.map((i) => ({ id: uid(), text: i.text, done: !!i.done })) };
    }
    if (spec.type === "gen") {
      const g = gens.find((x) => x.id === spec.gen); if (!g) return null;
      const res = await g.run({ ...defaults(g.id), edition: getSettings().edition }, Math.random);
      return { ...base, title: res.title, genLabel: g.label, gen: g.id, kind: system !== "dnd5e" && g.id === "wild" ? "wildmon" : g.id, lines: res.lines, ...(res.mons ? { mons: res.mons } : {}) };
    }
    if (spec.type === "libmon") {
      const mon = cleanMon(spec.mon || (spec.wildId ? await getWildMon(spec.wildId) : null));
      if (!mon) throw new Error("that Pokémon isn't in the library any more");
      return { ...base, title: mon.nickname || mon.name, mon, source: spec.source || { kind: "wild", id: spec.wildId || "" } };
    }
    if (spec.type === "libtrainer") {
      const npc = await getNpc(spec.npcId);
      if (!npc?.name) throw new Error("that trainer isn't in the library any more");
      return { ...base, title: npc.name, npcId: spec.npcId, sprite: npc.sprite || "", mons: (npc.team?.party || []).map(cleanMon).filter(Boolean).slice(0, TEAM_MAX) };
    }
    if (spec.type === "dungeon") {
      const { genDungeon } = await import("../systems/dnd5e/engine/generators.js");
      const d = genDungeon(Math.random, { rooms: clamp(Number(spec.rooms) || 9, 3, 24), loops: 0.25 });
      return { ...base, title: `Dungeon (${d.rooms.length} rooms)`, dungeon: d, roomNotes: {} };
    }
    return null;
  }

  // Clicks drop a node in the middle of the view; walk outwards from there until it isn't on top of another node.
  function freeSpot(node) {
    const hit = (x, y) => board.nodes.some((o) => x < o.x + o.w + 20 && x + node.w + 20 > o.x && y < o.y + o.h + 20 && y + node.h + 20 > o.y);
    const x0 = node.x, y0 = node.y;
    for (let ring = 0; ring < 14; ring++) {
      for (let k = 0; k < Math.max(1, ring * 6); k++) {
        const a = (k / Math.max(1, ring * 6)) * Math.PI * 2;
        const x = Math.round(x0 + Math.cos(a) * ring * 150), y = Math.round(y0 + Math.sin(a) * ring * 120);
        if (!hit(x, y)) { node.x = x; node.y = y; return; }
      }
    }
  }

  async function addNode(spec, at) {
    if (readonly) return;
    if (board.nodes.length >= MAX_NODES) { toast(`A board holds up to ${MAX_NODES} nodes.`, "bad"); return; }
    let node;
    try { node = await build(spec); } catch (err) { toast(`Couldn't make that: ${err.message || err}`, "bad"); return; }
    if (!node) return;
    const [w, h] = SIZE[node.type] || SIZE.note;
    node.w = w; node.h = hasSlots(node) ? 420 : h;   // room for the Trainer and Team slots
    const r = vp.getBoundingClientRect();
    const c = at || toWorld(r.left + r.width / 2 + 40, r.top + r.height / 2);
    node.x = Math.round(at ? c[0] - 40 : c[0] - w / 2); node.y = Math.round(at ? c[1] - 14 : c[1] - h / 2);
    if (!at) freeSpot(node);
    edit((b) => { b.nodes.push(node); syncSessions(b, node); grow(b); });
    applyBounds(); drawNodes();
    nodeEls.get(node.id)?.style.setProperty("z-index", String(++zTop));
    closeFly();
    fitNode(node.id, 0, () => shake(nodeEls.get(node.id)));   // sized to its text, then it lands with a little shake
  }

  // a quick wobble when a node lands (added, or put down after a move); none for reduced motion
  function shake(e) {
    if (!e || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    e.classList.remove("pl-shake"); void e.offsetWidth; e.classList.add("pl-shake");
    setTimeout(() => e.classList.remove("pl-shake"), 480);
  }

  // A new node grows until all its text shows: wider first for a lot of text, then as tall as it needs.
  function fitNode(id, pass = 0, onDone = null) {
    requestAnimationFrame(() => {
      const e = nodeEls.get(id);
      if (!e) return;
      const body = e.querySelector(".pl-node-body");
      const over = Math.max(body ? body.scrollHeight - body.clientHeight : 0, e.scrollHeight - e.clientHeight);
      if (over <= 2) { onDone?.(); return; }
      const n = board.nodes.find((x) => x.id === id);
      if (!n) return;
      const widen = pass === 0 && over > 260 && n.w < 460;
      edit((b) => { const x = b.nodes.find((y) => y.id === id); if (!x) return; if (widen) x.w = 460; else x.h = Math.min(1600, x.h + over + 10); });
      drawNodes();
      if (widen) fitNode(id, 1, onDone);
      else requestAnimationFrame(() => onDone?.());
    });
  }

  async function reroll(n) {
    const g = gens.find((x) => x.id === n.gen); if (!g) return;
    try {
      const res = await g.run({ ...defaults(g.id), edition: getSettings().edition }, Math.random);
      edit((b) => { const x = nodeOf(b, n.id); if (x) { x.title = res.title; x.lines = res.lines; if (res.mons) x.mons = res.mons; delete x.identity; } });
      drawNodes();
    } catch (err) { toast(`Couldn't roll that: ${err.message || err}`, "bad"); }
  }

  // ---- rail and flyouts ----------------------------------------------------------------------
  function palItem(label, spec, hintText, ico) {
    const b = el("button", { type: "button", class: "pl-pal", draggable: "true", title: hintText || "Drag onto the board, or click to add" }, [ico ? icon(ico, 18) : null, el("span", {}, label)]);
    b.addEventListener("dragstart", (ev) => { ev.dataTransfer.setData("text/plain", JSON.stringify({ pl: 1, ...spec() })); ev.dataTransfer.effectAllowed = "copy"; });
    b.addEventListener("click", () => addNode(spec()));
    return b;
  }
  function railBtn(id, label, ico, { fly = false, spec = null } = {}) {
    const b = el("button", { type: "button", class: `pl-rail-btn${flyout === id ? " active" : ""}`, title: label, "aria-label": label, ...(spec ? { draggable: "true" } : {}), ...(fly ? { "aria-expanded": String(flyout === id) } : {}) }, [icon(ico, 22), el("span", {}, label)]);
    if (spec) {
      b.addEventListener("dragstart", (ev) => { ev.dataTransfer.setData("text/plain", JSON.stringify({ pl: 1, ...spec() })); ev.dataTransfer.effectAllowed = "copy"; });
      b.addEventListener("click", () => { closeFly(); addNode(spec()); });
    } else b.addEventListener("click", () => openFly(flyout === id ? null : id));
    return b;
  }
  function drawRail() {
    const p = getPlan();
    rail.replaceChildren(
      railBtn("note", "Note", "note", { spec: () => ({ type: "note" }) }),
      railBtn("list", "Checklist", "list", { spec: () => ({ type: "list" }) }),
      railBtn("text", "Sticky", "sticky", { spec: () => ({ type: "text" }) }),
      railBtn("dungeon", "Dungeon", "dungeon", { fly: true }),
      railBtn("gens", "Generate", "dice", { fly: true }),
      ...(pokemon ? [railBtn("libs", "Libraries", "paw", { fly: true }), dexRailBtn()] : []),
      ...(p.notes.length || p.lists.length ? [railBtn("saved", "Saved", "saved", { fly: true })] : []),
    );
  }
  function openFly(id) {
    flyout = id;
    drawRail();
    if (!id) { flyEl.hidden = true; return; }
    flyEl.hidden = false; bgPanel.hidden = true;
    if (id === "dungeon") {
      const rooms = numInput(9, () => {}, { min: 3, max: 24, ariaLabel: "Rooms in a new dungeon" });
      flyEl.replaceChildren(el("h5", {}, "Dungeon"), field("Rooms", rooms), palItem("New dungeon", () => ({ type: "dungeon", rooms: rooms.value }), "Drag a freshly generated dungeon onto the board", "dungeon"),
        el("p", { class: "dnd-tiny dnd-muted" }, "On the board, expand a dungeon to read every room and add your own notes to each."));
    } else if (id === "gens") {
      flyEl.replaceChildren(el("h5", {}, "Generators"), ...gens.map((g) => palItem(g.label, () => ({ type: "gen", gen: g.id }), `Drag a ${g.label.toLowerCase()} onto the board`, KINDS[system !== "dnd5e" && g.id === "wild" ? "wildmon" : g.id]?.icon)));
    } else if (id === "libs") {
      flyEl.replaceChildren(el("h5", {}, "Libraries"), el("p", { class: "dnd-tiny dnd-muted" }, "Loading the DM's trainers and wild Pokémon…"));
      Promise.all([getNpcs(), getWildList()]).then(([npcs, wild]) => {
        if (flyout !== "libs") return;
        flyEl.replaceChildren(
          el("h5", {}, "Libraries"),
          el("p", { class: "dnd-tiny dnd-muted" }, "Drag onto the board, or straight into a trainer, gym leader or wild encounter's slots."),
          el("h6", { class: "pl-fly-sub" }, "NPC trainers"),
          ...(npcs.length ? npcs.map((x) => palItem(x.name || "NPC", () => ({ type: "libtrainer", npcId: x.id }), `${x.partyCount} Pokémon`, "person")) : [el("p", { class: "dnd-tiny dnd-muted" }, "None yet: the DM adds them in Control Centre → NPC Library.")]),
          el("h6", { class: "pl-fly-sub" }, "Wild Pokémon"),
          ...(wild.length ? wild.map((x) => palItem(`${x.name || "Pokémon"}${x.level ? ` · Lv ${x.level}` : ""}`, () => ({ type: "libmon", wildId: x.id, source: { kind: "wild", id: x.id } }), "", "paw")) : [el("p", { class: "dnd-tiny dnd-muted" }, "None yet: the DM adds them in Control Centre → Wild Library.")]),
        );
      });
    } else if (id === "saved") {
      const p = getPlan();
      flyEl.replaceChildren(el("h5", {}, "Saved notes and checklists"), el("p", { class: "dnd-tiny dnd-muted" }, "Adds a copy to the board."),
        ...p.notes.slice(0, 40).map((x) => palItem(x.title || "Untitled note", () => ({ type: "clone", from: "note", id: x.id }), "", "note")),
        ...p.lists.slice(0, 40).map((x) => palItem(x.title || "Checklist", () => ({ type: "clone", from: "list", id: x.id }), "", "list")));
    }
  }
  const closeFly = () => { if (flyout) openFly(null); };

  vp.addEventListener("dragover", (ev) => { if (!readonly) { ev.preventDefault(); ev.dataTransfer.dropEffect = "copy"; vp.classList.add("drop"); } });
  vp.addEventListener("dragleave", () => vp.classList.remove("drop"));
  vp.addEventListener("drop", (ev) => {
    vp.classList.remove("drop");
    if (readonly) return;
    ev.preventDefault();
    const dexCard = ev.dataTransfer.getData(CARD_MIME);
    if (dexCard) { dropFromDex(dexCard, { x: ev.clientX, y: ev.clientY }, (mon) => addNode({ type: "libmon", mon, source: { kind: "wild", id: "" } }, toWorld(ev.clientX, ev.clientY))); return; }
    let spec; try { spec = JSON.parse(ev.dataTransfer.getData("text/plain")); } catch { return; }
    if (!spec || spec.pl !== 1) return;
    const from = spec.from;
    addNode(spec, toWorld(ev.clientX, ev.clientY)).then(() => { if (from) takeFromTeam(from.nodeId, from.index); });
  });

  // ---- the Dex (Pokémon campaigns): the same pull-out as the hub's; a Pokémon dragged out of it (or placed with +) is
  // generated at the level you give, with the moves it would know by then, as a card or straight into a Team slot.
  let dexEl = null, dexKind = null;
  function dexRailBtn() {
    const fresh = railBtn("dex", "Dex", "scroll").cloneNode(true);   // railBtn's look, without its flyout click
    fresh.classList.toggle("active", !!dexEl);
    fresh.addEventListener("click", () => toggleDex(dexEl ? null : "pokemon"));
    return fresh;
  }
  async function toggleDex(kind) {
    dexEl?.remove(); dexEl = null; dexKind = kind;
    if (kind) {
      const state = await pokemonState();
      dexEl = dexPanel(state, kind, {
        onSwitch: (k) => toggleDex(k),
        onClose: () => toggleDex(null),
        openFull: () => { location.hash = kind === "pokemon" ? "pokedex" : "moves"; },
        onPlace: (card) => { const r = vp.getBoundingClientRect(); dropFromDex(JSON.stringify(card), { x: r.left + r.width / 2, y: r.top + r.height / 2 }, (mon) => addNode({ type: "libmon", mon, source: { kind: "wild", id: "" } })); },
      });
      dexEl.classList.add("pl-dex");
      shell.append(dexEl);
      void dexEl.offsetWidth; dexEl.classList.add("open");
      dexEl.focusSearch();
    }
    drawRail();
  }
  async function dropFromDex(raw, screen, place) {
    let card; try { card = JSON.parse(raw); } catch { return; }
    if (card.type !== "mon") { toast("Only Pokémon can be placed from the Dex here.", "bad"); return; }
    const level = await askLevel({ x: screen.x, y: screen.y, name: card.name, required: true, initial: card.level || "" });
    if (!level) return;
    const mon = generateMon(await pokemonState(), card.name, level);
    if (!mon) { toast(`Couldn't find ${card.name} in the Pokédex.`, "bad"); return; }
    place(mon);
  }

  // ---- slots: trainer identity and team (Pokémon trainer, gym leader and wild encounter nodes) ----------------------
  const monSprite = (m) => (m?.dex ? el("img", { class: "pl-mon-sprite", src: spriteUrl(m.dex), alt: "", loading: "lazy" }) : el("span", { class: "pl-mon-ball", "aria-hidden": "true" }));
  function monCard(m) {
    return el("div", { class: "pl-mon-card" }, [
      monSprite(m),
      el("div", { class: "pl-mon-info" }, [
        el("strong", {}, m.nickname ? `${m.nickname} (${m.name})` : m.name), el("span", { class: "pl-mon-lv" }, `Lv ${m.level}`),
        m.ability ? el("span", { class: "dnd-tiny dnd-muted" }, m.ability) : null,
        m.moves?.length ? el("div", { class: "pl-pills" }, m.moves.map((x) => el("span", { class: "pl-pill" }, x))) : null,
      ].filter(Boolean)),
    ]);
  }
  function trainerCard(n) {
    return el("div", { class: "pl-trainer-card" }, [
      el("div", { class: "pl-trainer-top" }, [n.sprite ? el("img", { class: "pl-trainer-sprite", src: trainerSpriteUrl(n.sprite), alt: "" }) : el("span", { class: "pl-avatar" }, (n.title || "?")[0].toUpperCase()), el("strong", {}, n.title)]),
      el("div", { class: "pl-mini-team" }, (n.mons || []).map((m) => el("span", { class: "pl-mini-mon", title: `${m.name} Lv ${m.level}` }, [monSprite(m), el("span", {}, String(m.level))]))),
    ]);
  }

  function slotsEl(n) {
    const wrap = el("div", { class: "pl-slots" });
    if (kindOf(n) !== "wildmon") wrap.append(trainerSlot(n));
    wrap.append(teamSlot(n));
    return wrap;
  }
  // a portrait for a trainer or gym leader: shown in its Trainer slot here and on its encounter button on the hub
  function pickPortrait(n) {
    openTrainerPortraitPicker({ current: n.identity?.sprite || "", onSelect: (file) => {
      edit((b) => {
        const x = nodeOf(b, n.id); if (!x) return;
        x.identity = { name: x.identity?.name || x.title || "Trainer", npcId: x.identity?.npcId || "", sprite: file || "" };
      });
      drawNodes();
    } });
  }
  function trainerSlot(n) {
    const who = n.identity;
    const slot = el("div", { class: `pl-slot pl-slot-trainer${who ? " filled" : ""}`, "data-slot": "trainer", "data-node": n.id }, who
      ? [who.sprite ? el("img", { class: "pl-trainer-sprite small", src: trainerSpriteUrl(who.sprite), alt: "" }) : el("span", { class: "pl-avatar small" }, who.name[0].toUpperCase()),
        el("span", { class: "pl-slot-label" }, [el("strong", {}, who.name), el("span", { class: "dnd-tiny dnd-muted" }, who.npcId ? "From the NPC Library" : "Trainer")]),
        readonly ? null : iconBtn("person", "Choose a portrait", () => pickPortrait(n)),
        readonly ? null : iconBtn("close", "Clear the trainer", () => { edit((b) => { const x = nodeOf(b, n.id); if (x) delete x.identity; }); drawNodes(); })].filter(Boolean)
      : [el("span", { class: "pl-socket", "aria-hidden": "true" }), el("span", { class: "pl-slot-empty" }, readonly ? "No trainer" : "Trainer: drop one from the Libraries here, or"),
        readonly ? null : btn("Choose a portrait", () => pickPortrait(n), "btn secondary tiny")].filter(Boolean));
    if (!readonly) acceptDrops(slot, n, () => 0);
    return slot;
  }
  function teamSlot(n) {
    const mons = n.mons || [];
    const rows = mons.map((m, i) => {
      const row = el("div", { class: "pl-team-row", draggable: readonly ? "false" : "true", "data-index": String(i) }, [
        readonly ? null : el("span", { class: "pl-grip", "aria-hidden": "true" }, "⋮⋮"),
        monSprite(m), el("span", { class: "pl-team-name" }, m.nickname || m.name), el("span", { class: "pl-mon-lv" }, `Lv ${m.level}`),
        readonly ? null : iconBtn("close", `Remove ${m.name}`, () => { takeFromTeam(n.id, i); }),
      ].filter(Boolean));
      if (!readonly) {
        row.addEventListener("dragstart", (ev) => {
          ev.stopPropagation();
          ev.dataTransfer.setData("text/plain", JSON.stringify({ pl: 1, type: "libmon", mon: m, source: { kind: "wild", id: "" }, from: { nodeId: n.id, index: i } }));
          ev.dataTransfer.effectAllowed = "move";
          requestAnimationFrame(() => row.classList.add("lifted"));
        });
        row.addEventListener("dragend", () => row.classList.remove("lifted"));
        row.addEventListener("pointerdown", (ev) => ev.stopPropagation());   // dragging a row isn't panning the board
      }
      return row;
    });
    const room = TEAM_MAX - mons.length;
    const slot = el("div", { class: "pl-slot pl-slot-team", "data-slot": "team", "data-node": n.id }, [
      el("div", { class: "pl-slot-head" }, [el("span", { class: "pl-socket", "aria-hidden": "true" }), el("strong", {}, "Team"), el("span", { class: "dnd-tiny dnd-muted" }, `${mons.length}/${TEAM_MAX}`)]),
      ...rows,
      room > 0 && !readonly ? el("div", { class: "pl-team-drop" }, mons.length ? "Drop more Pokémon here" : "Drop Pokémon from the Libraries here") : null,
    ].filter(Boolean));
    if (!readonly) acceptDrops(slot, n, (clientY) => insertIndex(slot, clientY));
    return slot;
  }
  // Where a Pokémon dropped at clientY lands in a team: before the first row whose middle is below the pointer.
  function insertIndex(slot, clientY) {
    const rows = [...slot.querySelectorAll(".pl-team-row")];
    const i = rows.findIndex((r) => { const b = r.getBoundingClientRect(); return clientY < b.top + b.height / 2; });
    return i < 0 ? rows.length : i;
  }
  // HTML5 drops onto a slot: library entries from the flyout, and team rows from this or another node.
  function acceptDrops(slot, n, indexAt) {
    slot.addEventListener("dragover", (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      ev.dataTransfer.dropEffect = "move";
      slot.classList.add("hot");
      if (slot.dataset.slot === "team") showInsert(slot, indexAt(ev.clientY));
    });
    slot.addEventListener("dragleave", (ev) => { if (!slot.contains(ev.relatedTarget)) { slot.classList.remove("hot"); showInsert(slot, -1); } });
    slot.addEventListener("drop", async (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      slot.classList.remove("hot"); showInsert(slot, -1); vp.classList.remove("drop");
      const dexCard = ev.dataTransfer.getData(CARD_MIME);
      if (dexCard) {
        if (slot.dataset.slot !== "team") { toast("Pokémon go in the Team slot.", "bad"); return; }
        const at = indexAt(ev.clientY);
        dropFromDex(dexCard, { x: ev.clientX, y: ev.clientY }, (mon) => addToTeam(n.id, mon, at));
        return;
      }
      let spec; try { spec = JSON.parse(ev.dataTransfer.getData("text/plain")); } catch { return; }
      if (!spec || spec.pl !== 1) return;
      const at = indexAt(ev.clientY);
      try {
        if (spec.type === "libtrainer") { const t = await build(spec); if (t) giveTrainer(n.id, t); return; }
        if (spec.type !== "libmon") { toast("Only trainers and Pokémon from the Libraries fit here.", "bad"); return; }
        if (slot.dataset.slot !== "team") { toast("Pokémon go in the Team slot.", "bad"); return; }
        if (spec.from?.nodeId === n.id) { moveInTeam(n.id, spec.from.index, at); return; }
        const mon = spec.mon ? cleanMon(spec.mon) : (await build(spec))?.mon;
        if (mon && addToTeam(n.id, mon, at) && spec.from) takeFromTeam(spec.from.nodeId, spec.from.index);
      } catch (err) { toast(`Couldn't add that: ${err.message || err}`, "bad"); }
    });
  }
  function showInsert(slot, i) {
    slot.querySelectorAll(".pl-insert").forEach((x) => x.remove());
    if (i < 0) return;
    const rows = slot.querySelectorAll(".pl-team-row");
    const mark = el("div", { class: "pl-insert", "aria-hidden": "true" });
    if (rows[i]) rows[i].before(mark); else (rows[rows.length - 1] || slot.querySelector(".pl-slot-head")).after(mark);
  }
  // The slot under a card being dragged by its title bar (pointer drag), if it accepts that kind of card.
  function slotAt(cx, cy, self, type) {
    for (const s of nodeLayer.querySelectorAll(".pl-slot")) {
      if (self.contains(s)) continue;
      const r = s.getBoundingClientRect();
      if (cx < r.left || cx > r.right || cy < r.top || cy > r.bottom) continue;
      if (type === "libtrainer") return s.closest(".pl-node")?.querySelector('.pl-slot[data-slot="trainer"]') ? s : null;
      if (type === "libmon" && s.dataset.slot === "team") return s;
    }
    return null;
  }
  function snapInto(slot, card, clientY) {
    const targetId = slot.dataset.node;
    let ok = false;
    if (card.type === "libtrainer") ok = giveTrainer(targetId, card);
    else ok = addToTeam(targetId, card.mon, insertIndex(slot, clientY));
    if (!ok) { drawNodes(); return; }
    // the card snaps in: it leaves the board (drag a team row out to get a card back)
    edit((b) => { b.nodes = b.nodes.filter((x) => x.id !== card.id); removeLinksOf(b, card.id); });
    drawNodes();
    nodeEls.get(targetId)?.classList.add("snapped");
    setTimeout(() => nodeEls.get(targetId)?.classList.remove("snapped"), 600);
  }
  function giveTrainer(targetId, t) {
    const name = t.title || t.name || "Trainer";
    edit((b) => {
      const x = nodeOf(b, targetId); if (!x) return;
      x.identity = { name, npcId: t.npcId || "", sprite: t.sprite || "" };
      if (t.mons?.length) x.mons = t.mons.map(cleanMon).filter(Boolean).slice(0, TEAM_MAX);
      x.title = kindOf(x) === "gym" && !/gym leader/i.test(name) ? `Gym Leader ${name}` : name;
    });
    drawNodes();
    toast(`${name} and their team are in.`, "good");
    return true;
  }
  function addToTeam(targetId, mon, at) {
    const target = nodeOf(board, targetId);
    if (!target) return false;
    if ((target.mons || []).length >= TEAM_MAX) { toast(`A team holds ${TEAM_MAX} Pokémon.`, "bad"); return false; }
    edit((b) => { const x = nodeOf(b, targetId); if (!x) return; x.mons = x.mons || []; x.mons.splice(clamp(at, 0, x.mons.length), 0, cleanMon(mon)); });
    drawNodes();
    return true;
  }
  function moveInTeam(nodeId, from, to) {
    edit((b) => {
      const x = nodeOf(b, nodeId); if (!x?.mons?.[from]) return;
      const [m] = x.mons.splice(from, 1);
      x.mons.splice(clamp(to > from ? to - 1 : to, 0, x.mons.length), 0, m);
    });
    drawNodes();
  }
  function takeFromTeam(nodeId, index) {
    edit((b) => { const x = nodeOf(b, nodeId); if (x?.mons?.[index]) x.mons.splice(index, 1); });
    drawNodes();
  }

  // ---- drawers (maps, scenarios, party plans...) ---------------------------------------------
  let drawerId = null;
  function openDrawer(x, arg = null) {
    if (!x || (drawerId === x.id && !arg)) { drawerId = null; drawer.hidden = true; drawer.replaceChildren(); drawTop(); return; }
    drawerId = x.id; closeFly(); bgPanel.hidden = true;
    drawer.classList.toggle("full", !!x.full);   // a whole page over the board (the Map editor)
    const body = el("div", { class: "pl-drawer-body" });
    drawer.replaceChildren(el("div", { class: "pl-drawer-head" }, [el("h3", {}, x.label), iconBtn("close", "Close", () => openDrawer(null))]), body);
    drawer.hidden = false;
    x.render(body, () => openDrawer(null), arg);
    drawTop();
  }

  // ---- sessions ------------------------------------------------------------------------------
  function drawSessions() {
    sessLayer.replaceChildren();
    for (const s of board.sessions) {
      const sh = s.shape;
      const shape = sh.kind === "box" ? svg("rect", { x: sh.x, y: sh.y, width: sh.w, height: sh.h, rx: 14 }) : svg("polygon", { points: sh.pts.map((q) => q.join(",")).join(" ") });
      shape.setAttribute("fill", s.color); shape.setAttribute("fill-opacity", "0.1"); shape.setAttribute("stroke", s.color); shape.setAttribute("stroke-width", "5"); shape.setAttribute("stroke-dasharray", "14 9");
      const lx = sh.kind === "box" ? sh.x + 14 : Math.min(...sh.pts.map((q) => q[0])) + 14, ly = sh.kind === "box" ? sh.y - 12 : Math.min(...sh.pts.map((q) => q[1])) - 12;
      const label = svg("text", { x: lx, y: ly, fill: s.color, class: "pl-session-label" });
      label.textContent = `Session ${s.n}`;
      const g = svg("g", { "data-session": s.id });
      g.append(shape, label);
      sessLayer.append(g);
    }
    for (const [id, e] of nodeEls) paintSession(e, nodeOf(board, id));
    legend.replaceChildren(...board.sessions.map((s) => {
      const count = board.nodes.filter((n) => (n.sessions || []).includes(s.id)).length;
      const row = el("div", { class: "pl-legend-row" }, [el("span", { class: "pl-swatch", style: `background:${s.color}` }), el("span", {}, `Session ${s.n}`), el("span", { class: "dnd-muted" }, `${count}`)]);
      row.append(iconBtn("eye", `View only session ${s.n}`, () => focusSession(focusId === s.id ? null : s.id)));
      if (!readonly) row.append(iconBtn("close", `Remove session ${s.n} (keeps the nodes)`, () => { if (focusId === s.id) focusId = null; edit((b) => removeSession(b, s.id)); drawSessions(); }));
      return row;
    }));
    legend.hidden = !board.sessions.length;
    applyFocus();
  }

  // View one session on its own: everything else fades out and the view fits that session's nodes.
  function applyFocus() {
    const s = focusId && sessionById(focusId);
    if (focusId && !s) focusId = null;
    for (const [id, e] of nodeEls) e.classList.toggle("dim", !!s && !(nodeOf(board, id)?.sessions || []).includes(s.id));
    sessLayer.querySelectorAll("[data-session]").forEach((g) => g.setAttribute("opacity", !s || g.dataset.session === s.id ? "1" : "0.1"));
    linkLayer.querySelectorAll(".pl-link").forEach((g) => g.classList.toggle("dim", !!s && !(g.dataset.a && g.dataset.b && nodeOf(board, g.dataset.a)?.sessions?.includes(s.id) && nodeOf(board, g.dataset.b)?.sessions?.includes(s.id))));
    legend.querySelectorAll(".pl-legend-row").forEach((r, i) => r.classList.toggle("focus", !!s && board.sessions[i]?.id === s.id));
    if (!s) { focusBar.hidden = true; return; }
    const n = board.nodes.filter((x) => (x.sessions || []).includes(s.id)).length;
    focusBar.hidden = false;
    focusBar.replaceChildren(el("span", { class: "pl-swatch", style: `background:${s.color}` }), el("strong", {}, `Viewing Session ${s.n}`), el("span", { class: "dnd-muted" }, `${n} node${n === 1 ? "" : "s"}`), btn("Show everything", () => focusSession(null), "btn secondary tiny"));
  }
  function focusSession(id) {
    focusId = id;
    applyFocus();
    if (id) fit(board.nodes.filter((x) => (x.sessions || []).includes(id)));
  }

  // ---- pointer on empty board: pan, pinch, or draw a session ----------------------------------
  const pts = new Map();
  let gesture = null;
  vp.addEventListener("pointerdown", (ev) => {
    if (ev.target.closest(".pl-node")) return;
    closeFly(); if (!bgPanel.hidden) bgPanel.hidden = true;
    capture(vp, ev.pointerId);
    pts.set(ev.pointerId, [ev.clientX, ev.clientY]);
    if (pts.size === 2) { gesture = { kind: "pinch", d: dist(), z: view().z }; clearDraw(); return; }
    if (readonly || tool === "move") gesture = { kind: "pan", sx: ev.clientX, sy: ev.clientY, ox: view().x, oy: view().y };
    else gesture = { kind: tool, pts: [toWorld(ev.clientX, ev.clientY)] };
    vp.classList.add("busy");
  });
  const dist = () => { const a = [...pts.values()]; return Math.hypot(a[0][0] - a[1][0], a[0][1] - a[1][1]) || 1; };
  vp.addEventListener("pointermove", (ev) => {
    if (!pts.has(ev.pointerId)) return;
    pts.set(ev.pointerId, [ev.clientX, ev.clientY]);
    if (!gesture) return;
    if (gesture.kind === "pinch" && pts.size === 2) {
      const a = [...pts.values()];
      zoomAt((a[0][0] + a[1][0]) / 2, (a[0][1] + a[1][1]) / 2, (dist() / gesture.d) * gesture.z / view().z);
    } else if (gesture.kind === "pan") setView(gesture.ox + ev.clientX - gesture.sx, gesture.oy + ev.clientY - gesture.sy, view().z);
    else if (gesture.kind === "box" || gesture.kind === "free") { gesture.pts.push(toWorld(ev.clientX, ev.clientY)); drawPreview(gesture); }
  });
  vp.addEventListener("pointerup", (ev) => {
    pts.delete(ev.pointerId);
    if (!gesture) return;
    const g = gesture;
    if (g.kind === "pinch") { if (pts.size < 2) gesture = null; return; }
    gesture = null; vp.classList.remove("busy");
    if (g.kind === "box" || g.kind === "free") finishSession(g);
  });
  vp.addEventListener("pointercancel", (ev) => { pts.delete(ev.pointerId); gesture = null; clearDraw(); vp.classList.remove("busy"); });

  function drawPreview(g) {
    clearDraw();
    const col = "#e5484d";
    if (g.kind === "box") {
      const s = boxFrom(g.pts[0], g.pts[g.pts.length - 1]);
      draw.append(svg("rect", { x: s.x, y: s.y, width: s.w, height: s.h, rx: 14, fill: col, "fill-opacity": "0.1", stroke: col, "stroke-width": "5", "stroke-dasharray": "14 9" }));
    } else draw.append(svg("polyline", { points: g.pts.map((q) => q.join(",")).join(" "), fill: "none", stroke: col, "stroke-width": "6", "stroke-linecap": "round", "stroke-linejoin": "round" }));
  }
  const clearDraw = () => draw.replaceChildren();

  function finishSession(g) {
    clearDraw();
    const shape = g.kind === "box" ? boxFrom(g.pts[0], g.pts[g.pts.length - 1]) : { kind: "free", pts: simplify(g.pts) };
    if (shape.kind === "box" ? shape.w < 20 || shape.h < 20 : shape.pts.length < 5) { toast(g.kind === "box" ? "Drag a box around the nodes first." : "Draw a loop around the nodes first.", ""); return; }
    if (!nodesInShape(board.nodes, shape).length) { toast("There are no nodes inside that shape.", ""); return; }
    let made = null;
    edit((b) => { made = addSession(b, shape); });
    setTool("move");
    drawSessions();
    if (made) toast(`Session ${made.n} created.`, "good");
  }

  vp.addEventListener("wheel", (ev) => {
    if (!ev.ctrlKey && ev.target.closest(".pl-node-body")) return;   // let a node's text scroll
    ev.preventDefault();
    zoomAt(ev.clientX, ev.clientY, ev.deltaY < 0 ? 1.12 : 1 / 1.12);
  }, { passive: false });
  shell.addEventListener("keydown", (ev) => { if (ev.key === "Escape") { if (focusId) focusSession(null); closeFly(); if (!bgPanel.hidden) bgPanel.hidden = true; if (tool !== "move") setTool("move"); } });

  // ---- connections ---------------------------------------------------------------------------
  let linkFrom = null;
  function cancelLink() { linkFrom = null; for (const e of nodeEls.values()) e.classList.remove("link-from"); }
  const roomName = (n, id) => { const r = n?.dungeon?.rooms?.find((x) => x.id === id); return r ? `Room ${r.id}` : `Room ${id}`; };
  const linkText = (l, a, b) => [l.fromRoom != null ? `${roomName(a, l.fromRoom)} ` : "", relationText(l.rel, l.label), l.toRoom != null ? ` ${roomName(b, l.toRoom)}` : ""].join("").trim();

  function drawLinks() {
    linkLayer.replaceChildren();
    for (const l of board.links) {
      const a = nodeOf(board, l.from), b = nodeOf(board, l.to);
      if (!a || !b) continue;
      const [p, q] = edgePoints(a, b);
      const path = `M${p[0]} ${p[1]} L${q[0]} ${q[1]}`;
      const ang = Math.atan2(q[1] - p[1], q[0] - p[0]), ah = 18;
      const head = `M${q[0]} ${q[1]} L${q[0] - ah * Math.cos(ang - 0.45)} ${q[1] - ah * Math.sin(ang - 0.45)} L${q[0] - ah * Math.cos(ang + 0.45)} ${q[1] - ah * Math.sin(ang + 0.45)} Z`;
      const g = svg("g", { class: "pl-link", "data-a": l.from, "data-b": l.to });
      g.append(svg("path", { d: path, class: "pl-link-halo" }), svg("path", { d: path, class: "pl-link-line" }), svg("path", { d: head, class: "pl-link-head" }));
      const text = linkText(l, a, b);
      if (text) {
        const mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2, w = Math.max(60, text.length * 9.5 + 26);
        const pill = svg("g", { class: "pl-link-pill", tabindex: "0", role: "button", "aria-label": `Connection: ${text}` });
        const t = svg("text", { x: mx, y: my + 6, "text-anchor": "middle" });
        t.textContent = text;
        pill.append(svg("rect", { x: mx - w / 2, y: my - 16, width: w, height: 32, rx: 16 }), t);
        pill.addEventListener("pointerdown", (ev) => ev.stopPropagation());
        const open = () => { if (!readonly) linkDialog(l); };
        pill.addEventListener("click", open);
        pill.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); open(); } });
        g.append(pill);
      }
      linkLayer.append(g);
    }
    applyFocus();
  }

  nodeLayer.addEventListener("pointerdown", (ev) => {
    if (tool !== "link") return;
    const e = ev.target.closest(".pl-node");
    if (!e) return;
    ev.preventDefault(); ev.stopPropagation();
    const id = e.dataset.id, n = nodeOf(board, id);
    if (!linkFrom) { linkFrom = id; e.classList.add("link-from"); toast("Now click the node to connect it to.", ""); return; }
    if (linkFrom === id && n.type !== "dungeon") { cancelLink(); return; }
    const from = linkFrom; cancelLink();
    linkDialog({ from, to: id, rel: "", label: "", fromRoom: null, toRoom: null }, true);
  }, true);

  // One dialog both creates and edits a connection: who, how they relate (from a list, or your own words), and which room if an end is a dungeon.
  function linkDialog(l, isNew = false) {
    const a = nodeOf(board, l.from), b = nodeOf(board, l.to);
    if (!a || !b) return;
    const state = { rel: l.rel || suggestRelation(kindOf(a), kindOf(b)), label: l.label || "", fromRoom: l.fromRoom, toRoom: l.toRoom };
    let touched = !isNew;
    const nameOf = (n) => n.title || (KINDS[kindOf(n)] || KINDS.note).label;
    const roomSelect = (n, key) => {
      const opts = [["", "Whole node"], ...n.dungeon.rooms.map((r) => [String(r.id), `Room ${r.id}: ${r.type}`])];
      return field(`${nameOf(n)}: which room?`, selectEl(opts, state[key] == null ? "" : String(state[key]), (v) => {
        state[key] = v === "" ? null : Number(v);
        if (!touched) { const k = (key === "toRoom" ? state.toRoom : state.fromRoom) != null ? "room" : kindOf(key === "toRoom" ? b : a); state.rel = suggestRelation(key === "toRoom" ? kindOf(a) : k, key === "toRoom" ? k : kindOf(b)); relSel.value = state.rel; }
      }));
    };
    const relSel = selectEl(RELATIONS.map(([k, t]) => [k, t]), state.rel, (v) => { state.rel = v; touched = true; custom.hidden = v !== "custom"; });
    const customInput = textInput(state.label, (v) => { state.label = v.slice(0, 60); }, { placeholder: "e.g. owes money to", ariaLabel: "Your own relationship" });
    const custom = el("div", { class: "pl-link-custom" }, [field("In your words", customInput)]);
    custom.hidden = state.rel !== "custom";
    const body = el("div", { class: "dnd-stack" }, [
      el("p", { class: "pl-link-who" }, [el("strong", {}, nameOf(a)), "  →  ", el("strong", {}, nameOf(b))]),
      field("Relationship", relSel), custom,
      a.type === "dungeon" ? roomSelect(a, "fromRoom") : null,
      b.type === "dungeon" ? roomSelect(b, "toRoom") : null,
    ]);
    const save = () => {
      const label = state.rel === "custom" ? state.label.trim() : "";
      if (state.rel === "custom" && !label) { toast("Type the relationship, or pick one from the list.", ""); return false; }
      const data = { from: l.from, to: l.to, rel: state.rel, label, fromRoom: state.fromRoom, toRoom: state.toRoom };
      edit((bd) => { if (isNew) addLink(bd, data); else { const x = bd.links.find((k) => k.id === l.id); if (x) Object.assign(x, data); } });
      drawLinks();
      if (isNew) toast("Connected.", "good");
    };
    const actions = [{ label: "Cancel" }, { label: isNew ? "Connect" : "Save", cls: "btn", onClick: save }];
    if (!isNew) actions.unshift(
      { label: "Delete link", cls: "btn danger", onClick: () => { edit((bd) => { bd.links = bd.links.filter((k) => k.id !== l.id); }); drawLinks(); } },
      { label: "Reverse", onClick: () => { edit((bd) => { const x = bd.links.find((k) => k.id === l.id); if (x) { [x.from, x.to] = [x.to, x.from]; [x.fromRoom, x.toRoom] = [x.toRoom, x.fromRoom]; } }); drawLinks(); } },
    );
    modal({ title: isNew ? "Connect nodes" : "Edit connection", body, actions });
  }

  // ---- background ----------------------------------------------------------------------------
  function drawBgPanel() {
    bgPanel.replaceChildren(
      el("h5", {}, "Background"),
      el("div", { class: "pl-bg-choices" }, BACKGROUNDS.map(([id, label]) => {
        const on = board.bg.kind === "preset" && board.bg.id === id;
        const b = el("button", { type: "button", class: `pl-bg-sw pl-bg-${id}${on ? " active" : ""}`, title: label, "aria-label": label, "aria-pressed": String(on) }, el("span", {}, label));
        b.addEventListener("click", () => { edit((x) => { x.bg = { ...x.bg, kind: "preset", id }; }); applyBg(); drawBgPanel(); });
        return b;
      })),
      el("div", { class: "dnd-row" }, [
        btn("Upload your own", uploadBg, "btn secondary small"),
        bgUrl ? btn("Remove it", async () => { await deleteImage(`bg-${board.id}`).catch(() => {}); bgUrl = null; edit((x) => { x.bg = { ...x.bg, kind: "preset", id: "parchment" }; }); applyBg(); drawBgPanel(); }, "btn secondary small") : null,
      ]),
      bgUrl ? field("Picture", selectEl([["tile", "Repeat across the board"], ["fill", "Stretch to fill"]], board.bg.fit, (v) => { edit((x) => { x.bg = { ...x.bg, kind: "image", fit: v }; }); applyBg(); })) : null,
      el("p", { class: "dnd-tiny dnd-muted" }, "An uploaded picture stays on this device. It is not shared with your DM."),
    );
  }
  async function uploadBg() {
    const file = await new Promise((resolve) => {
      const input = el("input", { type: "file", accept: "image/png,image/jpeg,image/webp,image/gif", style: "display:none" });
      input.addEventListener("change", () => { resolve(input.files[0] || null); input.remove(); });
      input.addEventListener("cancel", () => { resolve(null); input.remove(); });
      document.body.appendChild(input); input.click();
    });
    if (!file) return;
    if (file.size > 12 * 1024 * 1024) { toast("That picture is over 12 MB. Try a smaller one.", "bad"); return; }
    try {
      const url = await readAsDataUrl(file);
      await imageSize(url);
      await putImage(`bg-${board.id}`, url);
      bgUrl = url;
      edit((x) => { x.bg = { ...x.bg, kind: "image", id: "upload" }; });
      applyBg(); drawBgPanel();
    } catch (err) { toast(err.message || "Couldn't use that picture.", "bad"); }
  }

  // ---- top bar -------------------------------------------------------------------------------
  const toolBtns = {};
  function setTool(t) {
    tool = t;
    for (const [k, b] of Object.entries(toolBtns)) { b.classList.toggle("active", k === t); b.setAttribute("aria-pressed", String(k === t)); }
    vp.dataset.tool = t;
    if (t !== "link") cancelLink();
    if (t === "link") toast("Click one node, then the node to connect it to.", "");
    else if (t !== "move") toast(t === "box" ? "Drag a box around the nodes that make a session." : "Draw a loop around the nodes that make a session.", "");
  }
  const tbtn = (ico, label, fn, extra = "") => { const b = el("button", { type: "button", class: `pl-tbtn icon${extra}`, title: label, "aria-label": label }, icon(ico, 18)); b.addEventListener("click", fn); return b; };
  const ibtn = (ico, label, fn) => { const b = el("button", { type: "button", class: "pl-tbtn icon", title: label, "aria-label": label }, icon(ico, 18)); b.addEventListener("click", fn); return b; };

  function drawTop() {
    const sel = selectEl(list.map((b) => [b.id, b.name]), board?.id || "", (id) => openBoard(id));
    sel.setAttribute("aria-label", "Board"); sel.classList.add("pl-board-select");
    const left = el("div", { class: "pl-group" }, [sel]);
    if (full) {
      // the app's top bar is hidden on the full-screen planner (like the hub), so its menu button lives here
      const home = document.documentElement.classList.contains("no-sidebar");   // no sidebar: this button goes back to the hub
      const menuBtn = el("button", { type: "button", class: "pl-round", "aria-label": home ? "Back to the hub" : "Menu", title: home ? "Back to the hub" : "Menu" });
      menuBtn.innerHTML = home
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11l9-7 9 7M5 10v10h5v-6h4v6h5V10"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';
      menuBtn.addEventListener("click", () => document.getElementById("navToggle")?.click());
      left.prepend(menuBtn);
    }
    if (!readonly) left.append(el("div", { class: "pl-seg" }, [
      ibtn("plus", "New board", () => { const nb = newBoard(`Board ${list.length + 1}`); mutatePlan((p) => { p.boards.push(nb); }); openBoard(nb.id); }),
      ibtn("edit", "Rename board", renameBoard),
      ibtn("trash", "Delete board", deleteBoard),
    ]));
    const right = el("div", { class: "pl-group" });
    if (!readonly) {
      const seg = el("div", { class: "pl-seg" });
      for (const [k, ico, label, tip] of [["move", "hand", "Move", "Pan around the board"], ["box", "box", "Box", "Session: drag a box round nodes to group them"], ["free", "lasso", "Freehand", "Session: draw any shape round nodes to group them"], ["link", "link", "Connect", "Connect two nodes with a labelled link"]]) {
        const b = tbtn(ico, label, () => setTool(k), tool === k ? " active" : "");
        b.title = tip; b.setAttribute("aria-label", tip); b.setAttribute("aria-pressed", String(tool === k)); toolBtns[k] = b;
        seg.append(b);
      }
      right.append(seg, tbtn("image", "Background", () => { closeFly(); bgPanel.hidden = !bgPanel.hidden; if (!bgPanel.hidden) drawBgPanel(); }, " solo"));
    }
    right.append(el("div", { class: "pl-seg" }, [ibtn("minus", "Zoom out", () => zoomMid(1 / 1.25)), ibtn("plus", "Zoom in", () => zoomMid(1.25)), ibtn("fit", "Fit everything", fit)]));
    if (extras.length) right.append(el("div", { class: "pl-seg" }, extras.map((x) => tbtn(x.icon, x.label, () => openDrawer(x), drawerId === x.id ? " active" : ""))));
    topbar.replaceChildren(left, right);
  }
  async function renameBoard() {
    const name = await promptDialog("Rename board", "Name", board.name);
    if (!name?.trim()) return;
    edit((b) => { b.name = name.trim().slice(0, 80); }); list = getPlan().boards; drawTop();
  }
  async function deleteBoard() {
    if (list.length <= 1 && !board.nodes.length) { toast("That's your only board.", ""); return; }
    if (!(await confirmDialog(`Delete "${board.name}" and everything on it?`, { ok: "Delete", danger: true }))) return;
    const id = board.id;
    await deleteImage(`bg-${id}`).catch(() => {});
    mutatePlan((p) => { p.boards = p.boards.filter((b) => b.id !== id); });
    list = getPlan().boards;
    openBoard(list[0]?.id);
  }

  // ---- opening a board -----------------------------------------------------------------------
  async function openBoard(id) {
    flushPending();
    if (!readonly) list = getPlan().boards;
    if (!list.length) {
      if (readonly) { panel.replaceChildren(el("div", { class: "card" }, el("p", { class: "view-sub" }, "No whiteboards yet."))); return; }
      const nb = newBoard("Board 1"); mutatePlan((p) => { p.boards.push(nb); }); list = getPlan().boards; id = nb.id;
    }
    board = list.find((b) => b.id === id) || list[0];
    try { localStorage.setItem("pokemon-dnd-planner-board", board.id); } catch { /* storage blocked */ }
    bgUrl = null;
    if (board.bg.kind === "image" && !readonly) { try { bgUrl = await getImage(`bg-${board.id}`); } catch { bgUrl = null; } }
    const fresh = board.view.x === 0 && board.view.y === 0;
    inited = !fresh;
    applyBounds(); applyBg(); applyView(); drawNodes(); drawTop(); if (!readonly) drawRail();
    if (fresh && vp.clientWidth) { inited = true; setView(vp.clientWidth / 2, vp.clientHeight / 2, 0.8); }
  }
  new ResizeObserver(() => { if (!board || !vp.clientWidth) return; if (!inited) { inited = true; setView(vp.clientWidth / 2, vp.clientHeight / 2, 0.8); } else if (!readonly) ensureCover(); else { const c = coverBounds(board.bounds, -view().x / view().z, -view().y / view().z, (vp.clientWidth - view().x) / view().z, (vp.clientHeight - view().y) / view().z); if (c.grew) { board.bounds = c.bounds; applyBounds(); } } }).observe(vp);

  let last = null; try { last = localStorage.getItem("pokemon-dnd-planner-board"); } catch { /* storage blocked */ }
  openBoard(last);
}
