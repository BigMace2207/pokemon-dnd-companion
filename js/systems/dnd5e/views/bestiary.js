// The Bestiary: every SRD monster as a stat block with clickable rolls, plus
// "add to encounter" and "add to combat" for the DM.

import { el, asyncView, btn, toast } from "../ui.js";
import { loadSet } from "../data.js";
import { browser } from "../components/browser.js";
import { statBlock, monsterLine } from "../components/statblock.js";
import { pageTitle, editionSwitch, attribution } from "./common.js";
import { getSettings, getDm, updateDm } from "../store.js";
import { CR_LIST, crLabel } from "../engine/rules.js";
import { getViewState, setViewState } from "../../../viewState.js";
import { addToDraft } from "./encounter.js";

export function renderBestiary(container) {
  container.replaceChildren();
  container.append(...pageTitle("Bestiary", "Monsters from the SRD. Click an ability, attack or damage chip to roll it; add creatures to an encounter."));
  const edition = getSettings().edition;
  const holder = el("div");
  container.append(editionSwitch(() => renderBestiary(container)), el("div", { style: "height:12px" }), holder);

  asyncView(holder, async () => {
    const { list } = await loadSet(edition, "monsters");
    const custom = getDm().customMonsters || [];
    const items = [...custom.map((m) => ({ ...m, custom: true })), ...list];
    const types = [...new Set(items.map((m) => m.type.replace(/^swarm of .*$/i, "swarm")))].sort();
    const sizes = ["Tiny", "Small", "Medium", "Large", "Huge", "Gargantuan"];
    const crOptions = CR_LIST.map((c) => [String(c), `CR ${crLabel(c)}`]);
    const pending = getViewState("dnd:monster:goto", null);
    const b = browser({
      items, stateKey: `dnd:bestiary:${edition}`,
      id: (m) => m.id, label: (m) => `${m.name}${m.custom ? " ★" : ""}`, meta: monsterLine,
      search: (m) => `${m.name} ${m.type} ${m.subtype || ""} ${m.alignment || ""}`,
      filters: [
        { key: "cr", label: "CR", options: crOptions, test: (m, v) => m.cr === Number(v) },
        { key: "type", label: "Type", options: types.map((t) => [t, t[0].toUpperCase() + t.slice(1)]), test: (m, v) => m.type.replace(/^swarm of .*$/i, "swarm") === v },
        { key: "size", label: "Size", options: sizes.map((s) => [s, s]), test: (m, v) => m.size === v },
        { key: "crmin", label: "Min CR", options: crOptions, test: (m, v) => m.cr >= Number(v) },
        { key: "crmax", label: "Max CR", options: crOptions, test: (m, v) => m.cr <= Number(v) },
      ],
      toggles: [
        { key: "legendary", label: "Legendary", test: (m) => (m.legendary || []).length > 0 },
        { key: "spell", label: "Spellcaster", test: (m) => (m.traits || []).some((t) => t.spellcasting) },
        { key: "fly", label: "Flies", test: (m) => !!m.speed?.fly },
        { key: "swim", label: "Swims", test: (m) => !!m.speed?.swim },
      ],
      sorts: [
        { id: "name", label: "Name", cmp: (a, b) => a.name.localeCompare(b.name) },
        { id: "cr", label: "Challenge rating", cmp: (a, b) => a.cr - b.cr || a.name.localeCompare(b.name) },
        { id: "hp", label: "Hit points", cmp: (a, b) => b.hp - a.hp },
      ],
      detail: (m) => statBlock(m, {
        actions: [
          btn("Add to encounter", () => { addToDraft(m, 1); toast(`${m.name} added to the encounter builder.`, "good"); }, "btn small"),
          btn("Add to combat", () => addToCombat(m), "btn secondary small"),
        ],
        onSpell: (name) => { setViewState("dnd:spell:goto", slugify(name)); location.hash = "dndSpells"; },
      }),
      empty: "No monster matches those filters.",
    });
    if (pending) { setViewState("dnd:monster:goto", null); b.select(pending); }
    return [b.root, attribution()];
  });
}

const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

function addToCombat(m) {
  import("../combatState.js").then(({ addMonsterToCombat }) => {
    addMonsterToCombat(m);
    toast(`${m.name} added to the combat tracker.`, "good");
  });
}

export { updateDm };
