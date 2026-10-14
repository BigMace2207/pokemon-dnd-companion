import { el, field, makeCombo } from "../components.js";
import { calcAllStats, checkHit, d20Roll, rollMoveDice, BALL_TYPES } from "../calc.js";
import { battleMoves } from "../data.js";
import { STATUS_OPTIONS } from "../statusEffects.js";
import { newMon } from "../storage.js";
import {
  dmLogin, dmAction, checkDmToken, listTrainers, getMusicSlots, postBattleLog,
  getNpcs, getNpc, getWildList, getWildMon, getSfxFiles, getSfxBlobUrl, getDmInbox, getFullTurn,
} from "../network.js";
import { monIsLiveCombatant } from "../battleGate.js";
import { renderFullTurn } from "./fullturn.js";
import { computeBattleDamage } from "../battleMath.js";
import { makeTrainerSpritePicker } from "../trainerSpritePicker.js";
import { npcToText, parseNpcText, parseTeamText } from "../teamExport.js";
import { getViewState, setViewState } from "../viewState.js";
import { makeSavedMonPicker } from "../savedMonPicker.js";
import { goToPokemon, goToStatCalc } from "../navState.js";
import { learnableMoveNames } from "../levelUp.js";
import { HEAL_ITEMS, STATUS_HEAL_ITEMS } from "../battleItems.js";
import { tmMoveNames, tmName } from "../bagItems.js";

const TOKEN_KEY = "pokemon-dnd-dm-token";

export async function renderControlCentre(container, state) {
  container.innerHTML = "";
  container.appendChild(el("h1", { class: "view-title" }, "Control Centre"));

  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) {
    renderLogin(container, state);
    return;
  }
  container.appendChild(el("p", { class: "view-sub" }, "Checking session…"));
  const stillValid = await checkDmToken(token);
  container.innerHTML = "";
  container.appendChild(el("h1", { class: "view-title" }, "Control Centre"));
  if (!stillValid) {
    localStorage.removeItem(TOKEN_KEY);
    container.appendChild(el("p", { class: "formula-note" }, "Your session ended (the server was probably restarted) — log in again."));
    renderLogin(container, state);
    return;
  }
  renderMain(container, state, token);
}

function renderLogin(container, state) {
  container.appendChild(el("p", { class: "view-sub" }, "Dungeon Master access only."));
  const pwInput = el("input", { type: "password", placeholder: "Password" });
  const errorMsg = el("p", { class: "formula-note", style: "display:none;color:var(--bad)" }, "Incorrect password.");
  const btn = el("button", { class: "btn" }, "Enter");
  async function attempt() {
    btn.disabled = true; btn.textContent = "Checking…";
    const res = await dmLogin(pwInput.value);
    btn.disabled = false; btn.textContent = "Enter";
    if (res?.ok) {
      localStorage.setItem(TOKEN_KEY, res.token);
      renderControlCentre(container, state);
    } else {
      errorMsg.style.display = "block";
    }
  }
  btn.addEventListener("click", attempt);
  pwInput.addEventListener("keydown", (e) => { if (e.key === "Enter") attempt(); });
  container.appendChild(el("div", { class: "card" }, [field("Password", pwInput), btn, errorMsg]));
}

function renderMain(container, state, token) {
  const logoutBtn = el("button", { class: "btn secondary" }, "Log Out");
  logoutBtn.addEventListener("click", () => { localStorage.removeItem(TOKEN_KEY); renderControlCentre(container, state); });

  const tabs = {
    "DM Tools": (body) => renderDmTools(body, state, token),
    "Battle Control": (body) => renderFullTurn(body, state, token),
    "NPC Library": (body) => renderNpcLibrary(body, state, token),
    "Wild Library": (body) => renderWildLibrary(body, state, token),
    "Music Board": (body) => renderMusicBoard(body, token),
    "Sound Effects": (body) => renderSoundEffects(body),
  };
  const tabNames = Object.keys(tabs);
  const savedTab = getViewState("controlcentre:tab", "DM Tools");
  const activeTabName = tabNames.includes(savedTab) ? savedTab : "DM Tools";
  const tabBtns = tabNames.map((name) => el("button", { class: "pill-btn" + (name === activeTabName ? " active" : "") }, name));
  const tabRow = el("div", { class: "card" }, [...tabBtns, el("span", { style: "float:right" }, [logoutBtn])]);
  container.appendChild(tabRow);

  const body = el("div");
  container.appendChild(body);

  tabBtns.forEach((btn, i) => {
    const name = tabNames[i];
    btn.addEventListener("click", () => {
      tabBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      setViewState("controlcentre:tab", name);
      tabs[name](body);
    });
  });

  tabs[activeTabName](body);
}

