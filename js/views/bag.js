// A trainer's full Bag — every item they've picked up, sorted into the
// same sections the games use (Poké Balls, Medicine, TMs, Held Items, Key
// Items) and colour-coded by rarity. Reads/writes the exact same
// save.bag the floating Quick Console (js/console.js) does, so adding an
// item there shows up here and vice versa.

import { el, field, makeCombo } from "../components.js";
import { loadSave, writeSave, addBagItem, useBagItem, bagEntries } from "../storage.js";
import { categorizeItem, SECTION_LABELS, SECTION_ORDER, tmMoveNames, tmName, tmMoveName } from "../bagItems.js";
import { rarityOf, rarityColor, rarityLabel } from "../itemRarity.js";
import { loadIconIndex, resolveIcon, iconPath, PLACEHOLDER_ICON } from "../itemIcons.js";
import { openIconPicker } from "../iconPicker.js";
import { BALL_TYPES } from "../calc.js";
import { HEAL_ITEMS, STATUS_HEAL_ITEMS } from "../battleItems.js";
import { addLogEntry } from "../log.js";
import { attachInfoTooltip, tooltipTitle, tooltipRow } from "../infoTooltip.js";
import { describeItem } from "../itemDescriptions.js";

export function renderBag(container, state) {
  container.innerHTML = "";
  container.appendChild(el("h1", { class: "view-title" }, "Bag"));

  let save = loadSave();
  let iconIndex = {};

  function persist() { writeSave(save); render(); }

  // ---------------- Add item ----------------
  const nonTmNames = [...BALL_TYPES, ...HEAL_ITEMS.map((h) => h.name), ...STATUS_HEAL_ITEMS.map((h) => h.name), ...state.items.map((it) => it.name)];
  const tmOptions = tmMoveNames(state).map((m) => tmName(m));
  const addCombo = makeCombo({ options: [...nonTmNames, ...tmOptions], placeholder: "Search items, or type anything else for a Key Item…" });
  const qtyInput = el("input", { type: "number", min: "1", value: "1", style: "max-width:90px" });
  const addBtn = el("button", { class: "btn" }, "+ Add to Bag");
  addBtn.addEventListener("click", () => {
    const name = addCombo.inputEl.value.trim();
    const qty = Math.max(1, Number(qtyInput.value) || 1);
    if (!name) return;
    addBagItem(save, name, qty);
    addLogEntry(`Added ${qty}× ${name} to the Bag.`);
    addCombo.setValue(""); qtyInput.value = "1";
    persist();
  });
  container.appendChild(el("div", { class: "card" }, [
    el("h4", {}, "Add an Item"),
    el("div", { class: "grid-3" }, [field("Item", addCombo), field("Qty", qtyInput), addBtn]),
  ]));

  const sectionsWrap = el("div");
  container.appendChild(sectionsWrap);

  function iconFor(section, rawName, itemName) {
    const moveType = section === "tm" ? state.moves[state.moveByName.get(rawName)]?.type : null;
    const override = save.itemIcons[itemName];
    if (override) return { icon: override, isOverride: true };
    const resolved = resolveIcon(iconIndex, { name: rawName, section, moveType });
    return { icon: resolved || PLACEHOLDER_ICON, isOverride: false, unresolved: !resolved };
  }

  function bagItemCard(section, itemName, count) {
    const rawName = section === "tm" ? tmMoveName(itemName) : itemName;
    const displayName = section === "tm" ? `TM: ${rawName}` : itemName;
    const rarity = rarityOf({ section, name: rawName, state });
    const color = rarityColor(rarity);
    const { icon, unresolved } = iconFor(section, rawName, itemName);

    const removeBtn = el("button", { class: "btn secondary bag-item-mini-btn" }, "−1");
    removeBtn.addEventListener("click", () => { useBagItem(save, itemName, 1); persist(); });
    const assignBtn = unresolved ? el("button", { class: "btn secondary bag-item-mini-btn" }, "Assign Icon") : null;
    if (assignBtn) assignBtn.addEventListener("click", () => openIconPicker((picked) => { save.itemIcons[itemName] = picked; persist(); }));

    const card = el("div", { class: "bag-item-card", style: `border-color:${color}` }, [
      el("div", { class: "bag-item-rarity-tag", style: `background:${color}` }, rarityLabel(rarity)),
      el("img", { class: "bag-item-icon", src: iconPath(icon.category, icon.filename), alt: displayName }),
      el("div", { class: "bag-item-name" }, displayName),
      el("div", { class: "bag-item-count" }, `×${count}`),
      el("div", { class: "bag-item-actions" }, [assignBtn, removeBtn].filter(Boolean)),
    ]);
    attachInfoTooltip(card, () => [tooltipTitle(displayName), tooltipRow(describeItem(itemName, state))]);
    return card;
  }

  async function render() {
    iconIndex = await loadIconIndex();
    sectionsWrap.innerHTML = "";
    const bySection = { ball: [], medicine: [], tm: [], held: [], key: [] };
    bagEntries(save).forEach(([name, count]) => bySection[categorizeItem(name, state)].push([name, count]));

    SECTION_ORDER.forEach((section) => {
      const items = bySection[section].sort((a, b) => a[0].localeCompare(b[0]));
      sectionsWrap.appendChild(el("h4", {}, `${SECTION_LABELS[section]} (${items.length})`));
      sectionsWrap.appendChild(items.length
        ? el("div", { class: "bag-grid" }, items.map(([name, count]) => bagItemCard(section, name, count)))
        : el("p", { class: "view-sub" }, "Nothing here yet."));
    });
  }

  render();
}
