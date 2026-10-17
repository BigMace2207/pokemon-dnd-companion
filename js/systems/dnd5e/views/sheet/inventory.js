// Sheet > Inventory: carried items (equip, attune, quantity, bonus), money, weight and
// the "add an item" dialog (SRD equipment, magic items, or a custom item).

import { el, field, btn, chip, section, toast, modal, selectEl, textInput, numInput, confirmDialog, checkbox, tabs } from "../../ui.js";
import { loadSet } from "../../data.js";
import { newItem, addItemRecord, itemRecord } from "../../engine/character.js";
import { CURRENCY, totalCopper, walletFromCopper, costToCopper, carryCapacity } from "../../engine/rules.js";

const signed = (n) => (n >= 0 ? `+${n}` : `−${Math.abs(n)}`);
const fmtWeight = (w) => (Math.round(w * 100) / 100).toString();

export function renderInventoryTab(panel, S) {
  const { char, d, ctx } = S;

  // ---- weight / capacity
  const cap = d.capacity;
  const pct = Math.min(100, (d.weight / cap) * 100);
  const lvl = d.encumbrance === "heavy" ? "bad" : d.encumbrance === "encumbered" ? "warn" : "good";
  panel.append(section("Carrying", [
    el("div", { class: "dnd-row between" }, [
      el("strong", {}, `${fmtWeight(d.weight)} lb carried`),
      el("span", { class: "dnd-muted dnd-small" }, `capacity ${cap} lb · encumbered over ${d.scores.STR.score * 5} · heavily over ${d.scores.STR.score * 10}`),
    ]),
    el("div", { class: "dnd-hp-track", style: "margin-top:6px" }, [el("div", { class: `dnd-hp-fill ${lvl}`, style: `width:${pct}%` })]),
    el("div", { class: "dnd-small dnd-muted", style: "margin-top:6px" }, d.encumbrance === "none" ? "Not encumbered." : d.encumbrance === "encumbered" ? "Encumbered: speed reduced by 10 ft." : "Heavily encumbered: speed reduced by 20 ft., disadvantage on checks, attacks and saves using Str, Dex or Con."),
  ]));

  // ---- money
  panel.append(moneyCard(S));

  // ---- items
  const rows = char.inventory.map((it) => itemRow(S, it));
  const addBtn = btn("+ Add item", () => openAddItem(S), "btn small");
  const attuned = d.attunedCount;
  panel.append(section("Items", [
    el("div", { class: "dnd-row between", style: "margin-bottom:8px" }, [addBtn, chip(`Attuned ${attuned}/3`, attuned > 3 ? "bad" : attuned ? "accent" : "")]),
    ...(rows.length ? rows : [el("p", { class: "view-sub" }, "Nothing carried yet.")]),
  ]));
  void carryCapacity;
}

// ------------------------------------------------------------------ money

function moneyCard(S) {
  const { char } = S;
  const w = char.currency;
  const boxes = CURRENCY.map((c) => {
    const input = numInput(w[c.key] || 0, (v) => { w[c.key] = Math.max(0, v || 0); S.commit(); }, { min: 0, ariaLabel: `${c.name} pieces` });
    const plus = btn("+", () => { w[c.key] = (w[c.key] || 0) + 1; S.commit(); }, "btn secondary tiny dnd-icon-btn", { "aria-label": `Add 1 ${c.key}` });
    const minus = btn("−", () => { w[c.key] = Math.max(0, (w[c.key] || 0) - 1); S.commit(); }, "btn secondary tiny dnd-icon-btn", { "aria-label": `Remove 1 ${c.key}` });
    return el("div", { class: "dnd-coin" }, [el("div", { class: "dnd-coin-label" }, c.key.toUpperCase()), el("div", { class: "dnd-row tight" }, [minus, input, plus])]);
  });
  const total = totalCopper(w);
  const adjust = el("input", { type: "number", value: "10", inputmode: "numeric", class: "dnd-num", "aria-label": "Amount in gold" });
  const gain = btn("Gain gp", () => { w.gp = (w.gp || 0) + (Number(adjust.value) || 0); S.commit(); }, "btn secondary small");
  const spend = btn("Spend gp", () => {
    const cost = Math.round((Number(adjust.value) || 0) * 100);
    if (cost > total) { toast("Not enough money.", "bad"); return; }
    const out = walletFromCopper(total - cost, { useElectrum: (w.ep || 0) > 0 });
    Object.assign(w, out);
    S.commit();
  }, "btn secondary small");
  const tidy = btn("Tidy coins", () => { Object.assign(w, walletFromCopper(total, { useElectrum: false })); S.commit(); }, "btn secondary small");
  return section("Money", [
    el("div", { class: "dnd-coins" }, boxes),
    el("div", { class: "dnd-row", style: "margin-top:10px" }, [el("span", { class: "dnd-muted dnd-small" }, `Worth ${(total / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })} gp`), adjust, gain, spend, tidy]),
  ]);
}

