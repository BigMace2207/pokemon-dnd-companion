import test from "node:test";
import assert from "node:assert/strict";
import { PLACE_TYPES, POKEMON_PLACE_TYPES, placeTypesFor, placeType, pinFields, pinDiffers, placeNodes, placeOnMaps, nodeForPin } from "../../js/planner/places.js";

const tavern = { id: "n1", type: "place", title: "The Rusty Anchor", placeKind: "tavern", known: "Best stew in Red Larch", body: "A smoky dockside tavern.", dmNotes: "The owner is a spy." };

test("a place's label carries what players may read, never the DM's notes", () => {
  const f = pinFields(tavern);
  assert.equal(f.label, "The Rusty Anchor");
  assert.equal(f.kind, "Tavern");
  assert.equal(f.known, "Best stew in Red Larch");
  assert.equal(f.note, "A smoky dockside tavern.");
  assert.equal(f.icon, placeType("tavern")[2]);
  assert.ok(!JSON.stringify(f).includes("spy"), "the DM's notes stay on the card");
  assert.deepEqual(Object.keys(f).sort(), ["color", "icon", "kind", "known", "label", "note"]);
});

test("an unnamed or untyped place still makes a sensible label", () => {
  const f = pinFields({ id: "n2", type: "place", title: "  ", placeKind: "", body: "", known: "" });
  assert.equal(f.label, "Unnamed place");
  assert.equal(f.kind, "");
  assert.equal(f.icon, "📍");
  assert.equal(placeType("nonsense")[0], "other");
});

test("every place type has a one-word label, an icon of at most two characters and a hex colour", () => {
  for (const [key, label, icon, colour] of PLACE_TYPES) {
    assert.ok(key && label, key);
    assert.ok([...icon].length <= 2, `${key} icon is ${[...icon].length} characters`);
    assert.match(colour, /^#[0-9a-f]{6}$/i, key);
  }
});

test("a Pokemon campaign has its own place types, and the D&D side never shows them", () => {
  const dnd = placeTypesFor("dnd5e").map(([k]) => k), pokemon = placeTypesFor("pokemon-dnd").map(([k]) => k);
  for (const [key, , icon, colour] of POKEMON_PLACE_TYPES) {
    assert.ok(pokemon.includes(key) && !dnd.includes(key), key);
    assert.ok([...icon].length <= 2, key); assert.match(colour, /^#[0-9a-f]{6}$/i, key);
  }
  assert.equal(dnd[dnd.length - 1], "other"); assert.equal(pokemon[pokemon.length - 1], "other", "Other stays last");
  assert.equal(placeType("gym")[1], "Gym", "a label made on a Pokemon campaign still reads as one");
  assert.equal(pinFields({ title: "Pewter Gym", placeKind: "gym" }).icon, "🏟️");
});

test("pinDiffers sees only changes to what a place sets", () => {
  const pin = { id: "p1", x: 0.2, y: 0.3, revealed: true, placeId: "n1", ...pinFields(tavern) };
  assert.equal(pinDiffers(pin, pinFields(tavern)), false, "position and reveal state are the label's own");
  assert.equal(pinDiffers(pin, pinFields({ ...tavern, body: "Rebuilt after the fire." })), true);
  assert.equal(pinDiffers(pin, pinFields({ ...tavern, placeKind: "inn" })), true);
  assert.equal(pinDiffers({ id: "p2" }, pinFields(tavern)), true, "a label with no details yet needs them");
});

test("places are found across boards, and on the maps", () => {
  const plan = {
    boards: [{ id: "b1", nodes: [tavern, { id: "n3", type: "note" }] }, { id: "b2", nodes: [{ id: "n4", type: "place", title: "Skem" }] }],
    maps: [{ id: "m1", pins: [{ id: "p1", placeId: "n1" }, { id: "p2" }] }, { id: "m2", pins: [{ id: "p3", placeId: "n1" }] }],
  };
  assert.deepEqual(placeNodes(plan).map((x) => x.node.id), ["n1", "n4"]);
  assert.equal(placeOnMaps(plan, "n1").map.id, "m1");
  assert.equal(placeOnMaps(plan, "n1", "m2").map.id, "m2", "prefers the map being edited");
  assert.equal(placeOnMaps(plan, "n4"), null);
  assert.equal(nodeForPin(plan, plan.maps[0].pins[0]).title, "The Rusty Anchor");
  assert.equal(nodeForPin(plan, plan.maps[0].pins[1]), null, "a plain label has no card");
  assert.equal(nodeForPin(plan, { placeId: "gone" }), null, "a removed card");
});
