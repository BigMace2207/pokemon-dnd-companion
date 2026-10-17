// The character builder: a guided, rules-aware wizard (race -> class -> background ->
// abilities -> spells -> equipment -> review) that produces a ready-to-play sheet.
// Everything is editable on the sheet afterwards; the wizard only saves typing.

import { el, field, btn, chip, selectEl, numInput, textInput, checkbox, toast, asyncView, section } from "../ui.js";
import { loadCtx, loadSet } from "../data.js";
import { renderDesc } from "../../../markdown.js";
import { pickMany, pickOne } from "../components/choiceUi.js";
import { spellPicker } from "../components/spellPicker.js";
import {
  newDraft, buildCharacter, draftProblems, pointBuyValid, standardArrayFor, CLASS_PRIORITY,
  rollAbilityScores, raceBonuses, backgroundBonuses,
} from "../engine/builder.js";
import { derive, classLabel } from "../engine/character.js";
import {
  ABILITIES, ABILITY_KEYS, ALIGNMENTS, SKILLS, STANDARD_ARRAY, POINT_BUY_COST, POINT_BUY_BUDGET, SUBCLASS_LEVEL, STARTING_GOLD,
} from "../engine/rules.js";
import { slug } from "../engine/dataIndex.js";
import { getSettings, setSettings, saveCharacter, createCharacter } from "../store.js";
import { rollDie } from "../engine/dice.js";
import { hpBar } from "../components/hpBar.js";

const STEPS = [
  ["basics", "Basics"], ["race", "Race"], ["class", "Class"], ["background", "Background"],
  ["abilities", "Abilities"], ["spells", "Spells"], ["equipment", "Equipment"], ["review", "Review"],
];

const signed = (n) => (n >= 0 ? `+${n}` : `−${Math.abs(n)}`);

