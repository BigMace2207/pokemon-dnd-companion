// Combat. Two faces of the same page:
//   Player view -- the initiative order the DM has published: whose turn it is, how hurt
//                  the monsters look (never exact numbers), and your party's HP.
//   DM tracker  -- the real thing: initiative, HP, conditions, notes, the monsters' stat
//                  blocks, and "publish live" to share the public view with the table.
// Party members' HP and conditions changed in the tracker are sent to their sheets as
// directives (the same transport the Pokemon DM tools use).

import { el, btn, chip, section, tabs, numInput, textInput, selectEl, field, toast, confirmDialog, modal, checkbox } from "../ui.js";
import { pageTitle } from "./common.js";
import { hpBar } from "../components/hpBar.js";
import { pips, savePips } from "../components/pips.js";
import { statBlock } from "../components/statblock.js";
import { loadSet } from "../data.js";
import { getSettings, activeCharacter } from "../store.js";
import { withDm, getDmToken } from "../dmAccess.js";
import {
  getCombat, mutateCombat, resetCombat, addMonsterToCombat, publishCombat, endPublishedCombat, fetchPublicCombat,
} from "../combatState.js";
import {
  orderedCombatants, currentCombatant, nextTurn, prevTurn, withStableTurn, rollInitiative, damageCombatant, healCombatant,
  healthStatus, concentrationDc, pcCombatant, customCombatant,
} from "../engine/encounter.js";
import { CONDITION_NAMES_2014 } from "../engine/rules.js";
import { dmAction, listTrainers, getTrainerTeam, sendNoteToDm, getBattleLog } from "../../../network.js";
import { loadSave } from "../../../storage.js";

export function renderCombat(container) {
  container.replaceChildren();
  container.append(...pageTitle("Combat", "Initiative, turns, hit points and conditions."));
  const body = el("div");
  const t = tabs([
    { id: "player", label: "Player view", render: (p) => renderPlayerView(p) },
    { id: "dm", label: "DM tracker", render: (p) => withDm(p, (token) => renderTracker(p, token)) },
  ], { stateKey: "dnd:combat:tab", initial: "player" });
  body.append(t.bar, t.panel);
  container.append(body);
}

// ------------------------------------------------------------------ player view

const STATUS_CLASS = { Unhurt: "good", Wounded: "warn", Bloodied: "bad", "Near death": "bad", Defeated: "dim", Down: "bad" };

