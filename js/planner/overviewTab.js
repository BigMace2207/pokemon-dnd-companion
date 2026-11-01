// DM overview: a one-screen snapshot of where the campaign prep stands, with shortcuts into the other tabs.

import { el, btn, chip, section } from "../systems/dnd5e/ui.js";
import { getPlan, listProgress } from "./store.js";

export function renderOverviewTab(panel, { system, go, partyPlans }) {
  const plan = getPlan();
  const lists = plan.lists;
  const open = lists.reduce((n, l) => n + l.items.filter((i) => !i.done).length, 0);
  const total = lists.reduce((n, l) => n + l.items.length, 0);
  const byStatus = (s) => plan.scenarios.filter((x) => x.status === s).length;

  const next = plan.scenarios.filter((s) => s.status !== "played").sort((a, b) => (a.status === "ready" ? -1 : 1) - (b.status === "ready" ? -1 : 1) || b.updated - a.updated)[0];
  const nextScene = next?.scenes.find((s) => !s.done);

  const card = (title, body, actions) => section(title, [].concat(body), { actions });
  panel.append(el("div", { class: "dnd-grid-auto wide" }, [
    card("Next to run", next
      ? [el("p", {}, [el("strong", {}, next.title || "Untitled"), `  ${next.status === "ready" ? "(ready to run)" : "(draft)"}`]), nextScene ? el("p", { class: "dnd-muted" }, `Next scene: ${nextScene.title}`) : el("p", { class: "dnd-muted" }, "Every scene has been played."), btn("Open it", () => go("scenarios"), "btn small")]
      : [el("p", { class: "view-sub" }, "No scenario in progress."), btn("Write a scenario", () => go("scenarios"), "btn small")]),
    card("Prep checklists", lists.length
      ? [el("p", {}, `${open} open item${open === 1 ? "" : "s"} across ${lists.length} list${lists.length === 1 ? "" : "s"} (${total - open}/${total} done).`), ...lists.slice(0, 4).map((l) => { const p = listProgress(l); return el("div", { class: "pl-mini" }, [el("span", {}, l.title), el("div", { class: "dnd-hp-track pl-bar" }, el("div", { class: `dnd-hp-fill ${p.pct === 100 ? "good" : "warn"}`, style: `width:${p.pct}%` }))]); }), btn("Open checklists", () => go("lists"), "btn secondary small")]
      : [el("p", { class: "view-sub" }, "No checklists yet. Start from the session prep template."), btn("Create one", () => go("lists"), "btn small")]),
    card("Scenarios", [el("div", { class: "dnd-row tight" }, [chip(`${byStatus("draft")} draft`), chip(`${byStatus("ready")} ready`, "gold"), chip(`${byStatus("played")} played`)]), btn("Open scenarios", () => go("scenarios"), "btn secondary small")]),
    card("What the party wants", el("div", { id: "pl-party-snap" }, el("p", { class: "dnd-small dnd-muted" }, "Loading…")), btn("Party plans", () => go("party"), "btn secondary small")),
    card("Maps and generators", [el("p", {}, `${plan.maps.length} map${plan.maps.length === 1 ? "" : "s"}, ${plan.maps.reduce((n, m) => n + m.pins.length, 0)} labels.`), el("div", { class: "dnd-row" }, [btn("Maps", () => go("maps"), "btn secondary small"), btn("Generators", () => go("generators"), "btn secondary small")]), el("p", { class: "dnd-small dnd-muted" }, system === "pokemon-dnd" ? "Wild encounters, trainers, gym leaders, routes and more." : "NPCs, encounters, taverns, loot, dungeons and more.")]),
  ]));
  partyPlans().then((plans) => {
    const snap = panel.querySelector("#pl-party-snap");
    if (!snap) return;
    if (!plans) { snap.replaceChildren(el("p", { class: "dnd-small dnd-muted" }, "Couldn't load the party's plans.")); return; }
    if (!plans.length) { snap.replaceChildren(el("p", { class: "dnd-small dnd-muted" }, "No player has shared a plan yet.")); return; }
    snap.replaceChildren(...plans.slice(0, 6).map((p) => {
      const items = (p.plan.lists || []).flatMap((l) => (l.items || []).filter((i) => !i.done));
      return el("div", { class: "pl-mini" }, [el("strong", {}, p.name || "Player"), el("span", { class: "dnd-small dnd-muted" }, items.length ? ` — ${items[0].text}${items.length > 1 ? ` (+${items.length - 1} more)` : ""}` : " — nothing open")]);
    }));
  });
}