// ---------------- Shared: a single Pokémon's editable fields ----------------

// Same species/item/ability/move data sources as My Team (js/views/team.js)
// — an NPC or Wild library entry is the exact same "mon" shape a player's
// save uses, so it should pick from the exact same real lists, not free
// text, to stay linked to the same items/moves/abilities system everywhere
// else in the app.
function abilityChoicesFor(state, speciesName) {
  const p = state.pokemonByName.get(speciesName);
  if (!p) return [];
  return [p.ability1, p.ability2, p.hiddenAbility].filter(Boolean);
}

function monFieldsRow(mon, state, onRemove) {
  if (!mon.moves) mon.moves = ["", "", "", ""];
  const species = state.pokemonByName.get(mon.name);
  const abilitySelect = el("select", {}, [el("option", { value: "" }, "None"), ...abilityChoicesFor(state, mon.name).map((a) => el("option", { value: a }, a))]);
  abilitySelect.value = mon.ability || "";
  abilitySelect.addEventListener("input", () => { mon.ability = abilitySelect.value; });

  const speciesCombo = makeCombo({
    options: state.pokemon.map((p) => p.name), initial: mon.name, placeholder: "Species…",
    onSelect: (n) => {
      mon.name = n; mon.dex = state.pokemonByName.get(n)?.dex ?? null; mon.ability = "";
      const prev = abilitySelect.value;
      abilitySelect.innerHTML = "";
      abilitySelect.appendChild(el("option", { value: "" }, "None"));
      abilityChoicesFor(state, n).forEach((a) => abilitySelect.appendChild(el("option", { value: a }, a)));
      abilitySelect.value = [...abilitySelect.options].some((o) => o.value === prev) ? prev : "";
    },
  });
  const nicknameInput = el("input", { type: "text", value: mon.nickname || "", placeholder: "Nickname" });
  nicknameInput.addEventListener("input", () => { mon.nickname = nicknameInput.value; });
  const levelInput = el("input", { type: "number", min: "1", max: "100", value: String(mon.level || 5) });
  levelInput.addEventListener("input", () => { mon.level = Number(levelInput.value) || 1; });
  // Max HP shown right on the label — same "Current HP / Max HP" pattern as
  // My Team — so the DM can see at a glance how much health this NPC/Wild
  // Pokémon actually has instead of guessing from a bare number.
  const maxHp = species ? calcAllStats(species, Math.min(100, Math.max(1, Number(mon.level) || 1)), 15, 0, 1).hp : null;
  const hpLabel = el("span", {}, `Current HP${maxHp !== null ? ` / ${maxHp}` : ""}`);
  const hpInput = el("input", { type: "number", min: "0", value: mon.currentHp ?? "" });
  hpInput.addEventListener("input", () => { mon.currentHp = Number(hpInput.value) || 0; });
  const itemCombo = makeCombo({ options: state.items.map((it) => it.name), initial: mon.item || "", placeholder: "Held item (optional)", onSelect: (n) => { mon.item = n; } });
  itemCombo.inputEl.addEventListener("input", () => { mon.item = itemCombo.inputEl.value; });
  const statusSelect = el("select", {}, STATUS_OPTIONS.map((s) => el("option", { value: s }, s)));
  statusSelect.value = mon.status || "None";
  statusSelect.addEventListener("input", () => { mon.status = statusSelect.value; });
  // Restricted to moves this species can actually know at its current level
  // (see learnableMoveNames) — same rule as My Team's move picker.
  const monMoveNames = learnableMoveNames(state, mon);
  const moveCombos = [0, 1, 2, 3].map((i) => {
    const combo = makeCombo({ options: monMoveNames, initial: mon.moves[i] || "", placeholder: `Move ${i + 1}`, onSelect: (n) => { mon.moves[i] = n; } });
    combo.inputEl.addEventListener("blur", () => { mon.moves[i] = combo.inputEl.value; });
    return combo;
  });

  const rows = [
    el("div", { class: "grid-3" }, [field("Species", speciesCombo), field("Nickname", nicknameInput), field("Level", levelInput)]),
    el("div", { class: "grid-3" }, [
      el("label", { class: "field" }, [hpLabel, hpInput]),
      field("Item", itemCombo),
      field("Ability", abilitySelect),
    ]),
    el("div", { class: "grid-2" }, [
      field("Status", statusSelect),
      el("div", {}, [
        species ? el("button", { class: "btn secondary", onclick: () => goToPokemon(mon.name) }, "View in Pokédex") : null,
        species ? el("button", { class: "btn secondary", onclick: () => goToStatCalc(mon.name, mon.level) }, "View in Stat Calculator") : null,
        onRemove ? el("button", { class: "btn secondary", onclick: onRemove }, "Remove") : null,
      ].filter(Boolean)),
    ]),
    el("div", { class: "grid-2" }, [field("Move 1", moveCombos[0]), field("Move 2", moveCombos[1])]),
    el("div", { class: "grid-2" }, [field("Move 3", moveCombos[2]), field("Move 4", moveCombos[3])]),
  ];
  return el("div", { class: "card", style: "margin-bottom:8px" }, rows);
}

