// The DM's "Full Turn" battle console: one screen to run a whole encounter —
// build the roster from any library (or any online player's team), get the
// same Speed-ordered turn order as the Initiative Tracker, and resolve
// whoever's turn it is with real move buttons, a Bag (Poké Balls + healing
// items), Mega Evolution, and Run — all through the exact same math used
// everywhere else in the app (calc.js) and posting straight to the shared
// Battle Log as it happens.
//
// The roster here is its own thing, separate from the simple shared
// Initiative Tracker battle (js/views/initiative.js + /api/battle) — it
// carries full mon data per combatant (item/ability/status/moves), which
// only the DM needs, so it's saved server-side as STATE.fullTurn via the
// fullTurnSave dmAction and loaded once per visit rather than polled.

import { combatantLabel, ownerName, monName } from "../battleLabels.js";
import { el, field } from "../components.js";
import {
  calcAllStats, checkHit, d20Roll, rollMoveDice, successThreshold,
  catchChance, toCatchStatusBucket, BALL_TYPES,
} from "../calc.js";
import { megaFormFor } from "../data.js";
import { makeSavedMonPicker } from "../savedMonPicker.js";
import { HEAL_ITEMS } from "../battleItems.js";
import { dmAction, postBattleLog, getFullTurn, sendToTrainer, getBackgroundFiles } from "../network.js";
import { computeBattleDamage, moveEffectivenessSummary } from "../battleMath.js";
import { targetKindForMove, resolveSpreadTargets, sideIsDefeated } from "../moveTargeting.js";
import { registerInterval } from "../intervals.js";
import { renderBattleView } from "./battleview.js";
import { loadSave } from "../storage.js";
import { showDiceRollFx } from "../diceRollFx.js";
import { hubSound } from "../hubSound.js";

// The server only distinguishes "online" (has a live client that applies
// directives itself) from "npc"/"wild" (no client — the DM's action IS the
// change). The picker's "team" (DM's own local save, if any) is also a live
// client under its own networkId, so it's "online" too.
function toServerTargetKind(sourceKind) {
  return sourceKind === "npc" || sourceKind === "wild" ? sourceKind : "online";
}

function cloneMon(mon) {
  return JSON.parse(JSON.stringify(mon));
}

