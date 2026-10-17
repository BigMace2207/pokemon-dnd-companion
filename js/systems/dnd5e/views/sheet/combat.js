// Sheet > Combat: AC/initiative/speed, hit points, death saves, conditions, active
// effects, attacks and class resources.

import { el, field, btn, chip, section, promptDialog, toast, numInput, textInput, confirmDialog } from "../../ui.js";
import { hpBar } from "../../components/hpBar.js";
import { pips, savePips } from "../../components/pips.js";
import { d20Test, damageRoll, modeFromEvent } from "../../rolls.js";
import { applyDamage, applyHeal, deathSave, EFFECTS } from "../../engine/character.js";
import { EXHAUSTION_2014, EXHAUSTION_2024, CONDITION_NAMES_2014, CONDITION_NAMES_2024, ABILITY_KEYS } from "../../engine/rules.js";
import { concentrationDc } from "../../engine/encounter.js";
import { rollDie } from "../../engine/dice.js";

const signed = (n) => (n >= 0 ? `+${n}` : `−${Math.abs(n)}`);

export function renderCombatTab(panel, S) {
  const { char, d } = S;
  const who = char.name || "Character";

  // ---------------------------------------------------------- top stats
  const stat = (label, value, sub, onClick, title) => {
    const tile = el(onClick ? "button" : "div", { class: `dnd-bigstat${onClick ? " clickable" : ""}`, ...(onClick ? { type: "button", title } : {}) }, [
      el("div", { class: "v" }, String(value)), el("div", { class: "l" }, label), sub ? el("div", { class: "dnd-tiny dnd-muted" }, sub) : null,
    ].filter(Boolean));
    if (onClick) tile.addEventListener("click", onClick);
    return tile;
  };
  const acTile = stat("Armor Class", d.ac.value, null, () => acDetail(S), d.ac.breakdown.join(" · "));
  const initTile = stat("Initiative", signed(d.initiative), "click to roll", (e) => d20Test({ label: `${who}: Initiative`, mod: d.initiative, who, kind: "initiative", mode: modeFromEvent(e) }), "Roll initiative");
  const casting = d.casting[0];
  const tiles = el("div", { class: "dnd-stat-row" }, [
    acTile, initTile, stat("Speed", `${d.speed} ft`), stat("Proficiency", signed(d.pb)),
    stat("Passive Perception", d.passive.perception),
    casting ? stat("Spell save DC", casting.dc, `attack ${signed(casting.attack)}`) : null,
  ].filter(Boolean));
  panel.append(tiles);
  if (d.senses.length || d.resistances.length) panel.append(el("div", { class: "dnd-chip-row", style: "margin:-6px 0 14px" }, [...d.senses.map((s) => chip(s)), ...d.resistances.map((r) => chip(`Resist ${r}`, "good"))]));

  const cols = el("div", { class: "dnd-sheet-cols" });
  const left = el("div", { class: "dnd-stack" }), right = el("div", { class: "dnd-stack" });
  cols.append(left, right);
  panel.append(cols);

  // ---------------------------------------------------------- hit points
  left.append(hpCard(S));
  left.append(conditionsCard(S));
  left.append(effectsCard(S));
  right.append(attacksCard(S));
  const res = resourcesCard(S);
  if (res) right.append(res);
}

function acDetail(S) {
  const { d } = S;
  toast(`AC ${d.ac.value}: ${d.ac.breakdown.join(" · ")}`);
}

// ------------------------------------------------------------------ HP

