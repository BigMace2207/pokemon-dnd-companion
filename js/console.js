// A floating "Quick Console" — one button in the bottom corner, present on
// every view (mounted once from app.js, outside the router) — for the
// three things you otherwise have to leave whatever you're doing and go to
// My Team for: topping up your Bag, leveling a Pokémon up (with the same
// move-swap prompt a real level-up gives), and healing with whatever
// medicine you actually have on hand. Everything here reads/writes this
// browser's own save, exactly like My Team — it's a shortcut into the same
// data, not a second source of truth.

import { el, field, makeCombo } from "./components.js";
import { widgetDock } from "./widgetDock.js";
import { loadSave, writeSave, addBagItem, useBagItem, bagEntries } from "./storage.js";
import { calcAllStats, BALL_TYPES } from "./calc.js";
import { HEAL_ITEMS, STATUS_HEAL_ITEMS } from "./battleItems.js";
import { tmMoveNames, tmName } from "./bagItems.js";
import { handleLevelUp } from "./levelUp.js";
import { addLogEntry } from "./log.js";
import { getFullTurn } from "./network.js";
import { monIsLiveCombatant } from "./battleGate.js";

function notifySaveChanged() {
  window.dispatchEvent(new CustomEvent("pokemon-dnd-save-changed"));
}

function monOptions(save) {
  return [...save.party, ...save.pc].filter((m) => m.name);
}

function monLabel(m) { return `${m.nickname || m.name} (Lv.${m.level})`; }

