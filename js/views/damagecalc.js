import { el, field, makeCombo, typePill } from "../components.js";
import { rollDice, checkHit, d20Roll } from "../calc.js";
import { battleMoves } from "../data.js";
import { STATUS_OPTIONS, STATUS_INFO, rollTurnCheck } from "../statusEffects.js";
import { makeSavedMonPicker } from "../savedMonPicker.js";
import { AUTO_APPLIED_ITEMS } from "../itemEffects.js";
import { AUTO_APPLIED_ABILITIES } from "../abilityEffects.js";
import { computeBattleDamage } from "../battleMath.js";
import { getViewState, setViewState } from "../viewState.js";

// Ability options are pulled from a Pokémon's own data. A curated subset of
// abilities (js/abilityEffects.js) and items (js/itemEffects.js) get folded
// into the damage math automatically — everything else is reference-only,
// shown with its real effect text so you can apply it by hand.
function abilityOptions(p) {
  const opts = [{ value: "", label: "None" }];
  if (p.ability1) opts.push({ value: p.ability1, label: p.ability1 });
  if (p.ability2 && p.ability2 !== p.ability1) opts.push({ value: p.ability2, label: p.ability2 });
  if (p.hiddenAbility) opts.push({ value: p.hiddenAbility, label: `${p.hiddenAbility} (Hidden)` });
  return opts;
}
function abilityEffect(p, name) {
  if (!name) return null;
  if (name === p.ability1) return p.ability1Effect;
  if (name === p.ability2) return p.ability2Effect;
  if (name === p.hiddenAbility) return p.hiddenAbilityEffect;
  return null;
}
function rebuildAbilitySelect(select, p) {
  const prev = select.value;
  select.innerHTML = "";
  abilityOptions(p).forEach((o) => select.appendChild(el("option", { value: o.value }, o.label)));
  const stillValid = [...select.options].some((o) => o.value === prev);
  select.value = stillValid ? prev : "";
}

