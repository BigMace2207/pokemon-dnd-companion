// Rolling for the D&D views: d20 tests (with advantage/disadvantage), damage
// (with crit doubling) and free-form expressions. Every roll is added to a
// session feed, shown in a small card, and -- if "share rolls" is on -- posted to
// the campaign's Battle Log so the table sees it.

import { el } from "../../components.js";
import { rollD20, roll as rollExpr, fmtMod } from "./engine/dice.js";
import { getSettings, setSettings } from "./store.js";
import { postBattleLog } from "../../network.js";

const feed = [];
const subs = new Set();
const MAX_FEED = 80;

export function recentRolls() { return feed; }
export function onRoll(fn) { subs.add(fn); return () => subs.delete(fn); }
export function clearRolls() { feed.length = 0; subs.forEach((fn) => fn(null)); }

export function rollMode() { return getSettings().rollMode || "normal"; }
export function setRollMode(mode) { setSettings({ rollMode: mode }); subs.forEach((fn) => fn(null)); }

// shift = advantage, ctrl/alt/cmd = disadvantage, otherwise the sheet's toggle
export function modeFromEvent(e) {
  if (e?.shiftKey) return "adv";
  if (e?.ctrlKey || e?.altKey || e?.metaKey) return "dis";
  return rollMode();
}

function publish(entry, { share = true, who = "" } = {}) {
  entry.ts = Date.now();
  entry.who = who || entry.who || "";
  feed.unshift(entry);
  if (feed.length > MAX_FEED) feed.length = MAX_FEED;
  subs.forEach((fn) => fn(entry));
  showCard(entry);
  if (share && getSettings().shareRolls && entry.who) {
    postBattleLog(entry.who, `${entry.label}: ${entry.total}${entry.shareDetail ? ` (${entry.shareDetail})` : ""}${entry.crit ? " — CRITICAL!" : entry.fumble ? " — natural 1" : ""}`);
  }
  return entry;
}

// A d20 test: attack roll, ability check, saving throw, initiative...
export function d20Test({ label, mod = 0, mode, who = "", reliable10 = false, kind = "check", share = true }) {
  const r = rollD20({ mod, mode: mode || rollMode(), reliable10 });
  const shown = r.rolls.length > 1 ? `${r.rolls.join(", ")} → ${r.chosen}` : `${r.chosen}`;
  const modeTag = r.mode === "adv" ? " (advantage)" : r.mode === "dis" ? " (disadvantage)" : "";
  return publish({
    kind, label: `${label}${modeTag}`, total: r.total, natural: r.natural, crit: r.crit, fumble: r.fumble,
    detail: `d20 ${shown}${reliable10 && r.natural < 10 ? " (Reliable Talent: 10)" : ""} ${fmtMod(mod)}`,
    shareDetail: `d20 ${shown} ${fmtMod(mod)}`, rolls: r.rolls, d20: r,
  }, { share, who });
}

// Damage or healing: expr like "1d8+3"; crit doubles the dice.
export function damageRoll({ label, expr, crit = false, who = "", share = true, kind = "damage", reroll = null }) {
  const r = rollExpr(reroll ? expr.replace(/(\d+d\d+)/, `$1r${reroll}`) : expr, { crit });
  if (!r) return null;
  return publish({
    kind, label: `${label}${crit ? " (critical)" : ""}`, total: Math.max(0, r.total), crit, detail: r.text, shareDetail: r.text,
  }, { share, who });
}

export function expressionRoll(expr, { label = "Roll", who = "", share = true } = {}) {
  const r = rollExpr(expr);
  if (!r) return null;
  const natural20 = r.terms.length === 1 && r.terms[0].label.startsWith("1d20") && r.terms[0].dice.find((d) => d.kept)?.v;
  return publish({
    kind: "expr", label: `${label}: ${expr.trim()}`, total: r.total, detail: r.text, shareDetail: r.text,
    crit: natural20 === 20, fumble: natural20 === 1,
  }, { share, who });
}

// ---------------------------------------------------------------- floating card

let card = null, hideTimer = null;

function showCard(entry) {
  if (!document.body) return;
  if (!card) {
    card = el("div", { class: "dnd-roll-card", role: "status", "aria-live": "polite" });
    document.body.appendChild(card);
    card.addEventListener("click", () => card.classList.remove("show"));
  }
  clearTimeout(hideTimer);
  card.className = `dnd-roll-card show ${entry.crit ? "crit" : entry.fumble ? "fumble" : ""}`;
  card.replaceChildren(
    el("div", { class: "dnd-roll-total" }, String(entry.total)),
    el("div", { class: "dnd-roll-info" }, [
      el("div", { class: "dnd-roll-label" }, entry.label),
      el("div", { class: "dnd-roll-detail" }, entry.detail || ""),
    ]),
  );
  hideTimer = setTimeout(() => card?.classList.remove("show"), 5200);
}
