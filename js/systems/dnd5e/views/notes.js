// Campaign notes for the DM: free notes, NPCs, quests, locations and session recaps.
// Everything lives in the DM's own save (private), written in Markdown with a live preview.

import { el, btn, chip, tabs, textInput, selectEl, field, toast, confirmDialog, download, checkbox } from "../ui.js";
import { pageTitle } from "./common.js";
import { getDm, updateDm } from "../store.js";
import { uid } from "../engine/character.js";
import { renderMarkdown } from "../../../markdown.js";

const KINDS = {
  notes: { label: "Notes", singular: "note", extra: [], title: "Title" },
  npcs: { label: "NPCs", singular: "NPC", title: "Name", extra: [{ key: "role", label: "Role / occupation" }, { key: "attitude", label: "Attitude", options: ["Friendly", "Neutral", "Wary", "Hostile", "Unknown"] }] },
  quests: { label: "Quests", singular: "quest", title: "Quest", extra: [{ key: "status", label: "Status", options: ["Rumour", "Active", "Completed", "Failed"] }, { key: "giver", label: "Given by" }, { key: "reward", label: "Reward" }] },
  locations: { label: "Locations", singular: "location", title: "Name", extra: [{ key: "kind", label: "Kind (town, dungeon, tavern…)" }] },
  sessions: { label: "Sessions", singular: "session", title: "Title", extra: [{ key: "date", label: "Date", type: "date" }, { key: "level", label: "Party level" }] },
};

export function renderNotes(container) {
  container.replaceChildren();
  container.append(...pageTitle("Campaign Notes", "Your private DM notebook: notes, NPCs, quests, locations and session recaps, all in Markdown."));
  const t = tabs(Object.entries(KINDS).map(([id, k]) => ({ id, label: `${k.label} (${(getDm()[id] || []).length})`, render: (p) => renderKind(p, id, k) })), { stateKey: "dnd:notes:tab", initial: "notes" });
  const exportBtn = btn("Export everything (.md)", () => download("campaign-notes.md", exportAll(), "text/markdown"), "btn secondary small");
  container.append(el("div", { class: "dnd-row between", style: "margin-bottom:8px" }, [el("span"), exportBtn]), t.bar, t.panel);
}

function exportAll() {
  const dm = getDm();
  const out = ["# Campaign notes", ""];
  for (const [id, k] of Object.entries(KINDS)) {
    const list = dm[id] || [];
    if (!list.length) continue;
    out.push(`## ${k.label}`, "");
    for (const n of list) {
      out.push(`### ${n.name || "Untitled"}`);
      for (const e of k.extra) if (n[e.key]) out.push(`- **${e.label}:** ${n[e.key]}`);
      if (n.tags) out.push(`- **Tags:** ${n.tags}`);
      out.push("", n.notes || "", "");
    }
  }
  return out.join("\n");
}

