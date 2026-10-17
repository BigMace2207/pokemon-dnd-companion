// Sheet > Spells: slots, spell lists per class, casting (spends a slot, tracks
// concentration, posts to the table's log) and adding/removing spells.

import { el, btn, chip, section, toast, modal, selectEl, confirmDialog, checkbox } from "../../ui.js";
import { pips } from "../../components/pips.js";
import { spellDetail, spellLevelText } from "../../components/spellCard.js";
import { spellPicker } from "../../components/spellPicker.js";
import { classSpellIds, learnTargets, addSpell, removeSpell, togglePrepared, maxSpellLevel, alwaysPreparedNames, preparedCount, spellKindFor } from "../../engine/spellbook.js";
import { ordinal } from "../../engine/rules.js";
import { postBattleLog } from "../../../../network.js";
import { getSettings } from "../../store.js";

const signed = (n) => (n >= 0 ? `+${n}` : `−${Math.abs(n)}`);

export function renderSpellsTab(panel, S) {
  const { char, d, ctx } = S;
  const spells = ctx.spells;
  if (!d.casting.length && !Object.values(char.spells.cantrips || {}).some((l) => l.length)) {
    panel.append(section("No spellcasting", [
      el("p", {}, "This character has no spellcasting class yet."),
      el("p", { class: "view-sub" }, "Bards, clerics, druids, paladins, rangers, sorcerers, warlocks and wizards cast spells. Take a level in one from the Level up button — or add a custom caster class (e.g. an Artificer or Eldritch Knight from another book) in Level up → Other class."),
    ]));
    return;
  }

  // ---- casting stats ----
  const statRow = el("div", { class: "dnd-stat-row" }, d.casting.flatMap((c) => [
    el("div", { class: "dnd-bigstat" }, [el("div", { class: "v" }, String(c.dc)), el("div", { class: "l" }, `${c.className} save DC`)]),
    el("div", { class: "dnd-bigstat" }, [el("div", { class: "v" }, signed(c.attack)), el("div", { class: "l" }, `${c.className} attack`)]),
    el("div", { class: "dnd-bigstat" }, [el("div", { class: "v" }, c.ability), el("div", { class: "l" }, "Casting ability")]),
  ]));
  panel.append(statRow);

  // ---- slots ----
  const slotParts = [];
  for (const s of d.slots) {
    if (!s.max) continue;
    slotParts.push(el("div", { class: "dnd-slot-row" }, [
      el("strong", { class: "dnd-slot-label" }, ordinal(s.level)),
      pips(s.max, s.used, (n) => { char.slotsUsed[s.level] = n; S.commit(); }, { label: `${ordinal(s.level)} level slot` }),
      el("span", { class: "dnd-muted dnd-small" }, `${s.max - s.used} of ${s.max}`),
    ]));
  }
  if (d.pact) {
    slotParts.push(el("div", { class: "dnd-slot-row" }, [
      el("strong", { class: "dnd-slot-label" }, `Pact (${ordinal(d.pact.level)})`),
      pips(d.pact.count, d.pact.used, (n) => { char.pactUsed = n; S.commit(); }, { label: "Pact magic slot" }),
      el("span", { class: "dnd-muted dnd-small" }, `${d.pact.count - d.pact.used} of ${d.pact.count} — short rest`),
    ]));
  }
  if (!slotParts.length) slotParts.push(el("p", { class: "view-sub" }, "No spell slots yet at this level."));
  const concLine = char.concentration ? el("div", { class: "dnd-alert" }, [el("strong", {}, "Concentrating: "), char.concentration, " ", btn("End", () => { char.concentration = ""; S.commit(); }, "btn tiny")]) : null;
  panel.append(section("Spell slots", [...slotParts, concLine].filter(Boolean)));

  // ---- one block per casting class ----
  for (const c of d.casting) panel.append(classBlock(S, c));
  // cantrips from sources with no class entry (racial, feat)
  const orphan = Object.entries(char.spells.cantrips || {}).filter(([cid]) => !d.casting.some((c) => c.classId === cid));
  if (orphan.length) {
    const ids = orphan.flatMap(([, l]) => l);
    panel.append(section("Other cantrips", ids.map((id) => spellRow(S, spells.get(id), { classId: orphan[0][0], kind: "cantrip", prepared: true }))));
  }
}

