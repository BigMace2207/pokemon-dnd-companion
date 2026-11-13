// Whiteboard geometry and data helpers. No DOM here, so Node can test them (tests/js/board.test.mjs).
//
// A board lives in "world" coordinates (any integer, positive or negative). `bounds` is the part of the world that is
// drawn as paper. It starts at BASE_W x BASE_H and grows by GROW whenever a node comes within EDGE of a side, so the
// board feels endless without ever being a huge element up front.

export const BASE_W = 3200, BASE_H = 2000;
export const EDGE = 260, GROW = 900;
export const MAX_NODES = 300;

export const defaultBounds = () => ({ x: -BASE_W / 2, y: -BASE_H / 2, w: BASE_W, h: BASE_H });

// Extend bounds on every side a node is close to (or past). Returns a new object and whether anything changed.
export function growBounds(bounds, nodes) {
  const b = { ...bounds };
  let grew = false;
  for (const n of nodes) {
    const right = n.x + (n.w || 0), bottom = n.y + (n.h || 0);
    let guard = 0;
    while (n.x < b.x + EDGE && guard++ < 200) { b.x -= GROW; b.w += GROW; grew = true; }
    while (right > b.x + b.w - EDGE && guard++ < 400) { b.w += GROW; grew = true; }
    while (n.y < b.y + EDGE && guard++ < 600) { b.y -= GROW; b.h += GROW; grew = true; }
    while (bottom > b.y + b.h - EDGE && guard++ < 800) { b.h += GROW; grew = true; }
  }
  return { bounds: b, grew };
}

export function pointInPolygon(px, py, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// A shape is { kind: "box", x, y, w, h } or { kind: "free", pts: [[x, y], ...] } (world coordinates).
// A node counts as inside when its centre is.
export function inShape(shape, px, py) {
  if (shape.kind === "box") return px >= shape.x && px <= shape.x + shape.w && py >= shape.y && py <= shape.y + shape.h;
  return shape.pts.length >= 3 && pointInPolygon(px, py, shape.pts);
}
export const nodesInShape = (nodes, shape) => nodes.filter((n) => inShape(shape, n.x + (n.w || 0) / 2, n.y + (n.h || 0) / 2));

// Thin out a freehand stroke: points closer than `gap` to the previous kept one are dropped, and the result is capped.
export function simplify(pts, gap = 8, cap = 240) {
  const out = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) >= gap) out.push([Math.round(p[0]), Math.round(p[1])]);
  }
  if (out.length <= cap) return out;
  const step = out.length / cap;
  return Array.from({ length: cap }, (_, i) => out[Math.floor(i * step)]);
}

export const boxFrom = (a, b) => ({ kind: "box", x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(a[0] - b[0]), h: Math.abs(a[1] - b[1]) });

// Distinct, readable on both light and dark paper.
export const SESSION_COLORS = ["#e5484d", "#2f8fe0", "#2fa866", "#e0a21a", "#9b59d6", "#e0662f", "#17a5a5", "#d6479a", "#7a8a2a", "#6d6dd9"];
export const sessionColor = (n) => SESSION_COLORS[(Math.max(1, n) - 1) % SESSION_COLORS.length];
export const nextSessionNumber = (sessions) => sessions.reduce((m, s) => Math.max(m, Number(s.n) || 0), 0) + 1;

// Add a session over `shape`; every node inside it joins it. A node can be in several sessions at once.
// Returns the session, or null when the shape holds nothing.
export function addSession(board, shape) {
  const inside = nodesInShape(board.nodes, shape);
  if (!inside.length) return null;
  const n = nextSessionNumber(board.sessions);
  const s = { id: `s${Date.now().toString(36)}${n}`, n, color: sessionColor(n), shape };
  board.sessions.push(s);
  for (const node of inside) node.sessions = [...(node.sessions || []), s.id];
  return s;
}

// A node belongs to every session whose shape holds its centre, so dropping or dragging a node into a session joins it
// (and dragging it out leaves). Call after a node is added or moved.
export function syncSessions(board, node) {
  const mine = board.sessions.filter((s) => s.shape && inShape(s.shape, node.x + (node.w || 0) / 2, node.y + (node.h || 0) / 2)).map((s) => s.id);
  const before = (node.sessions || []).join();
  if (mine.length) node.sessions = mine; else delete node.sessions;
  return before !== mine.join();
}

