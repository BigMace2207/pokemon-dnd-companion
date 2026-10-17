// The character sheet. A small controller object `S` is handed to each tab:
//   S.char / S.ctx / S.d  -- the character, the rules data, and the derived numbers
//   S.commit()            -- save, recompute, redraw header + current tab
//   S.save()              -- save only (for typing into a field without losing focus)

import { el, asyncView, btn, chip, tabs, selectEl, toast, section } from "../ui.js";
import { loadCtx, loadSet } from "../data.js";
import { activeCharacter, listCharacters, setActive, saveCharacter, CHANGED } from "../store.js";
import { derive, classLabel, asiPending, subclassPending, pendingChoices, shortRest, longRest, totalLevel } from "../engine/character.js";
import { levelForXp } from "../engine/rules.js";
import { rollMode, setRollMode, onRoll } from "../rolls.js";
import { pageTitle } from "./common.js";
import { debounce } from "../ui.js";

export function renderSheet(container) {
  container.replaceChildren();
  const holder = el("div");
  container.append(holder);

  asyncView(holder, async () => {
    const char = activeCharacter();
    if (!char) {
      return [
        ...pageTitle("Character Sheet"),
        section("No character yet", [
          el("p", {}, "Create a character to see the sheet."),
          btn("Go to Characters", () => { location.hash = "dndCharacters"; }, "btn"),
        ]),
      ];
    }
    const ctx = await loadCtx(char.edition, ["spells"]);
    const spells = (await loadSet(char.edition, "spells")).list;
    return buildSheet(char, ctx, spells);
  });
}

