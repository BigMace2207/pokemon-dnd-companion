// Encounter builder: pick monsters, see the difficulty for your party, get a
// random suggestion for a target difficulty, save encounters, and send them to the
// combat tracker.

import { el, field, asyncView, btn, selectEl, numInput, toast, promptDialog, confirmDialog, section } from "../ui.js";
import { loadSet } from "../data.js";
import { pageTitle, editionSwitch, attribution } from "./common.js";
import { getSettings, getDm, updateDm, listCharacters } from "../store.js";
import { evaluateEncounter, suggestEncounter, partyBudget, groupMultiplier } from "../engine/encounter.js";
import { CR_LIST, crLabel } from "../engine/rules.js";
import { monsterLine } from "../components/statblock.js";
import { addMonsterToCombat } from "../combatState.js";
import { listTrainers, getTrainerTeam } from "../../../network.js";
import { loadSave } from "../../../storage.js";

// ---- draft helpers (also used by the Bestiary's "Add to encounter") ----

function draft(dm) {
  dm.draft ||= { levels: [3, 3, 3, 3], monsters: [] };
  return dm.draft;
}

export function addToDraft(m, count = 1) {
  updateDm((dm) => {
    const d = draft(dm);
    const row = d.monsters.find((x) => x.id === m.id);
    if (row) row.count += count;
    else d.monsters.push({ id: m.id, name: m.name, cr: m.cr, xp: m.xp, count, custom: m.custom ? m : undefined });
  });
}