export function renderDamageCalc(container, state) {
  container.innerHTML = "";
  container.appendChild(el("h1", { class: "view-title" }, "Battle Damage Calculator"));

  const moveNames = battleMoves(state).map((m) => m.name);
  const setup = getViewState("damagecalc:setup", {});

  let attacker = (setup.attacker && state.pokemonByName.get(setup.attacker)) || state.pokemonByName.get("Bulbasaur") || state.pokemon[0];
  let defender = (setup.defender && state.pokemonByName.get(setup.defender)) || state.pokemonByName.get("Bulbasaur") || state.pokemon[0];
  let moveName = (setup.move && moveNames.includes(setup.move)) ? setup.move : (moveNames.includes("Fell Stinger") ? "Fell Stinger" : moveNames[0]);

  // Bundled into one viewState entry rather than a key per field — this is
  // the "setup" half of the calculator (who/what/how you're rolling), not
  // the roll results themselves (lastRoll/accLastRoll/status checks below),
  // which intentionally reset each visit since re-rolling is the point.
  function persistSetup() {
    setViewState("damagecalc:setup", {
      attacker: attacker.name, defender: defender.name, move: moveName,
      attackerLevel: levelAttackerInput.value, defenderLevel: levelDefenderInput.value,
      attackerHp: attackerHpInput.value,
      attackerAbility: abilityAttackerSelect.value, defenderAbility: abilityDefenderSelect.value,
      attackerItem: itemAttackerCombo.inputEl.value, defenderItem: itemDefenderCombo.inputEl.value,
      attackerStatus: statusAttackerSelect.value, defenderStatus: statusDefenderSelect.value,
      accRollMode: accRollModeSelect.value, accManual: accManualInput.value,
      rollMode: rollModeSelect.value, manualDice: manualDiceInput.value,
    });
  }

  const attackerCombo = makeCombo({
    options: state.pokemon.map((p) => p.name), initial: attacker.name,
    onSelect: (n) => { attacker = state.pokemonByName.get(n); rebuildAbilitySelect(abilityAttackerSelect, attacker); persistSetup(); update(); },
  });
  const defenderCombo = makeCombo({
    options: state.pokemon.map((p) => p.name), initial: defender.name,
    onSelect: (n) => { defender = state.pokemonByName.get(n); rebuildAbilitySelect(abilityDefenderSelect, defender); persistSetup(); update(); },
  });
  const moveCombo = makeCombo({ options: moveNames, initial: moveName, onSelect: (n) => { moveName = n; persistSetup(); update(); } });

  const levelAttackerInput = el("input", { type: "number", min: "1", max: "100", value: String(setup.attackerLevel ?? 5) });
  const levelDefenderInput = el("input", { type: "number", min: "1", max: "100", value: String(setup.defenderLevel ?? 5) });
  const attackerHpInput = el("input", { type: "number", min: "0", placeholder: "blank = full HP", value: setup.attackerHp ?? "" });
  const abilityAttackerSelect = el("select", {});
  const abilityDefenderSelect = el("select", {});
  rebuildAbilitySelect(abilityAttackerSelect, attacker);
  rebuildAbilitySelect(abilityDefenderSelect, defender);
  if (setup.attackerAbility) abilityAttackerSelect.value = setup.attackerAbility;
  if (setup.defenderAbility) abilityDefenderSelect.value = setup.defenderAbility;
  const itemNames = state.items.map((it) => it.name);
  const itemAttackerCombo = makeCombo({ options: itemNames, placeholder: "e.g. Choice Band (optional)", initial: setup.attackerItem || "", onSelect: () => { persistSetup(); update(); } });
  const itemDefenderCombo = makeCombo({ options: itemNames, placeholder: "e.g. Leftovers (optional)", initial: setup.defenderItem || "", onSelect: () => { persistSetup(); update(); } });
  const statusAttackerSelect = el("select", {}, STATUS_OPTIONS.map((s) => el("option", { value: s }, s)));
  const statusDefenderSelect = el("select", {}, STATUS_OPTIONS.map((s) => el("option", { value: s }, s)));
  if (setup.attackerStatus) statusAttackerSelect.value = setup.attackerStatus;
  if (setup.defenderStatus) statusDefenderSelect.value = setup.defenderStatus;

  const accRollModeSelect = el("select", {}, ["Manual Entry", "Auto-Roll"].map((o) => el("option", { value: o }, o)));
  const accManualInput = el("input", { type: "number", min: "1", max: "20", value: String(setup.accManual ?? 15) });
  const rollModeSelect = el("select", {}, ["Manual Entry", "Auto-Roll"].map((o) => el("option", { value: o }, o)));
  const manualDiceInput = el("input", { type: "number", value: String(setup.manualDice ?? 3), min: "0" });
  if (setup.accRollMode) accRollModeSelect.value = setup.accRollMode;
  if (setup.rollMode) rollModeSelect.value = setup.rollMode;

  function applyAttackerMon(mon) {
    const species = state.pokemonByName.get(mon.name);
    if (!species) return;
    attacker = species;
    attackerCombo.setValue(species.name);
    rebuildAbilitySelect(abilityAttackerSelect, attacker);
    levelAttackerInput.value = mon.level || 5;
    attackerHpInput.value = mon.currentHp ?? "";
    abilityAttackerSelect.value = mon.ability || "";
    statusAttackerSelect.value = mon.status || "None";
    itemAttackerCombo.setValue(mon.item || "");
    persistSetup();
    update();
  }
  function applyDefenderMon(mon) {
    const species = state.pokemonByName.get(mon.name);
    if (!species) return;
    defender = species;
    defenderCombo.setValue(species.name);
    rebuildAbilitySelect(abilityDefenderSelect, defender);
    levelDefenderInput.value = mon.level || 5;
    abilityDefenderSelect.value = mon.ability || "";
    statusDefenderSelect.value = mon.status || "None";
    itemDefenderCombo.setValue(mon.item || "");
    persistSetup();
    update();
  }
  container.appendChild(el("div", { class: "grid-2" }, [
    makeSavedMonPicker({ title: "Load Attacker From…", onPick: applyAttackerMon }),
    makeSavedMonPicker({ title: "Load Defender From…", onPick: applyDefenderMon }),
  ]));

  container.appendChild(el("div", { class: "card" }, [
    el("div", { class: "grid-2" }, [field("Attacker Pokémon", attackerCombo), field("Defender Pokémon", defenderCombo)]),
    el("div", { class: "grid-2" }, [field("Attacker Level (1–100)", levelAttackerInput), field("Defender Level (1–100)", levelDefenderInput)]),
    el("div", { class: "grid-2" }, [field("Attacker Ability", abilityAttackerSelect), field("Defender Ability", abilityDefenderSelect)]),
    el("div", { class: "grid-2" }, [field("Attacker Status", statusAttackerSelect), field("Defender Status", statusDefenderSelect)]),
    field("Attacker Current HP (optional — only needed for Overgrow/Blaze/Torrent/Swarm)", attackerHpInput),
    el("div", { class: "grid-2" }, [field("Attacker Item (optional)", itemAttackerCombo), field("Defender Item (optional)", itemDefenderCombo)]),
    field("Move Used", moveCombo),
  ]));

  container.appendChild(el("div", { class: "card" }, [
    el("h4", {}, "Step 1: Accuracy Check"),
    el("div", { class: "grid-2" }, [
      field("Roll Mode", accRollModeSelect),
      field("Manual d20 Roll (used if Roll Mode = Manual Entry)", accManualInput),
    ]),
    el("button", { class: "btn", onclick: () => { accLastRoll = null; update(); } }, "Roll Accuracy (d20)"),
  ]));
  const accResultCard = el("div", { class: "card" });
  container.appendChild(accResultCard);

  container.appendChild(el("div", { class: "card" }, [
    el("h4", {}, "Step 2: Damage Roll (only matters if it hit)"),
    el("div", { class: "grid-2" }, [
      field("Roll Mode", rollModeSelect),
      field("Manual Dice Total (used if Roll Mode = Manual Entry)", manualDiceInput),
    ]),
    el("button", { class: "btn", onclick: () => { lastRoll = null; update(); } }, "Roll Damage Dice"),
  ]));

  const infoCard = el("div", { class: "card" });
  const resultCard = el("div", { class: "card" });
  container.appendChild(infoCard);
  container.appendChild(resultCard);

  let lastRoll = null;
  let accLastRoll = null;
  let atkStatusCheck = null;
  let defStatusCheck = null;

  function clampedLevel(input) {
    return Math.min(100, Math.max(1, Number(input.value) || 1));
  }

  function update() {
    const move = state.moves[state.moveByName.get(moveName)];
    const attackerLevel = clampedLevel(levelAttackerInput);
    const defenderLevel = clampedLevel(levelDefenderInput);

    const attackerAbility = abilityAttackerSelect.value;
    const defenderAbility = abilityDefenderSelect.value;
    const attackerItem = itemAttackerCombo.inputEl.value.trim();
    const defenderItem = itemDefenderCombo.inputEl.value.trim();
    const attackerItemData = state.itemByName.get(attackerItem);
    const defenderItemData = state.itemByName.get(defenderItem);
    const attackerCurrentHp = attackerHpInput.value.trim() === "" ? null : Number(attackerHpInput.value);
    const attackerStatus = statusAttackerSelect.value;
    const defenderStatus = statusDefenderSelect.value;

    // --- Step 1: Accuracy check ---
    const accRollMode = accRollModeSelect.value;
    let accD20;
    if (accRollMode === "Manual Entry") accD20 = Math.min(20, Math.max(1, Number(accManualInput.value) || 1));
    else { if (accLastRoll === null) accLastRoll = d20Roll(); accD20 = accLastRoll; }
    const { roll5: accRoll5, threshold: accThreshold, hit } = checkHit(move.accuracy, accD20);

    accResultCard.innerHTML = "";
    const accKv = el("table", { class: "kv-table" });
    function accRow(label, val) { accKv.appendChild(el("tr", {}, [el("td", {}, label), el("td", {}, String(val))])); }
    accRow("Move Accuracy", move.accuracy ?? "—");
    accRow("d20 Roll (used)", accD20);
    accRow("Roll × 5", accRoll5);
    accRow("Need to beat (100 − Accuracy)", accThreshold);
    accResultCard.appendChild(accKv);
    accResultCard.appendChild(el("div", { class: "result-banner " + (hit ? "good" : "bad") }, hit ? "HIT" : "MISS"));

    function statusBlock(who, status, lastCheck, setCheck) {
      const info = STATUS_INFO[status];
      if (!info) return null;
      const parts = [el("div", { class: "formula-note" }, `${who} is ${status}: ${info.summary}`)];
      if (info.turnCheck) {
        if (lastCheck) {
          parts.push(el("div", { class: "formula-note" }, `${info.turnCheck.label} → rolled ${lastCheck.result}: ${lastCheck.blocked ? "can't act this turn!" : "acts normally."}`));
        }
        parts.push(el("button", { class: "btn secondary", onclick: () => { setCheck(rollTurnCheck(status)); update(); } }, `Roll ${status} Check`));
      }
      return parts;
    }
    (statusBlock(attacker.name, attackerStatus, atkStatusCheck, (v) => { atkStatusCheck = v; }) || []).forEach((n) => accResultCard.appendChild(n));
    (statusBlock(defender.name, defenderStatus, defStatusCheck, (v) => { defStatusCheck = v; }) || []).forEach((n) => accResultCard.appendChild(n));

    // --- Step 2: Damage roll (computed here so it can feed the shared
    // battleMath engine below; displayed further down in resultCard) ---
    const rollMode = rollModeSelect.value;
    let diceRoll, rollDetail = "";
    if (move.category === "Status") {
      diceRoll = 0;
    } else if (rollMode === "Manual Entry") {
      diceRoll = Number(manualDiceInput.value) || 0;
    } else {
      if (lastRoll === null) lastRoll = rollDice(move.diceCount || 0, move.dieSize || 6);
      diceRoll = lastRoll.total;
      rollDetail = ` (rolls: ${lastRoll.rolls.join(", ")})`;
    }

    // Same engine the DM's Full Turn console and Control Centre use to
    // resolve a real turn (js/battleMath.js) — curated item/ability/status
    // modifiers folded into the damage number; everything else reference
    // only. Stats are scaled to level (IV 15, EV 0, neutral nature — same
    // assumption as the Stat Calculator's default).
    const { result, appliedMods, forcedImmune, wonderGuardTriggered, attackerAtLevel, defenderAtLevel } = computeBattleDamage({
      state, move,
      attackerSpecies: attacker, attackerLevel, attackerAbility, attackerItem, attackerStatus, attackerCurrentHp,
      defenderSpecies: defender, defenderLevel, defenderAbility, defenderItem, defenderStatus,
      diceRoll,
    });

    function itemSummary(name, data) {
      if (!name) return "—";
      if (!data) return `${name} (not in item database — custom/homebrew, no auto effect)`;
      const tag = AUTO_APPLIED_ITEMS.has(name) ? "auto-applied ✓" : "reference only";
      return `${name} [${tag}] — ${data.effect}`;
    }
    function abilitySummary(p, name) {
      if (!name) return "—";
      const tag = AUTO_APPLIED_ABILITIES.has(name) ? "auto-applied ✓" : "reference only";
      return `${name} [${tag}] — ${abilityEffect(p, name) || ""}`;
    }

    infoCard.innerHTML = "";
    infoCard.appendChild(el("h4", {}, "Combatants"));
    const kv0 = el("table", { class: "kv-table" });
    function row0(label, valueNode) { kv0.appendChild(el("tr", {}, [el("td", {}, label), el("td", {}, valueNode)])); }
    row0("Attacker", `${attacker.name} — Lv.${attackerLevel}` + (attackerCurrentHp !== null ? ` (${attackerCurrentHp}/${attackerAtLevel.hp} HP)` : ""));
    row0("Attacker Ability", abilitySummary(attacker, attackerAbility));
    row0("Attacker Item", itemSummary(attackerItem, attackerItemData));
    row0("Attacker Status", attackerStatus === "None" ? "—" : `${attackerStatus}${STATUS_INFO[attackerStatus]?.autoApplied ? " [auto-applied ✓]" : " [reference only]"} — ${STATUS_INFO[attackerStatus]?.summary || ""}`);
    row0("Defender", `${defender.name} — Lv.${defenderLevel}`);
    row0("Defender Ability", abilitySummary(defender, defenderAbility));
    row0("Defender Item", itemSummary(defenderItem, defenderItemData));
    row0("Defender Status", defenderStatus === "None" ? "—" : `${defenderStatus}${STATUS_INFO[defenderStatus]?.autoApplied ? " [auto-applied ✓]" : " [reference only]"} — ${STATUS_INFO[defenderStatus]?.summary || ""}`);
    infoCard.appendChild(kv0);
    infoCard.appendChild(el("div", { class: "formula-note" }, "Abilities/Items marked \"auto-applied\" (a curated ~55 items and ~25 abilities with well-known, deterministic effects — Choice Band, Life Orb, Overgrow-family, Levitate, Adaptability, type-boosting items/abilities, etc.) are folded into the damage number below automatically. Everything else is reference only — apply it by hand."));

    infoCard.appendChild(el("h4", {}, "Move & Type Details"));
    const kv = el("table", { class: "kv-table" });
    function row(label, valueNode) { kv.appendChild(el("tr", {}, [el("td", {}, label), el("td", {}, valueNode)])); }
    row("Move Type", move.type ? typePill(move.type) : "—");
    row("Move Category", move.category || "—");
    row("Move Tier", move.tier || "—");
    row("Dice Count / Size", move.diceCount ? `${move.diceCount}d${move.dieSize}` : "—");
    row("Attacker Type(s)", el("span", {}, [typePill(attacker.type1), attacker.type2 ? typePill(attacker.type2) : null].filter(Boolean)));
    row("Defender Type(s)", el("span", {}, [typePill(defender.type1), defender.type2 ? typePill(defender.type2) : null].filter(Boolean)));
    infoCard.appendChild(kv);

    resultCard.innerHTML = "";
    resultCard.appendChild(el("h4", {}, "Combat Math"));
    const kv2 = el("table", { class: "kv-table" });
    function row2(label, val) { kv2.appendChild(el("tr", {}, [el("td", {}, label), el("td", {}, val)])); }
    if (!result.status) {
      row2("Attacker Off. Stat", `${result.offStat} (Lv.${attackerLevel})`);
      row2("Defender Def. Stat", `${result.defStat} (Lv.${defenderLevel})`);
      row2("STAB", result.stab === 1.5 ? "1.5× (same type)" : "1×");
      row2("Type Effectiveness", `${result.eff}×` + (result.eff === 0 ? (forcedImmune ? ` (immune — ${defenderAbility})` : " (immune)") : result.eff > 1 ? " (super effective)" : result.eff < 1 ? " (not very effective)" : ""));
      row2("Dice Roll Used", String(diceRoll) + rollDetail);
      row2("Modifiers Applied", appliedMods.length
        ? appliedMods.map((m) => `${m.label} ×${Number(m.mult.toFixed(3))}`).join(", ")
        : "None");
      if (wonderGuardTriggered) row2("Ability Override", "Wonder Guard blocks non-super-effective hits — damage forced to 0");
    }
    resultCard.appendChild(kv2);

    const banner = el("div", {
      class: "result-banner " + (!hit ? "neutral" : result.status ? "neutral" : result.damage === 0 ? "neutral" : "bad"),
    }, !hit ? "MISS — no damage" : result.status ? result.damage : `${result.damage} damage`);
    resultCard.appendChild(banner);
    resultCard.appendChild(el("div", { class: "formula-note" }, "Damage = (Dice Roll + Off. Stat − Def. Stat) × STAB × Type Effectiveness × Modifiers, rounded down, min 1 (0 if immune). Off./Def. stat uses Attack/Defense for Physical moves, Sp. Atk/Sp. Def for Special moves, scaled to each Pokémon's level (IV 15, EV 0, neutral nature) and including any Choice item/Huge Power/Fur Coat-style stat boost; Status moves deal no damage."));
  }

  [levelAttackerInput, levelDefenderInput, attackerHpInput, abilityAttackerSelect, abilityDefenderSelect, itemAttackerCombo.inputEl, itemDefenderCombo.inputEl, rollModeSelect, manualDiceInput, accRollModeSelect, accManualInput].forEach((elm) => elm.addEventListener("input", () => { persistSetup(); update(); }));
  statusAttackerSelect.addEventListener("input", () => { atkStatusCheck = null; persistSetup(); update(); });
  statusDefenderSelect.addEventListener("input", () => { defStatusCheck = null; persistSetup(); update(); });
  update();
}