function hpCard(S) {
  const { char, d } = S;
  const who = char.name || "Character";
  const wrap = el("div");
  function draw() {
    const cur = d.hp.current;
    const amount = el("input", { type: "number", min: "0", value: "1", inputmode: "numeric", class: "dnd-num", "aria-label": "Amount" });
    const val = () => Math.max(0, Math.floor(Number(amount.value) || 0));
    const dmg = btn("Damage", () => {
      const n = val(); if (!n) return;
      const r = applyDamage(char, S.d, n);
      S.commit();
      if (r.state === "dead") toast(`${who} has died.`, "bad");
      else if (r.state === "down") toast(`${who} is down!`, "bad");
      else if (char.concentration) toast(`Concentrating on ${char.concentration}: make a Constitution save, DC ${concentrationDc(n)}.`);
    }, "btn danger small");
    const heal = btn("Heal", () => { const n = val(); if (!n) return; const g = applyHeal(char, S.d, n); S.commit(); toast(`Restored ${g} hit points.`, "good"); }, "btn small");
    const temp = btn("Set temp HP", () => { char.hp.temp = val(); S.commit(); }, "btn secondary small");
    const hpBox = el("div", { class: "dnd-hp-big" }, [
      el("div", { class: "dnd-hp-nums" }, [el("span", { class: "cur" }, String(cur)), el("span", { class: "max" }, ` / ${d.hp.max}`)]),
      hpBar(cur, d.hp.max, d.hp.temp),
    ]);
    const parts = [hpBox, el("div", { class: "dnd-row" }, [amount, dmg, heal, temp])];
    // death saves
    if (cur === 0 && !char.conditions.includes("Dead")) {
      const ds = char.deathSaves;
      const dead = ds.f >= 3, stable = ds.s >= 3;
      parts.push(el("div", { class: "dnd-deathsaves" }, [
        el("strong", {}, dead ? "Dead" : stable ? "Stable" : "Death saving throws"),
        el("div", { class: "dnd-row" }, [el("span", { class: "dnd-small" }, "Successes"), savePips(ds.s, "s", (n) => { ds.s = n; S.commit(); }), el("span", { class: "dnd-small" }, "Failures"), savePips(ds.f, "f", (n) => { ds.f = n; S.commit(); })]),
        dead || stable ? null : btn("Roll death save", (e) => {
          const r = d20Test({ label: `${who}: Death save`, mod: 0, who, kind: "death", mode: modeFromEvent(e) });
          const res = deathSave(char, r.d20.natural);
          S.commit();
          toast(res === "revive" ? "Natural 20: back up with 1 HP!" : res === "dead" ? `${who} has died.` : res === "stable" ? `${who} is stable.` : res === "success" ? "Success." : "Failure.", res === "dead" || res === "failure" ? "bad" : "good");
        }, "btn small"),
      ].filter(Boolean)));
    }
    // hit dice
    const hd = d.hitDice.map((h) => el("span", { class: "dnd-chip" }, `${h.label}: ${h.total - h.used}/${h.total}`));
    parts.push(el("div", { class: "dnd-row", style: "margin-top:8px" }, [el("span", { class: "dnd-muted dnd-small" }, "Hit dice"), ...hd]));
    const bonus = numInput(Number(char.hp.bonus) || 0, (v) => { char.hp.bonus = v || 0; S.commit(); }, { min: -999, max: 999 });
    parts.push(el("details", { class: "dnd-fold" }, [el("summary", {}, "Hit point settings"), field("Extra max HP (manual bonus)", bonus),
      field("Override max HP (leave empty for the computed value)", numInput(char.hp.override ?? "", (v) => { char.hp.override = v == null ? null : v; S.commit(); }, { min: 1, max: 9999 }))]));
    wrap.replaceChildren(section("Hit points", parts));
  }
  draw();
  return wrap;
}

// ------------------------------------------------------------------ conditions