// ---------------- DM Tools ----------------

function renderDmTools(body, state, token) {
  body.innerHTML = "";

  // --- Messages from players ---
  const inboxWrap = el("div");
  body.appendChild(el("div", { class: "card" }, [el("h4", {}, "Messages from Players"), inboxWrap]));
  async function refreshDmInbox() {
    const entries = await getDmInbox(token);
    inboxWrap.innerHTML = "";
    if (!entries.length) { inboxWrap.appendChild(el("p", { class: "view-sub" }, "No messages.")); return; }
    [...entries].reverse().forEach((m) => {
      const dismissBtn = el("button", { class: "btn secondary" }, "Dismiss");
      dismissBtn.addEventListener("click", async () => { await dmAction(token, "dmInboxClear", { ids: [m.id] }); refreshDmInbox(); });
      inboxWrap.appendChild(el("div", { class: "card", style: "margin-bottom:6px;display:flex;justify-content:space-between;align-items:center;gap:10px" }, [
        el("span", {}, [el("strong", {}, m.fromName || "A trainer"), `: ${m.text}`]),
        dismissBtn,
      ]));
    });
  }
  refreshDmInbox();

  // --- Force a move --- (two compact "pick a saved Pokémon" boxes instead
  // of a full Source/target selector, since all this needs is two Pokémon
  // and a move.)
  const moveNames = battleMoves(state).map((m) => m.name);
  const moveCombo = makeCombo({ options: moveNames, placeholder: "Pick a move…", onSelect: () => {} });
  const rollOut = el("div", { class: "formula-note" }, "");
  const aAttacksBtn = el("button", { class: "btn" }, "◀ Attacks");
  const bAttacksBtn = el("button", { class: "btn" }, "Attacks ▶");

  let forceMoveA = null, forceMoveB = null;
  const forcePickerA = makeSavedMonPicker({ title: "Pokémon A", defaultSource: "player", onPick: (mon, entry) => { forceMoveA = entry; } });
  const forcePickerB = makeSavedMonPicker({ title: "Pokémon B", defaultSource: "player", onPick: (mon, entry) => { forceMoveB = entry; } });

  function toServerTargetKind(sourceKind) {
    return sourceKind === "npc" || sourceKind === "wild" ? sourceKind : "online";
  }

  async function forceMove(atk, def) {
    const move = state.moves[state.moveByName.get(moveCombo.inputEl.value.trim())];
    if (!move || !atk?.mon || !def?.mon) { rollOut.textContent = "Pick a Pokémon on both sides and a move first."; return; }
    const atkSpecies = state.pokemonByName.get(atk.mon.name);
    const defSpecies = state.pokemonByName.get(def.mon.name);
    if (!atkSpecies || !defSpecies) { rollOut.textContent = "Species not recognized."; return; }
    const d20 = d20Roll();
    const { hit } = checkHit(move.accuracy, d20);
    if (!hit) {
      rollOut.textContent = `${atk.sourceLabel}'s ${atk.mon.nickname || atk.mon.name} used ${move.name} — MISSED (d20 rolled ${d20}).`;
      await postBattleLog("Dungeon Master", rollOut.textContent);
      return;
    }
    const diceRoll = rollMoveDice(move).total;
    // Same engine the Damage Calculator and Full Turn console use (see
    // js/battleMath.js) — each combatant's own item/ability/status feeds
    // the same curated modifier pipeline, instead of a bare base-formula hit.
    const { result } = computeBattleDamage({
      state, move,
      attackerSpecies: atkSpecies, attackerLevel: Number(atk.mon.level) || 5, attackerAbility: atk.mon.ability,
      attackerItem: atk.mon.item, attackerStatus: atk.mon.status, attackerCurrentHp: atk.mon.currentHp,
      defenderSpecies: defSpecies, defenderLevel: Number(def.mon.level) || 5, defenderAbility: def.mon.ability,
      defenderItem: def.mon.item, defenderStatus: def.mon.status,
      defenderCurrentHp: def.mon.currentHp ?? null,
      diceRoll,
    });
    const dmg = result.status ? 0 : result.damage;
    rollOut.textContent = result.status
      ? `${atk.sourceLabel}'s ${atk.mon.nickname || atk.mon.name} used ${move.name} (status move — no direct damage).`
      : `${atk.sourceLabel}'s ${atk.mon.nickname || atk.mon.name} used ${move.name} on ${def.sourceLabel}'s ${def.mon.nickname || def.mon.name} for ${dmg} damage!`
        + (result.special?.note ? ` (${result.special.note})` : "");
    if (dmg > 0) {
      await dmAction(token, "forceMove", {
        targetId: def.sourceId, targetKind: toServerTargetKind(def.sourceKind), monId: def.mon.id, damage: dmg,
        attackerName: `${atk.sourceLabel}'s ${atk.mon.nickname || atk.mon.name}`,
        defenderName: `${def.sourceLabel}'s ${def.mon.nickname || def.mon.name}`,
        moveName: move.name,
      });
    } else {
      await postBattleLog("Dungeon Master", rollOut.textContent);
    }
  }
  aAttacksBtn.addEventListener("click", () => forceMove(forceMoveB, forceMoveA));
  bAttacksBtn.addEventListener("click", () => forceMove(forceMoveA, forceMoveB));

  body.appendChild(el("div", { class: "card" }, [
    el("h4", {}, "Force a Move"),
    el("div", { class: "grid-2" }, [forcePickerA, forcePickerB]),
    field("Move", moveCombo),
    el("div", { class: "grid-3" }, [aAttacksBtn, el("span", { style: "text-align:center;align-self:center;color:var(--text-dim)" }, "A ↔ B"), bAttacksBtn]),
    rollOut,
  ]));

  // --- Give: levels or a Bag item ---
  // Auto-applied client-side via the same directive channel as setHp/
  // setStatus/personalNote above (js/directives.js) — no manual Accept
  // needed, lands next time that trainer's app polls (a few seconds if
  // they're online now). Only makes sense for a live trainer's own save —
  // an NPC/Wild Library entry has no client polling for directives, so
  // those are edited directly in their own Library tab instead.
  let giveLevelEntry = null;
  const givePicker = makeSavedMonPicker({
    title: "Give Levels To…", defaultSource: "player",
    onPick: (mon, entry) => { giveLevelEntry = entry; giveLevelInput.value = mon.level || 5; },
  });
  const giveLevelInput = el("input", { type: "number", min: "1", max: "100", value: "5" });
  const givePlusOneBtn = el("button", { class: "btn secondary" }, "▲ +1 Level");
  const giveSetLevelBtn = el("button", { class: "btn" }, "Give Levels");
  const giveLevelOut = el("div", { class: "formula-note" }, "");
  async function giveLevel(newLevel) {
    if (!giveLevelEntry?.mon) { giveLevelOut.textContent = "Pick a Pokémon first."; return; }
    if (giveLevelEntry.sourceKind !== "player" && giveLevelEntry.sourceKind !== "team") {
      giveLevelOut.textContent = "NPCs and Wild Pokémon can have their level edited directly in their Library entry instead.";
      return;
    }
    const level = Math.min(100, Math.max(1, Number(newLevel) || giveLevelEntry.mon.level || 1));
    await dmAction(token, "giveLevel", {
      targetId: giveLevelEntry.sourceId, monId: giveLevelEntry.mon.id, level,
      trainerName: giveLevelEntry.sourceLabel, monName: giveLevelEntry.mon.nickname || giveLevelEntry.mon.name,
    });
    giveLevelInput.value = level;
    // Levels can't land mid-fight (see js/battleGate.js) — let the DM know
    // which case they're in instead of always saying the same thing.
    const ft = await getFullTurn();
    const midBattle = monIsLiveCombatant(ft, giveLevelEntry.sourceId, giveLevelEntry.mon.id);
    giveLevelOut.textContent = midBattle
      ? `Queued — ${giveLevelEntry.sourceLabel}'s ${giveLevelEntry.mon.nickname || giveLevelEntry.mon.name} is mid-battle, so this'll apply once the encounter ends.`
      : `Queued — ${giveLevelEntry.sourceLabel}'s ${giveLevelEntry.mon.nickname || giveLevelEntry.mon.name} will be Level ${level}.`;
  }
  givePlusOneBtn.addEventListener("click", () => giveLevel((Number(giveLevelInput.value) || giveLevelEntry?.mon.level || 1) + 1));
  giveSetLevelBtn.addEventListener("click", () => giveLevel(giveLevelInput.value));

  const giveItemTrainerSelect = el("select", {}, [el("option", { value: "" }, "Loading trainers…")]);
  async function refreshGiveItemTrainers() {
    const trainers = await listTrainers("");
    giveItemTrainerSelect.innerHTML = "";
    if (!trainers.length) { giveItemTrainerSelect.appendChild(el("option", { value: "" }, "No trainers online")); return; }
    trainers.forEach((t) => giveItemTrainerSelect.appendChild(el("option", { value: t.id }, t.name)));
  }
  refreshGiveItemTrainers();
  const refreshGiveItemBtn = el("button", { class: "btn secondary" }, "Refresh");
  refreshGiveItemBtn.addEventListener("click", refreshGiveItemTrainers);
  const giveItemAllNames = [
    ...BALL_TYPES, ...HEAL_ITEMS.map((h) => h.name), ...STATUS_HEAL_ITEMS.map((h) => h.name),
    ...state.items.map((it) => it.name), ...tmMoveNames(state).map((m) => tmName(m)),
  ];
  const giveItemCombo = makeCombo({ options: giveItemAllNames, placeholder: "Search items, or type anything else for a Key Item…" });
  const giveItemQty = el("input", { type: "number", min: "1", value: "1", style: "max-width:90px" });
  const giveItemBtn = el("button", { class: "btn" }, "Give Item");
  const giveItemOut = el("div", { class: "formula-note" }, "");
  giveItemBtn.addEventListener("click", async () => {
    const name = giveItemCombo.inputEl.value.trim();
    const qty = Math.max(1, Number(giveItemQty.value) || 1);
    const trainerId = giveItemTrainerSelect.value;
    const trainerName = giveItemTrainerSelect.selectedOptions[0]?.textContent || "A trainer";
    if (!name || !trainerId) { giveItemOut.textContent = "Pick a trainer and an item first."; return; }
    await dmAction(token, "giveItem", { targetId: trainerId, name, qty, trainerName });
    giveItemOut.textContent = `Queued — ${qty}× ${name} sent to ${trainerName}.`;
    giveItemCombo.setValue(""); giveItemQty.value = "1";
  });

  body.appendChild(el("div", { class: "grid-2" }, [
    el("div", { class: "card" }, [
      el("h4", {}, "Give: Levels"),
      givePicker,
      el("div", { class: "grid-3" }, [field("Level", giveLevelInput), givePlusOneBtn, giveSetLevelBtn]),
      giveLevelOut,
    ]),
    el("div", { class: "card" }, [
      el("h4", {}, "Give: Item"),
      el("div", { class: "grid-2" }, [field("Trainer", giveItemTrainerSelect), refreshGiveItemBtn]),
      el("div", { class: "grid-2" }, [field("Item", giveItemCombo), field("Qty", giveItemQty)]),
      giveItemBtn,
      giveItemOut,
    ]),
  ]));

  // --- Personal note (any online trainer, not just Combatant A) + direct battle log post ---
  const noteRecipientSelect = el("select", {}, [el("option", { value: "" }, "Loading trainers…")]);
  async function refreshNoteRecipients() {
    const trainers = await listTrainers("");
    noteRecipientSelect.innerHTML = "";
    if (!trainers.length) { noteRecipientSelect.appendChild(el("option", { value: "" }, "No trainers online")); return; }
    trainers.forEach((t) => noteRecipientSelect.appendChild(el("option", { value: t.id }, t.name)));
  }
  refreshNoteRecipients();
  const refreshRecipientsBtn = el("button", { class: "btn secondary" }, "Refresh");
  refreshRecipientsBtn.addEventListener("click", refreshNoteRecipients);
  const noteText = el("input", { type: "text", placeholder: "e.g. You find a Rare Candy under a rock." });
  const noteBtn = el("button", { class: "btn secondary" }, "Send Note");
  noteBtn.addEventListener("click", async () => {
    if (!noteRecipientSelect.value || !noteText.value.trim()) return;
    await dmAction(token, "personalNote", { targetId: noteRecipientSelect.value, text: noteText.value.trim() });
    noteText.value = ""; noteBtn.textContent = "Sent ✓"; setTimeout(() => { noteBtn.textContent = "Send Note"; }, 1200);
  });

  const logText = el("input", { type: "text", placeholder: "Narrate something for everyone…" });
  const logBtn = el("button", { class: "btn secondary" }, "Post to Battle Log");
  logBtn.addEventListener("click", async () => {
    if (!logText.value.trim()) return;
    await postBattleLog("Dungeon Master", logText.value.trim());
    logText.value = "";
  });

  body.appendChild(el("div", { class: "grid-2" }, [
    el("div", { class: "card" }, [
      el("h4", {}, "Personal Note (private, goes to My Log)"),
      el("div", { class: "grid-2" }, [field("Recipient", noteRecipientSelect), refreshRecipientsBtn]),
      field("Note", noteText), noteBtn,
    ]),
    el("div", { class: "card" }, [el("h4", {}, "Battle Log (visible to everyone)"), field("Entry", logText), logBtn]),
  ]));
}