export function removeSession(board, id) {
  board.sessions = board.sessions.filter((s) => s.id !== id);
  for (const n of board.nodes) if (n.sessions) { n.sessions = n.sessions.filter((x) => x !== id); if (!n.sessions.length) delete n.sessions; }
}

// ---- connections between nodes ------------------------------------------------------------
// A link is { id, from, to, rel, label, fromRoom, toRoom }: `rel` is one of RELATIONS (or "custom"), `label` is what is
// shown. For a dungeon node an end can point at one room (fromRoom / toRoom = room id).
export const RELATIONS = [
  ["works at", "works at"], ["owns", "owns"], ["lives in", "lives in"], ["found in", "is found in"], ["guards", "guards"],
  ["sells", "sells"], ["knows", "knows"], ["ally of", "is an ally of"], ["enemy of", "is an enemy of"], ["wants", "wants"],
  ["hides in", "hides in"], ["leads to", "leads to"], ["part of", "is part of"], ["carries", "carries"], ["custom", "Custom..."],
];
// A sensible first choice for the relationship, from the kinds of the two nodes (see kindOf in boardView.js).
const SUGGEST = {
  "npc>shop": "works at", "npc>tavern": "works at", "npc>room": "guards", "npc>dungeon": "lives in", "npc>npc": "knows",
  "loot>room": "found in", "loot>dungeon": "found in", "loot>npc": "carries", "loot>shop": "found in", "loot>tavern": "found in",
  "encounter>room": "guards", "encounter>dungeon": "found in", "shop>npc": "owns", "tavern>npc": "owns",
  "hook>npc": "wants", "hook>dungeon": "leads to", "rumour>dungeon": "leads to", "route>route": "leads to", "trainer>gym": "works at",
  "wildmon>route": "found in", "treasure>route": "found in", "room>room": "leads to", "note>note": "part of",
};
export const suggestRelation = (fromKind, toKind) => SUGGEST[`${fromKind}>${toKind}`] || "knows";
export const relationText = (rel, label) => (rel === "custom" ? label : (RELATIONS.find(([k]) => k === rel)?.[1] ?? label)) || "";

export function addLink(board, link) {
  if (link.from === link.to && link.fromRoom == null && link.toRoom == null) return null;
  const l = { id: `l${Date.now().toString(36)}${board.links.length}`, ...link };
  board.links.push(l);
  return l;
}
export const removeLinksOf = (board, nodeId) => { board.links = board.links.filter((l) => l.from !== nodeId && l.to !== nodeId); };

// Where the segment between two node rectangles' centres meets each rectangle's edge (so lines end at the border).
export function edgePoints(a, b) {
  const ca = [a.x + a.w / 2, a.y + a.h / 2], cb = [b.x + b.w / 2, b.y + b.h / 2];
  const clip = (r, c, toward) => {
    const dx = toward[0] - c[0], dy = toward[1] - c[1];
    if (!dx && !dy) return c;
    const t = Math.min(dx ? (r.w / 2) / Math.abs(dx) : Infinity, dy ? (r.h / 2) / Math.abs(dy) : Infinity);
    return [c[0] + dx * t, c[1] + dy * t];
  };
  return [clip(a, ca, cb), clip(b, cb, ca)];
}

// Backgrounds drawn with CSS only (see planner.css, .pl-bg-<id>), so they cost nothing to store or share.
export const BACKGROUNDS = [
  ["cosmic", "Cosmic"], ["parchment", "Parchment"], ["grid", "Grid paper"], ["dots", "Dot grid"], ["slate", "Dark slate"],
  ["blueprint", "Blueprint"], ["stone", "Dungeon stone"], ["forest", "Forest floor"], ["ocean", "Sea chart"], ["lava", "Lava"], ["plain", "Plain"],
];
export const isPreset = (id) => BACKGROUNDS.some(([k]) => k === id);