function classBlock(S, c) {
  const { char, d, ctx } = S;
  const spells = ctx.spells;
  const part = d.parts.find((p) => p.id === c.classId);
  const ids = classSpellIds(char, c.classId);
  const always = new Set(alwaysPreparedNames(char, ctx).map((n) => ctx.spellsByName.get(n.toLowerCase())?.id).filter(Boolean));
  const maxLvl = maxSpellLevel(d);
  const known = c.kind === "known";
  const book = c.kind === "book";
  const prepCount = preparedCount(char, c.classId);

  const facts = [];
  if (c.cantrips != null) facts.push(chip(`Cantrips ${ids.size ? [...ids.values()].filter((k) => k === "cantrip").length : 0}/${c.cantrips}`));
  if (known && c.known != null) facts.push(chip(`Spells known ${[...ids.values()].filter((k) => k === "known").length}/${c.known}`));
  if (!known && c.preparedMax != null) facts.push(chip(`Prepared ${prepCount}/${c.preparedMax}`, prepCount > c.preparedMax ? "bad" : "accent"));
  if (book) facts.push(chip(`Spellbook ${(char.spells.book || []).length}`));

  const header = el("div", { class: "dnd-section-head" }, [
    el("h4", {}, `${c.className} spells`),
    el("div", { class: "dnd-row tight" }, [
      btn("Add spells", () => openAdd(S, c), "btn small"),
      c.kind === "prepared" || book ? btn("Prepare…", () => openPrepare(S, c), "btn secondary small") : null,
    ].filter(Boolean)),
  ]);
  const body = [header, el("div", { class: "dnd-chip-row", style: "margin-bottom:10px" }, facts)];

  // group by level
  const byLevel = new Map();
  const add = (id, kind, prepared) => {
    const sp = spells.get(id);
    if (!sp) return;
    if (!byLevel.has(sp.level)) byLevel.set(sp.level, []);
    byLevel.get(sp.level).push({ sp, kind, prepared });
  };
  for (const [id, kind] of ids) {
    if (kind === "cantrip") add(id, kind, true);
    else if (known) add(id, kind, true);
    else if (book) add(id, kind, (char.spells.prepared?.[c.classId] || []).includes(id));
    else add(id, kind, true);
  }
  for (const id of always) {
    if (!ids.has(id) && spells.get(id)?.classes) add(id, "always", true);
  }
  const levels = [...byLevel.keys()].sort((a, b) => a - b);
  if (!levels.length) body.push(el("p", { class: "view-sub" }, "No spells yet — use Add spells."));
  for (const lv of levels) {
    const rows = byLevel.get(lv).sort((a, b) => a.sp.name.localeCompare(b.sp.name));
    const lvlLabel = lv === 0 ? "Cantrips" : `${ordinal(lv)} level`;
    const visible = book ? rows : rows;
    body.push(el("div", { class: "dnd-spell-level" }, [
      el("h5", {}, `${lvlLabel}${lv > maxLvl && lv > 0 ? " (no slots yet)" : ""}`),
      ...visible.map((r) => spellRow(S, r.sp, { classId: c.classId, kind: r.kind, prepared: r.prepared, bookCaster: book, always: r.kind === "always" })),
    ]));
  }
  return el("div", { class: "card" }, body);
}

function spellRow(S, sp, { classId, kind, prepared, bookCaster = false, always = false }) {
  const { char, d } = S;
  if (!sp) return el("div", { class: "dnd-spell-row dnd-muted" }, "Unknown spell");
  const open = el("div");
  let expanded = false;
  const line = el("div", { class: `dnd-spell-row${bookCaster && !prepared && sp.level > 0 ? " unprepared" : ""}` });
  const name = el("button", { type: "button", class: "dnd-spell-name", "aria-expanded": "false" }, [
    el("strong", {}, sp.name),
    el("span", { class: "dnd-tiny dnd-muted" }, ` ${sp.school}${sp.concentration ? " · C" : ""}${sp.ritual ? " · R" : ""}${always ? " · always prepared" : ""}`),
  ]);
  name.addEventListener("click", () => {
    expanded = !expanded;
    name.setAttribute("aria-expanded", String(expanded));
    open.replaceChildren(...(expanded ? [el("div", { class: "dnd-spell-open" }, spellDetail(sp, { charLevel: d.level, who: char.name }))] : []));
  });
  const controls = [];
  if (bookCaster && sp.level > 0) {
    const cb = checkbox("Prepared", prepared, () => { togglePrepared(char, classId, sp.id); S.commit(); });
    controls.push(cb);
  }
  if (sp.level === 0) controls.push(btn("Cast", () => castSpell(S, sp, 0, null), "btn small"));
  else if (prepared || always) {
    controls.push(btn("Cast…", () => castDialog(S, sp), "btn small"));
    if (sp.ritual) controls.push(btn("Ritual", () => castSpell(S, sp, sp.level, "ritual"), "btn secondary tiny", { title: "Cast as a ritual (takes 10 minutes longer, uses no slot)" }));
  }
  if (!always) controls.push(btn("✕", async () => {
    if (!(await confirmDialog(`Remove ${sp.name} from this list?`, { ok: "Remove", danger: true }))) return;
    removeSpell(char, classId, sp.id, kind === "cantrip" ? "cantrip" : kind);
    if (kind === "book") removeSpell(char, classId, sp.id, "prepared");
    S.commit();
  }, "btn secondary tiny dnd-icon-btn", { "aria-label": `Remove ${sp.name}` }));
  line.append(name, el("div", { class: "dnd-row tight" }, controls));
  return el("div", {}, [line, open]);
}