// ---------------- NPC Trainer Library ----------------

async function renderNpcLibrary(body, state, token) {
  body.innerHTML = "";
  body.appendChild(el("h4", {}, "NPC Trainer Library"));
  const addBtn = el("button", { class: "btn" }, "+ New NPC Trainer");
  body.appendChild(addBtn);
  const listWrap = el("div", { style: "margin-top:10px" });
  body.appendChild(listWrap);

  async function refresh() {
    const npcs = await getNpcs();
    listWrap.innerHTML = "";
    if (!npcs.length) { listWrap.appendChild(el("p", { class: "view-sub" }, "No NPCs saved yet.")); return; }
    for (const n of npcs) {
      const full = await getNpc(n.id);
      if (full) listWrap.appendChild(npcCard(n.id, full, state, token, refresh));
    }
  }
  addBtn.addEventListener("click", async () => { await dmAction(token, "npcSave", { npcId: null, name: "New NPC", team: { party: [] } }); refresh(); });
  refresh();
}

function npcCard(npcId, data, state, token, onChange) {
  const nameInput = el("input", { type: "text", value: data.name });
  let sprite = data.sprite || "";
  const spritePicker = makeTrainerSpritePicker({ initial: sprite, onSelect: (file) => { sprite = file; } });
  const party = data.team.party || [];
  const monsWrap = el("div");
  function renderMons() {
    monsWrap.innerHTML = "";
    party.forEach((mon, i) => monsWrap.appendChild(monFieldsRow(mon, state, () => { party.splice(i, 1); renderMons(); })));
  }
  renderMons();
  const addMonBtn = el("button", { class: "btn secondary" }, "+ Add Pokémon");
  addMonBtn.addEventListener("click", () => { party.push(newMon()); renderMons(); });
  const saveBtn = el("button", { class: "btn" }, "Save NPC");
  saveBtn.addEventListener("click", async () => {
    await dmAction(token, "npcSave", { npcId, name: nameInput.value, team: { party }, sprite });
    saveBtn.textContent = "Saved ✓"; setTimeout(() => { saveBtn.textContent = "Save NPC"; }, 1000);
  });
  const deleteBtn = el("button", { class: "btn secondary" }, "Delete NPC");
  deleteBtn.addEventListener("click", async () => {
    if (!confirm(`Delete NPC "${data.name}"? This can't be undone.`)) return;
    await dmAction(token, "npcDelete", { npcId });
    onChange();
  });

  // ---------------- Import / Export (same Showdown-style text as My Team) ----------------
  const exportBox = el("textarea", { rows: "6", spellcheck: "false", style: "width:100%;font-family:monospace;font-size:12px;resize:vertical;padding:6px 8px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--text);" });
  const exportBtn = el("button", { class: "btn secondary" }, "Export to Box");
  const copyBtn = el("button", { class: "btn secondary" }, "Copy");
  const importMsg = el("span", { class: "view-sub" }, "");
  const importReplaceBtn = el("button", { class: "btn secondary" }, "Import (replace party)");
  const importAddBtn = el("button", { class: "btn secondary" }, "Import (add to party)");
  exportBtn.addEventListener("click", () => { exportBox.value = npcToText({ name: nameInput.value, team: { party } }); });
  copyBtn.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(exportBox.value); copyBtn.textContent = "Copied ✓"; }
    catch { exportBox.select(); copyBtn.textContent = "Select-all — copy manually"; }
    setTimeout(() => { copyBtn.textContent = "Copy"; }, 1500);
  });
  function doNpcImport(replace) {
    const raw = exportBox.value.trim();
    const { name, party: mons, unrecognizedCount } = raw.startsWith("===") ? parseNpcText(state, raw) : { ...parseTeamText(state, raw), name: "" };
    if (!mons.length) { importMsg.textContent = "Nothing recognized in the box above."; return; }
    if (name) nameInput.value = name;
    if (replace) party.length = 0;
    party.push(...mons);
    renderMons();
    importMsg.textContent = `Imported ${mons.length}${unrecognizedCount ? ` (${unrecognizedCount} unrecognized species — check their names)` : ""}. Remember to Save NPC.`;
  }
  importReplaceBtn.addEventListener("click", () => doNpcImport(true));
  importAddBtn.addEventListener("click", () => doNpcImport(false));

  return el("div", { class: "card" }, [
    el("div", { class: "grid-3" }, [field("NPC Name", nameInput), saveBtn, deleteBtn]),
    field("Portrait", spritePicker),
    monsWrap,
    addMonBtn,
    el("h4", { style: "margin-top:14px" }, "Import / Export"),
    exportBox,
    el("div", { class: "grid-3" }, [exportBtn, copyBtn, importMsg]),
    el("div", { class: "grid-2" }, [importReplaceBtn, importAddBtn]),
  ]);
}

