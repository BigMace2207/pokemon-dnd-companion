// A graphical, classic-Pokémon-style battle screen for players: every
// combatant lined up in initiative order (your side along the bottom, back
// sprites; the other side along the top, front sprites), a turn-order strip,
// and a FIGHT/BAG/POKÉMON/RUN menu like the games.
//
// Every choice on your turn (FIGHT, BAG, POKÉMON, RUN or OTHER) is final: it's sent to the server, which records it
// as this turn's choice, and the menu locks ("Waiting for the DM…") until the DM starts the next turn in Battle
// Control. The server knows whose turn it is from the DM's console (fullTurn.turnId).
//
// Playing a move on your own turn actually resolves it — rolls to-hit and
// damage client-side (js/moveResolution.js, the same battleMath.js engine
// the DM's Full Turn console uses) and submits the result to the server via
// a trainer-scoped action (js/network.js's playMove) that can only change
// HP/status on the existing roster and advance the turn, never touch the
// roster's composition — see server.py's _handle_player_move. Bag items and
// Run still just send the DM a note, same as always, since catching/healing
// decisions stay under DM review for now.
//
// The Dungeon Master intentionally does NOT get this screen — Control
// Centre keeps its menu/table interface, since a DM is juggling several
// teams (NPCs, wild Pokémon, every online player) at once, not one lead
// Pokémon in a scene.

import { combatantLabel, ownerName, levelText } from "../battleLabels.js";
import { el } from "../components.js";
import { calcAllStats, BALL_TYPES } from "../calc.js";
import { HEAL_ITEMS } from "../battleItems.js";
import { spriteImg } from "../sprites.js";
import { loadSave } from "../storage.js";
import { getFullTurn, getBattleLog, playMove, playerAction, listTrainers, getNpcs } from "../network.js";
import { trainerSpriteUrl } from "../trainerSpritePicker.js";
import { registerInterval } from "../intervals.js";
import { targetKindForMove, enemiesOf, resolveSpreadTargets, sideOf, combatantsBySide, sideIsDefeated } from "../moveTargeting.js";
import { rollMove, damageAgainst } from "../moveResolution.js";
import { moveEffectivenessSummary } from "../battleMath.js";
import { showDiceRollFx } from "../diceRollFx.js";
import { attachCombatantInfo } from "../combatantInfo.js";

const POLL_MS = 3000;
const EMPTY_FULLTURN = { combatants: [], currentIndex: 0, round: 1, background: "", spreadHitsAllies: false, phase: "draft" };

function speciesFor(state, mon) { return mon ? state.pokemonByName.get(mon.name) : null; }

function statsFor(state, mon) {
  const species = speciesFor(state, mon);
  if (!species) return null;
  const level = Math.min(100, Math.max(1, Number(mon.level) || 1));
  return { ...species, ...calcAllStats(species, level, 15, 0, 1) };
}

function maxHpFor(state, mon) { return statsFor(state, mon)?.hp ?? null; }
function currentHpFor(state, mon) {
  const max = maxHpFor(state, mon);
  if (!mon || mon.currentHp === null || mon.currentHp === undefined) return max;
  return mon.currentHp;
}

// Same ordering rule as the Initiative Tracker / DM's Full Turn console, so
// "up now" here matches what the DM sees on their screen.
function orderedList(state, combatants) {
  return [...combatants].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority ? -1 : 1;
    const sa = statsFor(state, a.mon)?.spe ?? 0, sb = statsFor(state, b.mon)?.spe ?? 0;
    if (sb !== sa) return sb - sa;
    return (b.tiebreak ?? -1) - (a.tiebreak ?? -1);
  });
}

function hpBarClass(pct) {
  if (pct > 50) return "good";
  if (pct > 20) return "warn";
  return "bad";
}

function hpPct(state, mon) {
  const max = maxHpFor(state, mon);
  const cur = currentHpFor(state, mon);
  return max ? Math.max(0, Math.min(100, (cur / max) * 100)) : 0;
}

// A cheap fingerprint of "everything this screen actually draws from" —
// polling every few seconds only re-renders when this changes, so an
// unchanged encounter no longer causes a visible flash every poll.
function snapshotOf(fullTurn, logEntries) {
  const combatants = fullTurn.combatants.map((c) => [
    c.id, c.side, c.mon.currentHp, c.mon.status, c.mon.name, c.mon.nickname, c.mon.level, c.mon.item, c.mon.ability,
  ].join(":"));
  return JSON.stringify([fullTurn.phase, fullTurn.background, fullTurn.currentIndex, fullTurn.round, fullTurn.turnId, fullTurn.acted?.combatantId, fullTurn.acted?.text, fullTurn.spreadHitsAllies, combatants, logEntries.length, logEntries[logEntries.length - 1]?.id]);
}

