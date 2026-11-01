// Checklists: any number of lists with progress bars, quick-add, bulk paste and ready-made templates for each
// system and role. Players' lists are shared with the DM; the DM's are private.

import { el, btn, chip, selectEl, textInput, toast, confirmDialog, modal, field, debounce } from "../systems/dnd5e/ui.js";
import { getPlan, mutatePlan, newList, listProgress, uid, batched } from "./store.js";

const T = {
  dm: {
    dnd5e: [
      ["Session prep (the eight steps)", ["Review the characters and what they want", "Think of a strong start", "Outline some potential scenes", "Define secrets and clues", "Develop fantastic locations", "Outline important NPCs", "Choose relevant monsters", "Select magic item rewards"]],
      ["Before the session", ["Message the players the time and place", "Print or open the maps", "Queue music and sound effects", "Pre-roll a few initiatives and names", "Skim the monsters' stat blocks", "Prepare handouts"]],
      ["Dungeon prep", ["Draw or generate the map", "Mark traps and secret doors", "Stock the rooms (monsters, treasure, features)", "Write the lair's boss tactics", "Decide how the party can retreat or escape"]],
    ],
    "pokemon-dnd": [
      ["Session prep", ["Check each trainer's team and goals", "Plan a strong opening scene", "Pick the route and its wild Pokémon table", "Write the trainers they will meet", "Prepare a rival or gang encounter", "Choose item and TM rewards"]],
      ["Gym prep", ["Decide the gym puzzle or gimmick", "Write the apprentices' teams", "Build the leader's team and ace", "Choose the badge reward and TM", "Plan what happens if they lose"]],
      ["Before the session", ["Message the players the time", "Open the maps", "Queue music and sound effects", "Refresh the wild and NPC rosters in the Control Centre"]],
    ],
  },
  player: {
    dnd5e: [
      ["Session goals", ["Decide what my character wants this session", "Tell the DM about it", "Find out who to talk to"]],
      ["Things to buy", ["Healing potions", "Better armour", "Ammunition", "Rope, rations and torches"]],
      ["Character goals", ["Next level-up choice", "Find a magic item that fits my build", "Resolve my backstory hook"]],
      ["Questions for the DM", []],
    ],
    "pokemon-dnd": [
      ["Pokémon to catch", ["A Pokémon of each type I'm missing", "Something to cover my team's weakness", "A fast scout"]],
      ["Gym badge plan", ["Check the next gym's type", "Train the team to the right level", "Buy healing items", "Learn a TM that counters the leader"]],
      ["Things to buy at the Mart", ["Poké Balls", "Potions", "Antidotes", "Repels"]],
      ["Training plan", ["Evolve my starter", "Teach a new move", "Level the weakest team member"]],
      ["Questions for the DM", []],
    ],
  },
};

