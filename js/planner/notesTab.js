// Notes: a searchable list and a Markdown editor with preview. Players' notes are shared with the DM (the banner
// says so); the DM's notes are private.

import { el, btn, chip, textInput, field, selectEl, download, debounce, toast, confirmDialog } from "../systems/dnd5e/ui.js";
import { renderMarkdown } from "../markdown.js";
import { getPlan, mutatePlan, newNote, batched, uid } from "./store.js";
import { getDm } from "../systems/dnd5e/store.js";

// A note can be a plain note or a record with a few extra fields, so the planner also holds what the old Campaign Notes page did:
// NPCs, quests, locations and session recaps.
export const NOTE_KINDS = {
  note: { label: "Notes", one: "note", extra: [] },
  npc: { label: "NPCs", one: "NPC", extra: [{ key: "role", label: "Role / occupation" }, { key: "attitude", label: "Attitude", options: ["Friendly", "Neutral", "Wary", "Hostile", "Unknown"] }] },
  quest: { label: "Quests", one: "quest", extra: [{ key: "status", label: "Status", options: ["Rumour", "Active", "Completed", "Failed"] }, { key: "giver", label: "Given by" }, { key: "reward", label: "Reward" }] },
  location: { label: "Locations", one: "location", extra: [{ key: "place", label: "Kind (town, dungeon, tavern…)" }] },
  session: { label: "Sessions", one: "session", extra: [{ key: "date", label: "Date", type: "date" }, { key: "level", label: "Party level" }] },
};
const kindOf = (n) => (NOTE_KINDS[n.kind] ? n.kind : "note");
const sub = (n) => { const k = NOTE_KINDS[kindOf(n)]; return k.extra.map((e) => n.fields?.[e.key]).filter(Boolean).slice(0, 1).join(""); };

// Notes written on the old Campaign Notes page (stored in the DM's D&D data) are copied in once; the originals are left where they were.
const LEGACY = { notes: "note", npcs: "npc", quests: "quest", locations: "location", sessions: "session" };
function importLegacy() {
  const plan = getPlan();
  if (plan.legacyImported) return;
  const dm = getDm();
  const rows = [];
  for (const [key, kind] of Object.entries(LEGACY)) {
    for (const r of dm[key] || []) {
      const fields = {};
      for (const e of NOTE_KINDS[kind].extra) { const v = e.key === "place" ? r.kind : r[e.key]; if (v) fields[e.key] = String(v); }
      rows.push({ id: uid(), kind, title: r.name || "", body: r.notes || "", tags: String(r.tags || "").split(",").map((t) => t.trim()).filter(Boolean), fields, pinned: false, created: r.created || Date.now(), updated: r.updated || r.created || Date.now() });
    }
  }
  mutatePlan((p) => { p.notes.push(...rows); p.legacyImported = true; });
}

function exportAll(notes) {
  const out = ["# Campaign notes", ""];
  for (const [id, k] of Object.entries(NOTE_KINDS)) {
    const list = notes.filter((n) => kindOf(n) === id);
    if (!list.length) continue;
    out.push(`## ${k.label}`, "");
    for (const n of list) {
      out.push(`### ${n.title || "Untitled"}`);
      for (const e of k.extra) if (n.fields?.[e.key]) out.push(`- **${e.label}:** ${n.fields[e.key]}`);
      if ((n.tags || []).length) out.push(`- **Tags:** ${n.tags.join(", ")}`);
      out.push("", n.body || "", "");
    }
  }
  return out.join("\n");
}

const ago = (ts) => {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(ts).toLocaleDateString();
};

