// Party plans (DM only): what each player has written and what they want to get done. "Everyone" shows every open
// checklist item at the table grouped by player, to plan a session around; picking one player shows their notes and
// checklists in full. Read-only: the players edit their own. Refreshes every 20 seconds while open.

import { el, btn, chip, toast } from "../systems/dnd5e/ui.js";
import { getAllPlans } from "../network.js";
import { renderMarkdown } from "../markdown.js";
import { listProgress } from "./store.js";
import { loadSave } from "../storage.js";
import { normalizeBoard } from "./board.js";
import { renderBoardApp } from "./boardView.js";

const ago = (ts) => {
  if (!ts) return "never";
  const s = Math.max(0, Date.now() / 1000 - ts);
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(ts * 1000).toLocaleDateString();
};

const openItems = (plan) => (plan.lists || []).flatMap((l) => (l.items || []).filter((i) => !i.done).map((i) => ({ list: l.title, text: i.text })));

export function renderPartyTab(panel, { token, onLoaded }) {
  const me = loadSave().networkId;
  let plans = [];
  let selected = "all";
  let status = "Loading…";
  let timer = null, lastSig = "";
  const bar = el("div", { class: "dnd-row tight", role: "tablist", "aria-label": "Players" });
  const body = el("div", { class: "dnd-stack" });
  const stamp = el("span", { class: "dnd-small dnd-muted" });

  async function load(manual = false) {
    const res = await getAllPlans(token);
    if (res === null) { status = "Couldn't load the plans (offline, or your DM access has expired)."; }
    else {
      const next = res.filter((p) => p.id !== me).sort((a, b) => a.name.localeCompare(b.name));
      const sig = JSON.stringify(next.map((p) => [p.id, p.updated]));
      if (!manual && sig === lastSig && !status) return;   // nothing changed: don't rebuild (it would reset a board you're looking at)
      lastSig = sig; plans = next; status = ""; onLoaded?.(plans);
    }
    stamp.textContent = res ? `Updated ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : "";
    draw();
    if (manual && res) toast("Refreshed.", "good");
  }

  function draw() {
    bar.replaceChildren(
      pill("Everyone", "all", `${plans.reduce((n, p) => n + openItems(p.plan).length, 0)} open`),
      ...plans.map((p) => pill(p.name || "Player", p.id, `${openItems(p.plan).length} open`)),
    );
    if (status) { body.replaceChildren(el("div", { class: "card" }, el("p", { class: "view-sub" }, status))); return; }
    if (!plans.length) { body.replaceChildren(el("div", { class: "card" }, [el("h4", {}, "No plans shared yet"), el("p", { class: "view-sub" }, "When your players write notes or checklists in their Campaign Planner, they show up here. They are shared automatically.")])); return; }
    if (selected !== "all" && !plans.some((p) => p.id === selected)) selected = "all";
    body.replaceChildren(selected === "all" ? everyone() : player(plans.find((p) => p.id === selected)));
  }

  function pill(label, id, meta) {
    const b = el("button", { type: "button", role: "tab", class: `pill-btn${selected === id ? " active" : ""}`, "aria-selected": String(selected === id) }, `${label} · ${meta}`);
    b.addEventListener("click", () => { selected = id; draw(); });
    return b;
  }

  function everyone() {
    return el("div", { class: "dnd-grid-auto wide" }, plans.map((p) => {
      const items = openItems(p.plan);
      return el("div", { class: "card" }, [
        el("div", { class: "dnd-section-head" }, [el("h4", {}, p.name || "Player"), chip(`edited ${ago(p.updated)}`)]),
        items.length
          ? el("ul", { class: "pl-open" }, items.slice(0, 14).map((i) => el("li", {}, [i.text, el("span", { class: "dnd-small dnd-muted" }, `  — ${i.list}`)])))
          : el("p", { class: "dnd-small dnd-muted" }, "Nothing on their to-do lists."),
        items.length > 14 ? el("p", { class: "dnd-small dnd-muted" }, `…and ${items.length - 14} more`) : null,
        el("div", { class: "dnd-row tight" }, [chip(`${(p.plan.notes || []).length} notes`), chip(`${(p.plan.lists || []).length} lists`), btn("Open", () => { selected = p.id; draw(); }, "btn secondary tiny")]),
      ].filter(Boolean));
    }));
  }

  function player(p) {
    const notes = [...(p.plan.notes || [])].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.updated - a.updated);
    const lists = p.plan.lists || [];
    const boards = (p.plan.boards || []).map(normalizeBoard).filter((b) => b.id);
    const boardHost = el("div", { class: "pl-party-boards" });
    if (boards.length) renderBoardApp(boardHost, { system: "", readonly: true, boards });
    return el("div", { class: "dnd-stack" }, [boards.length ? el("h3", {}, `${p.name || "Player"}’s whiteboards`) : null, boards.length ? boardHost : null, el("div", { class: "dnd-grid-2" }, [
      el("div", { class: "dnd-stack" }, [
        el("h3", {}, `${p.name || "Player"}’s notes`),
        ...(notes.length ? notes.map((n, i) => el("details", { class: "dnd-fold", open: i === 0 ? "" : null }, [el("summary", {}, `${n.pinned ? "★ " : ""}${n.title || "Untitled"}`), renderMarkdown(n.body || "")])) : [el("p", { class: "view-sub" }, "No notes.")]),
      ]),
      el("div", { class: "dnd-stack" }, [
        el("h3", {}, "Checklists"),
        ...(lists.length ? lists.map((l) => {
          const pr = listProgress({ items: l.items || [] });
          return el("div", { class: "card" }, [
            el("div", { class: "dnd-row between" }, [el("strong", {}, l.title), el("span", { class: "dnd-small dnd-muted" }, `${pr.done}/${pr.total}`)]),
            el("div", { class: "dnd-hp-track pl-bar" }, el("div", { class: `dnd-hp-fill ${pr.pct === 100 ? "good" : "warn"}`, style: `width:${pr.pct}%` })),
            el("div", { class: "pl-items readonly" }, (l.items || []).map((i) => el("div", { class: `pl-item${i.done ? " done" : ""}` }, [el("span", { class: "pl-tick", "aria-hidden": "true" }, i.done ? "☑" : "☐"), el("span", { class: i.done ? "pl-item-text done" : "pl-item-text" }, i.text)]))),
          ]);
        }) : [el("p", { class: "view-sub" }, "No checklists.")]),
      ]),
    ])]);
  }

  panel.append(el("div", { class: "dnd-row between" }, [el("p", { class: "pl-banner", style: "margin:0" }, "Read-only. Your players write these in their own planner; they appear here automatically."), el("div", { class: "dnd-row" }, [stamp, btn("Refresh", () => load(true), "btn secondary small")])]), bar, body);
  load();
  timer = setInterval(() => { if (!document.body.contains(body)) { clearInterval(timer); return; } if (!document.hidden) load(); }, 20000);
}
