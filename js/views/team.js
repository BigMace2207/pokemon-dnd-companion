import { el, field, makeCombo, typePill, statBars } from "../components.js";
import { calcAllStats } from "../calc.js";
import { STATUS_OPTIONS } from "../statusEffects.js";
import { loadSave, writeSave, newMon } from "../storage.js";
import { addLogEntry } from "../log.js";
import { spriteImg } from "../sprites.js";
import { handleLevelUp, learnableMoveNames } from "../levelUp.js";
import { teamToText, parseTeamText } from "../teamExport.js";
import { getViewState, setViewState } from "../viewState.js";
import { goToPokemon, goToStatCalc } from "../navState.js";
import { getFullTurn } from "../network.js";
import { monIsLiveCombatant } from "../battleGate.js";

// Persistent party (max 6) + PC box, saved to this browser's localStorage.
// Nothing here is shared reference data like the rest of the app — it's
// your save file, so it only exists on this device/browser until you
// build the same team again elsewhere.

export function renderTeam(container, state) {
  container.innerHTML = "";
  container.appendChild(el("h1", { class: "view-title" }, "My Team"));

  let save = loadSave();
  const pokemonNames = state.pokemon.map((p) => p.name);
  // Which mon cards currently have their stat breakdown expanded — kept
  // in viewState so it survives both the re-render every edit triggers AND
  // navigating away and back to this page.
  const statsOpenIds = new Set(getViewState("team:statsOpen", []));
  function persistStatsOpen() { setViewState("team:statsOpen", [...statsOpenIds]); }
  // On phones each card is long, so its details (species, HP, moves...) start
  // hidden behind a per-Pokémon Show/Hide button; desktop always shows them.
  const detailsOpenIds = new Set(getViewState("team:detailsOpen", []));
  function persistDetailsOpen() { setViewState("team:detailsOpen", [...detailsOpenIds]); }

  const partySection = el("div", { class: "card-grid" });
  const pcSection = el("div", { class: "card-grid" });
  container.appendChild(el("h4", {}, `Active Party (${save.party.length}/6)`));
  container.appendChild(partySection);
  container.appendChild(el("div", { class: "grid-2" }, [
    el("button", { class: "btn", onclick: () => { if (save.party.length < 6) { save.party.push(newMon()); persist(); } } }, "+ Add to Party"),
    el("button", { class: "btn secondary", onclick: () => { save.pc.push(newMon()); persist(); } }, "+ Add to PC"),
  ]));
  container.appendChild(el("h4", {}, `PC Box (${save.pc.length})`));
  container.appendChild(pcSection);

  // ---------------- Import / Export (Pokémon Showdown-style text) ----------------
  const exportBox = el("textarea", { rows: "8", spellcheck: "false", style: "width:100%;font-family:monospace;font-size:12.5px;resize:vertical;padding:8px 10px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--text);" });
  const exportBtn = el("button", { class: "btn secondary" }, "Export Party to Box Below");
  const copyBtn = el("button", { class: "btn secondary" }, "Copy");
  const importMsg = el("span", { class: "view-sub" }, "");
  const importReplaceBtn = el("button", { class: "btn" }, "Import (replace party)");
  const importAddBtn = el("button", { class: "btn secondary" }, "Import (add to party)");

  exportBtn.addEventListener("click", () => { exportBox.value = teamToText(save.party); });
  copyBtn.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(exportBox.value); copyBtn.textContent = "Copied ✓"; }
    catch { exportBox.select(); copyBtn.textContent = "Select-all — copy manually"; }
    setTimeout(() => { copyBtn.textContent = "Copy"; }, 1500);
  });
  function doImport(replace) {
    const { mons, unrecognizedCount } = parseTeamText(state, exportBox.value);
    if (!mons.length) { importMsg.textContent = "Nothing recognized in the box above."; return; }
    const room = 6 - (replace ? 0 : save.party.length);
    const toAdd = mons.slice(0, Math.max(0, room));
    if (replace) save.party = toAdd;
    else save.party.push(...toAdd);
    addLogEntry(`Imported ${toAdd.length} Pokémon${replace ? " (replaced party)" : ""}.`);
    importMsg.textContent = `Imported ${toAdd.length} of ${mons.length}${mons.length > toAdd.length ? " (party is full — rest left out)" : ""}${unrecognizedCount ? `. ${unrecognizedCount} weren't recognized species — check their names.` : "."}`;
    persist();
  }
  importReplaceBtn.addEventListener("click", () => {
    if (!confirm("Replace your whole active party with what's in the box? PC box is untouched.")) return;
    doImport(true);
  });
  importAddBtn.addEventListener("click", () => doImport(false));

  container.appendChild(el("div", { class: "card" }, [
    el("h4", {}, "Import / Export"),
    exportBox,
    el("div", { class: "grid-3" }, [exportBtn, copyBtn, importMsg]),
    el("div", { class: "grid-2" }, [importReplaceBtn, importAddBtn]),
  ]));

  function persist() {
    writeSave(save);
    render();
  }

  function abilityChoicesFor(speciesName) {
    const p = state.pokemonByName.get(speciesName);
    if (!p) return [];
    return [p.ability1, p.ability2, p.hiddenAbility].filter(Boolean);
  }

  function monCard(mon, list, index, isParty) {
    const species = state.pokemonByName.get(mon.name);
    const level = Math.min(100, Math.max(1, Number(mon.level) || 1));
    const maxHp = species ? calcAllStats(species, level, 15, 0, 1).hp : null;
    if (mon.currentHp === null && maxHp !== null) mon.currentHp = maxHp;

    const speciesCombo = makeCombo({
      options: pokemonNames, initial: mon.name, placeholder: "Pick a species…",
      onSelect: (n) => {
        mon.name = n; mon.dex = state.pokemonByName.get(n)?.dex ?? null; mon.ability = ""; mon.currentHp = null;
        addLogEntry(`${mon.nickname || n} joined your ${isParty ? "party" : "PC box"} as a ${n}.`);
        persist();
      },
    });
    const nicknameInput = el("input", { type: "text", value: mon.nickname, placeholder: "Nickname (optional)" });
    nicknameInput.addEventListener("input", () => { mon.nickname = nicknameInput.value; writeSave(save); });
    const hpLabel = el("span", {}, `Current HP${maxHp !== null ? ` / ${maxHp}` : ""}`);
    const hpInput = el("input", { type: "number", min: "0", value: mon.currentHp ?? "" });
    let hpBeforeEdit = mon.currentHp;
    hpInput.addEventListener("focus", () => { hpBeforeEdit = mon.currentHp; });
    hpInput.addEventListener("input", () => { mon.currentHp = Number(hpInput.value) || 0; writeSave(save); });
    hpInput.addEventListener("blur", () => {
      if (mon.currentHp !== hpBeforeEdit) addLogEntry(`${mon.nickname || mon.name}'s HP: ${hpBeforeEdit} → ${mon.currentHp}.`);
    });
    const levelInput = el("input", { type: "number", min: "1", max: "100", value: String(mon.level) });
    let levelBeforeEdit = mon.level;
    levelInput.addEventListener("focus", () => { levelBeforeEdit = mon.level; });
    levelInput.addEventListener("blur", async () => {
      if (mon.level === levelBeforeEdit) return;
      if (mon.level > levelBeforeEdit) {
        const target = mon.level;
        const ft = await getFullTurn();
        if (monIsLiveCombatant(ft, save.networkId, mon.id)) {
          // Can't land mid-battle — revert the visible level and hold the
          // target on the mon itself; app.js's directive poll (running
          // regardless of which page is open) applies it automatically
          // once the fight's over.
          mon.level = levelBeforeEdit;
          mon.queuedLevel = target;
          addLogEntry(`${mon.nickname || mon.name}'s level-up to ${target} can't land mid-battle — queued until the encounter ends.`);
          writeSave(save);
          render();
          return;
        }
        addLogEntry(`${mon.nickname || mon.name} is now Level ${mon.level} (was ${levelBeforeEdit}).`);
        await handleLevelUp(state, mon, levelBeforeEdit, mon.level);
        writeSave(save);
        render();
        return;
      }
      addLogEntry(`${mon.nickname || mon.name} is now Level ${mon.level} (was ${levelBeforeEdit}).`);
    });
    // Avoid a full card rebuild (and losing focus) on every keystroke —
    // just recompute Max HP and update the label + HP field in place.
    levelInput.addEventListener("input", () => {
      mon.level = Number(levelInput.value) || 1;
      writeSave(save);
      const sp = state.pokemonByName.get(mon.name);
      if (!sp) return;
      const newMax = calcAllStats(sp, Math.min(100, Math.max(1, mon.level)), 15, 0, 1).hp;
      hpLabel.textContent = `Current HP / ${newMax}`;
      if (mon.currentHp === null || mon.currentHp > newMax) { mon.currentHp = newMax; hpInput.value = newMax; writeSave(save); }
    });
    const itemCombo = makeCombo({ options: state.items.map((it) => it.name), initial: mon.item, placeholder: "Held item (optional)", onSelect: (n) => { mon.item = n; writeSave(save); } });
    itemCombo.inputEl.addEventListener("input", () => { mon.item = itemCombo.inputEl.value; writeSave(save); });
    const abilitySelect = el("select", {}, [el("option", { value: "" }, "None"), ...abilityChoicesFor(mon.name).map((a) => el("option", { value: a }, a))]);
    abilitySelect.value = mon.ability || "";
    abilitySelect.addEventListener("input", () => { mon.ability = abilitySelect.value; writeSave(save); });
    const statusSelect = el("select", {}, STATUS_OPTIONS.map((s) => el("option", { value: s }, s)));
    statusSelect.value = mon.status || "None";
    statusSelect.addEventListener("input", () => { mon.status = statusSelect.value; writeSave(save); });

    // Restricted to moves this species can actually know at its current
    // level (level-up moves gated by level, TM/Egg/Tutor moves always
    // available) rather than the entire move list — see learnableMoveNames.
    const monMoveNames = learnableMoveNames(state, mon);
    const moveCombos = mon.moves.map((mv, i) => {
      const combo = makeCombo({ options: monMoveNames, initial: mv, placeholder: `Move ${i + 1}`, onSelect: (n) => { mon.moves[i] = n; writeSave(save); } });
      combo.inputEl.addEventListener("blur", () => { mon.moves[i] = combo.inputEl.value; writeSave(save); });
      return combo;
    });

    // Fixed two-row header: identity on top, the action buttons together on
    // the row below -- always, so every card lines up the same way instead of
    // the buttons wrapping next to the name or under it depending on how long
    // the name and type pills happen to be.
    const identity = el("div", { class: "detail-header" }, [
      species ? spriteImg(species.dex, { back: false, alt: mon.name, className: "dex-sprite" }) : null,
      el("span", { class: "name" }, mon.nickname || mon.name || "New Pokémon"),
      species ? el("span", {}, [typePill(species.type1), species.type2 ? typePill(species.type2) : null].filter(Boolean)) : null,
    ].filter(Boolean));
    const actions = el("div", { class: "mon-actions" }, [
      species ? el("button", { class: "btn secondary", onclick: () => goToPokemon(mon.name) }, "View in Pokédex") : null,
      species ? el("button", { class: "btn secondary", onclick: () => goToStatCalc(mon.name, mon.level) }, "View in Stat Calculator") : null,
      el("button", {
        class: "btn secondary",
        onclick: () => { addLogEntry(`Removed ${mon.nickname || mon.name || "a Pokémon"}.`); list.splice(index, 1); persist(); },
      }, "Remove"),
      isParty
        ? el("button", { class: "btn secondary", onclick: () => { addLogEntry(`${mon.nickname || mon.name} moved to the PC.`); save.party.splice(index, 1); save.pc.push(mon); persist(); } }, "→ PC")
        : (save.party.length < 6
          ? el("button", { class: "btn secondary", onclick: () => { addLogEntry(`${mon.nickname || mon.name} joined the party.`); save.pc.splice(index, 1); save.party.push(mon); persist(); } }, "→ Party")
          : null),
    ].filter(Boolean));
    const header = el("div", { class: "mon-header" }, [identity, actions]);

    // All-in-one stat check — same formula/assumptions as the Stat
    // Calculator (IV 15, EV 0, neutral nature), right on the card instead
    // of needing to flip to a separate page.
    const statsOpen = statsOpenIds.has(mon.id);
    const statsToggle = el("button", { class: "btn secondary" }, statsOpen ? "▲ Hide Stats" : "▼ Show Stats");
    statsToggle.addEventListener("click", () => {
      if (statsOpen) statsOpenIds.delete(mon.id); else statsOpenIds.add(mon.id);
      persistStatsOpen();
      render();
    });
    const statsBlock = species && statsOpen
      ? el("div", { class: "team-stats-block" }, [
          statBars(calcAllStats(species, level, 15, 0, 1)),
          el("p", { class: "formula-note" }, `At Level ${level}, IV 15 / EV 0 / neutral nature — same assumption as the Stat Calculator. Base Stat Total ${species.total}.`),
        ])
      : null;

    const detailsOpen = detailsOpenIds.has(mon.id);
    const detailsToggle = el("button", { class: "btn secondary mon-details-toggle", "aria-expanded": String(detailsOpen) }, detailsOpen ? "▲ Hide Info" : "▼ Show Info");
    detailsToggle.addEventListener("click", () => {
      if (detailsOpen) detailsOpenIds.delete(mon.id); else detailsOpenIds.add(mon.id);
      persistDetailsOpen();
      render();
    });

    return el("div", { class: "card mon-card" + (detailsOpen ? " details-open" : "") }, [
      header,
      detailsToggle,
      el("div", { class: "mon-details" }, [
      el("div", { class: "grid-3" }, [field("Species", speciesCombo), field("Nickname", nicknameInput), field("Level", levelInput)]),
      mon.queuedLevel != null ? el("p", { class: "formula-note" }, `⏳ Queued: will reach Level ${mon.queuedLevel} once the current battle ends.`) : null,
      el("div", { class: "grid-3" }, [
        el("label", { class: "field" }, [hpLabel, hpInput]),
        field("Ability", abilitySelect),
        field("Status", statusSelect),
      ]),
      field("Held Item", itemCombo),
      el("div", { class: "grid-2" }, [field("Move 1", moveCombos[0]), field("Move 2", moveCombos[1])]),
      el("div", { class: "grid-2" }, [field("Move 3", moveCombos[2]), field("Move 4", moveCombos[3])]),
      species ? statsToggle : null,
      statsBlock,
      ].filter(Boolean)),
    ].filter(Boolean));
  }

  function render() {
    container.querySelector("h4").textContent = `Active Party (${save.party.length}/6)`;
    partySection.innerHTML = "";
    if (!save.party.length) partySection.appendChild(el("p", { class: "view-sub" }, "No Pokémon in your party yet."));
    save.party.forEach((mon, i) => partySection.appendChild(monCard(mon, save.party, i, true)));

    const pcHeader = [...container.querySelectorAll("h4")][1];
    pcHeader.textContent = `PC Box (${save.pc.length})`;
    pcSection.innerHTML = "";
    if (!save.pc.length) pcSection.appendChild(el("p", { class: "view-sub" }, "PC box is empty."));
    save.pc.forEach((mon, i) => pcSection.appendChild(monCard(mon, save.pc, i, false)));
  }

  render();
}