// ------------------------------------------------------------------ item rows

function itemRow(S, it) {
  const { char, ctx } = S;
  const rec = itemRecord(it, ctx);
  const kind = rec.kind || "gear";
  const canEquip = kind === "weapon" || kind === "armor";
  const equip = canEquip ? checkbox("Equipped", it.equipped, (v) => {
    if (v && kind === "armor" && !rec.armor?.shield && rec.armor?.category !== "Shield") {
      for (const o of char.inventory) if (o !== it && o.equipped && itemRecord(o, ctx).kind === "armor" && itemRecord(o, ctx).armor?.category !== "Shield") o.equipped = false;
    }
    if (v && kind === "armor" && (rec.armor?.shield || rec.armor?.category === "Shield")) {
      for (const o of char.inventory) if (o !== it && o.equipped && (itemRecord(o, ctx).armor?.shield || itemRecord(o, ctx).armor?.category === "Shield")) o.equipped = false;
    }
    it.equipped = v;
    S.commit();
  }) : null;
  const attune = checkbox("Attuned", it.attuned, (v) => { it.attuned = v; S.commit(); });
  const minus = btn("−", () => { it.qty = Math.max(0, (Number(it.qty) || 1) - 1); if (!it.qty) { char.inventory = char.inventory.filter((x) => x !== it); } S.commit(); }, "btn secondary tiny dnd-icon-btn", { "aria-label": `One less ${it.name}` });
  const plus = btn("+", () => { it.qty = (Number(it.qty) || 1) + 1; S.commit(); }, "btn secondary tiny dnd-icon-btn", { "aria-label": `One more ${it.name}` });
  const edit = btn("Edit", () => openEditItem(S, it), "btn secondary tiny");
  const del = btn("✕", async () => { if (await confirmDialog(`Remove ${it.name}?`, { ok: "Remove", danger: true })) { char.inventory = char.inventory.filter((x) => x !== it); S.commit(); } }, "btn secondary tiny dnd-icon-btn", { "aria-label": `Remove ${it.name}` });
  const tags = [];
  if (kind === "weapon" && rec.weapon?.damage) tags.push(chip(`${rec.weapon.damage.dice} ${rec.weapon.damage.type?.toLowerCase() || ""}`.trim()));
  if (kind === "armor" && rec.armor) tags.push(chip(rec.armor.category === "Shield" ? `+${rec.armor.base} AC` : `AC ${rec.armor.base}${rec.armor.dexBonus === false ? "" : " + Dex"}`));
  if (it.bonus) tags.push(chip(`${signed(it.bonus)} magic`, "gold"));
  if (it.magic) tags.push(chip(it.rarity || "magic", "gold"));
  const detail = rec.desc?.length ? el("details", { class: "dnd-fold dnd-item-desc" }, [el("summary", {}, "Description"), ...rec.desc.slice(0, 6).map((p) => el("p", { class: "dnd-small" }, p))]) : (it.notes ? el("p", { class: "dnd-small dnd-muted" }, it.notes) : null);
  return el("div", { class: `dnd-item${it.equipped ? " equipped" : ""}` }, [
    el("div", { class: "dnd-row between" }, [
      el("div", { class: "dnd-grow" }, [el("strong", {}, it.name), " ", ...tags]),
      el("div", { class: "dnd-row tight" }, [minus, el("span", { class: "dnd-strong dnd-mono", style: "min-width:22px;text-align:center" }, String(it.qty ?? 1)), plus, edit, del]),
    ]),
    el("div", { class: "dnd-row" }, [equip, it.magic || it.bonus || it.attuned ? attune : (rec.attunement ? attune : null), el("span", { class: "dnd-muted dnd-small" }, it.weight != null ? `${fmtWeight((Number(it.weight) || 0) * (Number(it.qty) || 1))} lb` : "")].filter(Boolean)),
    detail,
  ].filter(Boolean));
}

