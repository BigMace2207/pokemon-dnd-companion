// The DM's view of the party: every trainer online, each Pokémon in their party with its health, status, ability,
// held item and moves, and what's in their bag. Read from what each trainer's app already shares (the presence ping:
// party, PC and bag), so it's live without anyone doing anything. Shown in the Control Centre's Players tab and in the
// DM's PARTY pull tab.

import { el, typePill } from "../components.js";
import { getRoster } from "../network.js";
import { getDmToken } from "../systems/dnd5e/dmAccess.js";
import { calcAllStats } from "../calc.js";
import { spriteUrl } from "../sprites.js";
import { trainerSpriteUrl } from "../trainerSpritePicker.js";

const REFRESH_MS = 5000;

export function hpOf(state, mon) {
  const species = state?.pokemonByName?.get(mon.name);
  const level = Math.min(100, Math.max(1, Number(mon.level) || 1));
  const max = species ? calcAllStats(species, level, 15, 0, 1).hp : null;
  const cur = mon.currentHp === null || mon.currentHp === undefined ? max : mon.currentHp;
  return { species, max, cur, pct: max ? Math.max(0, Math.min(100, (cur / max) * 100)) : 100 };
}

function monRow(state, mon) {
  const { species, max, cur, pct } = hpOf(state, mon);
  const dex = mon.dex || species?.dex;
  const tone = pct > 50 ? "good" : pct > 20 ? "warn" : "bad";
  const moves = (mon.moves || []).filter(Boolean);
  return el("div", { class: `dmp-mon${cur === 0 ? " fainted" : ""}` }, [
    dex ? el("img", { class: "dmp-sprite", src: spriteUrl(dex), alt: "" }) : el("span", { class: "dmp-sprite dmp-q" }, "?"),
    el("div", { class: "dmp-mon-main" }, [
      el("div", { class: "dmp-mon-top" }, [
        el("strong", {}, mon.nickname ? `${mon.nickname} (${mon.name})` : mon.name),
        el("span", { class: "dmp-lv" }, `Lv ${mon.level ?? "?"}`),
        ...[typePill(species?.type1), typePill(species?.type2)].filter(Boolean),
        mon.status && mon.status !== "None" ? el("span", { class: "dmp-status" }, mon.status) : null,
      ].filter(Boolean)),
      el("div", { class: "dmp-hp" }, [
        el("span", { class: "dmp-hp-bar" }, el("span", { class: tone, style: `width:${pct}%` })),
        el("span", { class: "dmp-hp-num" }, max === null ? "HP ?" : `${cur}/${max} HP`),
      ]),
      el("div", { class: "dmp-facts" }, [
        el("span", {}, [el("b", {}, "Ability "), mon.ability || "—"]),
        el("span", {}, [el("b", {}, "Item "), mon.item || "—"]),
      ]),
      el("div", { class: "dmp-moves" }, moves.length ? moves.map((m) => el("span", { class: "dmp-move" }, m)) : [el("span", { class: "dmp-none" }, "No moves set")]),
    ]),
  ]);
}

function bagList(bag) {
  const entries = Object.entries(bag && typeof bag === "object" ? bag : {}).filter(([, n]) => Number(n) > 0);
  if (!entries.length) return el("p", { class: "dmp-none" }, "Empty bag");
  return el("div", { class: "dmp-bag" }, entries.sort((a, b) => a[0].localeCompare(b[0])).map(([name, n]) => el("span", { class: "dmp-item" }, `${name} ×${n}`)));
}

export function renderDmParty(host, state) {
  const wrap = el("div", { class: "dmp" });
  host.replaceChildren(wrap);
  let sig = "";
  async function draw() {
    // everyone in the campaign (the DM's token brings their parties and bags), online first
    const roster = (await getRoster(getDmToken() || "")) || [];
    const rows = roster.sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name)).map((t) => ({ t, team: { party: t.party || [], bag: t.bag || {}, pc: [] } }));
    const next = JSON.stringify(rows.map(({ t, team }) => [t.id, t.name, t.sprite, t.online, team.party, team.bag, t.cash]));
    if (next === sig) return;
    sig = next;
    wrap.replaceChildren(...(rows.length ? rows.map(({ t, team }) => {
      const party = (team.party || []).filter((m) => m && m.name);
      return el("section", { class: "dmp-trainer" }, [
        el("div", { class: "dmp-trainer-head" }, [
          t.sprite ? el("img", { class: "dmp-portrait", src: trainerSpriteUrl(t.sprite), alt: "" }) : el("span", { class: "dmp-portrait dmp-initial" }, (t.name || "?")[0].toUpperCase()),
          el("div", {}, [el("strong", {}, [t.name || "Trainer", " ", el("span", { class: `dmo-status${t.online ? " on" : ""}` }, t.online ? "Online" : "Offline")]), el("span", { class: "dmp-sub" }, `${party.length} Pokémon in the party · £${(Number(t.cash) || 0).toLocaleString()}`)]),
        ]),
        el("div", { class: "dmp-party" }, party.length ? party.map((m) => monRow(state, m)) : [el("p", { class: "dmp-none" }, "No Pokémon in their party yet.")]),
        el("details", { class: "dmp-bag-wrap" }, [el("summary", {}, "Bag"), bagList(team.bag)]),
      ]);
    }) : [el("p", { class: "dmp-none" }, "Nobody has joined this campaign yet.")]));
  }
  draw();
  const timer = setInterval(() => { if (!document.body.contains(wrap)) { clearInterval(timer); return; } if (!document.hidden) draw(); }, REFRESH_MS);
}