// ---------------- Wild Pokémon Library ----------------

async function renderWildLibrary(body, state, token) {
  body.innerHTML = "";
  body.appendChild(el("h4", {}, "Wild Pokémon Library"));
  const addBtn = el("button", { class: "btn" }, "+ New Wild Pokémon");
  body.appendChild(addBtn);
  const listWrap = el("div", { style: "margin-top:10px" });
  body.appendChild(listWrap);

  async function refresh() {
    const list = await getWildList();
    listWrap.innerHTML = "";
    if (!list.length) { listWrap.appendChild(el("p", { class: "view-sub" }, "No wild Pokémon saved yet.")); return; }
    for (const w of list) {
      const full = await getWildMon(w.id);
      if (full) listWrap.appendChild(wildCard(w.id, full, state, token, refresh));
    }
  }
  addBtn.addEventListener("click", async () => { await dmAction(token, "wildSave", { wildId: null, mon: newMon() }); refresh(); });
  refresh();
}

function wildCard(wildId, mon, state, token, onChange) {
  const row = monFieldsRow(mon, state, null);
  const saveBtn = el("button", { class: "btn" }, "Save");
  saveBtn.addEventListener("click", async () => {
    await dmAction(token, "wildSave", { wildId, mon });
    saveBtn.textContent = "Saved ✓"; setTimeout(() => { saveBtn.textContent = "Save"; }, 1000);
  });
  const deleteBtn = el("button", { class: "btn secondary" }, "Delete");
  deleteBtn.addEventListener("click", async () => {
    if (!confirm("Delete this wild Pokémon? This can't be undone.")) return;
    await dmAction(token, "wildDelete", { wildId });
    onChange();
  });
  return el("div", { class: "card" }, [row, el("div", { class: "grid-2" }, [saveBtn, deleteBtn])]);
}