export function renderNotesTab(panel, { dm }) {
  if (dm) importLegacy();
  let selected = getPlan().notes[0]?.id || null;
  let query = "";
  let tagFilter = "";
  let kindFilter = "";
  let preview = false;

  const list = el("div", { class: "dnd-list", role: "listbox" });
  const editor = el("div", { class: "card dnd-detail" });
  const q = el("input", { type: "search", placeholder: "Search notes…", autocomplete: "off", "aria-label": "Search notes" });
  const tagBar = el("div", { class: "dnd-chip-row" });
  const kindBar = el("div", { class: "dnd-chip-row", role: "tablist", "aria-label": "Kind of note" });
  const newBtn = btn("+ New note", () => create(), "btn small");
  q.addEventListener("input", () => { query = q.value.toLowerCase(); drawList(); });

  const notes = () => getPlan().notes;

  function drawList() {
    const all = notes();
    kindBar.replaceChildren(...[["", "All"], ...Object.entries(NOTE_KINDS).map(([id, k]) => [id, k.label])].map(([id, label]) => {
      const count = id ? all.filter((n) => kindOf(n) === id).length : all.length;
      if (id && !count && id !== "note" && kindFilter !== id) return null;
      const b = el("button", { type: "button", role: "tab", "aria-selected": String(kindFilter === id), class: `dnd-chip dnd-pickable${kindFilter === id ? " accent selected" : ""}` }, `${label} ${count}`);
      b.addEventListener("click", () => { kindFilter = id; drawList(); });
      return b;
    }).filter(Boolean));
    newBtn.textContent = `+ New ${kindFilter ? NOTE_KINDS[kindFilter].one : "note"}`;
    const tags = [...new Set(all.flatMap((n) => n.tags || []))].sort();
    tagBar.replaceChildren(...(tags.length ? [btnTag("All", ""), ...tags.map((t) => btnTag(t, t))] : []));
    const rows = all
      .filter((n) => (!query || `${n.title} ${n.body} ${(n.tags || []).join(" ")} ${Object.values(n.fields || {}).join(" ")}`.toLowerCase().includes(query)) && (!tagFilter || (n.tags || []).includes(tagFilter)) && (!kindFilter || kindOf(n) === kindFilter))
      .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.updated - a.updated);
    list.replaceChildren(...(rows.length ? rows.map((n) => {
      const b = el("button", { type: "button", class: `dnd-list-item${n.id === selected ? " active" : ""}`, role: "option", "aria-selected": String(n.id === selected) }, [
        el("span", { class: "dnd-grow" }, `${n.pinned ? "★ " : ""}${n.title || "Untitled"}`), el("span", { class: "meta" }, sub(n) || ago(n.updated)),
      ]);
      b.addEventListener("click", () => { selected = n.id; preview = false; drawList(); drawEditor(); });
      return b;
    }) : [el("p", { class: "view-sub", style: "padding:12px" }, all.length ? "Nothing matches." : "No notes yet. Press “+ New note”.")]));
  }
  function btnTag(label, value) {
    const b = el("button", { type: "button", class: `dnd-chip dnd-pickable${tagFilter === value ? " accent selected" : ""}` }, label);
    b.addEventListener("click", () => { tagFilter = value; drawList(); });
    return b;
  }

  function create() {
    const n = newNote("", "");
    if (kindFilter && kindFilter !== "note") { n.kind = kindFilter; n.fields = {}; for (const e of NOTE_KINDS[kindFilter].extra) if (e.options) n.fields[e.key] = e.options[e.key === "status" ? 1 : 0]; }
    mutatePlan((p) => { p.notes.unshift(n); });
    selected = n.id; preview = false;
    drawList(); drawEditor();
    editor.querySelector("input[type=text]")?.focus();
  }

  function drawEditor() {
    const n = notes().find((x) => x.id === selected);
    if (!n) { editor.replaceChildren(el("p", { class: "view-sub" }, "Pick a note, or start a new one.")); return; }
    const queue = batched((fns) => mutatePlan((p) => { const r = p.notes.find((x) => x.id === n.id); if (r) { fns.forEach((f) => f(r)); r.updated = Date.now(); } }));
    const save = (patch) => queue((r) => Object.assign(r, patch));
    const title = textInput(n.title, (v) => { save({ title: v }); const row = list.querySelector(".active .dnd-grow"); if (row) row.textContent = `${n.pinned ? "★ " : ""}${v || "Untitled"}`; }, { placeholder: "Title", ariaLabel: "Note title" });
    title.classList.add("dnd-name-input");
    const body = textInput(n.body, (v) => { save({ body: v }); }, { multiline: true, rows: 16, placeholder: "Write in Markdown…  **bold**, # headings, - lists, > quotes, tables", ariaLabel: "Note body" });
    const view = el("div", { class: "dnd-notes-preview", hidden: "" });
    const togglePreview = btn(preview ? "Edit" : "Preview", () => {
      preview = !preview;
      body.hidden = preview; view.hidden = !preview;
      if (preview) view.replaceChildren(renderMarkdown(body.value));
      togglePreview.textContent = preview ? "Edit" : "Preview";
    }, "btn secondary small");
    const kind = kindOf(n);
    const setField = (key, v) => queue((r) => { r.fields = { ...(r.fields || {}), [key]: v }; });
    const extras = NOTE_KINDS[kind].extra.map((e) => field(e.label, e.options
      ? selectEl(e.options.map((o) => [o, o]), n.fields?.[e.key] || e.options[0], (v) => { setField(e.key, v); drawList(); })
      : e.type === "date" ? Object.assign(el("input", { type: "date", value: n.fields?.[e.key] || "", "aria-label": e.label }), { onchange: (ev) => setField(e.key, ev.target.value) })
      : textInput(n.fields?.[e.key] || "", (v) => setField(e.key, v), { ariaLabel: e.label })));
    const kindSel = selectEl(Object.entries(NOTE_KINDS).map(([id, k]) => [id, k.one[0].toUpperCase() + k.one.slice(1)]), kind, (v) => { mutatePlan((p) => { const r = p.notes.find((x) => x.id === n.id); if (r) { r.kind = v; r.fields = r.fields || {}; r.updated = Date.now(); } }); drawList(); drawEditor(); });
    const tags = textInput((n.tags || []).join(", "), (v) => save({ tags: v.split(",").map((t) => t.trim()).filter(Boolean) }), { placeholder: "tags, separated by commas", ariaLabel: "Tags" });
    editor.replaceChildren(
      title,
      el("div", { class: "dnd-row between" }, [
        el("div", { class: "dnd-row" }, [
          btn(n.pinned ? "★ Pinned" : "☆ Pin", () => { mutatePlan((p) => { const r = p.notes.find((x) => x.id === n.id); r.pinned = !r.pinned; }); drawList(); drawEditor(); }, "btn secondary small"),
          togglePreview,
        ]),
        chip(`Edited ${ago(n.updated)}`),
      ]),
      el("div", { class: "dnd-grid-2" }, [field("Kind", kindSel), ...extras]),
      field("Tags", tags), body, view,
      el("div", { class: "dnd-row" }, [
        btn("Delete note", async () => { if (await confirmDialog(`Delete "${n.title || "this note"}"?`, { ok: "Delete", danger: true })) { mutatePlan((p) => { p.notes = p.notes.filter((x) => x.id !== n.id); }); selected = notes()[0]?.id || null; drawList(); drawEditor(); toast("Deleted."); } }, "btn danger small"),
        btn("Copy text", () => { navigator.clipboard?.writeText(`${n.title}\n\n${n.body}`); toast("Copied.", "good"); }, "btn secondary small"),
      ]),
    );
    if (preview) { body.hidden = true; view.hidden = false; view.replaceChildren(renderMarkdown(n.body)); }
  }

  panel.append(
    el("p", { class: "pl-banner" }, dm ? "Private to you: players can't see your notes." : "Your notes and checklists are shared with your DM so they can plan around what you want to do."),
    el("div", { class: "dnd-split" }, [
      el("div", {}, [el("div", { class: "card", style: "margin-bottom:12px" }, [el("div", { class: "dnd-row" }, [el("div", { class: "dnd-grow" }, q), newBtn]), kindBar, tagBar]), list, dm ? btn("Export everything (.md)", () => download("campaign-notes.md", exportAll(notes()), "text/markdown"), "btn secondary small") : null].filter(Boolean)),
      editor,
    ]),
  );
  const onChange = () => { if (!document.body.contains(list)) { window.removeEventListener("planner-changed", onChange); return; } };
  window.addEventListener("planner-changed", onChange);
  drawList(); drawEditor();
}
