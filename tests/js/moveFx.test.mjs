import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMoveLine } from "../../js/moveFx.js";
import { showdownCryName } from "../../js/hubSound.js";

const ash = { id: "a", sourceLabel: "Ash", mon: { name: "Pikachu" } };
const gary = { id: "b", sourceLabel: "Gary", mon: { name: "Eevee", nickname: "Ev" } };
const wild = { id: "c", sourceKind: "wild", mon: { name: "Pidgey" } };
const all = [ash, gary, wild];
const labels = (c) => [`${c.sourceLabel || "Wild"}'s ${c.mon.nickname || c.mon.name}`, `${c.sourceLabel || "Wild"}: ${c.mon.nickname || c.mon.name}`];
const moves = ["Thunder", "Thunderbolt", "Thunder Shock", "Growl", "Tackle"];

test("a player's hit names the move (the longest that fits), who used it and who it hit", () => {
  const m = parseMoveLine("Ash's Pikachu used Thunderbolt on Gary's Ev for 12 damage! (40 → 28 HP)", all, moves, labels);
  assert.equal(m.moveName, "Thunderbolt");
  assert.equal(m.attacker, ash);
  assert.deepEqual(m.targets, [gary]);
  assert.equal(m.missed, false);
});

test("the DM console's labels, misses and status moves are read too", () => {
  const miss = parseMoveLine("Wild: Pidgey used Tackle — MISSED (d20 rolled 3).", all, moves, labels);
  assert.equal(miss.attacker, wild);
  assert.equal(miss.missed, true);
  const mega = parseMoveLine("Ash: Pikachu (Mega) used Thunder Shock on Wild: Pidgey for 5", all, moves, labels);
  assert.equal(mega.attacker, ash);
  assert.equal(mega.moveName, "Thunder Shock");
  assert.deepEqual(mega.targets, [wild]);
  const growl = parseMoveLine("Gary's Ev used Growl (status move — no direct damage).", all, moves, labels);
  assert.equal(growl.status, true);
  assert.deepEqual(growl.targets, []);
});

test("lines that aren't moves are ignored", () => {
  assert.equal(parseMoveLine("Ash threw a Poké Ball", all, moves, labels), null);
  assert.equal(parseMoveLine("Ash's Pikachu used Splash", all, moves, labels), null);
});

test("cry names follow Pokémon Showdown's file names", () => {
  assert.equal(showdownCryName("Mr. Mime"), "mrmime");
  assert.equal(showdownCryName("Farfetch'd"), "farfetchd");
  assert.equal(showdownCryName("Nidoran♀"), "nidoranf");
  assert.equal(showdownCryName("Deoxys (Attack)"), "deoxys");
  assert.equal(showdownCryName("Flabébé"), "flabebe");
});
