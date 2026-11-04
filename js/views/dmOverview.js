// The Control Centre's Overview: one big board with everything the DM needs at a glance, kept live. The current
// battle (phase, round, whose turn it is, what they chose, every combatant's health), the whole party (each trainer's
// Pokémon with health, status and held item, and what's in their bag), messages from players, and the battle log.
// Each panel links to the page where you act on it.

import { el } from "../components.js";
import { getRoster, getFullTurn, getDmInbox, getBattleLog, dmAction } from "../network.js";
import { spriteUrl } from "../sprites.js";
import { trainerSpriteUrl } from "../trainerSpritePicker.js";
import { hpOf } from "./dmParty.js";
import { combatantLabel } from "../battleLabels.js";

const REFRESH_MS = 4000;

const hpBar = (pct) => el("span", { class: "dmo-hp" }, el("span", { class: pct > 50 ? "good" : pct > 20 ? "warn" : "bad", style: `width:${pct}%` }));

export function renderDmOverview(host, state, token, { go }) {
  const battle = el("section", { class: "dmo-panel dmo-battle" });
  const party = el("section", { class: "dmo-panel dmo-party" });
  const inbox = el("section", { class: "dmo-panel dmo-inbox" });
  const log = el("section", { class: "dmo-panel dmo-log" });
  const board = el("div", { class: "dmo-board" }, [battle, party, inbox, log]);
  host.replaceChildren(board);
  const head = (title, linkLabel, view) => {
    const b = linkLabel ? el("button", { type: "button", class: "dmo-link" }, `${linkLabel} →`) : null;
    b?.addEventListener("click", () => go(view));
    return el("div", { class: "dmo-head" }, [el("h3", {}, title), b].filter(Boolean));
  };
  let sig = "";

  async function draw() {
    const [roster, ft, messages, entries] = await Promise.all([getRoster(token), getFullTurn(), getDmInbox(token), getBattleLog()]);
    // everyone in the campaign, online first; away players show what they had when they last saved
    const teams = (roster || []).sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name))
      .map((t) => ({ t, team: { party: t.party || [], bag: t.bag || {}, cash: t.cash } }));
    const next = JSON.stringify([teams.map(({ t, team }) => [t.id, t.name, t.online, team.party, team.bag, team.cash]), ft, messages, entries.length, entries[entries.length - 1]?.id]);
    if (next === sig) return;
    sig = next;

    // ---- the battle
    const combatants = ft?.combatants || [];
    const up = ft?.turnId ? combatants.find((c) => c.id === ft.turnId) : combatants[ft?.currentIndex || 0];
    const phase = !combatants.length ? "No battle set up" : ft.phase === "live" ? `Live · round ${ft.round || 1}` : ft.phase === "vs" ? "VS screen (players see the intro)" : "Drafting (players can't see it yet)";
    battle.replaceChildren(
      head("Battle", "Battle Control", "battle"),
      el("div", { class: "dmo-chips" }, [el("span", { class: `dmo-chip${ft?.phase === "live" ? " live" : ""}` }, phase), up && ft?.phase === "live" ? el("span", { class: "dmo-chip" }, `Turn: ${combatantLabel(up)}`) : null].filter(Boolean)),
      ...(ft?.acted && up && ft.acted.combatantId === up.id ? [el("p", { class: "dmo-choice" }, [el("b", {}, "Their choice: "), ft.acted.text || ft.acted.kind])] : []),
      combatants.length ? el("div", { class: "dmo-fighters" }, ["A", "B"].map((side) => el("div", { class: "dmo-side" }, [
        el("span", { class: "dmo-side-name" }, side === "A" ? "Side A" : "Side B"),
        ...combatants.filter((c) => (c.side || "A") === side).map((c) => {
          const { species, max, cur, pct } = hpOf(state, c.mon || {});
          const dex = c.mon?.dex || species?.dex;
          return el("div", { class: `dmo-fighter${up?.id === c.id ? " up" : ""}${cur === 0 ? " out" : ""}` }, [
            dex ? el("img", { src: spriteUrl(dex), alt: "" }) : el("span", { class: "dmo-q" }, "?"),
            el("div", {}, [el("strong", {}, combatantLabel(c)), hpBar(pct), el("span", { class: "dmo-sub" }, max === null ? "HP ?" : `${cur}/${max} HP${c.mon?.status && c.mon.status !== "None" ? ` · ${c.mon.status}` : ""}`)]),
          ]);
        }),
      ]))) : el("p", { class: "dmo-empty" }, "Start one from an encounter button on the hub, or build it in Battle Control."),
    );

    // ---- the party
    const onlineCount = teams.filter(({ t }) => t.online).length;
    party.replaceChildren(head(`Party (${onlineCount} of ${teams.length} online)`, "Players", "players"), ...(teams.length ? teams.map(({ t, team }) => {
      const mons = (team.party || []).filter((m) => m && m.name);
      const bag = Object.entries(team.bag || {}).filter(([, n]) => Number(n) > 0);
      return el("div", { class: `dmo-trainer${t.online ? "" : " offline"}` }, [
        el("div", { class: "dmo-trainer-name" }, [
          t.sprite ? el("img", { src: trainerSpriteUrl(t.sprite), alt: "" }) : el("span", { class: "dmo-initial" }, (t.name || "?")[0].toUpperCase()),
          el("strong", {}, t.name || "Trainer"),
          el("span", { class: `dmo-status${t.online ? " on" : ""}` }, t.online ? "Online" : "Offline"),
          el("span", { class: "dmo-cash" }, `£${(Number(team.cash) || 0).toLocaleString()}`),
        ]),
        el("div", { class: "dmo-mons" }, mons.length ? mons.map((m) => {
          const { species, max, cur, pct } = hpOf(state, m);
          const dex = m.dex || species?.dex;
          return el("div", { class: `dmo-mon${cur === 0 ? " out" : ""}`, title: `${m.nickname || m.name} · Lv ${m.level ?? "?"} · ${max === null ? "HP ?" : `${cur}/${max} HP`}${m.item ? ` · holding ${m.item}` : ""}${(m.moves || []).filter(Boolean).length ? `\nMoves: ${m.moves.filter(Boolean).join(", ")}` : ""}` }, [
            dex ? el("img", { src: spriteUrl(dex), alt: "" }) : el("span", { class: "dmo-q" }, "?"),
            el("span", { class: "dmo-mon-name" }, `${m.nickname || m.name} ${m.level ?? ""}`),
            hpBar(pct),
            m.item ? el("span", { class: "dmo-held" }, m.item) : null,
          ].filter(Boolean));
        }) : [el("span", { class: "dmo-empty" }, "No team yet")]),
        el("div", { class: "dmo-bag" }, bag.length ? bag.slice(0, 12).map(([name, n]) => el("span", {}, `${name} ×${n}`)) : [el("span", { class: "dmo-empty" }, "Empty bag")]),
      ]);
    }) : [el("p", { class: "dmo-empty" }, "Nobody has joined this campaign yet.")]));

    // ---- messages from players
    inbox.replaceChildren(head(`Messages (${messages.length})`), ...(messages.length ? [...messages].reverse().slice(0, 20).map((m) => {
      const x = el("button", { type: "button", class: "dmo-dismiss", "aria-label": "Dismiss", title: "Dismiss" }, "×");
      x.addEventListener("click", async () => { await dmAction(token, "dmInboxClear", { ids: [m.id] }); sig = ""; draw(); });
      return el("div", { class: "dmo-msg" }, [el("div", {}, [el("strong", {}, m.fromName || "A trainer"), el("span", {}, m.text)]), x]);
    }) : [el("p", { class: "dmo-empty" }, "No messages.")]));

    // ---- the battle log
    log.replaceChildren(head("Battle log"), el("div", { class: "dmo-log-list" }, entries.length ? [...entries].reverse().slice(0, 30).map((e) => el("div", { class: "dmo-log-row" }, [
      el("span", { class: "dmo-sub" }, new Date(e.ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })), el("strong", {}, e.fromName || "Someone"), el("span", {}, e.text),
    ])) : [el("p", { class: "dmo-empty" }, "Nothing logged yet.")]));
  }
  draw();
  const timer = setInterval(() => { if (!document.body.contains(board)) { clearInterval(timer); return; } if (!document.hidden) draw(); }, REFRESH_MS);
}
