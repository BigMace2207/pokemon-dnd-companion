// The party: every D&D character that's online in this campaign, with live HP and status.
// Characters publish a small summary (name, HP, AC, conditions...) with the app's presence
// ping; this page just reads those back and refreshes while it is open.

import { el, btn, chip, section } from "../ui.js";
import { pageTitle } from "./common.js";
import { hpBar } from "../components/hpBar.js";
import { listTrainers, getTrainerTeam } from "../../../network.js";
import { loadSave } from "../../../storage.js";

export function renderParty(container) {
  container.replaceChildren();
  container.append(...pageTitle("The Party", "Everyone in the campaign who has a D&D character open. Updates every few seconds."));
  const summary = el("div", { class: "dnd-row" });
  const grid = el("div", { class: "dnd-grid-auto wide" }, el("p", { class: "view-sub" }, "Looking for adventurers…"));
  const stamp = el("span", { class: "dnd-muted dnd-small" });
  container.append(el("div", { class: "dnd-row between", style: "margin-bottom:12px" }, [summary, el("div", { class: "dnd-row" }, [stamp, btn("Refresh", load, "btn secondary small")])]), grid);

  let timer = null, busy = false;
  async function load() {
    if (busy) return;
    busy = true;
    try {
      const me = loadSave().networkId;
      const trainers = await listTrainers("");
      const rows = [];
      for (const t of trainers) {
        const res = await getTrainerTeam(t.id);
        const s = res?.team?.dnd;
        if (s) rows.push({ t, s, mine: t.id === me });
      }
      draw(rows);
      stamp.textContent = `Updated ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
    } catch {
      stamp.textContent = "Couldn't reach the server.";
    } finally { busy = false; }
  }

  function draw(rows) {
    summary.replaceChildren(...(rows.length ? [
      chip(`${rows.length} adventurer${rows.length === 1 ? "" : "s"}`, "gold"),
      chip(`Avg level ${(rows.reduce((n, r) => n + (r.s.level || 0), 0) / rows.length).toFixed(1)}`),
      chip(`Best passive Perception ${Math.max(...rows.map((r) => r.s.passivePerception || 0))}`),
      chip(`Party HP ${rows.reduce((n, r) => n + (r.s.hp || 0), 0)} / ${rows.reduce((n, r) => n + (r.s.maxHp || 0), 0)}`),
    ] : []));
    grid.replaceChildren(...(rows.length ? rows.map(({ t, s, mine }) => card(t, s, mine)) : [el("p", { class: "view-sub" }, "Nobody has a D&D character open right now. Create one under Characters and it will appear here for the rest of the table.")]));
  }

  load();
  timer = setInterval(() => { if (!document.body.contains(grid)) { clearInterval(timer); return; } if (!document.hidden) load(); }, 8000);
}

function card(t, s, mine) {
  const down = s.hp === 0;
  return el("div", { class: `card dnd-party-card${down ? " down" : ""}` }, [
    el("div", { class: "dnd-row" }, [
      s.portrait ? el("img", { class: "dnd-portrait", src: s.portrait, alt: "" }) : el("div", { class: "dnd-portrait placeholder" }, (s.name || "?").charAt(0).toUpperCase()),
      el("div", { class: "dnd-grow" }, [
        el("strong", {}, `${s.name || t.name}${mine ? " (you)" : ""}`),
        el("div", { class: "dnd-muted dnd-small" }, [s.race, s.classes].filter(Boolean).join(" · ")),
        el("div", { class: "dnd-muted dnd-tiny" }, `Played by ${t.name}`),
      ]),
      chip(`Lv ${s.level}`, "gold"),
    ]),
    hpBar(s.hp, s.maxHp, s.tempHp),
    el("div", { class: "dnd-row tight dnd-stat-strip" }, [
      chip(`AC ${s.ac}`), chip(`Speed ${s.speed}`), chip(`Init ${s.initiative >= 0 ? "+" : ""}${s.initiative}`), chip(`PP ${s.passivePerception}`),
      s.dc ? chip(`Spell DC ${s.dc}`) : null, s.inspiration ? chip("★ Inspired", "gold") : null, s.exhaustion ? chip(`Exhaustion ${s.exhaustion}`, "bad") : null,
    ].filter(Boolean)),
    s.concentration ? el("div", { class: "dnd-small" }, [el("strong", {}, "Concentrating: "), s.concentration]) : null,
    s.conditions?.length ? el("div", { class: "dnd-row tight" }, s.conditions.map((c) => chip(c, "bad"))) : null,
    down && s.deathSaves ? el("div", { class: "dnd-small" }, `Death saves: ${s.deathSaves.s} success, ${s.deathSaves.f} failure`) : null,
  ].filter(Boolean));
}

export { section };
