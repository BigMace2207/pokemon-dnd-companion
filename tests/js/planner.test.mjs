import test from "node:test";
import assert from "node:assert/strict";
import { batched, flushPending, listProgress, newList, newNote, newScenario, newScene, newMap, sharedPart } from "../../js/planner/store.js";

test("a batched saver applies every queued edit, not just the last one", async () => {
  const committed = [];
  const save = batched((fns) => committed.push(fns.length), 20);
  const doc = {};
  save((d) => { d.title = "A"; });
  save((d) => { d.body = "B"; });
  assert.equal(committed.length, 0, "nothing is written while still typing");
  await new Promise((r) => setTimeout(r, 60));
  assert.deepEqual(committed, [2]);
  const merged = {};
  save((d) => { d.x = 1; }); save((d) => { d.y = 2; });
  // simulate what the commit does with the queue
  const apply = batched((fns) => fns.forEach((f) => f(merged)), 20);
  apply((d) => { d.title = "A"; }); apply((d) => { d.body = "B"; });
  await new Promise((r) => setTimeout(r, 60));
  assert.deepEqual(merged, { title: "A", body: "B" });
  void doc;
});

test("pending edits are flushed on demand (page hide, navigation)", () => {
  let n = 0;
  const save = batched((fns) => { n += fns.length; }, 10_000);
  save(() => {}); save(() => {});
  flushPending();
  assert.equal(n, 2);
  flushPending();
  assert.equal(n, 2, "nothing is committed twice");
});

test("checklist progress", () => {
  const l = newList("Goals", ["a", "b", "c", "d"]);
  assert.deepEqual(listProgress(l), { total: 4, done: 0, pct: 0 });
  l.items[0].done = l.items[1].done = true;
  assert.deepEqual(listProgress(l), { total: 4, done: 2, pct: 50 });
  assert.deepEqual(listProgress(newList("Empty")), { total: 0, done: 0, pct: 0 });
  assert.equal(new Set(l.items.map((i) => i.id)).size, 4, "items get distinct ids");
});

test("constructors give complete records with unique ids", () => {
  const ids = new Set([newNote().id, newList().id, newScenario().id, newScene().id, newMap().id]);
  assert.equal(ids.size, 5);
  const s = newScenario("The Heist");
  assert.equal(s.title, "The Heist");
  assert.equal(s.status, "draft");
  assert.equal(s.scenes.length, 1);
  for (const k of ["readAloud", "body", "npcs", "foes", "secrets", "rewards", "branches", "location"]) assert.equal(typeof s.scenes[0][k], "string", k);
  assert.deepEqual(newMap("Isle").pins, []);
});

test("a player shares notes, checklists and whiteboards, never scenarios or maps", () => {
  const plan = { notes: [newNote("n")], lists: [newList("l")], scenarios: [newScenario("secret plot")], maps: [newMap("m")], updated: 5 };
  const shared = sharedPart(plan);
  assert.deepEqual(Object.keys(shared).sort(), ["boards", "lists", "notes", "updated"]);
  assert.ok(!JSON.stringify(shared).includes("secret plot"));
});

test("a place's DM notes never go with a shared whiteboard", () => {
  const place = { id: "p", type: "place", title: "The Rusty Anchor", body: "A tavern.", dmNotes: "The owner is a spy." };
  const plan = { notes: [], lists: [], boards: [{ id: "b", nodes: [place, { id: "n", type: "note", body: "hi" }] }], updated: 1 };
  const shared = sharedPart(plan);
  assert.ok(!JSON.stringify(shared).includes("spy"));
  assert.equal(shared.boards[0].nodes[0].body, "A tavern.", "the rest of the place is shared");
  assert.equal(plan.boards[0].nodes[0].dmNotes, "The owner is a spy.", "the DM's own copy is untouched");
});