function conditionsCard(S) {
  const { char } = S;
  const names = char.edition === "2024" ? CONDITION_NAMES_2024 : CONDITION_NAMES_2014;
  const exh = char.edition === "2024" ? EXHAUSTION_2024 : EXHAUSTION_2014;
  const chips = names.map((n) => {
    const on = char.conditions.includes(n);
    const b = el("button", { type: "button", class: `dnd-chip dnd-toggle${on ? " bad on" : ""}`, "aria-pressed": String(on) }, n);
    b.addEventListener("click", () => { char.conditions = on ? char.conditions.filter((c) => c !== n) : [...char.conditions, n]; S.commit(); });
    return b;
  });
  const minus = btn("−", () => { char.exhaustion = Math.max(0, (char.exhaustion || 0) - 1); S.commit(); }, "btn secondary tiny dnd-icon-btn");
  const plus = btn("+", () => { char.exhaustion = Math.min(6, (char.exhaustion || 0) + 1); S.commit(); }, "btn secondary tiny dnd-icon-btn");
  const concIn = textInput(char.concentration || "", (v) => { char.concentration = v; S.save(); }, { placeholder: "Spell or effect", ariaLabel: "Concentrating on" });
  const concBtn = btn("Concentration check", async (e) => {
    const dmg = Number(await promptDialog("Concentration check", "Damage taken", "10")) || 10;
    const dc = concentrationDc(dmg);
    const mod = S.d.saves.CON.mod;
    const r = d20Test({ label: `${char.name || "Character"}: Concentration (DC ${dc})`, mod, who: char.name, kind: "save", mode: modeFromEvent(e) });
    if (r.total < dc) { toast(`Failed (DC ${dc}): concentration on ${char.concentration || "the spell"} ends.`, "bad"); char.concentration = ""; S.commit(); }
    else toast(`Held concentration (DC ${dc}).`, "good");
  }, "btn secondary small");
  void ABILITY_KEYS;
  return section("Conditions", [
    el("div", { class: "dnd-chip-row" }, chips),
    el("div", { class: "dnd-row", style: "margin-top:10px" }, [el("strong", {}, "Exhaustion"), minus, el("span", { class: "dnd-strong dnd-mono" }, String(char.exhaustion || 0)), plus, el("span", { class: "dnd-muted dnd-small" }, exh[char.exhaustion || 0])]),
    el("div", { class: "dnd-grid-2", style: "margin-top:10px" }, [field("Concentrating on", concIn), el("div", { class: "dnd-row", style: "align-items:flex-end" }, [concBtn])]),
  ]);
}

// ------------------------------------------------------------------ active effects

function effectsCard(S) {
  const { char, d } = S;
  const has = (e) => !e.classId || d.parts.some((p) => p.id === e.classId);
  const rows = EFFECTS.filter(has).map((e) => {
    const on = char.effectsOn.includes(e.id);
    const b = el("button", { type: "button", class: `dnd-chip dnd-toggle${on ? " accent on" : ""}`, title: e.desc, "aria-pressed": String(on) }, e.label);
    b.addEventListener("click", () => { char.effectsOn = on ? char.effectsOn.filter((x) => x !== e.id) : [...char.effectsOn, e.id]; S.commit(); });
    return b;
  });
  return section("Active effects", [
    el("div", { class: "dnd-chip-row" }, rows),
    el("p", { class: "dnd-small dnd-muted", style: "margin-top:6px" }, "Switch on a spell or rage and your AC, attacks and resistances update."),
  ]);
}

// ------------------------------------------------------------------ attacks