// libmon / libtrainer: a Pokémon or an NPC trainer brought in from the DM's Wild and NPC Libraries. They snap into the
// Trainer and Team slots of a Pokémon trainer, gym leader or wild encounter node (boardView.js "Slots").
const NODE_TYPES = ["note", "list", "gen", "text", "dungeon", "libmon", "libtrainer", "place"];
export const TEAM_MAX = 6;
const str = (v, n) => String(v ?? "").slice(0, n);
const fin = (v, f = 0) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : f);
const hex = (v, f) => (/^#[0-9a-f]{3,8}$/i.test(String(v)) ? String(v) : f);

// One Pokémon on a team (from a generator or a library), with only the fields a battle needs.
export function cleanMon(m) {
  if (!m || typeof m !== "object" || !str(m.name, 40)) return null;
  const dex = Number(m.dex);
  return {
    name: str(m.name, 40), nickname: str(m.nickname, 40), dex: Number.isInteger(dex) && dex > 0 ? dex : null,
    level: clamp(fin(m.level, 5), 1, 100), ability: str(m.ability, 40), item: str(m.item, 40),
    moves: (Array.isArray(m.moves) ? m.moves : []).map((x) => str(x, 40)).filter(Boolean).slice(0, 4),
    ...(Array.isArray(m.types) ? { types: m.types.slice(0, 2).map((t) => str(t, 12)) } : {}),
    ...(m.auto ? { auto: true } : {}),   // made by a generator: a new level may also bring new moves
  };
}
const cleanMons = (list) => (Array.isArray(list) ? list : []).map(cleanMon).filter(Boolean).slice(0, TEAM_MAX);
const cleanIdentity = (v) => (v && typeof v === "object" && str(v.name, 60) ? { name: str(v.name, 60), npcId: str(v.npcId, 40), sprite: str(v.sprite, 100) } : null);

// Boards also arrive from other players (the DM reads them), so every field is rebuilt with a known type here.
function cleanNode(n) {
  if (!n || !NODE_TYPES.includes(n.type)) return null;
  const out = { id: str(n.id, 40) || `n${Math.random().toString(36).slice(2)}`, type: n.type, title: str(n.title, 120), x: fin(n.x), y: fin(n.y), w: clamp(fin(n.w, 300), 170, 4000), h: clamp(fin(n.h, 220), 110, 4000) };
  const ss = [...(Array.isArray(n.sessions) ? n.sessions : []), ...(n.session ? [n.session] : [])];   // `session` is the old single-session field
  if (ss.length) out.sessions = [...new Set(ss.map((x) => str(x, 40)).filter(Boolean))].slice(0, 12);
  if (n.mapLink && typeof n.mapLink === "object") out.mapLink = { mapId: str(n.mapLink.mapId, 40), pinId: str(n.mapLink.pinId, 40) };
  if (n.type === "note" || n.type === "text") out.body = str(n.body, 20000);
  // a place (js/planner/places.js): its type, what it's known for, the description players read, and the DM's own notes
  if (n.type === "place") { out.placeKind = str(n.placeKind, 30); out.known = str(n.known, 160); out.body = str(n.body, 4000); out.dmNotes = str(n.dmNotes, 8000); }
  if (n.type === "text") out.color = hex(n.color, "#f6e27a");
  if (n.type === "list") out.items = (Array.isArray(n.items) ? n.items : []).slice(0, 200).map((i) => ({ id: str(i?.id, 40) || Math.random().toString(36).slice(2), text: str(i?.text, 300), done: !!i?.done }));
  if (n.type === "gen") { out.kind = str(n.kind || n.gen, 20); out.genLabel = str(n.genLabel, 60); out.gen = str(n.gen, 40); out.lines = (Array.isArray(n.lines) ? n.lines : []).slice(0, 200).map((l) => str(l, 2000));
    // a Pokémon encounter's team and (for trainers and gym leaders) who they are, so the hub can turn it into a battle
    if (Array.isArray(n.mons)) out.mons = cleanMons(n.mons);
    const who = cleanIdentity(n.identity);
    if (who) out.identity = who;
    if (Number(n.level) > 0) out.level = clamp(fin(n.level, 10), 1, 100);   // the card's Level box
  }
  if (n.type === "libmon") {
    out.mon = cleanMon(n.mon);
    if (!out.mon) return null;
    out.source = { kind: n.source?.kind === "npc" ? "npc" : "wild", id: str(n.source?.id, 40) };
  }
  if (n.type === "libtrainer") {
    out.npcId = str(n.npcId, 40); out.sprite = str(n.sprite, 100); out.mons = cleanMons(n.mons);
    if (Number(n.level) > 0) out.level = clamp(fin(n.level, 10), 1, 100); }
  if (n.type === "dungeon") {
    out.dungeon = n.dungeon && Array.isArray(n.dungeon.rooms) ? n.dungeon : null;
    out.roomNotes = {};
    for (const [k, v] of Object.entries(n.roomNotes && typeof n.roomNotes === "object" ? n.roomNotes : {}).slice(0, 40)) out.roomNotes[str(k, 10)] = str(v, 4000);
    out.expanded = !!n.expanded; if (n.cw) { out.cw = fin(n.cw); out.ch = fin(n.ch); }
    if (!out.dungeon) return null;
  }
  return out;
}
const cleanShape = (sh) => (sh?.kind === "box" ? { kind: "box", x: fin(sh.x), y: fin(sh.y), w: fin(sh.w), h: fin(sh.h) }
  : sh?.kind === "free" && Array.isArray(sh.pts) ? { kind: "free", pts: sh.pts.slice(0, 300).map((q) => [fin(q?.[0]), fin(q?.[1])]) } : null);
const room = (v) => (v == null || v === "" ? null : fin(v, null));
function cleanLinks(links, nodes) {
  const ids = new Set(nodes.map((n) => n.id));
  return (Array.isArray(links) ? links : []).slice(0, 400)
    .map((l) => ({ id: str(l?.id, 40), from: str(l?.from, 40), to: str(l?.to, 40), rel: RELATIONS.some(([k]) => k === l?.rel) ? l.rel : "custom", label: str(l?.label, 60), fromRoom: room(l?.fromRoom), toRoom: room(l?.toRoom) }))
    .filter((l) => l.id && ids.has(l.from) && ids.has(l.to));
}
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// Grow bounds until they hold the world rectangle [x0,y0,x1,y1] (what the screen is showing), so the paper always fills the page.
export function coverBounds(bounds, x0, y0, x1, y1) {
  const b = { ...bounds };
  let grew = false, guard = 0;
  while (x0 < b.x && b.w < MAX_SPAN && guard++ < 100) { b.x -= GROW; b.w += GROW; grew = true; }
  while (x1 > b.x + b.w && b.w < MAX_SPAN && guard++ < 200) { b.w += GROW; grew = true; }
  while (y0 < b.y && b.h < MAX_SPAN && guard++ < 300) { b.y -= GROW; b.h += GROW; grew = true; }
  while (y1 > b.y + b.h && b.h < MAX_SPAN && guard++ < 400) { b.h += GROW; grew = true; }
  return { bounds: b, grew };
}
export const MAX_SPAN = 60000;

export function normalizeBoard(b) {
  const d = defaultBounds();
  const bb = b?.bounds || {};
  const num = (v, f) => (Number.isFinite(Number(v)) ? Number(v) : f);
  const nodes = (Array.isArray(b?.nodes) ? b.nodes : []).slice(0, MAX_NODES).map(cleanNode).filter(Boolean);
  const sessions = (Array.isArray(b?.sessions) ? b.sessions : []).slice(0, 60).map((s) => ({ id: str(s?.id, 40), n: fin(s?.n, 1), color: hex(s?.color, SESSION_COLORS[0]), shape: cleanShape(s?.shape) })).filter((s) => s.id && s.shape);
  return {
    id: str(b?.id, 40),
    name: str(b?.name || "Board", 80),
    bg: { kind: b?.bg?.kind === "image" ? "image" : "preset", id: str(b?.bg?.id || "cosmic", 20), fit: b?.bg?.fit === "fill" ? "fill" : "tile" },
    bounds: { x: num(bb.x, d.x), y: num(bb.y, d.y), w: clamp(num(bb.w, d.w), BASE_W, MAX_SPAN + GROW), h: clamp(num(bb.h, d.h), BASE_H, MAX_SPAN + GROW) },
    view: { x: num(b?.view?.x, 0), y: num(b?.view?.y, 0), z: clamp(num(b?.view?.z, 0.8), 0.15, 2.5) },
    nodes,
    sessions,
    links: cleanLinks(b?.links, nodes),
    created: num(b?.created, 0),
  };
}
