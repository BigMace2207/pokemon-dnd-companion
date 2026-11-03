import test from "node:test";
import assert from "node:assert/strict";
import { growBounds, defaultBounds, pointInPolygon, nodesInShape, simplify, addSession, removeSession, boxFrom, normalizeBoard, EDGE, GROW, BASE_W } from "../../js/planner/board.js";

const node = (id, x, y, w = 100, h = 80) => ({ id, type: "note", x, y, w, h });

test("the board grows only on the side a node nears", () => {
  const b = defaultBounds();
  assert.equal(growBounds(b, [node("a", 0, 0)]).grew, false);
  const r = growBounds(b, [node("a", b.x + b.w - 120, 0)]);   // right edge within EDGE
  assert.equal(r.grew, true);
  assert.equal(r.bounds.w, b.w + GROW);
  assert.equal(r.bounds.x, b.x);
  const l = growBounds(b, [node("a", b.x + 10, 0)]);
  assert.equal(l.bounds.x, b.x - GROW);
  assert.equal(l.bounds.w, b.w + GROW);
});

test("a node dropped far away grows the board until it is inside, with room to spare", () => {
  const b = defaultBounds();
  const r = growBounds(b, [node("far", 9000, -7000)]).bounds;
  assert.ok(9000 + 100 <= r.x + r.w - EDGE);
  assert.ok(-7000 >= r.y + EDGE);
});

test("polygon and box selection use the node centre", () => {
  const tri = [[0, 0], [100, 0], [0, 100]];
  assert.equal(pointInPolygon(20, 20, tri), true);
  assert.equal(pointInPolygon(80, 80, tri), false);
  const ns = [node("in", 10, 10, 20, 20), node("out", 200, 200, 20, 20)];
  assert.deepEqual(nodesInShape(ns, boxFrom([0, 0], [100, 100])).map((n) => n.id), ["in"]);
  assert.deepEqual(nodesInShape(ns, { kind: "free", pts: tri }).map((n) => n.id), ["in"]);
});

test("sessions get numbers and colours, and removing one frees its nodes", () => {
  const board = { nodes: [node("a", 0, 0), node("b", 500, 0), node("c", 1000, 0)], sessions: [] };
  const s1 = addSession(board, boxFrom([-10, -10], [200, 200]));
  const s2 = addSession(board, boxFrom([450, -10], [700, 200]));
  assert.equal(s1.n, 1); assert.equal(s2.n, 2);
  assert.notEqual(s1.color, s2.color);
  assert.deepEqual(board.nodes[0].sessions, [s1.id]);
  assert.equal(addSession(board, boxFrom([2000, 2000], [2100, 2100])), null);
  removeSession(board, s1.id);
  assert.equal(board.nodes[0].sessions, undefined);
  assert.equal(addSession(board, boxFrom([-10, -10], [200, 200])).n, 3);
});

test("freehand strokes are thinned and capped", () => {
  const raw = Array.from({ length: 2000 }, (_, i) => [i, Math.sin(i / 9) * 200]);
  const s = simplify(raw);
  assert.ok(s.length <= 240 && s.length > 20);
});