// options: only used when this screen is embedded somewhere other than its
// own top-level "Battle" nav item (currently: the DM's Battle Control tab,
// mirroring a chosen trainer's exact screen) —
//   networkId/trainerName: view as this trainer instead of "me". Playing a
//     move still goes through the same trainer-scoped server action, just
//     attributed to them — a DM using this to act for an AFK player is a
//     feature, not a bug, at this table.
//   dm: the DM's Battle Control. The screen always shows the battle from the side of whoever's turn it is. On an NPC's
//     or wild Pokémon's turn the DM uses the menu for it (dm.submit applies a move, dm.log records anything else); on a
//     player's turn it shows what they're choosing, like their own screen does while they wait.
//   embedded: true skips the "Battle" heading (the embedding page already
//     has its own), and true also caller must route interval ids through
//     registerIntervalFn so the outer page's own teardown covers them (the
//     global clearAllIntervals() only fires on router-level navigation, not
//     when this is re-rendered as a sub-component).
export function renderBattleView(container, state, options = {}) {
  const { networkId: overrideNetworkId, trainerName: overrideName, registerIntervalFn = registerInterval, embedded = false, dm = null } = options;
  const isPlayerKind = (c) => c && (c.sourceKind === "player" || c.sourceKind === "team");
  const dmDone = new Set();   // DM mode: the turns (turnId + round) the DM has already acted on
  container.innerHTML = "";
  if (!embedded) {
    // The Battle screen opens from the hub's encounter buttons, so that's the way back too.
    const back = el("button", { class: "btn secondary small battle-back", type: "button" }, "← Back to the hub");
    back.addEventListener("click", () => { location.hash = "hub"; });
    container.appendChild(back);
    container.appendChild(el("h1", { class: "view-title" }, "Battle"));
  }

  const save = loadSave();
  const myNetworkId = overrideNetworkId || save.networkId;
  const myDisplayName = overrideName || save.trainer.name || "A trainer";
  let activeIndex = save.party.findIndex((m) => m.name);
  if (activeIndex < 0) activeIndex = 0;
  let menuMode = "root"; // "root" | "fight" | "bag" | "pokemon" | "targeting"
  let flashMessage = null;
  let fullTurn = EMPTY_FULLTURN;
  let logEntries = [];
  let lastSnapshot = null;
  // While menuMode === "targeting": which enemy to act on once picked.
  // While an action was just taken against a spread of targets, this
  // instead highlights every target it hit, briefly.
  let pendingTarget = null; // (target) => void
  let highlightedIds = new Set();
  // True for the brief window between an optimistic local update (playing
  // a move) and the server confirming it — poll() skips entirely during
  // this window so a poll landing mid-flight can't fetch the pre-move
  // server state and clobber the update that's already on screen.
  let submitting = false;

  const turnOrderEl = el("div");
  const sceneEl = el("div");
  const dialogEl = el("div");
  container.appendChild(turnOrderEl);
  // sceneEl + dialogEl share one relatively-positioned wrapper so the text
  // box can sit absolutely over the bottom of the scene (see .battle-stage/
  // .battle-textbox in style.css) -- like the games' own battle screen,
  // instead of the text box being a separate block underneath it.
  container.appendChild(el("div", { class: "battle-stage" }, [sceneEl, dialogEl]));

  function myMon() { return dm ? myCombatant()?.mon || null : save.party[activeIndex] || null; }
  const dmTurnKey = () => `${fullTurn.turnId || activeCombatant()?.id}|${fullTurn.round}`;
  // DM mode: is this an NPC's or wild Pokémon's turn (the DM's to play)?
  const dmActs = () => !!dm && !!activeCombatant() && !isPlayerKind(activeCombatant());
  // My choice this turn, if I've made it: the menu stays locked until the DM starts the next turn.
  function myChoice() {
    if (dmActs()) return dmDone.has(dmTurnKey()) ? { text: "Done. Click Next Turn when you're ready." } : null;
    const mine = myCombatant();
    return mine && fullTurn.acted && fullTurn.acted.combatantId === mine.id ? fullTurn.acted : null;
  }

  function myCombatant() {
    if (dm) return activeCombatant();   // the DM sees the battle as whoever's turn it is
    return fullTurn.combatants.find((c) => (c.sourceKind === "player" || c.sourceKind === "team") && c.sourceId === myNetworkId) || null;
  }

  function activeCombatant() {
    // the DM's console says whose turn it is; the index below is the fallback for an older saved battle
    const named = fullTurn.turnId && fullTurn.combatants.find((c) => c.id === fullTurn.turnId);
    if (named) return named;
    const order = orderedList(state, fullTurn.combatants);
    if (!order.length) return null;
    const idx = Math.min(fullTurn.currentIndex, order.length - 1);
    // Display-only skip past a fainted "up now" — the real turn-advance
    // skip that owns currentIndex lives in submitTurn() below, run by
    // whoever's move actually knocked someone out.
    let i = idx, steps = 0;
    while (currentHpFor(state, order[i].mon) === 0 && steps < order.length) {
      i = (i + 1) % order.length;
      steps++;
    }
    return order[i];
  }

  // Enemies/allies are relative to my own combatant's "side" (set by the DM
  // when building the roster). If I'm not in the encounter yet, or nobody
  // has a side assigned (an older/simpler roster), everyone else on the
  // field is shown as a potential enemy — the same behavior this screen
  // always had before "sides" existed.
  function enemyCombatants() {
    const mine = myCombatant();
    if (!mine) return fullTurn.combatants;
    return enemiesOf(mine, fullTurn.combatants);
  }

  // text: a single message, or an array shown one after another in the same
  // box like the games' own message queue ("Chimchar used Ember!" then
  // "It was super effective!") -- each gets its own beat on screen before
  // advancing, only returning to the action menu after the last one.
  function flash(text) {
    const queue = Array.isArray(text) ? text : [text];
    let i = 0;
    function showNext() {
      flashMessage = queue[i];
      renderDialog();
      const isLast = i === queue.length - 1;
      setTimeout(() => {
        if (isLast) { flashMessage = null; menuMode = "root"; pendingTarget = null; highlightedIds = new Set(); renderDialog(); renderScene(); }
        else { i++; showNext(); }
      }, 1400);
    }
    showNext();
  }

  async function sendRequest(text, kind = "other", extra = {}) {
    const mine = myCombatant();
    if (!mine) return;
    if (dm) {
      if (!dmActs()) return;
      await dm.log(text);
      dmDone.add(dmTurnKey());
      menuMode = "root"; pendingTarget = null;
      flash(text);
      return;
    }
    submitting = true;
    try {
      const res = await playerAction({ networkId: myNetworkId, kind, text, ...extra });
      if (!res || res.error) { flash(res?.error || "Couldn't reach the server — try again."); return; }
      fullTurn = { ...fullTurn, acted: { combatantId: mine.id, kind, text } };
      menuMode = "root"; pendingTarget = null;
      flash("Sent to the Dungeon Master!");
    } finally {
      submitting = false;
    }
  }

  const targetLabel = combatantLabel;

  // Single-target actions (a move, a thrown ball, ...): if there's exactly
  // one valid enemy, act on it immediately (no extra tap, matches how the
  // real games skip target selection in a 1v1); with more than one, drop
  // into "targeting" mode so the trainer can pick which enemy sprite to hit.
  function withEnemyTarget(onTarget) {
    const enemies = enemyCombatants();
    if (enemies.length <= 1) {
      onTarget(enemies[0] || null);
      return;
    }
    pendingTarget = onTarget;
    menuMode = "targeting";
    renderDialog();
    renderScene();
  }

  // ---------------- Playing a move for real ----------------

  // Submits the outcome of this turn to the server: combatants (if any HP/
  // status changed), the advanced turn counter, and battle log lines. The
  // local state updates immediately so the screen feels responsive without
  // waiting on the round trip; the next poll reconciles with the server's
  // copy (which should already match, since this is exactly what was sent).
  async function submitTurn({ combatants, logTexts }) {
    if (dm) {
      submitting = true;
      try {
        await dm.submit({ combatants: combatants || fullTurn.combatants, logTexts });
        if (combatants) fullTurn = { ...fullTurn, combatants };
        dmDone.add(dmTurnKey());
        renderScene(); renderTurnOrder();
        lastSnapshot = snapshotOf(fullTurn, logEntries);
      } finally { submitting = false; }
      return;
    }
    submitting = true;
    try {
      // Re-fetch the live turn counter right before advancing it — basing
      // "next" off this client's own possibly-stale local fullTurn.currentIndex
      // let a device that missed a poll or two push a wrong index and desync
      // the table's turn order (symptom: the dialog gets stuck announcing
      // the same combatant's turn indefinitely).
      // The move's damage applies now; the turn itself only moves on when the DM clicks Next Turn.
      const fresh = await getFullTurn();
      const base = (fresh && fresh.phase === "live" && Array.isArray(fresh.combatants)) ? fresh : fullTurn;
      const finalCombatants = combatants || base.combatants;
      const res = await playMove({ networkId: myNetworkId, combatants: finalCombatants, logTexts });
      if (!res || res.error) { flash(res?.error || "Couldn't reach the server — try again."); return; }
      const mine = myCombatant();
      fullTurn = { ...base, combatants: finalCombatants, acted: { combatantId: mine?.id, kind: "move", text: logTexts?.[0] || "" } };
      renderScene();
      renderTurnOrder();
      // The server now matches what's already on screen — reflect that so
      // the very next poll doesn't see a "change" and re-render for free.
      lastSnapshot = snapshotOf(fullTurn, logEntries);
    } finally {
      submitting = false;
    }
  }

  async function playMoveNow(attacker, move, targets) {
    const atkSpecies = speciesFor(state, attacker.mon);
    const atkName = attacker.mon.nickname || attacker.mon.name;
    const { d20, hit, diceRoll } = rollMove(move);

    if (!hit) {
      showDiceRollFx({ label: move.name, d20, hit, resultText: "MISSED" });
      await submitTurn({ logTexts: [`${targetLabel(attacker)} used ${move.name} — MISSED (d20 rolled ${d20}).`] });
      flash([`${atkName} used ${move.name}!`, `${atkName}'s attack missed!`]);
      return;
    }
    if (move.category === "Status" || !atkSpecies) {
      showDiceRollFx({ label: move.name, d20, hit, resultText: "no direct damage" });
      await submitTurn({ logTexts: [`${targetLabel(attacker)} used ${move.name} (status move — no direct damage).`] });
      flash(`${atkName} used ${move.name}!`);
      return;
    }

    const updated = fullTurn.combatants.map((c) => ({ ...c, mon: { ...c.mon } }));
    const summaries = [];
    for (const t of targets) {
      const targetInUpdated = updated.find((c) => c.id === t.id);
      const dSpecies = speciesFor(state, t.mon);
      if (!targetInUpdated || !dSpecies) continue;
      const dmg = damageAgainst({ state, move, attackerSpecies: atkSpecies, attackerMon: attacker.mon, defenderSpecies: dSpecies, defenderMon: t.mon, diceRoll });
      const before = currentHpFor(state, t.mon);
      const after = Math.max(0, before - dmg);
      targetInUpdated.mon.currentHp = after;
      const eff = state.typeEffectiveness(move.type, dSpecies.type1) * (dSpecies.type2 ? state.typeEffectiveness(move.type, dSpecies.type2) : 1);
      summaries.push({ label: targetLabel(t), name: t.mon.nickname || t.mon.name, dmg, before, after, eff, fainted: after === 0 });
    }
    if (!summaries.length) { flash("No valid targets."); return; }

    // Authentic in-game phrasing for the on-screen text box -- one line
    // for the move, then one per target for anything worth calling out
    // (effectiveness, fainting). The blow-by-blow numbers (damage, HP
    // before/after) stay out of here and go to logText below instead,
    // which is what the Battle Log drawer actually shows.
    const multi = summaries.length > 1;
    const messages = [`${atkName} used ${move.name}!`];
    summaries.forEach((s) => {
      const who = multi ? ` on ${s.name}` : "";
      if (s.eff === 0) messages.push(`It had no effect${multi ? ` on ${s.name}` : ""}!`);
      else if (s.eff > 1) messages.push(`It was super effective${who}!`);
      else if (s.eff < 1) messages.push(`It was not very effective${who}...`);
      if (s.fainted) messages.push(`${s.name} fainted!`);
    });
    flash(messages);

    showDiceRollFx({ label: move.name, d20, hit, resultText: summaries.map((s) => `${s.dmg} dmg`).join(", ") });
    const logText = summaries.length > 1
      ? `${targetLabel(attacker)} used ${move.name} on ${summaries.length} targets — ${summaries.map((s) => `${s.label}: ${s.dmg} dmg (${s.before}→${s.after})`).join("; ")}`
      : `${targetLabel(attacker)} used ${move.name} on ${summaries[0].label} for ${summaries[0].dmg} damage! (${summaries[0].before} → ${summaries[0].after} HP)`;
    await submitTurn({ combatants: updated, logTexts: [logText] });
  }

  function useMove(moveName) {
    const mine = myCombatant();
    if (!mine) return;
    const move = state.moves[state.moveByName.get(moveName)];
    if (!move) { flash(`"${moveName}" isn't a recognized move — check its spelling in My Team.`); return; }
    const kind = targetKindForMove(moveName);
    if (kind === "single") {
      withEnemyTarget((opp) => { if (opp) playMoveNow(mine, move, [opp]); });
      return;
    }
    const targets = resolveSpreadTargets(moveName, mine, fullTurn.combatants, fullTurn.spreadHitsAllies);
    highlightedIds = new Set(targets.map((t) => t.id));
    renderScene();
    if (!targets.length) { flash("No valid targets nearby."); return; }
    playMoveNow(mine, move, targets);
  }

  // ---------------- Turn order strip ----------------

  function renderTurnOrder() {
    turnOrderEl.innerHTML = "";
    if (!fullTurn.combatants.length) return;
    const order = orderedList(state, fullTurn.combatants);
    const active = activeCombatant();
    const mine = myCombatant();
    turnOrderEl.appendChild(el("div", { class: "turn-order-box" }, order.map((c) => {
      const species = speciesFor(state, c.mon);
      const classes = ["turn-order-item"];
      if (c === active) classes.push("active");
      if (c === mine) classes.push("mine");
      return el("div", { class: classes.join(" ") }, [
        spriteImg(species?.dex, { back: false, alt: c.mon.name, className: "turn-order-sprite" }),
        el("span", { class: "turn-order-name" }, c.mon.nickname || c.mon.name),
      ]);
    })));
  }

  // ---------------- Scene (enemy row top, ally row bottom) ----------------

  // One combatant's sprite+HUD, used for both rows. facing "front" (enemy
  // row, top) shows the HUD above the sprite; "back" (ally row, bottom)
  // shows the sprite above the HUD, like the mainline games' own layout.
  function combatantSlot(c, { facing, selectable, isMine, isActive }) {
    const mon = c.mon;
    const species = speciesFor(state, mon);
    const cur = currentHpFor(state, mon);
    const fainted = cur === 0;
    const canSelect = selectable && !fainted;
    const classes = ["battle-combatant-slot", facing === "back" ? "ally" : "enemy"];
    if (canSelect) classes.push("selectable");
    if (highlightedIds.has(c.id)) classes.push("selected");
    if (fainted) classes.push("fainted");
    if (isActive) classes.push("active-turn");
    if (isMine) classes.push("mine");
    const hud = el("div", { class: "battle-hud" + (facing === "front" ? " enemy-hud" : "") }, [
      el("div", { class: "battle-hud-row" }, [
        el("span", { class: "battle-name" }, mon.nickname || mon.name),
        el("span", { class: "battle-level" }, `Lv${levelText(mon.level)}`),
      ]),
      el("div", { class: "battle-hpbar-bg" }, [el("div", { class: `battle-hpbar-fill ${hpBarClass(hpPct(state, mon))}`, style: `width:${hpPct(state, mon)}%` })]),
      isMine ? el("div", { class: "battle-hp-numbers" }, maxHpFor(state, mon) !== null ? `${cur} / ${maxHpFor(state, mon)}` : "") : null,
      mon.status && mon.status !== "None" ? el("div", { class: "battle-status" }, mon.status) : null,
    ].filter(Boolean));
    attachCombatantInfo(hud, c, species);
    const platform = el("div", { class: "battle-platform" }, [spriteImg(species?.dex, { back: facing === "back", alt: mon.name, className: "battle-sprite" })]);
    const slot = el("div", { class: classes.join(" ") }, facing === "back" ? [platform, hud] : [hud, platform]);
    if (canSelect) slot.addEventListener("click", () => {
      const cb = pendingTarget;
      menuMode = "root"; pendingTarget = null;
      if (cb) cb(c);
    });
    return slot;
  }

  // A local-only placeholder for the bottom row when this trainer isn't
  // (yet) part of the DM's encounter — shows their own saved Pokémon with
  // no networked HP, same fallback this screen always had.
  function localMineSlot() {
    const mon = myMon();
    const species = speciesFor(state, mon);
    const max = maxHpFor(state, mon);
    const cur = currentHpFor(state, mon);
    const pct = max ? Math.max(0, Math.min(100, (cur / max) * 100)) : 0;
    const hud = el("div", { class: "battle-hud" }, mon ? [
      el("div", { class: "battle-hud-row" }, [
        el("span", { class: "battle-name" }, mon.nickname || mon.name),
        el("span", { class: "battle-level" }, `Lv${levelText(mon.level)}`),
      ]),
      el("div", { class: "battle-hpbar-bg" }, [el("div", { class: `battle-hpbar-fill ${hpBarClass(pct)}`, style: `width:${pct}%` })]),
      el("div", { class: "battle-hp-numbers" }, max !== null ? `${cur} / ${max}` : ""),
      mon.status && mon.status !== "None" ? el("div", { class: "battle-status" }, mon.status) : null,
    ] : [el("div", { class: "battle-name" }, "No Pokémon selected — add one in My Team")]);
    if (mon) attachCombatantInfo(hud, { id: "local", mon, sourceLabel: myDisplayName }, species);
    return el("div", { class: "battle-combatant-slot ally mine" }, [
      el("div", { class: "battle-platform" }, [spriteImg(species?.dex, { back: true, alt: mon?.name || "", className: "battle-sprite" })]),
      hud,
    ]);
  }

  // ---------------- VS Screen (phase === "vs") ----------------
  // A Side A vs Side B intro card shown between Draft and Live — every
  // combatant's portrait, grouped by side, no actions available. Reuses
  // the same three container elements as the normal scene (turnOrderEl/
  // dialogEl cleared, sceneEl repurposed) so the embedding page's own
  // layout around this component doesn't need to know which mode it's in.
  async function renderVsScreen() {
    turnOrderEl.innerHTML = "";
    dialogEl.innerHTML = "";
    sceneEl.innerHTML = "";
    const sideA = combatantsBySide("A", fullTurn.combatants);
    const sideB = combatantsBySide("B", fullTurn.combatants);
    const all = [...sideA, ...sideB];

    // Trainer/NPC portraits, not the Pokémon's own sprite -- a wild
    // Pokémon has no trainer, so that case alone still falls back to the
    // species sprite. Only fetches whichever of these two lists this
    // encounter actually needs.
    const [trainers, npcs] = await Promise.all([
      all.some((c) => c.sourceKind === "player" || c.sourceKind === "team") ? listTrainers("") : [],
      all.some((c) => c.sourceKind === "npc") ? getNpcs() : [],
    ]);
    const trainerSprites = new Map(trainers.map((t) => [t.id, t.sprite]));
    const npcSprites = new Map(npcs.map((n) => [n.id, n.sprite]));

    function portrait(c) {
      const species = speciesFor(state, c.mon);
      const sprite = c.sourceKind === "npc" ? npcSprites.get(c.sourceId) : trainerSprites.get(c.sourceId);
      const img = sprite
        ? el("img", { src: trainerSpriteUrl(sprite), alt: c.sourceLabel, class: "vs-portrait-sprite" })
        : spriteImg(species?.dex, { back: false, alt: c.mon.name, className: "vs-portrait-sprite" });
      return el("div", { class: "vs-portrait" }, [
        img,
        el("div", { class: "vs-portrait-name" }, ownerName(c)),
        el("div", { class: "vs-portrait-trainer" }, c.mon.nickname || c.mon.name),
      ]);
    }
    const bgFile = fullTurn.background;
    const sceneStyle = bgFile ? `background-image:url('sprites/backgrounds/${encodeURIComponent(bgFile)}');background-size:cover;background-position:center;` : "";
    sceneEl.appendChild(el("div", { class: "vs-screen", style: sceneStyle }, [
      el("div", { class: "vs-symbol" }, "VS"),
      el("div", { class: "vs-sides" }, [
        el("div", { class: "vs-side vs-side-a" }, sideA.length ? sideA.map(portrait) : [el("div", { class: "view-sub" }, "—")]),
        el("div", { class: "vs-side vs-side-b" }, sideB.length ? sideB.map(portrait) : [el("div", { class: "view-sub" }, "—")]),
      ]),
    ]));
  }

  function renderAll() {
    if (fullTurn.phase === "vs" && !dm) { renderVsScreen(); return; }
    renderScene();
    renderTurnOrder();
    if (!flashMessage) renderDialog();
  }

  function renderScene() {
    sceneEl.innerHTML = "";
    const mine = myCombatant();
    const active = activeCombatant();
    const isTargeting = menuMode === "targeting";

    // Both rows are laid out in the same Speed/priority/tiebreak initiative
    // order the DM's Full Turn console uses — "up now" always lines up
    // with the same slot on both screens.
    const order = orderedList(state, fullTurn.combatants);
    const mySide = mine ? sideOf(mine) : null;
    const enemyRow = mine ? order.filter((c) => sideOf(c) !== mySide) : order;
    const allyRow = mine ? order.filter((c) => sideOf(c) === mySide) : [];

    const enemiesEl = el("div", { class: "battle-enemies" }, enemyRow.length
      ? enemyRow.map((c) => combatantSlot(c, { facing: "front", selectable: isTargeting, isMine: false, isActive: c === active }))
      : [el("div", { class: "battle-hud" }, [el("div", { class: "battle-name" }, "No opponents")])]);

    const alliesEl = el("div", { class: "battle-allies" }, mine
      ? allyRow.map((c) => combatantSlot(c, { facing: "back", selectable: false, isMine: c === mine, isActive: c === active }))
      : [localMineSlot()]);

    const bgFile = fullTurn.background;
    const sceneStyle = bgFile ? `background-image:url('sprites/backgrounds/${encodeURIComponent(bgFile)}');background-size:cover;background-position:center;` : "";

    const scene = el("div", { class: "battle-scene", style: sceneStyle }, [enemiesEl, alliesEl]);
    sceneEl.appendChild(scene);
  }

  function menuGridButtons() {
    const fightBtn = el("button", { class: "battle-menu-btn fight" }, "FIGHT");
    const bagBtn = el("button", { class: "battle-menu-btn bag" }, "BAG");
    const pokemonBtn = el("button", { class: "battle-menu-btn pokemon" }, "POKÉMON");
    const runBtn = el("button", { class: "battle-menu-btn run" }, "RUN");
    fightBtn.addEventListener("click", () => { menuMode = "fight"; renderDialog(); });
    bagBtn.addEventListener("click", () => { menuMode = "bag"; renderDialog(); });
    pokemonBtn.addEventListener("click", () => { menuMode = "pokemon"; renderDialog(); });
    runBtn.addEventListener("click", () => {
      const mon = myMon();
      sendRequest(`${dm ? ownerName(myCombatant()) : myDisplayName}'s ${mon?.nickname || mon?.name || "Pokémon"} tries to run from the encounter!`, "run");
    });
    const otherBtn = el("button", { class: "battle-menu-btn other" }, "OTHER");
    otherBtn.addEventListener("click", () => { menuMode = "other"; renderDialog(); });
    // the DM swaps an NPC's Pokémon from DM Control, so there's no POKÉMON button for them here
    return el("div", { class: `battle-menu-grid ${dm ? "four" : "five"}` }, dm ? [fightBtn, bagBtn, runBtn, otherBtn] : [fightBtn, bagBtn, pokemonBtn, runBtn, otherBtn]);
  }

  function backButton() {
    const btn = el("button", { class: "btn secondary battle-back" }, "◀ Back");
    btn.addEventListener("click", () => { menuMode = "root"; pendingTarget = null; renderDialog(); renderScene(); });
    return btn;
  }

  function renderDialog() {
    dialogEl.innerHTML = "";
    const mon = myMon();
    const combatant = myCombatant();
    const active = activeCombatant();
    const myTurn = combatant && active === combatant;

    const box = el("div", { class: "battle-textbox" });

    if (flashMessage) {
      box.appendChild(el("div", { class: "battle-message" }, flashMessage));
      dialogEl.appendChild(box);
      return;
    }

    if (fullTurn.combatants.length) {
      const fainted = (c) => currentHpFor(state, c.mon) === 0;
      const aDefeated = sideIsDefeated("A", fullTurn.combatants, fainted);
      const bDefeated = sideIsDefeated("B", fullTurn.combatants, fainted);
      if (aDefeated || bDefeated) {
        // DEFEAT/VICTORY are relative to which side THIS trainer is on, not
        // hardcoded to "A lost" — a Side B player winning must see VICTORY
        // too. Falls back to the old A-is-us assumption only for a viewer
        // with no side of their own (not in the encounter, spectating).
        const mySide = combatant ? sideOf(combatant) : "A";
        const myLoss = mySide === "A" ? aDefeated : bDefeated;
        box.appendChild(el("div", { class: `result-banner ${myLoss ? "bad" : "good"}`, style: "font-size:1.3em;text-align:center;padding:20px" }, myLoss ? "DEFEAT" : "VICTORY"));
        dialogEl.appendChild(box);
        return;
      }
    }

    if (menuMode === "targeting") {
      box.appendChild(el("div", { class: "battle-prompt" }, "Choose a target — tap an opponent above."));
      box.appendChild(backButton());
    } else if (menuMode === "fight") {
      const moves = (mon?.moves || []).filter(Boolean);
      box.appendChild(el("div", { class: "battle-prompt" }, `What will ${mon?.nickname || mon?.name || "your Pokémon"} do?`));
      if (!moves.length) {
        box.appendChild(el("p", { class: "view-sub" }, "No moves set — add them in My Team."));
      } else {
        box.appendChild(el("div", { class: "battle-menu-grid moves" }, moves.map((m) => {
          const spread = targetKindForMove(m) !== "single";
          const move = state.moves[state.moveByName.get(m)];
          const previewTargets = combatant
            ? (spread ? resolveSpreadTargets(m, combatant, fullTurn.combatants, fullTurn.spreadHitsAllies) : enemyCombatants())
            : [];
          const effLabel = move ? moveEffectivenessSummary(state, move, previewTargets.map((t) => speciesFor(state, t.mon))) : "";
          const label = [spread ? `${m} (hits all)` : m, effLabel ? `— ${effLabel}` : ""].filter(Boolean).join(" ");
          const b = el("button", { class: "battle-menu-btn move" }, label);
          b.addEventListener("click", () => useMove(m));
          return b;
        })));
      }
      box.appendChild(backButton());
    } else if (menuMode === "bag") {
      box.appendChild(el("div", { class: "battle-prompt" }, "Use an item:"));
      box.appendChild(el("h4", {}, "Poké Balls"));
      box.appendChild(el("div", { class: "battle-menu-grid moves" }, BALL_TYPES.map((ball) => {
        const b = el("button", { class: "battle-menu-btn move" }, ball);
        b.addEventListener("click", () => withEnemyTarget((opp) => sendRequest(`${myDisplayName} throws a ${ball}${opp ? ` at ${targetLabel(opp)}` : ""}!`, "item")));
        return b;
      })));
      box.appendChild(el("h4", {}, "Healing"));
      box.appendChild(el("div", { class: "battle-menu-grid moves" }, HEAL_ITEMS.map((item) => {
        const b = el("button", { class: "battle-menu-btn move" }, item.name);
        b.addEventListener("click", () => sendRequest(`${myDisplayName} uses a ${item.name} on ${mon?.nickname || mon?.name || "their Pokémon"}.`, "item"));
        return b;
      })));
      box.appendChild(backButton());
    } else if (menuMode === "other") {
      // anything that isn't a move, an item, a switch or running: describe it, and the DM decides what happens
      box.appendChild(el("div", { class: "battle-prompt" }, "What do you do?"));
      const text = el("textarea", { class: "battle-other-text", rows: "3", maxlength: "400", placeholder: "e.g. Mia climbs the tree to get a better view of the Onix", "aria-label": "Describe what you do" });
      const send = el("button", { class: "btn" }, "Do it");
      send.addEventListener("click", () => { const t = text.value.trim(); if (t) sendRequest(`${myDisplayName}: ${t}`, "other"); });
      text.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send.click(); } });
      box.appendChild(text);
      box.appendChild(el("div", { class: "battle-other-row" }, [send, backButton()]));
      setTimeout(() => text.focus(), 0);
    } else if (menuMode === "pokemon") {
      box.appendChild(el("div", { class: "battle-prompt" }, "Choose a Pokémon:"));
      box.appendChild(el("div", { class: "battle-party-list" }, save.party.filter((m) => m.name).map((m) => {
        const idx = save.party.indexOf(m);
        const max = maxHpFor(state, m);
        const cur = currentHpFor(state, m);
        const fainted = cur === 0;
        // el() sets any non-null attribute value via setAttribute, and HTML
        // boolean attributes like "disabled" are disabled by mere presence —
        // even setAttribute("disabled", false) still disables the button —
        // so the "not disabled" case must omit the attribute (null) rather
        // than pass false.
        const isDisabled = fainted || idx === activeIndex;
        const b = el("button", { class: "btn secondary battle-party-btn", disabled: isDisabled ? "" : null }, `${m.nickname || m.name} (Lv.${levelText(m.level)}) — ${fainted ? "Fainted" : (max === null ? "HP unknown" : `${cur}/${max} HP`)}`);
        if (!fainted && idx !== activeIndex) {
          b.addEventListener("click", async () => {
            await sendRequest(`${myDisplayName} sends out ${m.nickname || m.name}!`, "switch", { monId: m.id });
            if (myChoice()) activeIndex = idx;
            renderScene();
          });
        }
        return b;
      })));
      box.appendChild(backButton());
    } else {
      // root: the action menu on my turn, or a short status line otherwise.
      // The blow-by-blow history lives in the Battle Log drawer (the LOG
      // button) now, not here -- this box only ever shows the one current
      // line, same as the real games' battle screen.
      if (!fullTurn.combatants.length) {
        box.appendChild(el("div", { class: "battle-prompt" }, "No encounter in progress right now."));
      } else if (dm && !dmActs()) {
        // a player's turn: show what they're doing; their own screen has the menu
        const choice = fullTurn.acted && active && fullTurn.acted.combatantId === active.id ? fullTurn.acted : null;
        box.appendChild(el("div", { class: "battle-prompt" }, choice ? `${combatantLabel(active)}: ${choice.text || choice.kind}` : `Waiting for ${active ? combatantLabel(active) : "the next turn"} to choose…`));
        if (choice) box.appendChild(el("div", { class: "battle-waiting" }, "Resolve it, then click Next Turn."));
      } else if (!combatant) {
        box.appendChild(el("div", { class: "battle-prompt" }, "You're not in the DM's current encounter yet."));
      } else if (myTurn && myChoice()) {
        // chosen: locked until the DM starts the next turn
        box.appendChild(el("div", { class: "battle-prompt" }, myChoice().text || "Your choice is in."));
        box.appendChild(el("div", { class: "battle-waiting" }, "Waiting for the Dungeon Master to start the next turn…"));
      } else if (myTurn) {
        box.appendChild(el("div", { class: "battle-prompt" }, dm ? `${combatantLabel(combatant)}: what will it do?` : `What will ${mon?.nickname || mon?.name || "your Pokémon"} do?`));
        box.appendChild(menuGridButtons());
      } else {
        box.appendChild(el("div", { class: "battle-prompt" }, `Waiting for ${active ? combatantLabel(active) : "the next turn"}…`));
      }
    }

    dialogEl.appendChild(box);
  }

  async function poll() {
    if (submitting) return;
    const [ft, log] = await Promise.all([getFullTurn(), getBattleLog()]);
    if (submitting) return; // a move started while this fetch was in flight — its own state is newer, don't clobber it
    // The DM can build/edit the roster in draft without it appearing here —
    // only "vs" (the intro card) or "live" (the full screen) — see the
    // phase buttons in the Battle Control console — actually shows up here.
    const nextFullTurn = ft && Array.isArray(ft.combatants) ? (dm || (ft.phase && ft.phase !== "draft") ? ft : EMPTY_FULLTURN) : fullTurn;
    const nextLog = Array.isArray(log) ? log : logEntries;

    const snap = snapshotOf(nextFullTurn, nextLog);
    if (snap === lastSnapshot) return; // nothing actually changed — skip the re-render so the screen doesn't flash every poll
    lastSnapshot = snap;

    fullTurn = nextFullTurn;
    logEntries = nextLog;
    // A poll that reveals it's no longer my turn must drop any sub-menu
    // (FIGHT/BAG/POKÉMON/targeting) I still had open from my last go —
    // otherwise the menu (and the ability to act through it) keeps sitting
    // there stale even while the text box below correctly starts saying
    // it's someone else's turn.
    const mine = myCombatant();
    const nowMyTurn = mine !== null && mine === activeCombatant() && !myChoice();
    if (!nowMyTurn && menuMode !== "root") {
      menuMode = "root";
      pendingTarget = null;
      highlightedIds = new Set();
    }
    renderAll();
  }

  poll();
  registerIntervalFn(setInterval(poll, POLL_MS));
  // the embedding page (Battle Control) asks for a fresh look right after it changes the battle itself
  return { refresh: () => { lastSnapshot = null; return poll(); } };
}