function renderPlayerView(panel) {
  panel.replaceChildren();
  const host = el("div", { class: "dnd-stack" }, el("p", { class: "view-sub" }, "Waiting for the DM…"));
  const stamp = el("span", { class: "dnd-muted dnd-small" });
  const mine = activeCharacter();
  let timer = null, lastKey = "";

  async function load() {
    try {
      const ft = await fetchPublicCombat();
      stamp.textContent = `Updated ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
      const key = JSON.stringify(ft);
      if (key === lastKey) return;
      lastKey = key;
      draw(ft);
    } catch { stamp.textContent = "Couldn't reach the server."; }
  }

  function draw(ft) {
    if (!ft || !ft.combatants.length || ft.phase === "draft") {
      host.replaceChildren(el("div", { class: "card" }, [el("h4", {}, "No fight right now"), el("p", { class: "view-sub" }, "When the DM starts combat and publishes it, the initiative order shows up here.")]), initiativeCard(mine));
      return;
    }
    const cur = ft.combatants[ft.currentIndex];
    host.replaceChildren(
      el("div", { class: "card dnd-turn-banner" }, [
        el("div", { class: "dnd-muted dnd-small" }, `Round ${ft.round}`),
        el("div", { class: "dnd-turn-now" }, cur ? `${cur.name}’s turn` : ""),
        cur && mine && cur.pcId === mine.id ? el("strong", { style: "color:var(--good)" }, "That’s you!") : null,
      ].filter(Boolean)),
      el("div", { class: "dnd-stack" }, ft.combatants.map((c, i) => combatantPublic(c, i === ft.currentIndex, mine))),
      initiativeCard(mine),
    );
  }

  panel.append(el("div", { class: "dnd-row between" }, [el("span"), stamp]), host);
  load();
  timer = setInterval(() => { if (!document.body.contains(host)) { clearInterval(timer); return; } if (!document.hidden) load(); }, 4000);
}

function combatantPublic(c, active, mine) {
  const you = c.kind === "pc" && mine && c.pcId === mine.id;
  const cls = STATUS_CLASS[c.status] || "";
  return el("div", { class: `card dnd-combatant${active ? " active" : ""}${c.dead ? " dead" : ""}${you ? " you" : ""}` }, [
    el("div", { class: "dnd-row between" }, [
      el("div", {}, [el("strong", {}, c.name), you ? el("span", { class: "dnd-muted dnd-small" }, " (you)") : null].filter(Boolean)),
      el("div", { class: "dnd-row tight" }, [c.init != null ? chip(`Init ${c.init}`) : null, active ? chip("Acting", "gold") : null].filter(Boolean)),
    ]),
    c.kind === "pc" && c.maxHp != null ? hpBar(c.hp, c.maxHp, c.tempHp) : el("div", { class: `dnd-status ${cls}` }, c.status),
    c.kind === "pc" && c.ac != null ? el("div", { class: "dnd-muted dnd-small" }, `AC ${c.ac}`) : null,
    c.conditions?.length ? el("div", { class: "dnd-row tight" }, c.conditions.map((x) => chip(x, "bad"))) : null,
    c.concentrating ? el("div", { class: "dnd-small dnd-muted" }, "Concentrating on a spell") : null,
    c.deathSaves ? el("div", { class: "dnd-small" }, `Death saves — ${c.deathSaves.s} success / ${c.deathSaves.f} failure`) : null,
  ].filter(Boolean));
}

function initiativeCard(mine) {
  if (!mine) return null;
  const save = loadSave();
  const input = numInput(null, () => {}, { min: -10, max: 40, ariaLabel: "My initiative" });
  return section("Tell the DM your initiative", [
    el("div", { class: "dnd-row" }, [input, btn("Send", () => {
      if (input.value === "") { toast("Enter your initiative first.", "bad"); return; }
      sendNoteToDm(mine.name || save.trainer?.name || "Player", `Initiative: ${input.value}`);
      toast("Sent to the DM.", "good");
    }, "btn small")]),
  ]);
}

// ------------------------------------------------------------------ DM tracker

function renderTracker(panel, token) {
  panel.replaceChildren();
  const edition = getSettings().edition;
  const toolbar = el("div", { class: "card" });
  const list = el("div", { class: "dnd-stack" });
  const addHost = el("div");
  const logHost = el("div");
  const openStat = new Set();
  let monsters = null;
  let publishTimer = null;

  const dirty = () => { const c = getCombat(); if (c.live) { clearTimeout(publishTimer); publishTimer = setTimeout(publish, 500); } };
  async function publish(showToast = false) {
    try { await publishCombat(token); if (showToast) toast("Published to the table.", "good"); } catch { toast("Couldn't publish.", "bad"); }
  }
  const mutate = (fn) => { mutateCombat(fn); redraw(); dirty(); };
  const note = (combat, text) => { combat.log.unshift({ t: Date.now(), text }); combat.log.length = Math.min(combat.log.length, 60); };

  function sendToPlayer(c, kind, data) {
    if (c.kind !== "pc" || !c.owner) return;
    if (kind === "hp") dmAction(token, "setHp", { targetId: c.owner, monId: c.pcId, absolute: c.hp, trainerName: c.name, monName: c.name });
    else if (kind === "status") dmAction(token, "setStatus", { targetId: c.owner, monId: c.pcId, status: data, trainerName: c.name, monName: c.name });
  }

  // ---- toolbar
  function drawToolbar() {
    const combat = getCombat();
    const order = orderedCombatants(combat);
    const cur = currentCombatant(combat);
    const unrolled = order.filter((c) => c.init == null).length;
    toolbar.replaceChildren(
      el("div", { class: "dnd-row between" }, [
        el("div", {}, [el("strong", { style: "font-size:calc(20px * var(--s))" }, `Round ${combat.round}`), el("span", { class: "dnd-muted" }, cur && combat.started ? `  ·  ${cur.name}’s turn` : combat.started ? "" : "  ·  not started")]),
        el("div", { class: "dnd-row tight" }, [
          btn("◀ Prev", () => mutate((c) => prevTurn(c)), "btn secondary small"),
          combat.started
            ? btn("Next turn ▶", () => mutate((c) => { const before = c.round; nextTurn(c); const n = currentCombatant(c); if (n) note(c, `${c.round !== before ? `Round ${c.round}. ` : ""}${n.name}’s turn.`); tickConditions(c, n); }), "btn small")
            : btn("Start combat", () => {
              if (!order.length) { toast("Add some combatants first.", "bad"); return; }
              mutate((c) => { c.started = true; c.round = 1; c.turn = 0; for (const x of c.combatants) if (x.init == null) rollInitiative(x); note(c, "Combat begins."); });
            }, "btn small"),
        ]),
      ]),
      el("div", { class: "dnd-row", style: "margin-top:10px" }, [
        btn(unrolled ? `Roll initiative (${unrolled})` : "Re-roll all initiative", () => mutate((c) => withStableTurn(c, () => { for (const x of c.combatants) if (unrolled ? x.init == null : true) rollInitiative(x); })), "btn secondary small"),
        btn("Add combatants", () => toggleAdd(), "btn secondary small"),
        checkbox("Publish live to players", !!combat.live, (v) => { mutate((c) => { c.live = v; }); if (v) publish(true); else endPublishedCombat(token); }),
        btn("Publish now", () => publish(true), "btn secondary small"),
        btn("End combat", async () => {
          if (!(await confirmDialog("End this fight and clear the tracker?", { ok: "End combat", danger: true }))) return;
          resetCombat(); await endPublishedCombat(token); redraw();
        }, "btn danger small"),
      ]),
    );
  }

  // Conditions the rules end at the start/end of turn aren't automated (they vary per source);
  // this just reminds the DM about anything tracked on the creature whose turn it is.
  function tickConditions(combat, cur) {
    if (cur?.conditions?.length) toast(`${cur.name}: ${cur.conditions.join(", ")}`, "");
    if (cur?.concentration) note(combat, `${cur.name} is concentrating on ${cur.concentration}.`);
  }

  // ---- add panel
  function toggleAdd() {
    if (addHost.childElementCount) { addHost.replaceChildren(); return; }
    const party = el("div", { class: "dnd-stack" }, el("p", { class: "dnd-small dnd-muted" }, "Looking for online characters…"));
    (async () => {
      const found = [];
      try {
        for (const t of await listTrainers("")) { const res = await getTrainerTeam(t.id); const s = res?.team?.dnd; if (s) found.push({ t, s }); }
      } catch { /* offline */ }
      party.replaceChildren(...(found.length ? [
        btn("Add all online characters", () => { mutate((c) => { for (const { t, s } of found) addPc(c, t, s); }); }, "btn secondary small"),
        ...found.map(({ t, s }) => el("div", { class: "dnd-row between" }, [`${s.name} (${s.classes}, ${s.hp}/${s.maxHp} HP)`, btn("Add", () => mutate((c) => addPc(c, t, s)), "btn secondary tiny")])),
      ] : [el("p", { class: "dnd-small dnd-muted" }, "No D&D characters are online. Add a custom PC below instead.")]));
    })();
    const q = el("input", { type: "text", placeholder: "Search monsters…", autocomplete: "off", "aria-label": "Search monsters" });
    const results = el("div", { class: "dnd-list", style: "max-height:30vh" });
    const countIn = numInput(1, () => {}, { min: 1, max: 20, ariaLabel: "How many" });
    const hpMode = selectEl([["average", "Average HP"], ["roll", "Roll HP"]], "average", () => {});
    async function search() {
      monsters ||= (await loadSet(edition, "monsters")).list;
      const needle = q.value.trim().toLowerCase();
      const hits = monsters.filter((m) => !needle || m.name.toLowerCase().includes(needle)).slice(0, 40);
      results.replaceChildren(...hits.map((m) => el("div", { class: "dnd-list-item", style: "cursor:default" }, [
        el("span", { class: "dnd-grow" }, [m.name, el("span", { class: "dnd-muted dnd-tiny" }, `  CR ${m.cr}`)]),
        btn("Add", () => { addMonsterToCombat(m, Number(countIn.value) || 1, { hpMode: hpMode.value }); redraw(); dirty(); }, "btn secondary tiny"),
      ])));
    }
    q.addEventListener("input", search); search();
    const cName = textInput("", () => {}, { placeholder: "Name", ariaLabel: "Name" });
    const cHp = numInput(10, () => {}, { min: 1, ariaLabel: "HP" }), cAc = numInput(12, () => {}, { min: 0, ariaLabel: "AC" }), cInit = numInput(0, () => {}, { ariaLabel: "Initiative bonus" });
    const cKind = selectEl([["npc", "NPC / other"], ["pc", "Player character"], ["monster", "Monster"]], "npc", () => {});
    addHost.replaceChildren(el("div", { class: "card" }, [
      el("div", { class: "dnd-section-head" }, [el("h4", {}, "Add to the fight"), btn("Close", () => addHost.replaceChildren(), "btn secondary tiny")]),
      el("div", { class: "dnd-grid-2" }, [
        el("div", {}, [el("h5", {}, "Party"), party]),
        el("div", {}, [el("h5", {}, "Monsters"), el("div", { class: "dnd-row" }, [q, field("Qty", countIn), hpMode]), results]),
      ]),
      el("h5", {}, "Custom creature"),
      el("div", { class: "dnd-row" }, [cName, field("HP", cHp), field("AC", cAc), field("Init +", cInit), cKind, btn("Add", () => {
        if (!cName.value.trim()) { toast("Give it a name.", "bad"); return; }
        mutate((c) => { c.combatants.push(customCombatant({ name: cName.value.trim(), hp: cHp.value || 10, ac: cAc.value || 10, initBonus: Number(cInit.value) || 0, kind: cKind.value })); });
        cName.value = "";
      }, "btn small")]),
    ]));
  }

  function addPc(c, t, s) {
    if (c.combatants.some((x) => x.pcId === s.id && x.owner === t.id)) return;
    const pc = pcCombatant({ ...s, owner: t.id });
    pc.dexMod = s.initiative ?? 0;
    c.combatants.push(pc);
  }

  // ---- combatant rows
  function row(c, index, activeId, started) {
    const active = started && c.id === activeId;
    const hpControls = hpPanel(c);
    const stat = el("div");
    const expanded = openStat.has(c.id);
    const statBtn = c.kind === "monster" ? btn(expanded ? "Hide stats" : "Stat block", async () => {
      if (openStat.has(c.id)) openStat.delete(c.id); else openStat.add(c.id);
      redraw();
    }, "btn secondary tiny") : null;
    if (expanded && c.kind === "monster") {
      (async () => {
        monsters ||= (await loadSet(edition, "monsters")).list;
        const m = monsters.find((x) => x.id === c.monsterId);
        if (m) stat.replaceChildren(statBlock(m, { who: c.name }));
      })();
    }
    const initIn = numInput(c.init, (v) => mutate((cb) => withStableTurn(cb, () => { const x = cb.combatants.find((y) => y.id === c.id); if (x) x.init = v; })), { min: -10, max: 60, cls: "dnd-init", ariaLabel: `${c.name} initiative` });
    const nameIn = textInput(c.name, (v) => { const x = getCombat().combatants.find((y) => y.id === c.id); if (x) { mutateCombat((cb) => { cb.combatants.find((y) => y.id === c.id).name = v; }); dirty(); } }, { ariaLabel: "Name" });
    return el("div", { class: `card dnd-combatant${active ? " active" : ""}${c.dead ? " dead" : ""}${c.hidden ? " hidden-c" : ""}` }, [
      el("div", { class: "dnd-row" }, [
        el("div", { class: "dnd-initbox" }, [el("span", { class: "dnd-tiny dnd-muted" }, "INIT"), initIn]),
        el("div", { class: "dnd-grow" }, [nameIn, el("div", { class: "dnd-row tight dnd-small dnd-muted" }, [c.kind === "pc" ? "Player" : c.kind === "monster" ? `Monster${c.cr != null ? ` · CR ${c.cr}` : ""}` : "NPC", `AC ${c.ac}`, c.hidden ? "hidden from players" : ""].filter(Boolean).join(" · "))]),
        el("div", { class: "dnd-row tight" }, [
          btn("🎲", () => mutate((cb) => withStableTurn(cb, () => rollInitiative(cb.combatants.find((y) => y.id === c.id)))), "btn secondary tiny dnd-icon-btn", { title: "Roll initiative", "aria-label": `Roll initiative for ${c.name}` }),
          statBtn,
          btn(c.hidden ? "Reveal" : "Hide", () => mutate((cb) => { const x = cb.combatants.find((y) => y.id === c.id); x.hidden = !x.hidden; }), "btn secondary tiny"),
          btn("✕", async () => { if (await confirmDialog(`Remove ${c.name}?`, { ok: "Remove", danger: true })) mutate((cb) => withStableTurn(cb, () => { cb.combatants = cb.combatants.filter((y) => y.id !== c.id); })); }, "btn secondary tiny dnd-icon-btn", { "aria-label": `Remove ${c.name}` }),
        ].filter(Boolean)),
      ]),
      hpBar(c.hp, c.maxHp, c.tempHp),
      hpControls,
      conditionRow(c),
      c.legendary ? el("div", { class: "dnd-row tight dnd-small" }, ["Legendary actions used", pips(c.legendary.max, c.legendary.used, (used) => mutate((cb) => { cb.combatants.find((y) => y.id === c.id).legendary.used = used; }), { label: "Legendary action" })]) : null,
      c.kind === "pc" && c.hp === 0 ? deathSaveRow(c) : null,
      el("details", { class: "dnd-fold" }, [el("summary", {}, "Notes & details"),
        textInput(c.notes || "", (v) => { mutateCombat((cb) => { cb.combatants.find((y) => y.id === c.id).notes = v; }); }, { multiline: true, rows: 2, placeholder: "Notes only you can see" }),
        el("div", { class: "dnd-grid-2" }, [
          field("Max HP", numInput(c.maxHp, (v) => mutate((cb) => { const x = cb.combatants.find((y) => y.id === c.id); x.maxHp = Math.max(1, v || 1); x.hp = Math.min(x.hp, x.maxHp); }), { min: 1 })),
          field("AC", numInput(c.ac, (v) => mutate((cb) => { cb.combatants.find((y) => y.id === c.id).ac = v ?? 10; }), { min: 0 })),
        ]),
        field("Concentrating on", textInput(c.concentration || "", (v) => { mutateCombat((cb) => { cb.combatants.find((y) => y.id === c.id).concentration = v; }); dirty(); }, { placeholder: "spell name" })),
        c.resistances?.length || c.immunities?.length || c.vulnerabilities?.length ? el("div", { class: "dnd-small dnd-muted" }, [
          c.resistances.length ? `Resists: ${c.resistances.join(", ")}. ` : "", c.immunities.length ? `Immune: ${c.immunities.join(", ")}. ` : "", c.vulnerabilities.length ? `Vulnerable: ${c.vulnerabilities.join(", ")}.` : "",
        ].join("")) : null,
      ].filter(Boolean)),
      stat,
    ].filter(Boolean));
    void index;
  }

  function hpPanel(c) {
    const amt = numInput(null, () => {}, { min: 0, cls: "dnd-amount", ariaLabel: `Amount for ${c.name}` });
    const type = selectEl([["", "type…"], ...["Acid", "Bludgeoning", "Cold", "Fire", "Force", "Lightning", "Necrotic", "Piercing", "Poison", "Psychic", "Radiant", "Slashing", "Thunder"].map((t) => [t, t])], "", () => {}, { cls: "dnd-dmgtype" });
    const apply = (kind, crit = false) => {
      const n = Number(amt.value);
      if (!n || n < 0) { toast("Enter an amount.", "bad"); return; }
      mutate((cb) => {
        const x = cb.combatants.find((y) => y.id === c.id);
        if (kind === "dmg") {
          const r = damageCombatant(x, n, { type: type.value, crit });
          note(cb, `${x.name} takes ${r.dealt}${type.value ? ` ${type.value.toLowerCase()}` : ""} damage${r.note ? ` (${r.note})` : ""}${r.down ? (x.kind === "pc" ? " and falls unconscious" : " and is defeated") : ""}.`);
          if (r.dealt && x.concentration) toast(`${x.name} must make a Constitution save, DC ${concentrationDc(r.dealt)}, to keep ${x.concentration}.`, "");
        } else if (kind === "heal") {
          const g = healCombatant(x, n); note(cb, `${x.name} regains ${g} HP.`);
        } else if (kind === "temp") {
          x.tempHp = Math.max(x.tempHp || 0, n); note(cb, `${x.name} gains ${n} temporary HP.`);
        }
        sendToPlayer(x, "hp");
      });
    };
    return el("div", { class: "dnd-row tight" }, [
      amt, type,
      btn("Damage", () => apply("dmg"), "btn small"), btn("Crit", () => apply("dmg", true), "btn secondary tiny", { title: "Critical hit — counts double on a downed player's death saves" }),
      btn("Heal", () => apply("heal"), "btn secondary small"), btn("+Temp", () => apply("temp"), "btn secondary tiny"),
    ]);
  }

  function conditionRow(c) {
    const on = new Set(c.conditions || []);
    const bar = el("div", { class: "dnd-row tight" }, c.conditions.map((x) => {
      const b = el("button", { type: "button", class: "dnd-chip bad dnd-pickable", title: "Click to remove" }, `${x} ✕`);
      b.addEventListener("click", () => { mutate((cb) => { const y = cb.combatants.find((z) => z.id === c.id); y.conditions = y.conditions.filter((q) => q !== x); sendToPlayer(y, "status", `-${x}`); }); });
      return b;
    }));
    const add = selectEl([["", "+ condition"], ...CONDITION_NAMES_2014.filter((n) => !on.has(n)).map((n) => [n, n])], "", (v) => {
      if (!v) return;
      mutate((cb) => { const y = cb.combatants.find((z) => z.id === c.id); if (!y.conditions.includes(v)) y.conditions.push(v); sendToPlayer(y, "status", `+${v}`); note(cb, `${y.name} is ${v.toLowerCase()}.`); });
    }, { cls: "dnd-cond-select" });
    bar.append(add);
    return bar;
  }

  function deathSaveRow(c) {
    return el("div", { class: "dnd-row tight dnd-small" }, [
      "Death saves",
      el("span", {}, ["Successes ", savePips(c.deathSaves.s, "s", (v) => mutate((cb) => { cb.combatants.find((y) => y.id === c.id).deathSaves.s = v; }))]),
      el("span", {}, ["Failures ", savePips(c.deathSaves.f, "f", (v) => mutate((cb) => { cb.combatants.find((y) => y.id === c.id).deathSaves.f = v; }))]),
    ]);
  }

  function redraw() {
    const combat = getCombat();
    drawToolbar();
    const order = orderedCombatants(combat);
    const cur = currentCombatant(combat);
    list.replaceChildren(...(order.length ? order.map((c, i) => row(c, i, cur?.id, combat.started)) : [el("div", { class: "card" }, el("p", { class: "view-sub" }, "The tracker is empty. Use “Add combatants”, or send monsters here from the Bestiary and Encounter Builder."))]));
    logHost.replaceChildren(combat.log.length ? section("Combat log", el("div", { class: "dnd-stack dnd-small" }, combat.log.slice(0, 20).map((l) => el("div", {}, [el("span", { class: "dnd-muted dnd-tiny" }, `${new Date(l.t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}  `), l.text])))) : el("span"));
  }

  panel.append(toolbar, addHost, list, logHost);
  redraw();
  void getDmToken; void modal; void getBattleLog;
}