test("normalizeBoard rebuilds hostile data into safe values", () => {
  const b = normalizeBoard({
    id: "x", name: "n", bounds: { w: 5, h: "huge" }, bg: { kind: "image", id: "e" },
    nodes: [{ id: "1", type: "note", x: "<b>", y: 5, w: 1e9, title: "t", body: "b" }, { type: "evil" }, { id: "2", type: "dungeon", dungeon: { nope: 1 } }, { id: "3", type: "text", color: "red;background:url(x)" }],
    sessions: [{ id: "s", n: 1, color: "javascript:1", shape: { kind: "box", x: 0, y: 0, w: 10, h: 10 } }, { id: "t", shape: { kind: "poly" } }],
  });
  assert.equal(b.nodes.length, 2);
  assert.equal(b.nodes[0].x, 0);
  assert.equal(b.nodes[0].w, 4000);
  assert.equal(b.nodes[1].color, "#f6e27a");
  assert.equal(b.sessions.length, 1);
  assert.match(b.sessions[0].color, /^#/);
  assert.ok(b.bounds.w >= BASE_W);
});

test("a node can belong to several sessions, and the old single-session field is migrated", () => {
  const board = { nodes: [node("a", 0, 0), node("b", 500, 0)], sessions: [] };
  const s1 = addSession(board, boxFrom([-10, -10], [700, 200]));
  const s2 = addSession(board, boxFrom([-10, -10], [200, 200]));
  assert.deepEqual(board.nodes[0].sessions, [s1.id, s2.id]);
  assert.deepEqual(board.nodes[1].sessions, [s1.id]);
  removeSession(board, s1.id);
  assert.deepEqual(board.nodes[0].sessions, [s2.id]);
  assert.equal(board.nodes[1].sessions, undefined);
  const old = normalizeBoard({ id: "b", nodes: [{ id: "1", type: "note", session: "s9" }] });
  assert.deepEqual(old.nodes[0].sessions, ["s9"]);
});

import { syncSessions, coverBounds, addLink, removeLinksOf, edgePoints, suggestRelation, relationText } from "../../js/planner/board.js";

test("dropping a node into a session joins it, dragging it out leaves", () => {
  const board = { nodes: [node("a", 0, 0)], sessions: [] };
  const s = addSession(board, boxFrom([-10, -10], [200, 200]));
  const b = node("b", 1000, 1000); board.nodes.push(b);
  assert.equal(syncSessions(board, b), false);
  b.x = 20; b.y = 20;
  assert.equal(syncSessions(board, b), true);
  assert.deepEqual(b.sessions, [s.id]);
  b.x = 900;
  syncSessions(board, b);
  assert.equal(b.sessions, undefined);
});

test("the paper grows to cover whatever the screen shows", () => {
  const b = defaultBounds();
  assert.equal(coverBounds(b, b.x + 10, b.y + 10, b.x + 500, b.y + 500).grew, false);
  const r = coverBounds(b, b.x - 100, b.y, b.x + b.w + 3000, b.y + b.h + 10);
  assert.ok(r.grew && r.bounds.x <= b.x - 100 && r.bounds.x + r.bounds.w >= b.x + b.w + 3000 && r.bounds.y === b.y);
  const huge = coverBounds(b, -1e9, 0, 1e9, 10).bounds;
  assert.ok(huge.w < 80000);   // capped
});

test("links join nodes, follow rooms, drop with their node, and suggest a relationship", () => {
  const board = { nodes: [node("npc1", 0, 0), node("shop1", 500, 0)], links: [] };
  assert.equal(addLink(board, { from: "npc1", to: "npc1", rel: "knows", label: "" }), null);
  const l = addLink(board, { from: "npc1", to: "shop1", rel: suggestRelation("npc", "shop"), label: "", fromRoom: null, toRoom: 9 });
  assert.equal(l.rel, "works at");
  assert.equal(suggestRelation("loot", "room"), "found in");
  assert.equal(relationText("found in", ""), "is found in");
  assert.equal(relationText("custom", "owes money to"), "owes money to");
  const [p, q] = edgePoints(board.nodes[0], board.nodes[1]);
  assert.ok(p[0] === 100 && q[0] === 500);   // starts at the first node's right edge, ends at the second's left
  removeLinksOf(board, "shop1");
  assert.equal(board.links.length, 0);
  const n = normalizeBoard({ id: "x", nodes: [{ id: "a", type: "note" }, { id: "b", type: "note" }], links: [{ id: "1", from: "a", to: "b", rel: "ally of" }, { id: "2", from: "a", to: "gone" }, { id: "3", from: "a", to: "b", rel: "evil", label: "hi", toRoom: "7" }] });
  assert.equal(n.links.length, 2);
  assert.equal(n.links[1].rel, "custom");
  assert.equal(n.links[1].toRoom, 7);
});

test("library cards and trainer/team slots survive a save, and junk is dropped", () => {
  const b = normalizeBoard({ id: "b", nodes: [
    { id: "g", type: "gen", gen: "gym", kind: "gym", title: "Gym", identity: { name: "Brock", npcId: "n1", sprite: "brock.png" },
      mons: [{ name: "Onix", dex: 95, level: 14, moves: ["Tackle", "Rock Throw", "", "x", "y"], item: "Hard Stone" }, { name: "" }, ...Array(8).fill({ name: "Geodude", level: 12 })] },
    { id: "m", type: "libmon", mon: { name: "Rattata", dex: 19, level: 6, nickname: "Ratty" }, source: { kind: "wild", id: "w1" } },
    { id: "t", type: "libtrainer", title: "Misty", npcId: "n2", mons: [{ name: "Staryu", level: 18 }] },
    { id: "bad", type: "libmon", mon: { level: 5 } },
  ] });
  const gym = b.nodes.find((n) => n.id === "g");
  assert.equal(gym.identity.name, "Brock");
  assert.equal(gym.mons.length, 6, "a team holds six");
  assert.deepEqual(gym.mons[0].moves, ["Tackle", "Rock Throw", "x", "y"]);
  assert.equal(gym.mons[0].item, "Hard Stone");
  assert.equal(b.nodes.find((n) => n.id === "m").mon.nickname, "Ratty");
  assert.equal(b.nodes.find((n) => n.id === "t").mons[0].name, "Staryu");
  assert.equal(b.nodes.find((n) => n.id === "bad"), undefined, "a Pokémon with no name isn't kept");
});