export function mountQuickConsole(state) {
  if (document.getElementById("quickConsoleBtn")) return; // already mounted (e.g. hot-reload)

  const btn = el("button", { id: "quickConsoleBtn", class: "quick-console-btn", title: "Quick Console" }, "BAG");
  const panel = el("div", { class: "quick-console-panel" });
  panel.style.display = "none";
  document.body.appendChild(panel);
  widgetDock().appendChild(btn);

  let open = false;
  let activeTab = "add";

  function toggle() {
    open = !open;
    panel.style.display = open ? "block" : "none";
    if (open) render();
  }
  btn.addEventListener("click", toggle);

  function closeBtn() {
    const b = el("button", { class: "quick-console-close", title: "Close" }, "✕");
    b.addEventListener("click", toggle);
    return b;
  }

  function tabsRow() {
    const names = [["add", "Add Item"], ["level", "Level Up"], ["heal", "Heal"]];
    return el("div", { class: "quick-console-tabs" }, names.map(([key, label]) => {
      const b = el("button", { class: "pill-btn" + (activeTab === key ? " active" : "") }, label);
      b.addEventListener("click", () => { activeTab = key; render(); });
      return b;
    }));
  }

  // ---------------- Add Item ----------------
  function renderAddItem(body, save) {
    const allItemNames = [
      ...BALL_TYPES, ...HEAL_ITEMS.map((h) => h.name), ...STATUS_HEAL_ITEMS.map((h) => h.name),
      ...state.items.map((it) => it.name), ...tmMoveNames(state).map((m) => tmName(m)),
    ];
    const itemCombo = makeCombo({ options: allItemNames, placeholder: "Search items, or type anything else for a Key Item…" });
    const qtyInput = el("input", { type: "number", min: "1", value: "1", style: "max-width:90px" });
    const addBtn = el("button", { class: "btn" }, "+ Add to Bag");
    addBtn.addEventListener("click", () => {
      const name = itemCombo.inputEl.value.trim();
      const qty = Math.max(1, Number(qtyInput.value) || 1);
      if (!name) return;
      addBagItem(save, name, qty);
      writeSave(save);
      addLogEntry(`Added ${qty}× ${name} to the Bag.`);
      notifySaveChanged();
      itemCombo.setValue(""); qtyInput.value = "1";
      renderBagList();
    });

    const bagListWrap = el("div", { class: "quick-console-bag-list" });
    function renderBagList() {
      bagListWrap.innerHTML = "";
      const entries = bagEntries(save);
      if (!entries.length) { bagListWrap.appendChild(el("p", { class: "view-sub" }, "Bag is empty.")); return; }
      entries.sort((a, b) => a[0].localeCompare(b[0])).forEach(([name, count]) => {
        const removeBtn = el("button", { class: "btn secondary quick-console-mini-btn" }, "−1");
        removeBtn.addEventListener("click", () => {
          useBagItem(save, name, 1);
          writeSave(save);
          notifySaveChanged();
          renderBagList();
        });
        bagListWrap.appendChild(el("div", { class: "quick-console-bag-row" }, [
          el("span", {}, `${name} ×${count}`),
          removeBtn,
        ]));
      });
    }
    renderBagList();

    const viewBagLink = el("a", { href: "#bag", class: "quick-console-bag-link" }, "Open full Bag page →");
    viewBagLink.addEventListener("click", () => { toggle(); });

    body.appendChild(el("div", { class: "grid-2" }, [field("Item", itemCombo), field("Qty", qtyInput)]));
    body.appendChild(addBtn);
    body.appendChild(el("h4", { style: "margin-top:14px" }, "Current Bag"));
    body.appendChild(bagListWrap);
    body.appendChild(viewBagLink);
  }

  // ---------------- Level Up ----------------
  function renderLevelUp(body, save) {
    const mons = monOptions(save);
    if (!mons.length) { body.appendChild(el("p", { class: "view-sub" }, "No Pokémon yet — add one in My Team.")); return; }
    let selected = mons[0];
    const monSelect = el("select", {}, mons.map((m, i) => el("option", { value: i }, monLabel(m))));
    monSelect.addEventListener("change", () => { selected = mons[Number(monSelect.value)]; });

    const plusOneBtn = el("button", { class: "btn" }, "▲ Level Up (+1)");
    const levelInput = el("input", { type: "number", min: "1", max: "100", style: "max-width:90px" });
    levelInput.value = selected.level;
    monSelect.addEventListener("change", () => { levelInput.value = selected.level; });
    const setLevelBtn = el("button", { class: "btn secondary" }, "Set Level");
    const statusOut = el("div", { class: "formula-note" }, "");

    async function applyLevelChange(newLevel) {
      const from = selected.level;
      const to = Math.min(100, Math.max(1, Number(newLevel) || from));
      if (to === from) return;
      if (to > from) {
        const ft = await getFullTurn();
        if (monIsLiveCombatant(ft, save.networkId, selected.id)) {
          selected.queuedLevel = to;
          writeSave(save);
          addLogEntry(`${selected.nickname || selected.name}'s level-up to ${to} can't land mid-battle — queued until the encounter ends.`);
          statusOut.textContent = `⏳ Queued — ${selected.nickname || selected.name} will reach Level ${to} once the fight's over.`;
          return;
        }
      }
      selected.level = to;
      if (to > from) {
        statusOut.textContent = "Checking for new moves…";
        await handleLevelUp(state, selected, from, to);
      }
      writeSave(save);
      addLogEntry(`${selected.nickname || selected.name} is now Level ${to} (was ${from}).`);
      notifySaveChanged();
      statusOut.textContent = `${selected.nickname || selected.name} is now Level ${to}.`;
      levelInput.value = to;
      monSelect.innerHTML = "";
      mons.forEach((m, i) => monSelect.appendChild(el("option", { value: i }, monLabel(m))));
      monSelect.value = String(mons.indexOf(selected));
    }
    plusOneBtn.addEventListener("click", () => applyLevelChange(selected.level + 1));
    setLevelBtn.addEventListener("click", () => applyLevelChange(levelInput.value));

    body.appendChild(field("Pokémon", monSelect));
    body.appendChild(el("div", { class: "quick-console-stack" }, [plusOneBtn, el("div", { class: "grid-2" }, [levelInput, setLevelBtn])]));
    body.appendChild(statusOut);
  }

  // ---------------- Heal ----------------
  function renderHeal(body, save) {
    const mons = monOptions(save);
    if (!mons.length) { body.appendChild(el("p", { class: "view-sub" }, "No Pokémon yet — add one in My Team.")); return; }
    let selected = mons[0];
    const monSelect = el("select", {}, mons.map((m, i) => el("option", { value: i }, monLabel(m))));
    monSelect.addEventListener("change", () => { selected = mons[Number(monSelect.value)]; renderHealBtns(); });

    const hpOut = el("div", { class: "formula-note" }, "");
    const healBtnsWrap = el("div", { class: "grid-2" });
    const statusOut = el("div", { class: "formula-note" }, "");

    function maxHpFor(mon) {
      const species = state.pokemonByName.get(mon.name);
      if (!species) return null;
      return calcAllStats(species, Math.min(100, Math.max(1, mon.level)), 15, 0, 1).hp;
    }

    function renderHealBtns() {
      healBtnsWrap.innerHTML = "";
      const max = maxHpFor(selected);
      const cur = selected.currentHp ?? max;
      hpOut.textContent = max ? `${selected.nickname || selected.name}: ${cur} / ${max} HP` + (selected.status && selected.status !== "None" ? ` — ${selected.status}` : "") : "Unrecognized species.";
      const available = HEAL_ITEMS.filter((item) => (save.bag[item.name] || 0) > 0);
      const availableStatus = STATUS_HEAL_ITEMS.filter((item) => (save.bag[item.name] || 0) > 0 && selected.status && selected.status !== "None" && (item.cures === "Any" || item.cures === selected.status));
      if (!available.length && !availableStatus.length) {
        healBtnsWrap.appendChild(el("p", { class: "view-sub" }, "No usable medicine in your Bag — add some in the Add Item tab."));
        return;
      }
      available.forEach((item) => {
        const count = save.bag[item.name] || 0;
        const btn = el("button", { class: "btn secondary" }, `${item.name} (×${count})`);
        btn.addEventListener("click", () => {
          if (!max) return;
          const fainted = cur === 0;
          if (item.reviveOnly && !fainted) { statusOut.textContent = `${selected.nickname || selected.name} isn't fainted.`; return; }
          if (!item.reviveOnly && fainted) { statusOut.textContent = `${selected.nickname || selected.name} has fainted — use a Revive.`; return; }
          const newHp = item.isFraction ? Math.max(1, Math.round(max * item.amount)) : Math.min(max, cur + item.amount);
          useBagItem(save, item.name, 1);
          selected.currentHp = newHp;
          if (item.cureStatus) selected.status = "None";
          writeSave(save);
          addLogEntry(`Used a ${item.name} on ${selected.nickname || selected.name}: ${cur} → ${newHp} HP${item.cureStatus ? ", status cured" : ""}.`);
          notifySaveChanged();
          statusOut.textContent = `${selected.nickname || selected.name}: ${cur} → ${newHp} HP.`;
          renderHealBtns();
        });
        healBtnsWrap.appendChild(btn);
      });
      availableStatus.forEach((item) => {
        const count = save.bag[item.name] || 0;
        const btn = el("button", { class: "btn secondary" }, `${item.name} (×${count})`);
        btn.addEventListener("click", () => {
          const before = selected.status;
          useBagItem(save, item.name, 1);
          selected.status = "None";
          writeSave(save);
          addLogEntry(`Used a ${item.name} on ${selected.nickname || selected.name}: cured ${before}.`);
          notifySaveChanged();
          statusOut.textContent = `${selected.nickname || selected.name}: ${before} cured.`;
          renderHealBtns();
        });
        healBtnsWrap.appendChild(btn);
      });
    }
    renderHealBtns();

    body.appendChild(field("Pokémon", monSelect));
    body.appendChild(hpOut);
    body.appendChild(healBtnsWrap);
    body.appendChild(statusOut);
  }

  function render() {
    const save = loadSave();
    panel.innerHTML = "";
    panel.appendChild(el("div", { class: "quick-console-header" }, [el("strong", {}, "Quick Console"), closeBtn()]));
    panel.appendChild(tabsRow());
    const body = el("div", { class: "quick-console-body" });
    panel.appendChild(body);
    if (activeTab === "add") renderAddItem(body, save);
    else if (activeTab === "level") renderLevelUp(body, save);
    else renderHeal(body, save);
  }
}