function renderKind(panel, id, kind) {
  let selected = null;
  let query = "";
  let filter = "";
  const listHost = el("div", { class: "dnd-list", role: "listbox" });
  const editorHost = el("div", { class: "card dnd-detail" });
  const q = el("input", { type: "text", placeholder: `Search ${kind.label.toLowerCase()}…`, autocomplete: "off", "aria-label": "Search" });
  q.addEventListener("input", () => { query = q.value.toLowerCase(); drawList(); });
  const statusFilter = id === "quests" ? selectEl([["", "Any status"], ...kind.extra[0].options.map((o) => [o, o])], "", (v) => { filter = v; drawList(); }) : null;

  const items = () => getDm()[id] || [];
  function drawList() {
    const rows = items().filter((n) => (!query || `${n.name} ${n.notes || ""} ${n.tags || ""} ${n.role || ""}`.toLowerCase().includes(query)) && (!filter || n.status === filter));
    listHost.replaceChildren(...(rows.length ? rows.map((n) => {
      const b = el("button", { type: "button", class: `dnd-list-item${n.id === selected ? " active" : ""}`, role: "option", "aria-selected": String(n.id === selected) }, [
        el("span", { class: "dnd-grow" }, n.name || "Untitled"),
        el("span", { class: "meta" }, n.status || n.kind || n.role || (n.date ? n.date : "")),
      ]);
      b.addEventListener("click", () => { selected = n.id; drawList(); drawEditor(); });
      return b;
    }) : [el("p", { class: "view-sub", style: "padding:12px" }, items().length ? "Nothing matches." : `No ${kind.label.toLowerCase()} yet.`)]));
  }

  function create() {
    const rec = { id: uid(), name: "", notes: "", created: Date.now(), updated: Date.now() };
    for (const e of kind.extra) rec[e.key] = e.options ? e.options[e.key === "status" ? 1 : 0] : e.type === "date" ? new Date().toISOString().slice(0, 10) : "";
    updateDm((dm) => { (dm[id] ||= []).unshift(rec); });
    selected = rec.id; drawList(); drawEditor();
    editorHost.querySelector("input[type=text]")?.focus();
  }

  function drawEditor() {
    const n = items().find((x) => x.id === selected);
    if (!n) { editorHost.replaceChildren(el("p", { class: "view-sub" }, `Pick a ${kind.singular} or create a new one.`)); return; }
    const patch = (key, value) => { updateDm((dm) => { const r = dm[id].find((x) => x.id === n.id); if (r) { r[key] = value; r.updated = Date.now(); } }); };
    const preview = el("div", { class: "dnd-notes-preview" });
    const body = textInput(n.notes || "", (v) => { patch("notes", v); if (showPreview.querySelector("input").checked) preview.replaceChildren(renderMarkdown(v)); }, { multiline: true, rows: 14, placeholder: "Write in Markdown…  **bold**, *italic*, # headings, - lists, > quotes, tables" });
    const showPreview = checkbox("Preview", false, (on) => { preview.hidden = !on; body.hidden = on; if (on) preview.replaceChildren(renderMarkdown(body.value)); });
    preview.hidden = true;
    const nameIn = textInput(n.name, (v) => { patch("name", v); const row = listHost.querySelector(".active .dnd-grow"); if (row) row.textContent = v || "Untitled"; }, { placeholder: kind.title, ariaLabel: kind.title });
    nameIn.classList.add("dnd-name-input");
    const extras = kind.extra.map((e) => field(e.label, e.options ? selectEl(e.options.map((o) => [o, o]), n[e.key] || e.options[0], (v) => { patch(e.key, v); drawList(); }) : e.type === "date" ? Object.assign(el("input", { type: "date", value: n[e.key] || "" }), {}) : textInput(n[e.key] || "", (v) => patch(e.key, v))));
    extras.forEach((f, i) => { if (kind.extra[i].type === "date") f.querySelector("input").addEventListener("change", (ev) => patch("date", ev.target.value)); });
    editorHost.replaceChildren(
      nameIn,
      extras.length ? el("div", { class: "dnd-grid-2" }, extras) : null,
      field("Tags (comma separated)", textInput(n.tags || "", (v) => patch("tags", v))),
      el("div", { class: "dnd-row between" }, [showPreview, chip(`Edited ${new Date(n.updated || n.created).toLocaleDateString()}`)]),
      body, preview,
      el("div", { class: "dnd-row" }, [
        btn("Delete", async () => { if (await confirmDialog(`Delete "${n.name || "this entry"}"?`, { ok: "Delete", danger: true })) { updateDm((dm) => { dm[id] = dm[id].filter((x) => x.id !== n.id); }); selected = null; drawList(); drawEditor(); toast("Deleted.", ""); } }, "btn danger small"),
        id === "npcs" || id === "quests" ? btn("Copy as text", () => { navigator.clipboard?.writeText(`${n.name}\n${n.notes || ""}`); toast("Copied.", "good"); }, "btn secondary small") : null,
      ].filter(Boolean)),
    );
  }

  panel.append(el("div", { class: "dnd-split" }, [
    el("div", {}, [el("div", { class: "card", style: "margin-bottom:12px" }, [el("div", { class: "dnd-row" }, [el("div", { class: "dnd-grow" }, q), btn("+ New", create, "btn small")]), statusFilter ? field("Status", statusFilter) : null].filter(Boolean)), listHost]),
    editorHost,
  ]));
  selected = items()[0]?.id || null;
  drawList(); drawEditor();
}