function openEditItem(S, it) {
  const { char } = S;
  const name = textInput(it.name, () => {}, {});
  const qty = numInput(it.qty ?? 1, () => {}, { min: 0 });
  const weight = numInput(it.weight ?? "", () => {}, { min: 0, step: 0.25 });
  const bonus = numInput(it.bonus || 0, () => {}, { min: -3, max: 5 });
  const notes = textInput(it.notes || "", () => {}, { multiline: true, rows: 3 });
  modal({
    title: `Edit ${it.name}`,
    body: [field("Name", name), el("div", { class: "dnd-grid-2" }, [field("Quantity", qty), field("Weight each (lb)", weight)]), field("Magic bonus (+1, +2, ... to attack, damage or AC)", bonus), field("Notes", notes)],
    actions: [{ label: "Cancel" }, { label: "Save", cls: "btn", onClick: () => { it.name = name.value.trim() || it.name; it.qty = Number(qty.value) || 0; it.weight = weight.value === "" ? null : Number(weight.value); it.bonus = Number(bonus.value) || 0; it.notes = notes.value; if (!it.qty) char.inventory = char.inventory.filter((x) => x !== it); S.commit(); } }],
  });
}

// ------------------------------------------------------------------ add item dialog

async function openAddItem(S) {
  const { char, ctx } = S;
  const equipment = ctx.raw.equipment.list;
  const magic = (await loadSet(char.edition, "magicItems")).list;
  const body = el("div");
  const t = tabs([
    { id: "srd", label: "Equipment", render: (p) => p.append(srdList(equipment, false)) },
    { id: "magic", label: "Magic items", render: (p) => p.append(srdList(magic, true)) },
    { id: "custom", label: "Custom item", render: (p) => p.append(customForm()) },
  ], { initial: "srd" });
  body.append(t.bar, t.panel);
  const m = modal({ title: "Add an item", body, wide: true, actions: [{ label: "Done" }] });

  function srdList(list, isMagic) {
    const q = el("input", { type: "text", placeholder: "Search…", autocomplete: "off", "aria-label": "Search items" });
    const kinds = isMagic ? ["", "Armor", "Weapon", "Wondrous Item", "Potion", "Ring", "Rod", "Scroll", "Staff", "Wand"] : ["", "weapon", "armor", "gear", "tool", "pack", "ammo", "mount"];
    const kindSel = selectEl(kinds.map((k) => [k, k ? k[0].toUpperCase() + k.slice(1) : "All types"]), "", () => draw());
    const results = el("div", { class: "dnd-list", style: "max-height:46vh" });
    function draw() {
      const needle = q.value.trim().toLowerCase();
      const hits = list.filter((i) => (!needle || i.name.toLowerCase().includes(needle)) && (!kindSel.value || (isMagic ? (i.category || "").includes(kindSel.value) : i.kind === kindSel.value))).slice(0, 80);
      results.replaceChildren(...hits.map((i) => {
        const add = btn("Add", () => {
          addItemRecord(char, i, { magic: isMagic });
          S.commit();
          toast(`${i.name} added.`, "good");
        }, "btn small");
        return el("div", { class: "dnd-list-item", style: "cursor:default" }, [
          el("span", { class: "dnd-grow" }, [i.name, " ", el("span", { class: "dnd-muted dnd-tiny" }, isMagic ? `${i.rarity || ""}${i.attunement ? " · attunement" : ""}` : `${i.cost ? `${i.cost.q} ${i.cost.u}` : ""}${i.weight ? ` · ${i.weight} lb` : ""}`)]),
          add,
        ]);
      }));
      if (!hits.length) results.replaceChildren(el("p", { class: "view-sub", style: "padding:12px" }, "No matches."));
    }
    q.addEventListener("input", draw);
    draw();
    return el("div", {}, [el("div", { class: "dnd-grid-2" }, [field("Search", q), field("Type", kindSel)]), results]);
  }

  function customForm() {
    const f = { name: "", kind: "gear", qty: 1, weight: "", dice: "1d6", dtype: "Slashing", range: "Melee", props: "", cat: "Simple", acBase: 11, acCat: "Light", dex: true };
    const wrap = el("div");
    function draw() {
      const parts = [
        field("Name", textInput(f.name, (v) => { f.name = v; }, { placeholder: "e.g. Moonblade" })),
        el("div", { class: "dnd-grid-2" }, [
          field("Type", selectEl([["gear", "Gear"], ["weapon", "Weapon"], ["armor", "Armor"], ["shield", "Shield"]], f.kind, (v) => { f.kind = v; draw(); })),
          field("Quantity", numInput(f.qty, (v) => { f.qty = v || 1; }, { min: 1 })),
        ]),
        field("Weight each (lb)", numInput(f.weight, (v) => { f.weight = v; }, { min: 0, step: 0.25 })),
      ];
      if (f.kind === "weapon") parts.push(
        el("div", { class: "dnd-grid-2" }, [field("Damage dice", textInput(f.dice, (v) => { f.dice = v; })), field("Damage type", textInput(f.dtype, (v) => { f.dtype = v; }))]),
        el("div", { class: "dnd-grid-2" }, [field("Melee or ranged", selectEl([["Melee", "Melee"], ["Ranged", "Ranged"]], f.range, (v) => { f.range = v; })), field("Category", selectEl([["Simple", "Simple"], ["Martial", "Martial"]], f.cat, (v) => { f.cat = v; }))]),
        field("Properties (comma separated: Finesse, Light, Versatile…)", textInput(f.props, (v) => { f.props = v; })),
      );
      if (f.kind === "armor") parts.push(
        el("div", { class: "dnd-grid-2" }, [field("Base AC", numInput(f.acBase, (v) => { f.acBase = v || 10; }, { min: 0, max: 30 })), field("Category", selectEl([["Light", "Light"], ["Medium", "Medium"], ["Heavy", "Heavy"]], f.acCat, (v) => { f.acCat = v; }))]),
        checkbox("Adds Dexterity modifier", f.dex, (v) => { f.dex = v; }),
      );
      if (f.kind === "shield") parts.push(field("AC bonus", numInput(f.acBase === 11 ? 2 : f.acBase, (v) => { f.acBase = v || 2; }, { min: 0, max: 10 })));
      parts.push(btn("Add to inventory", () => {
        if (!f.name.trim()) { toast("Give it a name.", "bad"); return; }
        const it = newItem({ name: f.name.trim(), weight: f.weight === "" ? null : Number(f.weight), kind: f.kind === "shield" ? "armor" : f.kind }, f.qty);
        if (f.kind === "weapon") it.custom = { kind: "weapon", weapon: { category: f.cat, range: f.range, damage: { dice: f.dice, type: f.dtype }, properties: f.props.split(",").map((x) => x.trim()).filter(Boolean), reach: f.range === "Melee" ? 5 : null } };
        if (f.kind === "armor") it.custom = { kind: "armor", armor: { category: f.acCat, base: Number(f.acBase) || 10, dexBonus: f.dex, maxBonus: f.acCat === "Medium" ? 2 : null } };
        if (f.kind === "shield") it.custom = { kind: "armor", armor: { category: "Shield", base: Number(f.acBase) || 2, dexBonus: false, shield: true } };
        char.inventory.push(it);
        S.commit();
        toast(`${it.name} added.`, "good");
        m.close();
      }, "btn"));
      wrap.replaceChildren(...parts);
    }
    draw();
    return wrap;
  }
}

void costToCopper;