export function renderEncounter(container) {
  container.replaceChildren(...pageTitle("Encounter Builder", "Build a fight, check how hard it is for your party, and send it to the combat tracker."));
  const edition = getSettings().edition;
  const holder = el("div");
  container.append(editionSwitch(() => renderEncounter(container)), el("div", { style: "height:12px" }), holder);

  asyncView(holder, async () => {
    const { list: pool } = await loadSet(edition, "monsters");
    const customPool = (getDm().customMonsters || []).map((m) => ({ ...m, custom: true }));
    const all = [...customPool, ...pool];
    const byId = new Map(all.map((m) => [m.id, m]));

    const summary = el("div");
    const monsterList = el("div");
    const partyBox = el("div");
    const savedBox = el("div");

    function levels() { return draft(getDm()).levels; }

    function render() {
      const d = draft(getDm());
      // ---- party ----
      const lv = d.levels;
      const size = lv.length;
      const avg = Math.round(lv.reduce((s, x) => s + x, 0) / Math.max(1, size));
      const sizeIn = numInput(size, (v) => setParty(Math.max(1, Math.min(12, v || 1)), avg), { min: 1, max: 12 });
      const lvlIn = numInput(avg, (v) => setParty(size, Math.max(1, Math.min(20, v || 1))), { min: 1, max: 20 });
      partyBox.replaceChildren(section("Party", [
        el("div", { class: "dnd-row" }, [field("Characters", sizeIn), field("Level", lvlIn),
          btn("Use my table’s party", usePartyFromCampaign, "btn secondary small")]),
        el("p", { class: "view-sub dnd-small" }, `Levels: ${lv.join(", ")}`),
      ]));
      // ---- monsters ----
      const rows = d.monsters.map((row) => {
        const m = byId.get(row.id) || row.custom;
        const minus = btn("−", () => bump(row.id, -1), "btn secondary tiny dnd-icon-btn");
        const plus = btn("+", () => bump(row.id, 1), "btn secondary tiny dnd-icon-btn");
        const rm = btn("✕", () => remove(row.id), "btn secondary tiny dnd-icon-btn", { "aria-label": `Remove ${row.name}` });
        return el("div", { class: "dnd-row between dnd-enc-row" }, [
          el("div", { class: "dnd-grow" }, [el("strong", {}, row.name), el("span", { class: "dnd-muted dnd-small" }, ` · CR ${crLabel(row.cr)} · ${(row.xp ?? m?.xp ?? 0).toLocaleString()} XP`)]),
          el("div", { class: "dnd-row tight" }, [minus, el("span", { class: "dnd-strong dnd-mono", style: "min-width:24px;text-align:center" }, String(row.count)), plus, rm]),
        ]);
      });
      monsterList.replaceChildren(section("Monsters", [
        searchBox(),
        ...(rows.length ? rows : [el("p", { class: "view-sub" }, "No monsters yet — search above, or use Suggest.")]),
      ]));
      drawSummary();
      drawSaved();
    }

    function setParty(size, level) { updateDm((dm) => { draft(dm).levels = Array.from({ length: size }, () => level); }); render(); }
    function bump(id, n) { updateDm((dm) => { const d = draft(dm); const r = d.monsters.find((x) => x.id === id); if (r) { r.count += n; if (r.count <= 0) d.monsters = d.monsters.filter((x) => x.id !== id); } }); render(); }
    function remove(id) { updateDm((dm) => { const d = draft(dm); d.monsters = d.monsters.filter((x) => x.id !== id); }); render(); }

    async function usePartyFromCampaign() {
      const me = loadSave().networkId;
      const trainers = await listTrainers("");
      const found = [];
      for (const t of trainers) {
        const res = await getTrainerTeam(t.id);
        const lvl = res?.team?.dnd?.level;
        if (lvl) found.push(lvl);
      }
      const mine = listCharacters().map((c) => c.levelLog.length).filter(Boolean);
      const lv = found.length ? found : mine;
      void me;
      if (!lv.length) { toast("No online characters found — set the party by hand.", "bad"); return; }
      updateDm((dm) => { draft(dm).levels = lv; });
      render();
      toast(`Party set from ${lv.length} character${lv.length === 1 ? "" : "s"}.`, "good");
    }

    function searchBox() {
      const input = el("input", { type: "text", placeholder: "Add a monster… (name, type or CR)", autocomplete: "off", "aria-label": "Add a monster" });
      const results = el("div", { class: "dnd-list", style: "max-height:240px;display:none;margin:8px 0" });
      input.addEventListener("input", () => {
        const q = input.value.trim().toLowerCase();
        if (!q) { results.style.display = "none"; return; }
        const hits = all.filter((m) => `${m.name} ${m.type} cr ${crLabel(m.cr)}`.toLowerCase().includes(q)).slice(0, 30);
        results.replaceChildren(...hits.map((m) => {
          const b = el("button", { class: "dnd-list-item", type: "button" }, [el("span", { class: "dnd-grow" }, m.name), el("span", { class: "meta" }, monsterLine(m))]);
          b.addEventListener("click", () => { addToDraft(m, 1); input.value = ""; results.style.display = "none"; render(); });
          return b;
        }));
        results.style.display = hits.length ? "block" : "none";
      });
      return el("div", {}, [input, results]);
    }

    function drawSummary() {
      const d = draft(getDm());
      const monsters = d.monsters.map((r) => ({ xp: r.xp ?? byId.get(r.id)?.xp ?? 0, count: r.count }));
      const ev = evaluateEncounter(monsters, d.levels, edition);
      const b = ev.budget;
      const labels = edition === "2024" ? [["Low", b.low], ["Moderate", b.moderate], ["High", b.high]] : [["Easy", b.easy], ["Medium", b.medium], ["Hard", b.hard], ["Deadly", b.deadly]];
      const top = labels[labels.length - 1][1] * 1.25;
      const pct = Math.min(100, (ev.adjustedXp / top) * 100);
      const cls = ev.label.toLowerCase().replace(/\s+/g, "-");
      const sendBtn = btn("Send to combat tracker", () => sendToCombat(d), "btn small");
      const saveBtn = btn("Save encounter", saveEncounter, "btn secondary small");
      const clearBtn = btn("Clear", async () => { if (await confirmDialog("Remove every monster from this encounter?", { ok: "Clear", danger: true })) { updateDm((dm) => { draft(dm).monsters = []; }); render(); } }, "btn secondary small");
      summary.replaceChildren(section("Difficulty", [
        el("div", { class: `dnd-diff dnd-diff-${cls}` }, [
          el("div", { class: "dnd-diff-label" }, ev.total ? ev.label : "—"),
          el("div", { class: "dnd-diff-bar" }, [el("div", { class: "dnd-diff-fill", style: `width:${pct}%` }), ...labels.map(([, v]) => el("span", { class: "dnd-diff-tick", style: `left:${Math.min(100, (v / top) * 100)}%` }))]),
        ]),
        el("table", { class: "kv-table" }, [
          row("Monsters", String(ev.total)),
          row("Base XP", ev.baseXp.toLocaleString()),
          edition === "2014" ? row("Group multiplier", `×${ev.multiplier}`) : null,
          row(edition === "2014" ? "Adjusted XP" : "Encounter XP", ev.adjustedXp.toLocaleString()),
          row("XP each when defeated", ev.perPlayer.toLocaleString()),
          ...labels.map(([n, v]) => row(`${n} threshold`, v.toLocaleString())),
        ].filter(Boolean)),
        el("p", { class: "view-sub dnd-small", style: "margin-top:8px" }, edition === "2014"
          ? "Thresholds and the group multiplier follow the Dungeon Master’s Guide encounter-building guidance; treat them as a guide, not a guarantee."
          : "2024 rules compare the raw XP of the creatures to your party’s XP budget."),
        el("div", { class: "dnd-row" }, [sendBtn, saveBtn, clearBtn]),
      ]));
    }

    function sendToCombat(d) {
      if (!d.monsters.length) { toast("Add some monsters first.", "bad"); return; }
      for (const r of d.monsters) { const m = byId.get(r.id) || r.custom; if (m) addMonsterToCombat(m, r.count); }
      toast("Monsters added to the combat tracker.", "good");
    }

    async function saveEncounter() {
      const d = draft(getDm());
      if (!d.monsters.length) { toast("Nothing to save yet.", "bad"); return; }
      const name = await promptDialog("Save encounter", "Name", "");
      if (!name?.trim()) return;
      updateDm((dm) => { dm.encounters.push({ id: `e${Date.now().toString(36)}`, name: name.trim(), edition, levels: [...d.levels], monsters: d.monsters.map((r) => ({ ...r })) }); });
      render();
      toast("Encounter saved.", "good");
    }

    function drawSaved() {
      const saved = getDm().encounters || [];
      savedBox.replaceChildren(section("Saved encounters", saved.length ? saved.map((e) => {
        const total = e.monsters.reduce((s, r) => s + r.count, 0);
        return el("div", { class: "dnd-row between dnd-enc-row" }, [
          el("div", { class: "dnd-grow" }, [el("strong", {}, e.name), el("span", { class: "dnd-muted dnd-small" }, ` · ${total} creature${total === 1 ? "" : "s"} · ${e.edition}`)]),
          el("div", { class: "dnd-row tight" }, [
            btn("Load", () => { updateDm((dm) => { dm.draft = { levels: [...e.levels], monsters: e.monsters.map((r) => ({ ...r })) }; }); render(); toast(`Loaded “${e.name}”.`, "good"); }, "btn secondary tiny"),
            btn("Delete", async () => { if (await confirmDialog(`Delete “${e.name}”?`, { ok: "Delete", danger: true })) { updateDm((dm) => { dm.encounters = dm.encounters.filter((x) => x.id !== e.id); }); render(); } }, "btn secondary tiny"),
          ]),
        ]);
      }) : [el("p", { class: "view-sub" }, "Saved encounters appear here.")]));
    }

    // ---- suggestion ----
    function suggestCard() {
      const diffs = edition === "2024" ? [["low", "Low"], ["moderate", "Moderate"], ["high", "High"]] : [["easy", "Easy"], ["medium", "Medium"], ["hard", "Hard"], ["deadly", "Deadly"]];
      const diffSel = selectEl(diffs, diffs[1][0], () => {});
      const minSel = selectEl(CR_LIST.map((c) => [String(c), `CR ${crLabel(c)}`]), "0", () => {});
      const maxSel = selectEl(CR_LIST.map((c) => [String(c), `CR ${crLabel(c)}`]), "5", () => {});
      const countIn = numInput(6, () => {}, { min: 1, max: 15 });
      const typeSel = selectEl([["", "Any type"], ...[...new Set(pool.map((m) => m.type))].sort().map((t) => [t, t])], "", () => {});
      const go = btn("Suggest an encounter", () => {
        const budget = partyBudget(levels(), edition);
        const target = budget[diffSel.value];
        const picks = suggestEncounter(pool.filter((m) => !typeSel.value || m.type === typeSel.value), target, { minCr: Number(minSel.value), maxCr: Number(maxSel.value), maxCount: Number(countIn.value) || 6, edition, partySize: levels().length });
        if (!picks.length) { toast("Nothing fits — widen the CR range.", "bad"); return; }
        updateDm((dm) => { draft(dm).monsters = picks.map((p) => ({ id: p.monster.id, name: p.monster.name, cr: p.monster.cr, xp: p.monster.xp, count: p.count })); });
        render();
      }, "btn");
      return section("Suggest an encounter", [
        el("div", { class: "dnd-filters" }, [field("Target difficulty", diffSel), field("Min CR", minSel), field("Max CR", maxSel), field("Most creatures", countIn), field("Creature type", typeSel)]),
        go,
      ]);
    }

    const row = (k, v) => el("tr", {}, [el("td", {}, k), el("td", {}, v)]);
    render();
    void groupMultiplier;
    return [el("div", { class: "dnd-enc-grid" }, [el("div", { class: "dnd-stack" }, [partyBox, monsterList, suggestCard()]), el("div", { class: "dnd-stack" }, [summary, savedBox])]), attribution()];
  });
}