// ---------------------------------------------------------------- casting

function castDialog(S, sp) {
  const { d } = S;
  const options = [];
  d.slots.forEach((s) => { if (s.level >= sp.level && s.max > 0 && s.used < s.max) options.push({ value: `slot:${s.level}`, label: `${ordinal(s.level)}-level slot (${s.max - s.used} left)` }); });
  if (d.pact && d.pact.level >= sp.level && d.pact.used < d.pact.count) options.push({ value: `pact:${d.pact.level}`, label: `Pact slot, ${ordinal(d.pact.level)} level (${d.pact.count - d.pact.used} left)` });
  if (!options.length) { toast(`No spell slot left for ${sp.name}.`, "bad"); return; }
  if (options.length === 1) { applyCast(S, sp, options[0].value); return; }
  const sel = selectEl(options.map((o) => [o.value, o.label]), options[0].value, () => {});
  modal({ title: `Cast ${sp.name}`, body: [el("p", { class: "dnd-small dnd-muted" }, "Casting at a higher level can increase the effect."), sel], actions: [{ label: "Cancel" }, { label: "Cast", cls: "btn", onClick: () => applyCast(S, sp, sel.value) }] });
}

function applyCast(S, sp, value) {
  const [kind, lvl] = value.split(":");
  castSpell(S, sp, Number(lvl), kind === "pact" ? "pact" : "slot");
}

function castSpell(S, sp, level, how) {
  const { char } = S;
  if (how === "slot") char.slotsUsed[level] = (Number(char.slotsUsed[level]) || 0) + 1;
  else if (how === "pact") char.pactUsed = (Number(char.pactUsed) || 0) + 1;
  let msg = `${char.name || "Someone"} casts ${sp.name}${sp.level > 0 && how !== "ritual" ? ` (${ordinal(level)} level${how === "pact" ? ", pact" : ""})` : how === "ritual" ? " as a ritual" : ""}`;
  if (sp.concentration) {
    if (char.concentration && char.concentration !== sp.name) msg += ` — dropping concentration on ${char.concentration}`;
    char.concentration = sp.name;
  }
  S.commit();
  toast(msg + ".", "good");
  if (getSettings().shareRolls) postBattleLog(char.name || "Someone", msg + ".");
}

// ---------------------------------------------------------------- add / prepare

function openAdd(S, c) {
  const { char, ctx, d } = S;
  const maxLvl = Math.max(1, maxSpellLevel(d));
  const part = d.parts.find((p) => p.id === c.classId);
  const classSpells = S.spellList.filter((s) => (s.classes || []).includes(part.name) && s.level <= Math.max(maxLvl, 0));
  const have = new Set([...classSpellIds(char, c.classId).keys()]);
  const picker = spellPicker({ spells: classSpells, selected: [], max: null, locked: [...have], onChange: () => {} });
  modal({
    title: `Add ${c.className} spells`, wide: true,
    body: [el("p", { class: "dnd-small dnd-muted" }, `Tick spells to learn. Showing the ${c.className} list up to level ${maxLvl}. Spells you already have are ticked and locked.`), picker.root],
    actions: [{ label: "Cancel" }, {
      label: "Add selected", cls: "btn", onClick: () => {
        let n = 0;
        for (const id of picker.selected()) {
          const sp = ctx.spells.get(id);
          if (!sp || have.has(id)) continue;
          const kind = spellKindFor(char, part, sp);
          addSpell(char, c.classId, sp, kind);
          if (kind === "book" && false) addSpell(char, c.classId, sp, "prepared");
          n++;
        }
        S.commit();
        toast(n ? `Added ${n} spell${n > 1 ? "s" : ""}.` : "Nothing new selected.", n ? "good" : "");
      },
    }],
  });
}

function openPrepare(S, c) {
  const { char, ctx, d } = S;
  const part = d.parts.find((p) => p.id === c.classId);
  const book = c.kind === "book";
  const pool = book
    ? (char.spells.book || []).map((id) => ctx.spells.get(id)).filter(Boolean)
    : S.spellList.filter((s) => (s.classes || []).includes(part.name) && s.level >= 1 && s.level <= Math.max(1, maxSpellLevel(d)));
  const current = (char.spells.prepared?.[c.classId] || []).filter((id) => pool.some((s) => s.id === id));
  const picker = spellPicker({ spells: pool, selected: current, max: c.preparedMax, onChange: () => {} });
  modal({
    title: `Prepare ${c.className} spells`, wide: true,
    body: [el("p", { class: "dnd-small dnd-muted" }, `You can prepare ${c.preparedMax} spell${c.preparedMax === 1 ? "" : "s"}${book ? " from your spellbook" : " from the full class list"}. Change them after a long rest.`), picker.root],
    actions: [{ label: "Cancel" }, { label: "Save", cls: "btn", onClick: () => { char.spells.prepared ||= {}; char.spells.prepared[c.classId] = picker.selected(); S.commit(); } }],
  });
}

void spellLevelText;
