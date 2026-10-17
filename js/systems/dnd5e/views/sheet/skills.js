// Sheet > Abilities & Skills: ability scores, saving throws, skills, passive scores,
// proficiencies and languages.

import { el, btn, chip, section, numInput, promptDialog } from "../../ui.js";
import { d20Test, modeFromEvent } from "../../rolls.js";
import { ABILITIES, SKILLS, ABILITY_NAME } from "../../engine/rules.js";

const signed = (n) => (n >= 0 ? `+${n}` : `−${Math.abs(n)}`);

export function renderSkillsTab(panel, S) {
  const { char, d } = S;
  const who = char.name || "Character";

  // ---- ability scores
  const cards = ABILITIES.map((a) => {
    const s = d.scores[a.key];
    const mod = el("button", { type: "button", class: "dnd-ability-mod", title: `Roll a ${a.name} check (Shift = advantage, Ctrl = disadvantage)` }, signed(s.mod));
    mod.addEventListener("click", (e) => d20Test({ label: `${who}: ${a.name} check`, mod: s.mod, who, mode: modeFromEvent(e) }));
    const base = numInput(s.base, (v) => { char.abilities[a.key] = v || 10; S.commit(); }, { min: 1, max: 30, ariaLabel: `${a.name} base score` });
    const bonusBits = char.bonuses.filter((b) => b.ab === a.key).map((b) => `${b.src} ${signed(b.n)}`);
    if (char.setScores?.[a.key] && char.setScores[a.key] > s.base + s.bonus) bonusBits.push(`set to ${char.setScores[a.key]}`);
    return el("div", { class: "dnd-ability-card" }, [
      el("div", { class: "dnd-ability-name" }, a.name),
      mod,
      el("div", { class: "dnd-ability-score" }, [el("span", { class: "dnd-muted dnd-tiny" }, "Score"), el("strong", {}, String(s.score))]),
      el("div", { class: "dnd-ability-base" }, [el("span", { class: "dnd-tiny dnd-muted" }, "Base"), base]),
      bonusBits.length ? el("div", { class: "dnd-tiny dnd-muted" }, bonusBits.join(", ")) : null,
    ].filter(Boolean));
  });
  panel.append(section("Ability scores", el("div", { class: "dnd-ability-grid" }, cards)));

  const cols = el("div", { class: "dnd-sheet-cols" });
  const left = el("div", { class: "dnd-stack" }), right = el("div", { class: "dnd-stack" });
  cols.append(left, right);
  panel.append(cols);

  // ---- saves
  const saves = ABILITIES.map((a) => {
    const sv = d.saves[a.key];
    const dot = el("button", { type: "button", class: `dnd-dot${sv.proficient ? " on" : ""}`, title: "Toggle proficiency", "aria-pressed": String(sv.proficient), "aria-label": `${a.name} saving throw proficiency` });
    dot.addEventListener("click", () => {
      const set = new Set(char.saveProfs);
      if (set.has(a.key)) set.delete(a.key); else set.add(a.key);
      char.saveProfs = [...set];
      S.commit();
    });
    const roll = el("button", { type: "button", class: "dnd-roll-row" }, [el("span", { class: "dnd-grow" }, `${a.name}`), el("strong", { class: "dnd-mono" }, signed(sv.mod))]);
    roll.addEventListener("click", (e) => d20Test({ label: `${who}: ${a.name} save`, mod: sv.mod, who, kind: "save", mode: modeFromEvent(e) }));
    return el("div", { class: "dnd-skill-row" }, [dot, roll, sv.aura ? el("span", { class: "dnd-tiny dnd-muted" }, "aura") : null].filter(Boolean));
  });
  left.append(section("Saving throws", saves));

  // ---- passives
  left.append(section("Passive scores", el("div", { class: "dnd-stat-row" }, [
    ["Perception", d.passive.perception], ["Investigation", d.passive.investigation], ["Insight", d.passive.insight],
  ].map(([l, v]) => el("div", { class: "dnd-bigstat" }, [el("div", { class: "v" }, String(v)), el("div", { class: "l" }, l)])))));

  // ---- proficiencies & languages
  left.append(profCard(S));

  // ---- skills
  const rows = SKILLS.map((sk) => {
    const s = d.skills[sk.name];
    const level = s.level;
    const dot = el("button", { type: "button", class: `dnd-dot${level >= 1 ? " on" : ""}${level === 2 ? " expert" : ""}`, title: level === 0 ? "Not proficient" : level === 1 ? "Proficient" : "Expertise", "aria-label": `${sk.name} proficiency: ${level === 0 ? "none" : level === 1 ? "proficient" : "expertise"}` });
    dot.addEventListener("click", () => {
      const next = (level + 1) % 3;
      if (next === 0) delete char.skills[sk.name]; else char.skills[sk.name] = next;
      S.commit();
    });
    const roll = el("button", { type: "button", class: "dnd-roll-row" }, [
      el("span", { class: "dnd-grow" }, [sk.name, " ", el("span", { class: "dnd-tiny dnd-muted" }, `(${sk.ability})`), s.note ? el("span", { class: "dnd-tiny dnd-muted" }, ` · ${s.note}`) : null, s.reliable ? el("span", { class: "dnd-tiny dnd-good" }, " · min 10") : null].filter(Boolean)),
      el("strong", { class: "dnd-mono" }, signed(s.mod)),
    ]);
    roll.addEventListener("click", (e) => d20Test({ label: `${who}: ${sk.name}`, mod: s.mod, who, reliable10: s.reliable, mode: modeFromEvent(e) }));
    return el("div", { class: "dnd-skill-row" }, [dot, roll]);
  });
  right.append(section("Skills", [...rows, el("p", { class: "dnd-small dnd-muted", style: "margin-top:8px" }, "Click the dot to cycle none → proficient → expertise. Click the row to roll.")]));
  void ABILITY_NAME;
}

function listEditor(title, key, S) {
  const { char, d } = S;
  const fixed = new Set(d.lists[key]);
  const custom = char.proficiencies[key] || [];
  const chips = [...d.lists[key].map((x) => chip(x)), ].filter(Boolean);
  const wrap = el("div", { class: "dnd-prof-block" }, [el("strong", {}, title)]);
  const row = el("div", { class: "dnd-chip-row", style: "margin:4px 0 6px" }, chips.length ? chips : [el("span", { class: "dnd-muted dnd-small" }, "None")]);
  wrap.append(row);
  void fixed; void custom;
  wrap.append(btn(`+ Add ${title.toLowerCase().replace(/s$/, "")}`, async () => {
    const v = await promptDialog(`Add ${title.toLowerCase()}`, "Name", "");
    if (!v?.trim()) return;
    char.proficiencies[key] = [...(char.proficiencies[key] || []), v.trim()];
    S.commit();
  }, "btn secondary tiny"));
  if ((char.proficiencies[key] || []).length) {
    wrap.append(btn("Clear added", () => { char.proficiencies[key] = []; S.commit(); }, "btn secondary tiny"));
  }
  return wrap;
}

function profCard(S) {
  return section("Proficiencies & languages", [
    listEditor("Armor", "armor", S), listEditor("Weapons", "weapons", S), listEditor("Tools", "tools", S), listEditor("Languages", "languages", S),
  ]);
}