export function renderListsTab(panel, { dm, system }) {
  const host = el("div", { class: "pl-lists" });
  const templates = (T[dm ? "dm" : "player"][system] || T[dm ? "dm" : "player"].dnd5e);
  const add = selectEl([["", "+ New checklist…"], ["blank", "Blank list"], ...templates.map(([name], i) => [`t${i}`, `Template: ${name}`])], "", (v) => {
    if (!v) return;
    const tpl = v === "blank" ? null : templates[Number(v.slice(1))];
    const l = tpl ? newList(tpl[0], tpl[1]) : newList("New checklist");
    mutatePlan((p) => { p.lists.unshift(l); });
    add.value = "";
    draw();
  });
  panel.append(
    el("p", { class: "pl-banner" }, dm ? "Private to you: players can't see your checklists." : "Your checklists are shared with your DM, so they know what you want to get done."),
    el("div", { class: "card" }, el("div", { class: "dnd-row" }, [add, btn("Paste a list…", pasteList, "btn secondary small")])),
    host,
  );

  function pasteList() {
    const title = textInput("", () => {}, { placeholder: "List name", ariaLabel: "List name" });
    const body = textInput("", () => {}, { multiline: true, rows: 10, placeholder: "One item per line. Lines starting with - [ ] or - are fine.", ariaLabel: "Items" });
    modal({
      title: "Paste a checklist", body: [field("Name", title), field("Items", body)],
      actions: [{ label: "Cancel" }, { label: "Create", cls: "btn", onClick: () => {
        const items = body.value.split("\n").map((l) => l.replace(/^\s*(?:[-*]\s*)?(?:\[[ xX]\]\s*)?/, "").trim()).filter(Boolean);
        if (!items.length) { toast("Add at least one line.", "bad"); return false; }
        mutatePlan((p) => { p.lists.unshift(newList(title.value.trim() || "Pasted list", items)); });
        draw();
        return true;
      } }],
    });
  }

  function edit(listId, fn) { mutatePlan((p) => { const l = p.lists.find((x) => x.id === listId); if (l) { fn(l); l.updated = Date.now(); } }); }

  function card(l) {
    const pr = listProgress(l);
    const bar = el("div", { class: "dnd-hp-track pl-bar" }, el("div", { class: `dnd-hp-fill ${pr.pct === 100 ? "good" : "warn"}`, style: `width:${pr.pct}%` }));
    const count = el("span", { class: "dnd-muted dnd-small" }, `${pr.done}/${pr.total}`);
    const saveTitle = batched((fns) => edit(l.id, (x) => fns.forEach((f) => f(x))), 400);
    const title = textInput(l.title, (v) => saveTitle((x) => { x.title = v; }), { ariaLabel: "Checklist name" });
    title.classList.add("pl-list-title");
    const items = el("div", { class: "pl-items" });
    const refresh = () => { const p2 = listProgress(getPlan().lists.find((x) => x.id === l.id) || l); bar.firstChild.style.width = `${p2.pct}%`; bar.firstChild.className = `dnd-hp-fill ${p2.pct === 100 ? "good" : "warn"}`; count.textContent = `${p2.done}/${p2.total}`; };
    function drawItems() {
      const cur = getPlan().lists.find((x) => x.id === l.id) || l;
      items.replaceChildren(...cur.items.map((it, i) => {
        const cb = el("input", { type: "checkbox", "aria-label": it.text });
        cb.checked = it.done;
        cb.addEventListener("change", () => { edit(l.id, (x) => { x.items.find((y) => y.id === it.id).done = cb.checked; }); text.classList.toggle("done", cb.checked); refresh(); });
        const saveText = batched((fns) => edit(l.id, (x) => { const r = x.items.find((y) => y.id === it.id); if (r) fns.forEach((f) => f(r)); }), 400);
        const text = textInput(it.text, (v) => saveText((r) => { r.text = v; }), { ariaLabel: "Item" });
        text.className = `pl-item-text${it.done ? " done" : ""}`;
        const up = btn("↑", () => { edit(l.id, (x) => { if (i > 0) [x.items[i - 1], x.items[i]] = [x.items[i], x.items[i - 1]]; }); drawItems(); }, "btn secondary tiny dnd-icon-btn", { "aria-label": "Move up" });
        const down = btn("↓", () => { edit(l.id, (x) => { if (i < x.items.length - 1) [x.items[i + 1], x.items[i]] = [x.items[i], x.items[i + 1]]; }); drawItems(); }, "btn secondary tiny dnd-icon-btn", { "aria-label": "Move down" });
        const del = btn("✕", () => { edit(l.id, (x) => { x.items = x.items.filter((y) => y.id !== it.id); }); drawItems(); refresh(); }, "btn secondary tiny dnd-icon-btn", { "aria-label": "Delete item" });
        return el("div", { class: "pl-item" }, [cb, text, up, down, del]);
      }));
    }
    const addIn = el("input", { type: "text", placeholder: "Add an item and press Enter", "aria-label": "Add an item", autocomplete: "off" });
    addIn.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || !addIn.value.trim()) return;
      const t = addIn.value.trim();
      edit(l.id, (x) => { x.items.push({ id: uid(), text: t, done: false }); });
      addIn.value = ""; drawItems(); refresh(); addIn.focus();
    });
    drawItems();
    return el("div", { class: "card pl-list" }, [
      el("div", { class: "dnd-row between" }, [title, count]),
      bar, items, addIn,
      el("div", { class: "dnd-row" }, [
        btn("Clear done", () => { edit(l.id, (x) => { x.items = x.items.filter((y) => !y.done); }); drawItems(); refresh(); }, "btn secondary tiny"),
        btn("Uncheck all", () => { edit(l.id, (x) => x.items.forEach((y) => { y.done = false; })); drawItems(); refresh(); }, "btn secondary tiny"),
        btn("Copy", () => { navigator.clipboard?.writeText(`${l.title}\n${(getPlan().lists.find((x) => x.id === l.id) || l).items.map((i) => `${i.done ? "[x]" : "[ ]"} ${i.text}`).join("\n")}`); toast("Copied.", "good"); }, "btn secondary tiny"),
        btn("Delete list", async () => { if (await confirmDialog(`Delete "${l.title}"?`, { ok: "Delete", danger: true })) { mutatePlan((p) => { p.lists = p.lists.filter((x) => x.id !== l.id); }); draw(); } }, "btn danger tiny"),
      ]),
    ]);
  }

  function draw() {
    const lists = getPlan().lists;
    host.replaceChildren(...(lists.length ? lists.map(card) : [el("div", { class: "card" }, el("p", { class: "view-sub" }, "No checklists yet. Pick a template above or start a blank one."))]));
  }
  draw();
  void chip;
}