function buildSheet(char, ctx, spellList) {
  const headerEl = el("div");
  const tabHost = el("div");
  const root = el("div", { class: "dnd-sheet" }, [headerEl, tabHost]);
  const persist = debounce(() => saveCharacter(char), 350);

  const S = {
    char, ctx, spellList,
    d: derive(char, ctx),
    save() { persist(); },
    saveNow() { persist.flush(); },
    commit() { saveCharacter(char); S.d = derive(char, ctx); drawHeader(); redrawTab(); },
    refreshDerived() { S.d = derive(char, ctx); },
    redrawHeader: () => drawHeader(),
  };

  // The tab modules are loaded on first use.
  const tabDefs = [
    { id: "combat", label: "Combat", mod: "./sheet/combat.js", fn: "renderCombatTab" },
    { id: "skills", label: "Abilities & Skills", mod: "./sheet/skills.js", fn: "renderSkillsTab" },
    { id: "spells", label: "Spells", mod: "./sheet/spells.js", fn: "renderSpellsTab" },
    { id: "inventory", label: "Inventory", mod: "./sheet/inventory.js", fn: "renderInventoryTab" },
    { id: "features", label: "Features", mod: "./sheet/features.js", fn: "renderFeaturesTab" },
    { id: "details", label: "Details & Notes", mod: "./sheet/details.js", fn: "renderDetailsTab" },
  ];
  const t = tabs(tabDefs.map((d) => ({
    id: d.id, label: d.label,
    render: async (panel) => {
      panel.replaceChildren(el("p", { class: "view-sub" }, "Loading…"));
      const m = await import(d.mod);
      panel.replaceChildren();
      m[d.fn](panel, S);
    },
  })), { stateKey: "dnd:sheet:tab", initial: "combat" });
  tabHost.append(t.bar, t.panel);
  function redrawTab() { t.show(t.current()); }

  function drawHeader() {
    const d = S.d;
    const pending = [];
    const asi = asiPending(char);
    if (asi) pending.push(`${asi} ability score improvement${asi > 1 ? "s" : ""}`);
    const sub = subclassPending(char, ctx);
    if (sub.length) pending.push("choose a subclass");
    const choices = pendingChoices(char, ctx);
    if (choices.length) pending.push(`${choices.length} feature choice${choices.length > 1 ? "s" : ""}`);
    const canXp = d.canLevelByXp;

    const nameIn = el("input", { type: "text", value: char.name, class: "dnd-name-input", placeholder: "Character name", "aria-label": "Character name" });
    nameIn.addEventListener("input", () => { char.name = nameIn.value; S.save(); });
    const switcher = listCharacters().length > 1
      ? selectEl(listCharacters().map((c) => [c.id, c.name || "Unnamed"]), char.id, (id) => { setActive(id); renderSheet(root.parentElement.parentElement || root.parentElement); })
      : null;

    const xpNow = Number(char.xp) || 0;
    const xpLine = char.milestone ? el("span", { class: "dnd-muted dnd-small" }, "Milestone levelling") : el("span", { class: "dnd-muted dnd-small" }, `${xpNow.toLocaleString()} XP${d.xpNext ? ` / ${d.xpNext.toLocaleString()}` : ""}`);

    const modeBtns = el("div", { class: "dnd-segment", role: "group", "aria-label": "Roll mode" }, [["dis", "Dis"], ["normal", "Normal"], ["adv", "Adv"]].map(([m, label]) => {
      const b = el("button", { type: "button", class: rollMode() === m ? "on" : "", title: m === "adv" ? "Roll d20 tests with advantage" : m === "dis" ? "Roll d20 tests with disadvantage" : "Roll d20 tests normally" }, label);
      b.addEventListener("click", () => { setRollMode(m); drawHeader(); });
      return b;
    }));
    void onRoll;

    const levelBtn = btn(pending.length || canXp ? "Level up ▲" : "Level up", async () => { const m = await import("../components/levelUp.js"); m.openLevelUp(S); }, `btn small${pending.length || canXp ? "" : " secondary"}`);
    const inspire = btn(char.inspiration ? "★ Inspired" : "☆ Inspiration", () => { char.inspiration = !char.inspiration; S.commit(); }, `btn small${char.inspiration ? "" : " secondary"}`);
    const short = btn("Short rest", async () => { const m = await import("../components/rests.js"); m.openShortRest(S); }, "btn secondary small");
    const long = btn("Long rest", async () => { const m = await import("../components/rests.js"); m.openLongRest(S); }, "btn secondary small");

    const alerts = [];
    if (pending.length) alerts.push(el("div", { class: "dnd-alert" }, [el("strong", {}, "Level-up to do: "), pending.join(", "), " ", btn("Resolve", async () => { const m = await import("../components/levelUp.js"); m.openPending(S); }, "btn tiny")]));
    if (canXp) alerts.push(el("div", { class: "dnd-alert" }, [el("strong", {}, `You have enough XP for level ${d.xpLevel}. `), levelBtn.cloneNode(true)]));
    for (const w of d.warnings) alerts.push(el("div", { class: "dnd-alert warn" }, w));

    headerEl.replaceChildren(
      el("div", { class: "card dnd-sheet-head" }, [
        char.portrait ? el("img", { class: "dnd-portrait", src: char.portrait, alt: "" }) : el("div", { class: "dnd-portrait placeholder" }, (char.name || "?").charAt(0).toUpperCase()),
        el("div", { class: "dnd-grow" }, [
          nameIn,
          el("div", { class: "dnd-muted" }, `${char.race?.name || "No race"}${char.race?.subraceName ? ` (${char.race.subraceName})` : ""} · ${classLabel(char, ctx)} · ${char.background?.name || "No background"}${char.alignment ? ` · ${char.alignment}` : ""}`),
          el("div", { class: "dnd-row tight", style: "margin-top:4px" }, [chip(`Level ${d.level}`, "gold"), xpLine, chip(char.edition === "2024" ? "2024 rules" : "2014 rules")]),
        ]),
        el("div", { class: "dnd-sheet-actions" }, [
          el("div", { class: "dnd-row tight" }, [modeBtns, inspire]),
          el("div", { class: "dnd-row tight" }, [short, long, levelBtn]),
          switcher,
        ].filter(Boolean)),
      ]),
      ...alerts,
    );
  }

  drawHeader();
  // Another page (the DM, a directive) changed this character: reflect it.
  const onChanged = (e) => {
    if (!root.isConnected) { window.removeEventListener(CHANGED, onChanged); return; }
    if (e.detail?.id && e.detail.id !== char.id) return;
    const fresh = listCharacters().find((c) => c.id === char.id);
    if (fresh && fresh !== char && fresh.updated > char.updated) {
      Object.assign(char, fresh);
      S.d = derive(char, ctx);
      drawHeader();
      redrawTab();
    }
  };
  window.addEventListener(CHANGED, onChanged);
  void levelForXp; void totalLevel; void shortRest; void longRest; void toast;
  return root;
}
