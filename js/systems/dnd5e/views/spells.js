// Spell compendium: every SRD spell, searchable and filterable, with a damage
// roller and a quick "add to my character" action.

import { el, asyncView, btn, selectEl, toast, modal } from "../ui.js";
import { loadSet, loadCtx, SCHOOL_ORDER } from "../data.js";
import { browser } from "../components/browser.js";
import { spellDetail } from "../components/spellCard.js";
import { pageTitle, editionSwitch, attribution } from "./common.js";
import { getSettings, activeCharacter, saveCharacter } from "../store.js";
import { derive, classSummary } from "../engine/character.js";
import { learnTargets, addSpell } from "../engine/spellbook.js";
import { getViewState, setViewState } from "../../../viewState.js";

export function renderSpells(container) {
  container.replaceChildren();
  const holder = el("div");
  const title = pageTitle("Spells", "Every SRD spell. Filter by class, level and school, roll damage, and add spells to your character.");
  container.append(...title);
  const edition = getSettings().edition;
  container.append(editionSwitch(() => renderSpells(container)), el("div", { style: "height:12px" }), holder);

  asyncView(holder, async () => {
    const { list } = await loadSet(edition, "spells");
    const ctx = await loadCtx(edition);
    const classes = [...new Set(list.flatMap((s) => s.classes))].sort();
    const pending = getViewState("dnd:spell:goto", null);
    const b = browser({
      items: list, stateKey: `dnd:spells:${edition}`,
      id: (s) => s.id, label: (s) => s.name,
      meta: (s) => `${s.school.slice(0, 4)}${s.concentration ? " · C" : ""}${s.ritual ? " · R" : ""}`,
      search: (s) => `${s.name} ${s.school} ${s.classes.join(" ")} ${s.desc.join(" ")}`,
      group: (s) => (s.level === 0 ? "Cantrips" : `Level ${s.level}`),
      groupOrder: ["Cantrips", ...Array.from({ length: 9 }, (_, i) => `Level ${i + 1}`)],
      filters: [
        { key: "class", label: "Class", options: classes.map((c) => [c, c]), test: (s, v) => s.classes.includes(v) },
        { key: "level", label: "Level", options: [["0", "Cantrip"], ...Array.from({ length: 9 }, (_, i) => [String(i + 1), `Level ${i + 1}`])], test: (s, v) => s.level === Number(v) },
        { key: "school", label: "School", options: SCHOOL_ORDER.map((x) => [x, x]), test: (s, v) => s.school === v },
        { key: "cast", label: "Casting time", options: [["action", "Action"], ["bonus", "Bonus action"], ["reaction", "Reaction"], ["long", "1 minute or more"]], test: (s, v) => {
          const t = s.castingTime.toLowerCase();
          return v === "action" ? /^(1 )?action/.test(t) : v === "bonus" ? t.includes("bonus") : v === "reaction" ? t.includes("reaction") : /minute|hour/.test(t);
        } },
      ],
      toggles: [
        { key: "conc", label: "Concentration", test: (s) => s.concentration },
        { key: "ritual", label: "Ritual", test: (s) => s.ritual },
        { key: "dmg", label: "Deals damage", test: (s) => !!s.damage },
        { key: "nomat", label: "No material component", test: (s) => !(s.components || []).includes("M") },
      ],
      sorts: [
        { id: "level", label: "Level, then name", cmp: (a, b) => a.level - b.level || a.name.localeCompare(b.name) },
        { id: "name", label: "Name", cmp: (a, b) => a.name.localeCompare(b.name) },
      ],
      detail: (s) => {
        const char = activeCharacter();
        const charLevel = char ? char.levelLog.length : 1;
        const extra = [];
        if (char && char.edition === edition) {
          const targets = learnTargets(char, ctx, s);
          if (targets.length) {
            extra.push(btn(`Add to ${char.name || "my character"}…`, () => addToCharacter(char, ctx, s, targets), "btn small"));
          }
        }
        return spellDetail(s, { charLevel, who: char?.name || "", extra });
      },
      empty: "No spell matches those filters.",
    });
    if (pending) { setViewState("dnd:spell:goto", null); b.select(pending); }
    return [b.root, attribution()];
  });
}

function addToCharacter(char, ctx, spell, targets) {
  const choose = (t) => {
    addSpell(char, t.classId, spell, t.kind);
    saveCharacter(char);
    const where = t.kind === "cantrip" ? "cantrips" : t.kind === "book" ? "spellbook" : t.kind === "known" ? "known spells" : "prepared list";
    toast(`${spell.name} added to ${char.name || "your character"}'s ${t.className} ${where}.`, "good");
  };
  if (targets.length === 1) { choose(targets[0]); return; }
  const sel = selectEl(targets.map((t, i) => [i, `${t.className} (${t.kind})`]), "0", () => {});
  const m = modal({ title: `Add ${spell.name}`, body: [el("p", {}, "Which class list?"), sel], actions: [{ label: "Cancel" }, { label: "Add", cls: "btn", onClick: () => choose(targets[Number(sel.value)]) }] });
  void m;
}