// ---------------- Music Board ----------------

async function renderMusicBoard(body, token) {
  body.innerHTML = "";
  body.appendChild(el("h4", {}, "Music Board"));

  const grid = el("div", { class: "grid-3" });
  body.appendChild(grid);

  const slots = await getMusicSlots();
  slots.forEach((slot, i) => {
    const labelInput = el("input", { type: "text", value: slot.label, placeholder: `Slot ${i + 1}` });
    const urlInput = el("input", { type: "text", value: slot.url, placeholder: "YouTube URL" });
    const saveBtn = el("button", { class: "btn secondary" }, "Save");
    const playBtn = el("button", { class: "btn" }, "▶ Play");
    saveBtn.addEventListener("click", async () => {
      await dmAction(token, "musicSlot", { index: i, label: labelInput.value, url: urlInput.value });
      saveBtn.textContent = "Saved ✓"; setTimeout(() => { saveBtn.textContent = "Save"; }, 1000);
    });
    playBtn.addEventListener("click", () => { if (urlInput.value) window.open(urlInput.value, "_blank", "noopener"); });
    grid.appendChild(el("div", { class: "card" }, [
      labelInput, urlInput,
      el("div", { class: "grid-2", style: "margin-top:8px" }, [saveBtn, playBtn]),
    ]));
  });
}

// ---------------- Sound Effects ----------------

async function renderSoundEffects(body) {
  body.innerHTML = "";
  body.appendChild(el("h4", {}, "Sound Effects"));

  const refreshBtn = el("button", { class: "btn secondary" }, "Refresh List");
  body.appendChild(refreshBtn);
  const grid = el("div", { class: "grid-3", style: "margin-top:10px" });
  body.appendChild(grid);

  async function refresh() {
    const files = await getSfxFiles();
    grid.innerHTML = "";
    if (!files.length) {
      grid.appendChild(el("p", { class: "view-sub" }, "This campaign has no sound effects. The server owner can add .mp3 files for it."));
      return;
    }
    files.forEach((f) => {
      let audio = null; // fetched on first press, then reused
      const playBtn = el("button", { class: "btn" }, `▶ ${f.replace(/\.mp3$/i, "")}`);
      playBtn.addEventListener("click", async () => {
        if (!audio) {
          const url = await getSfxBlobUrl(f);
          if (!url) return;
          audio = new Audio(url);
        }
        audio.currentTime = 0;
        audio.play();
      });
      grid.appendChild(el("div", { class: "card" }, [playBtn]));
    });
  }
  refreshBtn.addEventListener("click", refresh);
  refresh();
}