// Layout: the battle itself fills the page, seen from the side of whoever's turn it is (the same screen players get; on
// an NPC's or wild Pokémon's turn the DM plays it from there). A bar above it runs the turn (phase, round, who's up,
// Next Turn). Pull-out drawers on the left add combatants, show the roster and set the scene; "DM Control" (bottom
// right) has the full console for anything else: any move, ball or item for whoever's up, Mega Evolution, running.
export function renderFullTurn(container, state, token) {
  container.innerHTML = "";
  container.appendChild(el("h1", { class: "view-title" }, "Battle Control"));
  const bar = el("div", { class: "bc-bar" });
  const stage = el("div", { class: "bc-stage" });
  const rail = el("div", { class: "bc-rail", role: "toolbar", "aria-label": "Battle tools" });
  const shell = el("div", { class: "bc-shell" }, [bar, el("div", { class: "bc-main" }, [rail, stage])]);
  container.appendChild(shell);
  // the drawers: left ones slide over the battle from the rail, DM Control from the right
  const drawers = {};
  let openDrawer = null;
  function makeDrawer(id, title, side = "left") {
    const body = el("div", { class: "bc-drawer-body" });
    const close = el("button", { type: "button", class: "bc-drawer-close", "aria-label": "Close" }, "×");
    close.addEventListener("click", () => toggleDrawer(null));
    const node = el("aside", { class: `bc-drawer ${side}`, "aria-label": title }, [el("div", { class: "bc-drawer-head" }, [el("strong", {}, title), close]), body]);
    shell.append(node);
    drawers[id] = { node, body };
    return body;
  }
  function toggleDrawer(id) {
    openDrawer = openDrawer === id ? null : id;
    for (const [k, d] of Object.entries(drawers)) d.node.classList.toggle("open", k === openDrawer);
    shell.querySelectorAll("[data-drawer]").forEach((b) => b.classList.toggle("on", b.dataset.drawer === openDrawer));
  }
  const railBtn = (id, label, icon) => {
    const b = el("button", { type: "button", class: "bc-rail-btn", "data-drawer": id, title: label }, [el("span", { "aria-hidden": "true" }, icon), el("span", {}, label)]);
    b.addEventListener("click", () => toggleDrawer(id));
    return b;
  };
  const addBody = makeDrawer("add", "Add combatants");
  const rosterBody = makeDrawer("roster", "Roster and turn order");
  const setupBody = makeDrawer("setup", "Battle setup");
  const dmBody = makeDrawer("dm", "DM Control", "right");
  rail.append(railBtn("add", "Add", "＋"), railBtn("roster", "Roster", "☰"), railBtn("setup", "Setup", "⚙"));
  const dmBtn = el("button", { type: "button", class: "bc-dm-btn", "data-drawer": "dm" }, "DM Control");
  dmBtn.addEventListener("click", () => toggleDrawer("dm"));
  shell.append(dmBtn);

  // combatants: [{ id, sourceKind, sourceId, sourceLabel, mon, priority, tiebreak, megaEvolved, megaFrom, side }]
  // side is "A" or "B" — used to sort out enemies vs. allies for the
  // player Battle screen's targeting and for spread moves below.
  let combatants = [];
  let currentIndex = 0;
  let round = 1;
  let targetId = null;
  let background = "";
  let spreadHitsAllies = false;
  // Draft / VS Screen / Live: building/editing the roster (adding
  // combatants, setting sides, picking a background) shouldn't show up on
  // any player's Battle screen until the DM moves past draft. "vs" is a
  // middle step — a Side A vs Side B intro card, no actions available yet —
  // before "live" opens up the real interactive battle screen. See the
  // phase buttons in renderRoundCard() and the gate in battleview.js's poll().
  let phase = "draft"; // "draft" | "vs" | "live"
  let acted = null;     // what the player on turn chose (server-side; cleared when the turn moves on)
  const rolledThrows = new Set();   // a player's ball throw (by when it was made) is only rolled once

  // turnId tells the server (and every player's screen) exactly whose turn it is: the order here is sorted by speed,
  // which only this console can work out.
  async function persist() {
    const turnId = combatants.length ? activeCombatant()?.id || null : null;
    lastRemote = remoteSig({ combatants, currentIndex, round, phase, turnId, acted });
    await dmAction(token, "fullTurnSave", { combatants, currentIndex, round, background, spreadHitsAllies, phase, turnId });
  }

  // Players' moves change HP and record their choice on the server, so this console keeps itself up to date (without
  // this, clicking Next Turn would save over a player's damage with an old copy). It never redraws while you're typing.
  let lastRemote = "";
  const remoteSig = (f) => JSON.stringify([f.combatants?.map((c) => [c.id, c.mon?.currentHp, c.mon?.status, c.mon?.id]), f.currentIndex, f.round, f.phase, f.turnId, f.acted?.combatantId, f.acted?.text]);
  registerInterval(setInterval(async () => {
    if (document.hidden || !document.body.contains(container)) return;
    const remote = await getFullTurn();
    if (!remote || !Array.isArray(remote.combatants)) return;
    const sig = remoteSig(remote);
    if (sig === lastRemote) return;
    if (container.contains(document.activeElement) && /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName)) return;
    lastRemote = sig;
    combatants = remote.combatants; currentIndex = remote.currentIndex || 0; round = remote.round || 1;
    phase = ["draft", "vs", "live"].includes(remote.phase) ? remote.phase : phase;
    acted = remote.acted || null;
    followTurn(remote.turnId);
    render();
  }, 3000));

  // After a switch the order changes (the new Pokémon has its own speed): keep "up now" on whoever holds the turn, or
  // on the Pokémon that came in for them.
  function followTurn(turnId) {
    if (!turnId) return;
    const order = orderedList();
    const holder = order.find((c) => c.id === turnId) || order.find((c) => c.cameInFor === turnId);
    if (holder) currentIndex = order.indexOf(holder);
  }

  function speciesFor(mon) { return state.pokemonByName.get(mon.name); }
  function statsFor(mon) {
    const species = speciesFor(mon);
    if (!species) return null;
    const level = Math.min(100, Math.max(1, Number(mon.level) || 1));
    return { ...species, ...calcAllStats(species, level, 15, 0, 1) };
  }
  function maxHpFor(mon) { return statsFor(mon)?.hp ?? null; }
  function currentHpFor(mon) {
    const max = maxHpFor(mon);
    if (mon.currentHp === null || mon.currentHp === undefined) return max;
    return mon.currentHp;
  }
  function labelFor(c) {
    const mega = c.megaEvolved ? " (Mega)" : "";
    return `${ownerName(c)}: ${monName(c.mon)}${mega}`;
  }

  // The turn order: only Pokémon on the field (a benched one waits until it's switched in or ticked Out in the roster).
  function orderedList() {
    return combatants.filter((c) => !c.benched).sort((a, b) => {
      if (a.priority !== b.priority) return a.priority ? -1 : 1;
      const sa = statsFor(a.mon)?.spe ?? 0, sb = statsFor(b.mon)?.spe ?? 0;
      if (sb !== sa) return sb - sa;
      return (b.tiebreak ?? -1) - (a.tiebreak ?? -1);
    });
  }

  // ---------------- Roster builder ----------------

  addBody.appendChild(makeSavedMonPicker({
    title: "Add Combatant From…",
    defaultSource: "player",
    onPick: (mon, entry) => {
      const species = speciesFor(mon);
      if (!species) { alert(`"${mon.name}" isn't a recognized species — can't add it.`); return; }
      // Default side: players/the DM's own team start on A, NPCs/wild
      // Pokémon on B — the common "trainers vs. the encounter" case. Either
      // side is flippable per-row in the roster table below, since a
      // session might put an NPC ally alongside the players instead.
      const defaultSide = (entry.sourceKind === "npc" || entry.sourceKind === "wild") ? "B" : "A";
      // Players send out one each, so a player's second Pokémon starts on the bench; the other side sends out all of
      // theirs. Either can be changed with the Out box in the roster (or the player picks their lead on the VS screen).
      const isPlayer = entry.sourceKind === "player" || entry.sourceKind === "team";
      const benched = isPlayer && combatants.some((c) => !c.benched && c.sourceKind === entry.sourceKind && c.sourceId === entry.sourceId);
      combatants.push({
        benched,
        id: String(Date.now()) + Math.random(),
        sourceKind: entry.sourceKind, sourceId: entry.sourceId, sourceLabel: entry.sourceLabel,
        mon: cloneMon(mon), priority: false, tiebreak: null, megaEvolved: false, megaFrom: null,
        side: defaultSide,
      });
      persist(); render();
    },
  }));

  const presentationCard = el("div", { class: "card" });
  const setupExtras = el("div", { class: "card" });
  const roundCard = bar;
  const rosterWrap = el("div");
  const turnCard = el("div");
  setupBody.append(presentationCard, setupExtras);
  rosterBody.append(rosterWrap);
  dmBody.append(turnCard);

  function activeCombatant() {
    const order = orderedList();
    if (!order.length) return null;
    if (currentIndex >= order.length) currentIndex = 0;
    // Defensive skip: a fainted combatant shouldn't sit as "up now" just
    // because currentIndex happens to land on them (e.g. a Force a Move
    // kill before their turn came around) — the main round-aware skip on
    // Next Turn above is what normally keeps this from happening at all.
    let idx = currentIndex, steps = 0;
    while (currentHpFor(order[idx].mon) === 0 && steps < order.length) {
      idx = (idx + 1) % order.length;
      steps++;
    }
    currentIndex = idx;
    return order[idx];
  }

  function otherCombatants(exceptId) {
    return combatants.filter((c) => c.id !== exceptId && !c.benched);
  }

  function postLog(text) {
    return postBattleLog("Dungeon Master", text);
  }

  // ---------------- Round controls ----------------

  const PHASE_INFO = {
    draft: { label: "Draft", banner: "DRAFT — not visible to players yet", tone: "neutral" },
    vs: { label: "VS Screen", banner: "VS SCREEN — players see a Side A vs Side B intro card, no actions yet", tone: "neutral" },
    live: { label: "Live", banner: "LIVE — every player can see and act in the full encounter", tone: "good" },
  };

  function renderRoundCard() {
    roundCard.innerHTML = "";
    // Draft → VS Screen → Live: build the roster in private, optionally show everyone the Side A vs Side B intro card,
    // then reveal the real interactive battle screen (the gate in battleview.js's poll()).
    const phases = el("div", { class: "bc-phases", role: "group", "aria-label": "Phase" }, ["draft", "vs", "live"].map((p) => {
      const btn = el("button", { type: "button", class: phase === p ? "on" : "", title: PHASE_INFO[p].banner }, PHASE_INFO[p].label);
      btn.addEventListener("click", () => { phase = p; persist(); render(); });
      return btn;
    }));
    const order = orderedList();
    const up = order.length ? activeCombatant() : null;
    const fainted = (c) => currentHpFor(c.mon) === 0;
    const aDown = sideIsDefeated("A", combatants, fainted), bDown = sideIsDefeated("B", combatants, fainted);
    const info = !order.length ? el("span", { class: "bc-info" }, "No combatants yet: open Add")
      : aDown || bDown ? el("span", { class: `bc-info ${aDown ? "bad" : "good"}` }, aDown ? "DEFEAT: Side A is wiped out" : "VICTORY: Side B is wiped out")
      : el("span", { class: "bc-info" }, [el("b", {}, `Round ${round}`), " · Up now: ", el("b", {}, up ? labelFor(up) : "?")]);
    // A player on turn makes one choice (a move, an item, running, switching or something else); then it's yours.
    const mineToPlay = up && up.sourceId === loadSave().networkId;   // the DM's own trainer: played from the battle screen here
    const theirs = acted && up && (acted.combatantId === up.id || acted.combatantId === up.cameInFor) ? acted : null;
    let rollBtn = null;
    if (theirs?.ball && phase === "live" && !rolledThrows.has(theirs.at)) {
      const target = combatants.find((c) => c.id === theirs.targetId && !c.benched);
      if (target) {
        rollBtn = el("button", { type: "button", class: "btn bc-roll" }, `🎲 Roll the catch`);
        rollBtn.addEventListener("click", async () => { rolledThrows.add(theirs.at); rollBtn.disabled = true; await rollCatch(up, theirs.ball, target); });
      }
    }
    const choice = up && (up.sourceKind === "player" || up.sourceKind === "team") && phase === "live" && !mineToPlay
      ? (theirs ? el("span", { class: "bc-choice done" }, [el("b", {}, "Their choice: "), theirs.text || theirs.kind, rollBtn].filter(Boolean)) : el("span", { class: "bc-choice" }, "Waiting for them to choose…"))
      : null;
    // A player on turn who hasn't chosen yet: Next Turn is greyed out until they do (it can still skip them, after a
    // confirm, so someone who has gone quiet can't hold the battle up).
    const waitingFor = up && (up.sourceKind === "player" || up.sourceKind === "team") && phase === "live" && !mineToPlay && !theirs ? up : null;
    const nextBtn = order.length ? el("button", { type: "button", class: `btn bc-next${waitingFor ? " waiting" : ""}`, "aria-disabled": waitingFor ? "true" : null,
      title: waitingFor ? `Waiting for ${labelFor(waitingFor)} to choose (click to skip their turn)` : "Start the next turn" }, "Next Turn ▶") : null;
    nextBtn?.addEventListener("click", () => {
      if (waitingFor && !confirm(`${labelFor(waitingFor)} hasn't chosen yet. Skip their turn?`)) return;
      combatants.forEach((c) => { delete c.cameInFor; });   // a switch only matters for the turn it happened in
      let steps = 0;
      do {
        currentIndex++;
        if (currentIndex >= order.length) { currentIndex = 0; round++; }
        steps++;
      } while (currentHpFor(order[currentIndex].mon) === 0 && steps < order.length);
      persist(); render();
    });
    roundCard.append(phases, el("span", { class: `bc-phase-note ${PHASE_INFO[phase].tone}` }, PHASE_INFO[phase].label === "Live" ? "Players can act" : phase === "vs" ? "Players see the intro" : "Hidden from players"), info, ...[choice, nextBtn].filter(Boolean));

    // the rest lives in Setup
    setupExtras.innerHTML = "";
    const clearLogBtn = el("button", { class: "btn secondary" }, "Clear Battle Log");
    clearLogBtn.addEventListener("click", async () => {
      if (!confirm("Clear the shared Battle Log for everyone? This can't be undone.")) return;
      await dmAction(token, "battleLogClear", {});
    });
    const resetBtn = el("button", { class: "btn secondary" }, "New Round (reset order)");
    resetBtn.addEventListener("click", () => { currentIndex = 0; round = 1; combatants.forEach((c) => { c.tiebreak = null; }); persist(); render(); });
    const endBtn = el("button", { class: "btn secondary" }, "End Encounter (clear all)");
    endBtn.addEventListener("click", () => {
      if (!confirm("Clear the whole roster? This can't be undone.")) return;
      combatants = []; currentIndex = 0; round = 1; targetId = null; phase = "draft"; persist(); render();
    });
    setupExtras.append(el("h4", {}, "Encounter"), el("div", { class: "bc-stack" }, [resetBtn, endBtn, clearLogBtn]));
  }

  // ---------------- Roster table ----------------

  function renderRoster() {
    rosterWrap.innerHTML = "";
    const onField = orderedList();
    const order = [...onField, ...combatants.filter((c) => c.benched)];
    if (!order.length) {
      rosterWrap.appendChild(el("p", { class: "view-sub" }, "No combatants yet — add some above."));
      return;
    }
    const table = el("table", { class: "data-table" }, [
      el("thead", {}, el("tr", {}, ["#", "Out", "Combatant", "Side", "Speed", "HP", "Status", "Priority", "Tiebreak", ""].map((h) => el("th", {}, h)))),
      el("tbody", {}, order.map((c, i) => {
        // Out: on the field (taking turns) or waiting on the bench
        const outCheck = el("input", { type: "checkbox", "aria-label": `${labelFor(c)} is out on the field`, title: "On the field (untick to put it on the bench)" });
        outCheck.checked = !c.benched;
        outCheck.style.width = "auto";
        outCheck.addEventListener("change", () => {
          const up = activeCombatant()?.id;
          c.benched = !outCheck.checked; delete c.cameInFor;
          followTurn(up);
          persist(); render();
        });
        const stats = statsFor(c.mon);
        const sideSelect = el("select", { class: "bc-side-select", "aria-label": "Side" }, [
          el("option", { value: "A" }, "Side A"),
          el("option", { value: "B" }, "Side B"),
        ]);
        // el() sets any non-null attribute value via setAttribute, and
        // "selected" is a boolean HTML attribute — present at all (even as
        // selected="false") means selected, so it must be set imperatively
        // via the property instead of passed through el()'s attrs (same
        // gotcha as the "disabled" battle-party-btn in battleview.js).
        sideSelect.value = c.side === "B" ? "B" : "A";
        sideSelect.addEventListener("change", () => { c.side = sideSelect.value; persist(); render(); });
        const priorityCheck = el("input", { type: "checkbox" });
        priorityCheck.checked = c.priority;
        priorityCheck.style.width = "auto";
        priorityCheck.addEventListener("input", () => { c.priority = priorityCheck.checked; persist(); render(); });
        const tieBtn = el("button", { class: "btn secondary bc-tie-btn" }, c.tiebreak != null ? `d20: ${c.tiebreak}` : "Roll tiebreak");
        tieBtn.addEventListener("click", () => { c.tiebreak = d20Roll(); persist(); render(); });
        const removeBtn = el("button", { class: "btn secondary" }, "✕");
        removeBtn.addEventListener("click", () => {
          combatants = combatants.filter((x) => x.id !== c.id);
          if (targetId === c.id) targetId = null;
          persist(); render();
        });
        const hp = currentHpFor(c.mon);
        const max = maxHpFor(c.mon);
        return el("tr", { class: c.benched ? "benched" : i === currentIndex ? "hi" : "" }, [
          el("td", {}, c.benched ? "–" : String(i + 1)),
          el("td", {}, outCheck),
          el("td", {}, labelFor(c)),
          el("td", {}, sideSelect),
          el("td", {}, String(stats?.spe ?? "?")),
          el("td", {}, `${hp ?? "?"} / ${max ?? "?"}${hp === 0 ? " (fainted)" : ""}`),
          el("td", {}, c.mon.status || "None"),
          el("td", {}, priorityCheck),
          el("td", {}, tieBtn),
          el("td", {}, removeBtn),
        ]);
      })),
    ]);
    rosterWrap.appendChild(el("div", { class: "table-wrap" }, [table]));
  }

  // ---------------- Presentation: background + spread-hits-allies ----------------

  async function renderPresentationCard() {
    presentationCard.innerHTML = "";
    presentationCard.appendChild(el("h4", {}, "Battle Presentation"));
    const bgSelect = el("select", {}, [el("option", { value: "" }, "Loading…")]);
    const files = await getBackgroundFiles();
    bgSelect.innerHTML = "";
    bgSelect.appendChild(el("option", { value: "" }, "None (default gradient)"));
    files.forEach((f) => bgSelect.appendChild(el("option", { value: f }, f.replace(/\.png$/i, "").replace(/_/g, " "))));
    bgSelect.value = files.includes(background) ? background : "";
    bgSelect.addEventListener("change", () => { background = bgSelect.value; persist().then(() => battle?.refresh()); });

    const alliesCheck = el("input", { type: "checkbox" });
    alliesCheck.checked = spreadHitsAllies;
    alliesCheck.style.width = "auto";
    alliesCheck.addEventListener("input", () => { spreadHitsAllies = alliesCheck.checked; persist(); });

    presentationCard.appendChild(el("div", { class: "grid-2" }, [
      field("Battle Background (shown on every player's Battle screen)", bgSelect),
      field("Spread moves (Earthquake, Surf, Discharge, ...) also hit allies — depends on table positioning", alliesCheck),
    ]));
  }

  // ---------------- The battle, seen as whoever's turn it is ----------------
  // The same screen players get (renderBattleView), in its DM mode: on an NPC's or wild Pokémon's turn the DM picks the
  // move from it, and the result lands here (dmSubmit); on a player's turn it shows what they're choosing.
  async function dmSubmit({ combatants: next, logTexts }) {
    const turnBefore = activeCombatant()?.id || null;
    for (const n of next || []) {
      const c = combatants.find((x) => x.id === n.id);
      // a switch from the battle screen: who's on the field and who's on the bench
      if (c && !!n.benched !== !!c.benched) { c.benched = !!n.benched; if (n.cameInFor) c.cameInFor = n.cameInFor; else delete c.cameInFor; }
      if (!c || n.mon?.currentHp === c.mon.currentHp || n.mon?.currentHp === undefined) continue;
      c.mon.currentHp = n.mon.currentHp;
      // reaches a player's own save, or the NPC / wild library entry, without a second log line
      await dmAction(token, "setHp", { targetId: c.sourceId, targetKind: toServerTargetKind(c.sourceKind), monId: c.mon.id, absolute: c.mon.currentHp, delta: null, inBattle: false });
    }
    for (const t of logTexts || []) await postLog(t);
    followTurn(turnBefore);
    await persist();
    render();
  }
  // ---------------- Catching: a d20 roll on the screen, the chance from the Pokémon's catch rate, HP, level, status
  // and the ball (js/calc.js catchChance). Used by DM Control's ball buttons, the DM's own throws on the battle screen
  // and a player's throw (their BAG choice carries the ball and the target, and the DM rolls it from the top bar).
  async function rollCatch(thrower, ball, target) {
    const species = speciesFor(target.mon);
    if (!species) return "Target's species not recognized.";
    const max = maxHpFor(target.mon) || 1;
    const hpPercent = (currentHpFor(target.mon) / max) * 100;
    const level = Number(target.mon.level) || null;
    const pct = catchChance({ catchRate: species.catchRate, ball, hpPercent, status: toCatchStatusBucket(target.mon.status), mod: 0, level });
    const d20 = d20Roll();
    const caught = ball === "Master Ball" || d20 * 5 > successThreshold(pct);
    const who = `${labelFor(thrower)} threw a ${ball} at ${labelFor(target)}`;
    const text = ball === "Master Ball"
      ? `${who} — AUTOMATIC CATCH!`
      : `${who} (catch ${Math.round(pct)}%: HP ${Math.round(hpPercent)}%, level ${level ?? "?"}, d20 rolled ${d20}) — ${caught ? "CAUGHT!" : "broke free!"}`;
    // the roll on screen: the die tumbles while the ball wobbles, then it clicks shut or pops open
    showDiceRollFx({ label: `${ball} → ${monName(target.mon)} (${Math.round(pct)}%)`, d20, hit: caught, resultText: caught ? "CAUGHT!" : "broke free!" });
    hubSound("ballShake"); setTimeout(() => hubSound("ballShake"), 220); setTimeout(() => hubSound("ballShake"), 440);
    setTimeout(() => hubSound(caught ? "caught" : "breakFree"), 650);
    await postLog(text);
    if (caught) {
      // Only a Wild Library entry actually has something to remove/hand over — catching a trainer's own or an NPC's
      // Pokémon is logged as a roleplay outcome but doesn't seize anything from that library.
      if (target.sourceKind === "wild") {
        await dmAction(token, "wildDelete", { wildId: target.sourceId });
        if (thrower.sourceKind === "npc" || thrower.sourceKind === "player") {
          await sendToTrainer({ fromId: "dm", fromName: "Dungeon Master", toId: thrower.sourceId, type: "pokemon", payload: cloneMon(target.mon) });
        }
      }
      combatants = combatants.filter((c) => c.id !== target.id);
      if (targetId === target.id) targetId = null;
      await persist();
    }
    render();
    return text;
  }

  const battle = renderBattleView(stage, state, { embedded: true, dm: {
    submit: dmSubmit, log: (text) => postLog(text),
    // the DM's own throw on the battle screen (an NPC's or the DM's trainer's turn): rolled here
    throwBall: async (throwerId, ball, targetCombatantId) => {
      const thrower = combatants.find((c) => c.id === throwerId), target = combatants.find((c) => c.id === targetCombatantId);
      return thrower && target ? rollCatch(thrower, ball, target) : "Pick a target first.";
    },
  } });

  // ---------------- Active turn: moves, bag, mega, run ----------------

  // logText flows through to the server's own inBattle auto-log (see
  // setHp/setStatus in server.py) rather than posting a second, separate
  // Battle Log entry for the same action.
  function applyHpChange(c, newHp, logText) {
    const max = maxHpFor(c.mon);
    c.mon.currentHp = Math.max(0, Math.min(max ?? newHp, newHp));
    return dmAction(token, "setHp", {
      targetId: c.sourceId, targetKind: toServerTargetKind(c.sourceKind), monId: c.mon.id,
      absolute: c.mon.currentHp, delta: null, inBattle: true, logText,
      trainerName: ownerName(c), monName: c.mon.nickname || c.mon.name,
    });
  }

  function applyStatusChange(c, status, { inBattle = true } = {}) {
    c.mon.status = status;
    return dmAction(token, "setStatus", {
      targetId: c.sourceId, targetKind: toServerTargetKind(c.sourceKind), monId: c.mon.id, status,
      inBattle, trainerName: ownerName(c), monName: c.mon.nickname || c.mon.name,
    });
  }

  function renderTurnCard() {
    turnCard.innerHTML = "";
    const active = activeCombatant();
    if (!active) return;

    // Self included (at the end, so the default selection stays an
    // opponent) — lets a Pokémon target its own status/healing moves at
    // itself instead of only ever being pickable as someone else's target.
    const targets = [...otherCombatants(active.id), active];
    const targetSelect = el("select", {}, targets.map((c) => el("option", { value: c.id }, c === active ? `${labelFor(c)} (self)` : labelFor(c))));
    if (targetId && targets.some((c) => c.id === targetId)) targetSelect.value = targetId;
    else targetId = targets[0]?.id || null;
    // Re-render (not just update the closure var) so the move buttons'
    // effectiveness labels below immediately reflect the newly picked
    // target instead of going stale until the next unrelated re-render.
    targetSelect.addEventListener("change", () => { targetId = targetSelect.value; renderTurnCard(); });

    function getTarget() { return combatants.find((c) => c.id === targetId) || null; }

    // --- Moves ---
    const moveNames = (active.mon.moves || []).filter(Boolean);
    const moveBtns = moveNames.map((moveName) => {
      const spread = targetKindForMove(moveName) !== "single";
      const move = state.moves[state.moveByName.get(moveName)];
      // Preview against whatever's currently selected in the Target dropdown
      // (or the full spread-target set for a spread move) — informational
      // only, so a "mixed effectiveness" spread doesn't misrepresent a
      // clean super-effective single target as some averaged number.
      const previewTargets = spread ? resolveSpreadTargets(moveName, active, combatants.filter((c) => !c.benched), spreadHitsAllies) : (getTarget() ? [getTarget()] : []);
      const effLabel = move ? moveEffectivenessSummary(state, move, previewTargets.map((t) => speciesFor(t.mon))) : "";
      const label = [spread ? `${moveName} (spread)` : moveName, effLabel ? `— ${effLabel}` : ""].filter(Boolean).join(" ");
      const btn = el("button", { class: "btn" }, label);
      btn.addEventListener("click", () => useMove(active, moveName, getTarget()));
      return btn;
    });

    // --- Mega Evolution ---
    const megaSpecies = !active.megaEvolved ? megaFormFor(state, active.mon.name, active.mon.item) : null;
    const megaBtn = megaSpecies ? el("button", { class: "btn secondary" }, `Mega Evolve → ${megaSpecies.name}`) : null;
    if (megaBtn) megaBtn.addEventListener("click", () => megaEvolve(active, megaSpecies));
    const revertBtn = active.megaEvolved ? el("button", { class: "btn secondary" }, "↩ Revert Mega Evolution") : null;
    if (revertBtn) revertBtn.addEventListener("click", () => revertMega(active));

    // --- Bag: Poké Balls ---
    const ballBtns = BALL_TYPES.map((ball) => {
      const btn = el("button", { class: "btn secondary" }, ball);
      btn.addEventListener("click", () => throwBall(active, ball, getTarget()));
      return btn;
    });

    // --- Bag: healing items ---
    const healBtns = HEAL_ITEMS.map((item) => {
      const btn = el("button", { class: "btn secondary" }, item.name);
      btn.addEventListener("click", () => useHealItem(item, getTarget()));
      return btn;
    });

    // --- Run ---
    const runBtn = el("button", { class: "btn secondary" }, "Attempt to Run");
    runBtn.addEventListener("click", () => attemptRun(active));

    const resultOut = el("div", { class: "formula-note" }, "");
    turnCard.appendChild(el("div", { class: "card bc-act" }, [
      el("p", { class: "view-sub" }, "Act for whoever's up with anything here; the battle view in the middle is the usual way."),
      el("h4", {}, `Turn: ${labelFor(active)}`),
      field("Target", targetSelect),
      el("div", { class: "grid-2" }, [
        el("div", {}, [
          el("h4", {}, "Moves"),
          moveBtns.length ? el("div", { class: "grid-2" }, moveBtns) : el("p", { class: "view-sub" }, "No moves set for this Pokémon — add them in its library entry."),
          [megaBtn, revertBtn].filter(Boolean).length ? el("div", { style: "margin-top:8px" }, [megaBtn, revertBtn].filter(Boolean)) : null,
          el("div", { style: "margin-top:8px" }, runBtn),
        ].filter(Boolean)),
        el("div", {}, [
          el("h4", {}, "Bag: Poké Balls"),
          el("div", { class: "grid-2" }, ballBtns),
          el("h4", { style: "margin-top:10px" }, "Bag: Healing Items"),
          el("div", { class: "grid-2" }, healBtns),
        ]),
      ]),
      resultOut,
    ].filter(Boolean)));

    // target is only used for "single"-target moves (picked from the
    // Target dropdown above) — spread moves (Earthquake, Rock Slide, ...;
    // see js/moveTargeting.js) work out their own target list from sides
    // and the DM's "Spread moves also hit allies" toggle instead.
    async function useMove(attacker, moveName, target) {
      const move = state.moves[state.moveByName.get(moveName)];
      if (!move) { resultOut.textContent = "Unrecognized move."; return; }
      const atkSpecies = speciesFor(attacker.mon);
      if (!atkSpecies) { resultOut.textContent = "Attacker's species not recognized."; return; }

      const kind = targetKindForMove(moveName);
      const rawTargets = kind === "single" ? (target ? [target] : []) : resolveSpreadTargets(moveName, attacker, combatants, spreadHitsAllies);
      if (!rawTargets.length) { resultOut.textContent = kind === "single" ? "Pick a target first." : "No valid targets nearby."; return; }
      const targets = rawTargets.filter((t) => speciesFor(t.mon));
      if (!targets.length) { resultOut.textContent = "Target's species not recognized."; return; }

      const d20 = d20Roll();
      const { hit } = checkHit(move.accuracy, d20);
      if (!hit) {
        const text = `${labelFor(attacker)} used ${moveName} — MISSED (d20 rolled ${d20}).`;
        resultOut.textContent = text;
        await postLog(text);
        return;
      }
      if (move.category === "Status") {
        const text = `${labelFor(attacker)} used ${moveName} (status move — no direct damage).`;
        resultOut.textContent = text;
        await postLog(text);
        render();
        return;
      }

      // One shared accuracy/dice roll for the whole spread hit (same
      // simplification Control Centre's Force a Move already used for a
      // single target) — the item/ability/status modifier pipeline below
      // still runs per-target, so a target's own Levitate/resist berry/etc.
      // still applies correctly even when several Pokémon are hit at once.
      const diceRoll = rollMoveDice(move).total;
      const summaries = [];
      for (const t of targets) {
        const { result } = computeBattleDamage({
          state, move,
          attackerSpecies: atkSpecies, attackerLevel: attacker.mon.level, attackerAbility: attacker.mon.ability,
          attackerItem: attacker.mon.item, attackerStatus: attacker.mon.status, attackerCurrentHp: currentHpFor(attacker.mon),
          defenderSpecies: speciesFor(t.mon), defenderLevel: t.mon.level, defenderAbility: t.mon.ability,
          defenderItem: t.mon.item, defenderStatus: t.mon.status,
          defenderCurrentHp: currentHpFor(t.mon),
          diceRoll,
        });
        const dmg = result.damage;
        const before = currentHpFor(t.mon);
        const after = Math.max(0, before - dmg);
        t.mon.currentHp = after;
        summaries.push(`${labelFor(t)}: ${dmg} dmg (${before}→${after})${result.special?.note ? " — " + result.special.note : ""}`);
        await dmAction(token, "forceMove", {
          targetId: t.sourceId, targetKind: toServerTargetKind(t.sourceKind), monId: t.mon.id, damage: dmg,
          attackerName: labelFor(attacker), defenderName: labelFor(t), moveName,
        });
      }
      resultOut.textContent = targets.length > 1
        ? `${labelFor(attacker)} used ${moveName} on ${targets.length} targets — ${summaries.join("; ")}`
        : `${labelFor(attacker)} used ${moveName} on ${summaries[0]}`;
      await persist();
      render();
    }

    async function throwBall(thrower, ball, target) {
      if (!target) { resultOut.textContent = "Pick a target first."; return; }
      resultOut.textContent = await rollCatch(thrower, ball, target);
    }

    async function useHealItem(item, target) {
      if (!target) { resultOut.textContent = "Pick a target first."; return; }
      const hp = currentHpFor(target.mon);
      const max = maxHpFor(target.mon);
      if (!max) { resultOut.textContent = "Target's species not recognized."; return; }
      const fainted = hp === 0;
      if (item.reviveOnly && !fainted) { resultOut.textContent = `${target.mon.nickname || target.mon.name} isn't fainted — ${item.name} only works on a fainted Pokémon.`; return; }
      if (!item.reviveOnly && fainted) { resultOut.textContent = `${target.mon.nickname || target.mon.name} has fainted — use a Revive first.`; return; }
      const newHp = item.isFraction ? Math.max(1, Math.round(max * item.amount)) : Math.min(max, hp + item.amount);
      const text = `${labelFor(active)} used a ${item.name} on ${labelFor(target)}: ${hp} → ${newHp} HP${item.cureStatus ? ", status cured" : ""}.`;
      await applyHpChange(target, newHp, text);
      if (item.cureStatus) await applyStatusChange(target, "None", { inBattle: false });
      resultOut.textContent = text;
      await persist();
      render();
    }

    async function megaEvolve(c, megaSpecies) {
      c.megaFrom = c.mon.name;
      c.mon.name = megaSpecies.name;
      c.megaEvolved = true;
      const text = `${ownerName(c)}'s ${c.mon.nickname || c.megaFrom} Mega Evolved into ${megaSpecies.name}!`;
      resultOut.textContent = text;
      await postLog(text);
      await persist();
      render();
    }

    async function revertMega(c) {
      const megaName = c.mon.name;
      c.mon.name = c.megaFrom || c.mon.name;
      c.megaFrom = null;
      c.megaEvolved = false;
      const text = `${combatantLabel(c)} (${megaName}) reverted from its Mega Evolution.`;
      resultOut.textContent = text;
      await postLog(text);
      await persist();
      render();
    }

    async function attemptRun(c) {
      // No per-trainer Athletics DC is reliably available from this screen,
      // so this is a simple flat d20 check (11+ succeeds) rather than trying
      // to derive a real escape DC — good enough for a GM tool, not meant to
      // replace a proper skill check the table wants to roll by hand.
      const d20 = d20Roll();
      const success = d20 >= 11;
      const text = success
        ? `${labelFor(c)} attempts to flee the encounter — SUCCESS (d20 rolled ${d20})! They escape.`
        : `${labelFor(c)} attempts to flee the encounter — FAILED (d20 rolled ${d20}). They're still in the fight.`;
      resultOut.textContent = text;
      await postLog(text);
      if (success) {
        combatants = combatants.filter((x) => x.id !== c.id);
        if (targetId === c.id) targetId = null;
        await persist();
      }
      render();
    }
  }

  function render() {
    renderRoundCard();
    renderRoster();
    renderTurnCard();
    battle?.refresh();
  }

  (async () => {
    const saved = await getFullTurn();
    if (saved && Array.isArray(saved.combatants)) {
      combatants = saved.combatants;
      currentIndex = saved.currentIndex || 0;
      round = saved.round || 1;
      acted = saved.acted || null;
      lastRemote = remoteSig(saved);
      background = saved.background || "";
      spreadHitsAllies = !!saved.spreadHitsAllies;
      phase = ["draft", "vs", "live"].includes(saved.phase) ? saved.phase : "draft";
    }
    await renderPresentationCard();
    render();
  })();
}
