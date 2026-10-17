// Equipment and magic items: SRD weapons, armor, gear, tools, mounts and the magic item list.

import { el, asyncView, btn, chip, tabs, toast } from "../ui.js";
import { loadSet } from "../data.js";
import { browser } from "../components/browser.js";
import { pageTitle, editionSwitch, attribution } from "./common.js";
import { getSettings, activeCharacter, saveCharacter } from "../store.js";
import { addItemRecord } from "../engine/character.js";
import { renderDesc } from "../../../markdown.js";
import { damageRoll } from "../rolls.js";

const KIND_LABEL = { weapon: "Weapons", armor: "Armor", gear: "Adventuring gear", tool: "Tools", pack: "Packs", ammo: "Ammunition", mount: "Mounts & vehicles" };
const RARITY_ORDER = ["Common", "Uncommon", "Rare", "Very Rare", "Legendary", "Artifact", "Varies"];

export function renderItems(container) {
  container.replaceChildren();
  container.append(...pageTitle("Equipment & Items", "Weapons, armor, gear and every SRD magic item. Add anything to your character's pack."));
  const edition = getSettings().edition;
  const holder = el("div");
  container.append(editionSwitch(() => renderItems(container)), el("div", { style: "height:12px" }), holder);
  asyncView(holder, async () => {
    const equipment = (await loadSet(edition, "equipment")).list;
    const magic = (await loadSet(edition, "magicItems")).list;
    const t = tabs([
      { id: "eq", label: `Equipment (${equipment.length})`, render: (p) => p.append(equipmentBrowser(equipment, edition).root) },
      { id: "magic", label: `Magic items (${magic.length})`, render: (p) => p.append(magicBrowser(magic, edition).root) },
    ], { stateKey: "dnd:items:tab", initial: "eq" });
    return [t.bar, t.panel, attribution()];
  });
}

const costText = (c) => (c ? `${c.q} ${c.u}` : "—");

function addButton(rec, magic, edition) {
  const char = activeCharacter();
  if (!char) return el("p", { class: "dnd-small dnd-muted" }, "Create a character to add items.");
  return btn(`Add to ${char.name || "my character"}`, () => { addItemRecord(char, rec, { magic }); saveCharacter(char); toast(`${rec.name} added.`, "good"); }, "btn small");
  void edition;
}

function equipmentBrowser(list, edition) {
  return browser({
    items: list, stateKey: `dnd:equipment:${edition}`,
    id: (i) => i.id, label: (i) => i.name,
    meta: (i) => costText(i.cost),
    search: (i) => `${i.name} ${(i.categories || []).join(" ")}`,
    group: (i) => KIND_LABEL[i.kind] || "Other",
    groupOrder: Object.values(KIND_LABEL),
    filters: [
      { key: "kind", label: "Type", options: Object.entries(KIND_LABEL), test: (i, v) => i.kind === v },
      { key: "cat", label: "Category", options: [["Simple", "Simple weapons"], ["Martial", "Martial weapons"], ["Light", "Light armor"], ["Medium", "Medium armor"], ["Heavy", "Heavy armor"]], test: (i, v) => i.weapon?.category === v || i.armor?.category === v },
    ],
    sorts: [{ id: "name", label: "Name", cmp: (a, b) => a.name.localeCompare(b.name) }],
    detail: (i) => {
      const rows = [["Cost", costText(i.cost)], ["Weight", i.weight != null ? `${i.weight} lb` : "—"]];
      if (i.weapon) {
        const w = i.weapon;
        rows.push(["Category", `${w.category} ${w.range}`], ["Damage", `${w.damage?.dice || "—"} ${w.damage?.type || ""}${w.versatile ? ` (versatile ${w.versatile})` : ""}`.trim()]);
        if (w.range2 || w.rangeNormal) rows.push(["Range", `${w.rangeNormal || ""}${w.rangeLong ? `/${w.rangeLong}` : ""} ft`]);
        if (w.properties?.length) rows.push(["Properties", w.properties.join(", ")]);
        if (w.mastery) rows.push(["Mastery", w.mastery]);
      }
      if (i.armor) {
        const a = i.armor;
        rows.push(["Armor class", `${a.base}${a.dexBonus ? ` + Dex${a.maxBonus ? ` (max ${a.maxBonus})` : ""}` : ""}`], ["Type", a.category]);
        if (a.strMin) rows.push(["Strength needed", String(a.strMin)]);
        if (a.stealthDisadvantage) rows.push(["Stealth", "Disadvantage"]);
      }
      if (i.quantity) rows.push(["Comes in", `${i.quantity}`]);
      const body = [
        el("h2", {}, i.name),
        el("p", { class: "dnd-row tight" }, [chip(KIND_LABEL[i.kind] || i.kind), ...(i.categories || []).slice(0, 3).map((c) => chip(c))]),
        el("table", { class: "data-table dnd-kv" }, rows.map(([k, v]) => el("tr", {}, [el("th", {}, k), el("td", {}, v)]))),
      ];
      if (i.weapon?.damage?.dice) body.push(el("div", { class: "dnd-row" }, [
        btn(`Roll ${i.weapon.damage.dice}`, () => damageRoll({ label: i.name, expr: i.weapon.damage.dice }), "btn secondary small"),
        btn("Crit", () => damageRoll({ label: i.name, expr: i.weapon.damage.dice, crit: true }), "btn secondary small"),
      ]));
      if (i.contents?.length) body.push(el("h4", {}, "Contents"), el("ul", {}, i.contents.map((c) => el("li", {}, `${c.qty > 1 ? `${c.qty} × ` : ""}${c.name}`))));
      if (i.desc?.length) body.push(renderDesc(i.desc));
      body.push(addButton(i, false, edition));
      return el("div", {}, body);
    },
  });
}

function magicBrowser(list, edition) {
  const cats = [...new Set(list.map((i) => i.category))].sort();
  return browser({
    items: list, stateKey: `dnd:magic:${edition}`,
    id: (i) => i.id, label: (i) => i.name, meta: (i) => i.rarity || "",
    search: (i) => `${i.name} ${i.category} ${i.rarity} ${(i.desc || []).join(" ")}`,
    group: (i) => i.rarity || "Other", groupOrder: RARITY_ORDER,
    filters: [
      { key: "rarity", label: "Rarity", options: RARITY_ORDER.map((r) => [r, r]), test: (i, v) => i.rarity === v },
      { key: "cat", label: "Category", options: cats.map((c) => [c, c]), test: (i, v) => i.category === v },
    ],
    toggles: [{ key: "att", label: "Requires attunement", test: (i) => /attunement/i.test((i.desc || [])[0] || "") || !!i.attunement }],
    sorts: [{ id: "name", label: "Name", cmp: (a, b) => a.name.localeCompare(b.name) }],
    detail: (i) => el("div", {}, [
      el("h2", {}, i.name),
      el("p", { class: "dnd-row tight" }, [chip(i.category, "accent"), chip(i.rarity || "", "gold"), i.variant ? chip("variant") : null].filter(Boolean)),
      renderDesc(i.desc || []),
      addButton(i, true, edition),
    ]),
  });
}