function attacksCard(S) {
  const { char, d } = S;
  const who = char.name || "Character";
  const rows = d.attacks.map((a) => {
    const hit = btn(`${signed(a.toHit)}`, (e) => d20Test({ label: `${who}: ${a.name}`, mod: a.toHit, who, kind: "attack", mode: modeFromEvent(e) }), "btn small");
    hit.title = "Roll to hit (Shift = advantage, Ctrl = disadvantage)";
    const dmgExpr = a.damage ? (a.damageMod ? `${a.damage}${a.damageMod > 0 ? "+" : "-"}${Math.abs(a.damageMod)}` : a.damage) : "";
    const dmg = a.damage ? btn(dmgExpr, () => damageRoll({ label: `${who}: ${a.name} damage`, expr: dmgExpr, who, reroll: a.gwf ? 2 : null }), "btn secondary small") : null;
    const crit = a.damage ? btn("Crit", () => damageRoll({ label: `${who}: ${a.name} damage`, expr: dmgExpr, who, crit: true, reroll: a.gwf ? 2 : null }), "btn secondary small") : null;
    const extra = [];
    if (a.versatile) extra.push(btn(`two-handed ${a.versatile}${a.damageMod ? (a.damageMod > 0 ? "+" : "-") + Math.abs(a.damageMod) : ""}`, () => damageRoll({ label: `${who}: ${a.name} (two-handed)`, expr: `${a.versatile}${a.damageMod ? (a.damageMod > 0 ? "+" : "-") + Math.abs(a.damageMod) : ""}`, who, reroll: a.gwf ? 2 : null }), "btn secondary tiny"));
    const del = a.custom ? btn("✕", () => { char.attacks = char.attacks.filter((x) => x.id !== a.id); S.commit(); }, "btn secondary tiny dnd-icon-btn", { "aria-label": "Remove attack" }) : null;
    return el("div", { class: "dnd-attack" }, [
      el("div", { class: "dnd-grow" }, [
        el("strong", {}, a.name),
        el("div", { class: "dnd-small dnd-muted" }, [a.damageType, a.range ? `range ${a.range}` : "", a.properties?.length ? a.properties.join(", ") : "", ...(a.notes || [])].filter(Boolean).join(" · ")),
      ]),
      el("div", { class: "dnd-row tight" }, [hit, dmg, crit, ...extra, del].filter(Boolean)),
    ]);
  });
  const add = btn("+ Custom attack", async () => {
    const name = await promptDialog("Custom attack", "Name (e.g. Fire Bolt)", "");
    if (!name?.trim()) return;
    const bonus = await promptDialog("Attack bonus", "To hit (a number)", String(d.pb + (d.casting[0]?.mod || 0)));
    const damage = await promptDialog("Damage", "Damage dice (e.g. 1d10)", "1d10");
    char.attacks.push({ id: `a${Date.now().toString(36)}`, name: name.trim(), bonus: Number(bonus) || 0, damage: (damage || "").trim(), type: "" });
    S.commit();
  }, "btn secondary small");
  return section("Attacks", [
    ...rows,
    el("p", { class: "dnd-small dnd-muted" }, "Equip weapons on the Inventory tab and they appear here with your bonuses applied."),
    add,
  ]);
}

// ------------------------------------------------------------------ resources

function resourcesCard(S) {
  const { char, d } = S;
  const res = d.resources;
  const rows = res.map((r) => {
    const unlimited = r.max == null;
    const ctl = unlimited ? el("span", { class: "dnd-muted dnd-small" }, "unlimited") : r.max > 12
      ? el("div", { class: "dnd-row tight" }, [
        btn("−", () => { char.resourcesUsed[r.key] = Math.min(r.max, (char.resourcesUsed[r.key] || 0) + 1); S.commit(); }, "btn secondary tiny dnd-icon-btn"),
        el("span", { class: "dnd-strong dnd-mono" }, `${r.max - r.used} / ${r.max}`),
        btn("+", () => { char.resourcesUsed[r.key] = Math.max(0, (char.resourcesUsed[r.key] || 0) - 1); S.commit(); }, "btn secondary tiny dnd-icon-btn")])
      : pips(r.max, r.used, (n) => { char.resourcesUsed[r.key] = n; S.commit(); }, { label: r.label });
    return el("div", { class: "dnd-resource" }, [
      el("div", { class: "dnd-grow" }, [el("strong", {}, r.label), el("div", { class: "dnd-tiny dnd-muted" }, [r.src, r.recharge === "short" ? "short or long rest" : "long rest", r.note].filter(Boolean).join(" · "))]),
      ctl,
      r.custom ? btn("✕", async () => { if (await confirmDialog(`Remove ${r.label}?`, { ok: "Remove", danger: true })) { char.customResources = char.customResources.filter((x) => x.id !== r.id); S.commit(); } }, "btn secondary tiny dnd-icon-btn", { "aria-label": `Remove ${r.label}` }) : null,
    ].filter(Boolean));
  });
  const add = btn("+ Custom resource", async () => {
    const name = await promptDialog("Custom resource", "Name (e.g. Bardic Inspiration, Luck points)", "");
    if (!name?.trim()) return;
    const max = Number(await promptDialog("Uses", "Maximum uses", "3")) || 1;
    char.customResources.push({ id: `r${Date.now().toString(36)}`, name: name.trim(), max, recharge: "long" });
    S.commit();
  }, "btn secondary small");
  return section("Resources", [...(rows.length ? rows : [el("p", { class: "view-sub" }, "Class features with limited uses show up here.")]), add]);
}

void rollDie;