export function renderBuilder(container, { onDone, onCancel } = {}) {
  container.replaceChildren(el("p", { class: "view-sub" }, "Loading the rules…"));
  const edition0 = getSettings().edition || "2014";
  let draft = newDraft(edition0);
  let step = 0;
  let ctx = null, categories = null, spellList = null, languages = [];

  const root = el("div", { class: "dnd-builder" });
  const stepBar = el("div", { class: "dnd-stepbar", role: "list" });
  const body = el("div", { class: "dnd-builder-body" });
  const summary = el("div", { class: "dnd-builder-summary" });
  const nav = el("div", { class: "dnd-row between dnd-builder-nav" });

  async function loadEdition(ed) {
    ctx = await loadCtx(ed, ["spells"]);
    categories = await loadSet(ed, "categories");
    spellList = (await loadSet(ed, "spells")).list;
    const ref = await loadSet(ed, "reference");
    languages = (ref.languages || []).map((l) => l.name);
  }

  // ------------------------------------------------------------ helpers
  const cls = () => ctx.classes.get(draft.classId);
  const race = () => ctx.races.get(draft.raceId);
  const bg = () => ctx.backgrounds.get(draft.backgroundId);
  const startLv = () => Math.max(1, Math.min(20, Number(draft.startLevel) || 1));
  const lvInfo = () => cls()?.levels.find((l) => l.level === startLv());

  function spellCounts() {
    const c = cls();
    const sc = lvInfo()?.sc;
    if (!c?.spellcasting || !sc) return null;
    const known = ["bard", "ranger", "sorcerer", "warlock"].includes(c.id) && draft.edition === "2014";
    const slots = sc.slots || [];
    let maxLevel = 0;
    slots.forEach((n, i) => { if (n > 0) maxLevel = i + 1; });
    return {
      cantrips: sc.cantrips || 0,
      known: known ? (sc.known || 0) : 0,
      book: c.id === "wizard" ? 6 + 2 * (startLv() - 1) : 0,
      prepared: sc.prepared != null ? sc.prepared : null,
      maxLevel: Math.max(1, maxLevel),
      kind: known ? "known" : c.id === "wizard" ? "book" : "prepared",
    };
  }
  const hasSpellStep = () => !!spellCounts();

  function stepsList() { return STEPS.filter(([id]) => id !== "spells" || (ctx && hasSpellStep())); }

  function preview() {
    try {
      const c = buildCharacter(draft, ctx);
      const d = derive(c, ctx);
      return { c, d };
    } catch { return null; }
  }

  function renderSummary() {
    const p = preview();
    const rows = [];
    rows.push(el("h4", {}, draft.name || "Your character"));
    rows.push(el("div", { class: "dnd-muted dnd-small" }, [race()?.name, draft.subraceId && race()?.subraces.find((s) => s.id === draft.subraceId)?.name, cls() ? `${cls().name} ${startLv()}` : null].filter(Boolean).join(" · ") || "Choose a race and class…"));
    if (p && cls()) {
      const { d } = p;
      rows.push(el("div", { class: "dnd-mini-stats" }, [
        mini("HP", d.hpMax), mini("AC", d.ac.value), mini("Speed", d.speed), mini("Prof.", signed(d.pb)),
        d.casting[0] ? mini("Spell DC", d.casting[0].dc) : null,
      ].filter(Boolean)));
      rows.push(el("div", { class: "dnd-mini-abilities" }, ABILITY_KEYS.map((k) => el("div", { class: "dnd-mini-ab" }, [el("b", {}, k), el("span", {}, String(d.scores[k].score)), el("em", {}, signed(d.scores[k].mod))]))));
      const skills = Object.entries(p.c.skills).filter(([, v]) => v).map(([k]) => k);
      if (skills.length) rows.push(el("div", { class: "dnd-chip-row", style: "margin-top:8px" }, skills.map((s) => chip(s))));
    }
    summary.replaceChildren(el("div", { class: "card" }, rows));
  }
  const mini = (l, v) => el("div", { class: "dnd-mini-stat" }, [el("span", { class: "v" }, String(v)), el("span", { class: "l" }, l)]);

  function drawStepBar() {
    const list = stepsList();
    stepBar.replaceChildren(...list.map(([id, label], i) => {
      const active = id === list[step]?.[0];
      const b = el("button", { type: "button", class: `pill-btn${active ? " active" : ""}`, role: "listitem", "aria-current": active ? "step" : null }, `${i + 1}. ${label}`);
      b.addEventListener("click", () => go(i));
      return b;
    }));
  }

  function go(i) {
    const list = stepsList();
    step = Math.max(0, Math.min(list.length - 1, i));
    draw();
    root.scrollIntoView({ block: "start" });
  }

  function drawNav() {
    const list = stepsList();
    const last = step >= list.length - 1;
    nav.replaceChildren(
      btn("Cancel", () => onCancel?.(), "btn secondary"),
      el("div", { class: "dnd-row" }, [
        step > 0 ? btn("← Back", () => go(step - 1), "btn secondary") : null,
        last ? null : btn("Next →", () => go(step + 1), "btn"),
      ].filter(Boolean)),
    );
  }

  function draw() {
    drawStepBar();
    const id = stepsList()[step][0];
    body.replaceChildren();
    ({ basics: stepBasics, race: stepRace, class: stepClass, background: stepBackground, abilities: stepAbilities, spells: stepSpells, equipment: stepEquipment, review: stepReview })[id]();
    renderSummary();
    drawNav();
  }

  // ------------------------------------------------------------ 1 basics
  function stepBasics() {
    const name = textInput(draft.name, (v) => { draft.name = v; renderSummary(); }, { placeholder: "Character name", ariaLabel: "Character name" });
    const player = textInput(draft.player, (v) => { draft.player = v; }, { placeholder: "Your name (optional)" });
    const ed = selectEl([["2014", "2014 rules (SRD 5.1) — the classic 5th edition"], ["2024", "2024 rules (SRD 5.2) — the revised rules"]], draft.edition, async (v) => {
      if (v === draft.edition) return;
      setSettings({ edition: v });
      const keep = { name: draft.name, player: draft.player };
      draft = Object.assign(newDraft(v), keep);
      await loadEdition(v);
      draw();
      toast(`Switched to the ${v} rules — race, class and background choices were reset.`);
    });
    const align = selectEl([["", "— Unaligned / decide later —"], ...ALIGNMENTS.map((a) => [a, a])], draft.alignment, (v) => { draft.alignment = v; });
    const lvl = numInput(draft.startLevel, (v) => { draft.startLevel = Math.max(1, Math.min(20, v || 1)); lvl.value = draft.startLevel; renderSummary(); }, { min: 1, max: 20 });
    body.append(section("Who are you?", [
      el("div", { class: "dnd-grid-2" }, [field("Name", name), field("Player", player)]),
      el("div", { class: "dnd-grid-2" }, [field("Rules edition", ed), field("Alignment", align)]),
      field("Starting level", lvl),
      el("p", { class: "view-sub dnd-small" }, "Most campaigns start at level 1. Choose a higher level to jump in mid-campaign — hit points use the average for each level, and any feat or ability score improvements you've earned can be applied from the sheet."),
    ]));
  }

  // ------------------------------------------------------------ 2 race
  function stepRace() {
    const list = ctx.raw.races.list;
    const kind = draft.edition === "2024" ? "species" : "race";
    const options = list.map((r) => ({ value: r.id, label: r.name, sub: raceSub(r) }));
    const picker = pickOne(options, draft.raceId, (v) => {
      draft.raceId = v; draft.subraceId = ""; draft.raceAbilityPicks = []; draft.raceLanguagePicks = []; draft.raceSkillPicks = []; draft.raceToolPick = ""; draft.raceSpellPick = ""; draft.raceTraitPicks = {};
      detail(); renderSummary();
    });
    const detailBox = el("div");
    body.append(el("div", { class: "dnd-split-even" }, [section(draft.edition === "2024" ? "Choose a species" : "Choose a race", picker), detailBox]));

    function raceSub(r) {
      const bonus = r.abilityBonuses.map((b) => `${b.ability} ${signed(b.bonus)}`).join(", ");
      return `${r.size || ""}${r.speed ? ` · ${r.speed} ft.` : ""}${bonus ? ` · ${bonus}` : ""}`;
    }
    function detail() {
      const r = race();
      if (!r) { detailBox.replaceChildren(section("", el("p", { class: "view-sub" }, `Pick a ${kind} to see its traits.`))); return; }
      const parts = [el("h3", { class: "dnd-detail-title" }, r.name)];
      if (r.sizeDesc) parts.push(el("p", { class: "dnd-small dnd-muted" }, r.sizeDesc));
      parts.push(el("div", { class: "dnd-chip-row" }, [chip(`Speed ${r.speed} ft.`), chip(r.size || ""), ...r.abilityBonuses.map((b) => chip(`${b.ability} ${signed(b.bonus)}`, "gold"))]));
      // subrace
      if (r.subraces.length) {
        parts.push(el("h4", {}, draft.edition === "2024" ? "Lineage / ancestry" : "Subrace"));
        parts.push(pickOne(r.subraces.map((s) => ({ value: s.id, label: s.name, sub: s.abilityBonuses.map((b) => `${b.ability} ${signed(b.bonus)}`).join(", ") })), draft.subraceId, (v) => { draft.subraceId = v; detail(); renderSummary(); }));
        const s = r.subraces.find((x) => x.id === draft.subraceId);
        if (s?.desc) parts.push(el("p", { class: "dnd-small" }, s.desc));
        for (const t of s?.traits || []) parts.push(traitBlock(t));
      }
      // ability choices (half-elf)
      if (r.abilityChoices) {
        parts.push(el("h4", {}, `Choose ${r.abilityChoices.choose} ability scores (+1 each)`));
        parts.push(pickMany(r.abilityChoices.from.map((f) => ({ value: f.ability, label: f.ability })), r.abilityChoices.choose, draft.raceAbilityPicks, (v) => { draft.raceAbilityPicks = v; renderSummary(); }));
      }
      if (r.languageChoices) {
        parts.push(el("h4", {}, `Choose ${r.languageChoices.choose} extra language${r.languageChoices.choose > 1 ? "s" : ""}`));
        const names = r.languageChoices.from.map((x) => (typeof x === "string" ? x : x.name));
        parts.push(pickMany(names, r.languageChoices.choose, draft.raceLanguagePicks, (v) => { draft.raceLanguagePicks = v; }));
      }
      for (const t of r.traits) {
        parts.push(traitBlock(t));
        if (t.name === "Skill Versatility") {
          parts.push(pickMany(SKILLS.map((s) => s.name), 2, draft.raceSkillPicks, (v) => { draft.raceSkillPicks = v; renderSummary(); }));
        }
        if (t.name === "Tool Proficiency" && r.id === "dwarf") {
          parts.push(field("Choose a tool", selectEl([["", "— choose —"], ...["Smith's Tools", "Brewer's Supplies", "Mason's Tools"].map((x) => [x, x])], draft.raceToolPick, (v) => { draft.raceToolPick = v; })));
        }
        if (t.options?.length && t.name === "Draconic Ancestry") {
          parts.push(field("Dragon ancestry", selectEl([["", "— choose —"], ...t.options.map((o) => [o, o])], draft.raceTraitPicks[t.name] || "", (v) => { draft.raceTraitPicks[t.name] = v; })));
        }
      }
      for (const t of [...r.traits, ...(r.subraces.find((x) => x.id === draft.subraceId)?.traits || [])]) {
        if (t.spellOptions) parts.push(field(`${t.name}: choose a cantrip`, selectEl([["", "— choose —"], ...t.spellOptions.from.map((n) => [slug(n), n])], draft.raceSpellPick, (v) => { draft.raceSpellPick = v; })));
      }
      detailBox.replaceChildren(el("div", { class: "card" }, parts));
    }
    detail();
  }

  const traitBlock = (t) => el("div", { class: "dnd-trait" }, [el("strong", {}, t.name), renderDesc(t.desc)]);

  // ------------------------------------------------------------ 3 class
  function stepClass() {
    const list = ctx.raw.classes.list;
    const picker = pickOne(list.map((c) => ({ value: c.id, label: c.name, sub: `d${c.hitDie} · saves ${c.saves.join(", ")}${c.spellcasting ? " · spellcaster" : ""}` })), draft.classId, (v) => {
      draft.classId = v; draft.classSkills = []; draft.subclassId = ""; draft.equipChoice = {}; draft.equipPick = {}; draft.cantrips = []; draft.spellsKnown = []; draft.spellbook = []; draft.prepared = [];
      draft.scores = draft.method === "standard" ? standardArrayFor(CLASS_PRIORITY[v]) : draft.scores;
      detail(); renderSummary();
    });
    const detailBox = el("div");
    body.append(el("div", { class: "dnd-split-even" }, [section("Choose a class", picker), detailBox]));
    function detail() {
      const c = cls();
      if (!c) { detailBox.replaceChildren(section("", el("p", { class: "view-sub" }, "Pick a class to see what it offers."))); return; }
      const parts = [el("h3", { class: "dnd-detail-title" }, c.name)];
      parts.push(el("div", { class: "dnd-chip-row" }, [chip(`Hit die d${c.hitDie}`, "gold"), ...(c.primaryAbility ? [chip(`Primary: ${c.primaryAbility}`)] : []), ...c.saves.map((s) => chip(`${s} save`))]));
      parts.push(el("p", { class: "dnd-prop" }, [el("b", {}, "Armor: "), c.armor.join(", ") || "None"]));
      parts.push(el("p", { class: "dnd-prop" }, [el("b", {}, "Weapons: "), c.weapons.join(", ") || "None"]));
      if (c.tools.length) parts.push(el("p", { class: "dnd-prop" }, [el("b", {}, "Tools: "), c.tools.join(", ")]));
      if (c.skills) {
        const taken = new Set(bgSkills());
        parts.push(el("h4", {}, `Choose ${c.skills.choose} skills`));
        parts.push(pickMany(c.skills.from, c.skills.choose, draft.classSkills, (v) => { draft.classSkills = v; renderSummary(); }, { disabled: [...taken] }));
        if (taken.size) parts.push(el("p", { class: "dnd-small dnd-muted" }, `${[...taken].join(" and ")} already come from your background.`));
      }
      const subLv = (SUBCLASS_LEVEL[draft.edition] || {})[c.id] || 99;
      if (startLv() >= subLv && c.subclasses.length) {
        parts.push(el("h4", {}, draft.edition === "2024" ? "Subclass" : "Subclass (chosen at level " + subLv + ")"));
        parts.push(pickOne(c.subclasses.map((s) => ({ value: s.id, label: s.name, sub: s.flavor || "" })), draft.subclassId, (v) => { draft.subclassId = v; detail(); }));
        const s = c.subclasses.find((x) => x.id === draft.subclassId);
        if (s) parts.push(renderDesc(s.desc.slice(0, 2)));
      } else if (c.subclasses.length) parts.push(el("p", { class: "dnd-small dnd-muted" }, `You choose a subclass at level ${subLv}.`));
      parts.push(el("h4", {}, "Level 1 features"));
      for (const fid of c.levels[0]?.features || []) {
        const f = c.features[fid];
        if (f) parts.push(el("details", { class: "dnd-fold" }, [el("summary", {}, f.name), renderDesc(f.desc)]));
      }
      detailBox.replaceChildren(el("div", { class: "card" }, parts));
    }
    detail();
  }
  function bgSkills() {
    const b = bg();
    if (b) return b.skills || [];
    return draft.bgCustom.skills || [];
  }

  // ------------------------------------------------------------ 4 background
  function stepBackground() {
    const list = ctx.raw.backgrounds.list;
    const opts = [...list.map((b) => ({ value: b.id, label: b.name, sub: [...(b.skills || [])].join(", ") })),
      ...(draft.edition === "2014" ? [{ value: "custom", label: "Custom background", sub: "Make your own: name, two skills, a feature" }] : [])];
    const picker = pickOne(opts, draft.backgroundId || (draft.bgCustom.name ? "custom" : ""), (v) => {
      draft.backgroundId = v === "custom" ? "" : v;
      if (v === "custom") draft.bgCustom = { ...draft.bgCustom, name: draft.bgCustom.name || "My Background" };
      // class skills that duplicate the new background's are dropped
      const taken = new Set(bgSkills());
      const removed = draft.classSkills.filter((s) => taken.has(s));
      if (removed.length) { draft.classSkills = draft.classSkills.filter((s) => !taken.has(s)); toast(`${removed.join(", ")} now come from the background — pick replacement class skills.`); }
      draft.equipChoice = draft.equipChoice; draft.bgEquipChoice = {}; draft.bgEquipPick = {};
      detail(); renderSummary();
    });
    const detailBox = el("div");
    body.append(el("div", { class: "dnd-split-even" }, [section("Choose a background", picker), detailBox]));
    function detail() {
      const b = bg();
      const custom = !b && (draft.bgCustom.name || draft.backgroundId === "");
      if (!b && !(draft.edition === "2014" && !draft.backgroundId && draft.bgCustom.name)) { detailBox.replaceChildren(section("", el("p", { class: "view-sub" }, "Pick a background to see what it grants."))); return; }
      const parts = [];
      if (b) {
        parts.push(el("h3", { class: "dnd-detail-title" }, b.name));
        parts.push(el("div", { class: "dnd-chip-row" }, [...(b.skills || []).map((s) => chip(s, "gold")), ...(b.tools || []).map((s) => chip(s))]));
        if (b.feature?.name) parts.push(el("div", { class: "dnd-trait" }, [el("strong", {}, b.feature.name), renderDesc(b.feature.desc)]));
        if (b.languageChoices) {
          parts.push(el("h4", {}, `Choose ${b.languageChoices} languages`));
          parts.push(pickMany(languages.filter((l) => l !== "Common"), b.languageChoices, draft.bgLanguagePicks, (v) => { draft.bgLanguagePicks = v; }));
        }
        if (draft.edition === "2024") {
          parts.push(el("h4", {}, "Ability score increases"));
          parts.push(el("p", { class: "dnd-small dnd-muted" }, `Your background lets you raise ${b.abilityScores.join(", ")}.`));
          parts.push(field("Method", selectEl([["2/1", "+2 to one and +1 to another"], ["1/1/1", "+1 to all three"]], draft.bgAbility.mode, (v) => { draft.bgAbility.mode = v; detail(); renderSummary(); })));
          if (draft.bgAbility.mode === "2/1") {
            parts.push(el("div", { class: "dnd-grid-2" }, [
              field("+2 to", selectEl([["", "—"], ...b.abilityScores.map((a) => [a, a])], draft.bgAbility.plus2, (v) => { draft.bgAbility.plus2 = v; if (v === draft.bgAbility.plus1) draft.bgAbility.plus1 = ""; detail(); renderSummary(); })),
              field("+1 to", selectEl([["", "—"], ...b.abilityScores.filter((a) => a !== draft.bgAbility.plus2).map((a) => [a, a])], draft.bgAbility.plus1, (v) => { draft.bgAbility.plus1 = v; renderSummary(); })),
            ]));
          }
          if (b.feat) parts.push(el("p", { class: "dnd-prop" }, [el("b", {}, "Origin feat: "), `${b.feat.name}${b.feat.note ? ` (${b.feat.note})` : ""}`]));
        }
        // 2014 personality suggestions
        const sug = [["Personality traits", b.personalityTraits, "traits"], ["Ideals", b.ideals, "ideals"], ["Bonds", b.bonds, "bonds"], ["Flaws", b.flaws, "flaws"]];
        for (const [label, arr, key] of sug) {
          if (!arr?.length) continue;
          parts.push(el("details", { class: "dnd-fold" }, [el("summary", {}, `${label} — suggestions`), ...arr.map((t) => {
            const row = el("button", { type: "button", class: "dnd-suggest" }, t);
            row.addEventListener("click", () => { draft.details[key] = draft.details[key] ? `${draft.details[key]}\n${t}` : t; toast(`Added to ${label.toLowerCase()}.`); });
            return row;
          })]));
        }
      } else {
        parts.push(el("h3", { class: "dnd-detail-title" }, "Custom background"));
        parts.push(field("Name", textInput(draft.bgCustom.name, (v) => { draft.bgCustom.name = v; }, { placeholder: "e.g. Guild Artisan" })));
        parts.push(el("h4", {}, "Two skill proficiencies"));
        parts.push(pickMany(SKILLS.map((s) => s.name), 2, draft.bgCustom.skills, (v) => { draft.bgCustom.skills = v; renderSummary(); }, { disabled: draft.classSkills }));
        parts.push(field("Tool proficiencies / languages (comma separated)", textInput(draft.bgCustom.tools, (v) => { draft.bgCustom.tools = v; }, { placeholder: "Thieves' tools, Elvish" })));
      }
      detailBox.replaceChildren(el("div", { class: "card" }, parts));
    }
    detail();
  }

  // ------------------------------------------------------------ 5 abilities
  function stepAbilities() {
    const methodSel = selectEl([["standard", "Standard array (15, 14, 13, 12, 10, 8)"], ["pointbuy", "Point buy (27 points)"], ["roll", "Roll 4d6, drop the lowest"], ["manual", "Enter manually"]], draft.method, (v) => {
      draft.method = v;
      if (v === "standard") draft.scores = standardArrayFor(CLASS_PRIORITY[draft.classId] || ABILITY_KEYS);
      else if (v === "pointbuy") draft.scores = { STR: 8, DEX: 8, CON: 8, INT: 8, WIS: 8, CHA: 8 };
      else if (v === "roll") { draft.rolled = rollAbilityScores(); draft.scores = autoAssign(draft.rolled.map((r) => r.total)); }
      draw();
    });
    const panel = el("div");
    body.append(section("Ability scores", [field("Method", methodSel), panel,
      el("div", { id: "abilityTable" })]));
    drawMethod();

    function bonusFor(k) {
      const all = [...raceBonuses(draft, ctx), ...backgroundBonuses(draft, ctx)];
      return all.filter((b) => b.ab === k).reduce((s, b) => s + b.n, 0);
    }
    function autoAssign(values) {
      const pri = CLASS_PRIORITY[draft.classId] || ABILITY_KEYS;
      const sorted = [...values].sort((a, b) => b - a);
      const out = {};
      pri.forEach((k, i) => { out[k] = sorted[i]; });
      return out;
    }
    function table() {
      return el("table", { class: "data-table dnd-ability-table" }, [
        el("thead", {}, el("tr", {}, ["Ability", "Base", "Bonus", "Score", "Mod"].map((h) => el("th", {}, h)))),
        el("tbody", {}, ABILITIES.map((a) => {
          const base = draft.scores[a.key];
          const bonus = bonusFor(a.key);
          const score = base + bonus;
          return el("tr", {}, [el("td", {}, `${a.name}`), el("td", {}, controlFor(a.key)), el("td", {}, bonus ? signed(bonus) : "—"), el("td", { class: "dnd-strong" }, String(score)), el("td", {}, signed(Math.floor((score - 10) / 2)))]);
        })),
      ]);
    }
    function controlFor(k) {
      if (draft.method === "pointbuy") {
        const dec = btn("−", () => { if (draft.scores[k] > 8) { draft.scores[k]--; drawMethod(); renderSummary(); } }, "btn secondary tiny dnd-icon-btn");
        const inc = btn("+", () => { if (draft.scores[k] < 15) { draft.scores[k]++; drawMethod(); renderSummary(); } }, "btn secondary tiny dnd-icon-btn");
        return el("div", { class: "dnd-row tight" }, [dec, el("span", { class: "dnd-strong dnd-mono", style: "min-width:26px;text-align:center" }, String(draft.scores[k])), inc]);
      }
      if (draft.method === "manual") return numInput(draft.scores[k], (v) => { draft.scores[k] = Math.max(1, Math.min(20, v || 10)); drawMethod(); renderSummary(); }, { min: 1, max: 20 });
      // standard & roll: pick from the pool, swapping with whoever has it
      const pool = draft.method === "standard" ? STANDARD_ARRAY : draft.rolled.map((r) => r.total);
      const sel = selectEl([...new Set(pool)].sort((a, b) => b - a).map((v) => [v, v]), String(draft.scores[k]), (v) => {
        const val = Number(v);
        const other = ABILITY_KEYS.find((o) => o !== k && draft.scores[o] === val);
        if (other) draft.scores[other] = draft.scores[k];
        draft.scores[k] = val;
        drawMethod(); renderSummary();
      });
      return sel;
    }
    function drawMethod() {
      const parts = [];
      if (draft.method === "pointbuy") {
        const pb = pointBuyValid(draft.scores);
        parts.push(el("p", { class: `dnd-strong ${pb.ok ? "" : "dnd-bad"}` }, `${pb.left} of ${POINT_BUY_BUDGET} points left`));
        parts.push(el("p", { class: "dnd-small dnd-muted" }, `Scores run from 8 to 15 before bonuses. Costs: ${Object.entries(POINT_BUY_COST).map(([s, c]) => `${s}=${c}`).join(", ")}.`));
      } else if (draft.method === "roll") {
        draft.rolled ||= rollAbilityScores();
        parts.push(el("div", { class: "dnd-chip-row" }, draft.rolled.map((r) => chip(`${r.total}  (${r.dice.slice(1).join("+")} — dropped ${r.dice[0]})`))));
        parts.push(btn("Re-roll all six", () => { draft.rolled = rollAbilityScores(); draft.scores = autoAssign(draft.rolled.map((r) => r.total)); drawMethod(); renderSummary(); }, "btn secondary small"));
      } else if (draft.method === "standard") {
        parts.push(btn("Suggest the best fit for my class", () => { draft.scores = standardArrayFor(CLASS_PRIORITY[draft.classId] || ABILITY_KEYS); drawMethod(); renderSummary(); }, "btn secondary small"));
      }
      parts.push(table());
      panel.replaceChildren(...parts);
      void rollDie;
    }
  }

  // ------------------------------------------------------------ 6 spells
  function stepSpells() {
    const c = cls();
    const counts = spellCounts();
    const classSpells = spellList.filter((s) => (s.classes || []).includes(c.name));
    const parts = [];
    parts.push(el("p", { class: "view-sub" }, `${c.name} spellcasting uses ${c.spellcasting.ability}. You can change your spells any time from the sheet.`));
    if (counts.cantrips) {
      parts.push(el("h4", {}, `Cantrips (choose ${counts.cantrips})`));
      parts.push(spellPicker({ spells: classSpells.filter((s) => s.level === 0), max: counts.cantrips, selected: draft.cantrips, onChange: (v) => { draft.cantrips = v; } }).root);
    }
    const leveled = classSpells.filter((s) => s.level >= 1 && s.level <= counts.maxLevel);
    if (counts.kind === "known" && counts.known) {
      parts.push(el("h4", {}, `Spells known (choose ${counts.known})`));
      parts.push(spellPicker({ spells: leveled, max: counts.known, selected: draft.spellsKnown, onChange: (v) => { draft.spellsKnown = v; } }).root);
    } else if (counts.kind === "book") {
      parts.push(el("h4", {}, `Spellbook (choose ${counts.book})`));
      parts.push(spellPicker({ spells: leveled, max: counts.book, selected: draft.spellbook, onChange: (v) => { draft.spellbook = v; if (draft.prepared.some((id) => !v.includes(id))) draft.prepared = draft.prepared.filter((id) => v.includes(id)); } }).root);
      parts.push(el("p", { class: "dnd-small dnd-muted" }, "Prepare spells from your book on the sheet after each long rest."));
    } else if (counts.kind === "prepared") {
      const mod = Math.floor((ABILITY_KEYS.includes(c.spellcasting.ability) ? ((preview()?.d.scores[c.spellcasting.ability]?.score ?? 10) - 10) / 2 : 0));
      const limit = counts.prepared ?? Math.max(1, mod + (c.id === "paladin" ? Math.floor(startLv() / 2) : startLv()));
      parts.push(el("h4", {}, `Prepared spells (up to ${limit})`));
      parts.push(el("p", { class: "dnd-small dnd-muted" }, `${c.name}s can prepare from the whole class list. Pick your starting set now or later on the sheet.`));
      parts.push(spellPicker({ spells: leveled, max: limit, selected: draft.prepared, onChange: (v) => { draft.prepared = v; } }).root);
    }
    body.append(section("Spells", parts));
  }

  // ------------------------------------------------------------ 7 equipment
  function stepEquipment() {
    const c = cls();
    const parts = [];
    const gold = STARTING_GOLD[draft.classId];
    parts.push(checkbox(`Take starting gold instead of equipment${gold ? ` (${gold[0]}d${gold[1]}${gold[2] > 1 ? ` × ${gold[2]}` : ""} gp)` : ""}`, draft.takeGold, (v) => {
      draft.takeGold = v;
      if (v) { const [n, d, m] = gold || [4, 4, 10]; let t = 0; for (let i = 0; i < n; i++) t += rollDie(d); draft.goldRoll = t * m; } else draft.goldRoll = null;
      draw();
    }));
    if (draft.takeGold) parts.push(el("p", { class: "dnd-strong" }, `You start with ${draft.goldRoll} gp.`));
    else if (c) {
      if (c.equipment.fixed.length) parts.push(el("p", { class: "dnd-small" }, [el("b", {}, "You always start with: "), c.equipment.fixed.map((f) => `${f.qty > 1 ? f.qty + "× " : ""}${f.name}`).join(", ")]));
      c.equipment.options.forEach((opt, oi) => parts.push(optionGroup(opt, oi, draft.equipChoice, draft.equipPick, `c${oi}`)));
    }
    const b = bg();
    if (b?.equipmentOptions?.length) {
      parts.push(el("h4", {}, `${b.name} equipment`));
      b.equipmentOptions.forEach((opt, oi) => parts.push(optionGroup(opt, oi, draft.bgEquipChoice, draft.bgEquipPick, `b${oi}`)));
    }
    if (!c) parts.push(el("p", { class: "view-sub" }, "Choose a class first to see its starting equipment."));
    body.append(section("Starting equipment", parts));
  }
  function optionGroup(opt, oi, choiceMap, pickMap, prefix) {
    const cur = choiceMap[oi] ?? 0;
    const wrap = el("div", { class: "dnd-equip-group" }, [el("strong", {}, opt.desc || `Choice ${oi + 1}`)]);
    opt.alternatives.forEach((alt, ai) => {
      const radio = el("input", { type: "radio", name: `opt-${prefix}`, id: `${prefix}-${ai}` });
      radio.checked = cur === ai;
      radio.addEventListener("change", () => { choiceMap[oi] = ai; draw(); });
      const label = el("label", { for: `${prefix}-${ai}`, class: "dnd-check" }, [radio, el("span", {}, alt.map((s) => (s.money ? `${s.qty} ${s.money}` : `${s.qty > 1 ? s.qty + "× " : ""}${s.name}`)).join(", "))]);
      const row = el("div", {}, [label]);
      if (cur === ai) alt.forEach((spec, si) => {
        if (!spec.pick) return;
        const items = (categories[spec.category]?.items || []).map((id) => ctx.equipment.get(id)).filter(Boolean);
        for (let n = 0; n < (spec.qty || 1); n++) {
          const key = `${prefix}:${ai}:${si}:${n}`;
          const sel = selectEl([["", `— choose ${spec.name} —`], ...items.map((i) => [i.id, i.name])], pickMap[key] || "", (v) => { pickMap[key] = v; renderSummary(); });
          row.append(el("div", { class: "dnd-indent" }, sel));
        }
      });
      wrap.append(row);
    });
    return wrap;
  }

  // ------------------------------------------------------------ 8 review
  function stepReview() {
    const problems = draftProblems(draft, ctx);
    const d = draft.details;
    const fields = [["Personality traits", "traits"], ["Ideals", "ideals"], ["Bonds", "bonds"], ["Flaws", "flaws"], ["Appearance", "appearance"], ["Backstory", "backstory"]];
    const create = btn("Create character", () => {
      const probs = draftProblems(draft, ctx);
      if (probs.length) { toast(probs[0], "bad"); return; }
      const c = buildCharacter(draft, ctx);
      saveCharacter(c);
      toast(`${c.name} is ready — good luck!`, "good");
      onDone?.(c);
    }, "btn");
    if (problems.length) create.setAttribute("disabled", "");
    body.append(
      section("Review", [
        problems.length ? el("div", { class: "dnd-problems" }, [el("strong", {}, "Still to do:"), el("ul", {}, problems.map((p) => el("li", {}, p)))]) : el("p", { class: "dnd-strong dnd-good" }, "Everything's in place."),
        el("div", { class: "dnd-grid-2" }, fields.map(([l, k]) => field(l, textInput(d[k], (v) => { draft.details[k] = v; }, { multiline: true, rows: 3 })))),
        create,
      ]),
    );
    const p = preview();
    if (p) body.append(section("Preview", [el("p", { class: "dnd-muted" }, `${classLabel(p.c, ctx)} · ${p.c.race.name}${p.c.race.subraceName ? ` (${p.c.race.subraceName})` : ""}`), hpBar(p.d.hp.current, p.d.hp.max, 0)]));
  }

  // ------------------------------------------------------------ boot
  root.append(stepBar, el("div", { class: "dnd-builder-grid" }, [body, summary]), nav);
  (async () => {
    try {
      await loadEdition(draft.edition);
      container.replaceChildren(el("h1", { class: "view-title" }, "New Character"), root);
      draw();
    } catch (e) {
      container.replaceChildren(el("div", { class: "card" }, [el("strong", {}, "Couldn't load the rules."), el("p", { class: "view-sub" }, String(e.message))]));
    }
  })();
  void createCharacter; void asyncView;
}
