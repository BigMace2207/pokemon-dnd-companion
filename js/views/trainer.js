import { el, field } from "../components.js";
import { loadSave, writeSave, saveAsNamed, loadNamed, listNamedSaves, deleteNamedSave, exportSaveToFile, importSaveFromFile } from "../storage.js";
import { makeTrainerSpritePicker } from "../trainerSpritePicker.js";

const SKILL_GROUPS = {
  "Strength": ["Acrobatics", "Physicality", "Athletics"],
  "Charisma": ["Deception", "Persuasion", "Intimidation"],
  "Intelligence": ["Perception", "Medicine", "Stealth"],
  "Pokémon": ["Communication", "Training", "Catching"],
};

function abilityMod(score) {
  if (score === null || score === undefined || score === "") return null;
  return Math.floor((score - 10) / 2);
}

function fmtMod(mod) {
  if (mod === null) return "—";
  return mod >= 0 ? `+${mod}` : String(mod);
}

// +2 at 0 badges, then +1 every two badges starting with the first one
// (badge 1 already bumps it, not just badge 2) — so 1-2 badges -> +3,
// 3-4 -> +4, 5-6 -> +5, 7-8 -> +6.
function proficiencyBonusFor(badges) {
  return 2 + Math.ceil((Number(badges) || 0) / 2);
}

// 4d6 drop the lowest; total below 8 is set to 12, per the rulebook.
function rollAbilityScore() {
  const rolls = [1, 2, 3, 4].map(() => 1 + Math.floor(Math.random() * 6));
  rolls.sort((a, b) => a - b);
  const total = rolls[1] + rolls[2] + rolls[3];
  return { rolls, total: total < 8 ? 12 : total };
}

export function renderTrainer(container, state) {
  container.innerHTML = "";
  container.appendChild(el("h1", { class: "view-title" }, "Trainer Sheet"));

  const save = loadSave();
  const t = save.trainer;
  function persist() { writeSave(save); }

  // --- Trainer info ---
  const nameInput = el("input", { type: "text", value: t.name });
  const idInput = el("input", { type: "text", value: t.trainerId });
  const genderInput = el("input", { type: "text", value: t.gender });
  const ageInput = el("input", { type: "text", value: t.age });
  const occupationInput = el("input", { type: "text", value: t.occupation });
  const regionInput = el("input", { type: "text", value: t.originRegion });
  const cashInput = el("input", { type: "number", value: t.cash });
  const badgesInput = el("input", { type: "number", min: "0", max: "8", value: t.badges });
  // Read-only -- derived from Badges (proficiencyBonusFor above), not typed
  // in directly. Kept as an <input> (not a plain span) so it lines up with
  // the other fields in the grid via the shared field()/label.field styles.
  const profBonusInput = el("input", { type: "text", value: fmtMod(proficiencyBonusFor(t.badges)), readonly: "" });
  const backstoryInput = el("textarea", { rows: "4", style: "width:100%;resize:vertical;font:inherit;padding:8px 10px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--text);" }, t.backstory || "");

  [
    [nameInput, "name", (v) => v],
    [idInput, "trainerId", (v) => v],
    [genderInput, "gender", (v) => v],
    [ageInput, "age", (v) => v],
    [occupationInput, "occupation", (v) => v],
    [regionInput, "originRegion", (v) => v],
    [cashInput, "cash", (v) => Number(v) || 0],
    [backstoryInput, "backstory", (v) => v],
  ].forEach(([elm, key, coerce]) => elm.addEventListener("input", () => { t[key] = coerce(elm.value); persist(); }));

  badgesInput.addEventListener("input", () => {
    t.badges = Math.min(8, Math.max(0, Number(badgesInput.value) || 0));
    persist();
    profBonusInput.value = fmtMod(proficiencyBonusFor(t.badges));
    renderSkills();
  });

  const spritePicker = makeTrainerSpritePicker({
    initial: t.sprite,
    onSelect: (file) => { t.sprite = file; persist(); },
  });

  // Save and load live as two icons beside the heading; each opens a small panel under it (sheetTools below)
  const sheetPanel = el("div", { class: "sheet-tools-panel", hidden: "" });
  const SAVE_D = "M5 3h11l3 3v15H5zM8 3v6h8V3M8 21v-7h8v7";
  const LOAD_D = "M12 3v12M7 10l5 5 5-5M4 17v4h16v-4";
  const iconBtn = (label, d) => {
    const b = el("button", { type: "button", class: "sheet-tool", "aria-label": label, title: label, "aria-expanded": "false" });
    b.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
    return b;
  };
  const saveIcon = iconBtn("Save character", SAVE_D);
  const loadIcon = iconBtn("Load character", LOAD_D);
  container.appendChild(el("div", { class: "card" }, [
    el("div", { class: "sheet-head" }, [el("h4", {}, "Trainer Information"), el("div", { class: "sheet-tools" }, [saveIcon, loadIcon])]),
    sheetPanel,
    el("div", { class: "grid-3" }, [field("Name", nameInput), field("Trainer ID", idInput), field("Gender", genderInput)]),
    el("div", { class: "grid-3" }, [field("Age", ageInput), field("Occupation", occupationInput), field("Origin Region", regionInput)]),
    el("div", { class: "grid-3" }, [field("Cash (£)", cashInput), field("Badges (0–8)", badgesInput), field("Proficiency Bonus", profBonusInput)]),
    field("Backstory", backstoryInput),
    field("Portrait", spritePicker),
  ]));

  // --- Named save slots: an extra, opt-in way to keep this character,
  // alongside the normal automatic per-browser save above (that one never
  // needs a name and keeps working regardless). ---
  const saveAsBtn = el("button", { class: "btn secondary" }, "Save As This Name");
  const savedSelect = el("select", {}, [el("option", { value: "" }, "No saved characters yet")]);
  const loadBtn = el("button", { class: "btn secondary" }, "Load");
  const deleteBtn = el("button", { class: "btn secondary" }, "Delete");
  const saveMsg = el("span", { class: "view-sub" }, "");

  function refreshSavedList() {
    const saves = listNamedSaves();
    savedSelect.innerHTML = "";
    if (!saves.length) { savedSelect.appendChild(el("option", { value: "" }, "No saved characters yet")); return; }
    saves.forEach((s) => savedSelect.appendChild(el("option", { value: s.key }, s.name)));
  }
  refreshSavedList();

  saveAsBtn.addEventListener("click", () => {
    if (!t.name.trim()) { saveMsg.textContent = "Set a Name above first."; return; }
    saveAsNamed(t.name);
    saveMsg.textContent = `Saved as "${t.name}".`;
    refreshSavedList();
  });
  loadBtn.addEventListener("click", () => {
    if (!savedSelect.value) return;
    const label = savedSelect.options[savedSelect.selectedIndex].textContent;
    if (!confirm(`Load "${label}"? This replaces your current trainer/team on this device (anything not saved under a name will be lost).`)) return;
    const slug = savedSelect.value.slice("pokemon-dnd-save-name-".length);
    loadNamed(slug);
    renderTrainer(container, state);
  });
  deleteBtn.addEventListener("click", () => {
    if (!savedSelect.value) return;
    deleteNamedSave(savedSelect.value);
    refreshSavedList();
  });

  // --- Export / Import as a file: a backup you control yourself, separate
  // from both this device's storage and the server's copy — put it on a
  // USB stick, email it to yourself, whatever. ---
  const exportBtn = el("button", { class: "btn secondary" }, "Export Save to File");
  const importInput = el("input", { type: "file", accept: "application/json,.json", style: "display:none" });
  const importBtn = el("button", { class: "btn secondary" }, "Import Save from File");
  const exportMsg = el("span", { class: "view-sub" }, "");

  exportBtn.addEventListener("click", () => {
    exportSaveToFile(loadSave());
    exportMsg.textContent = "Downloaded.";
  });
  importBtn.addEventListener("click", () => importInput.click());
  importInput.addEventListener("change", async () => {
    const file = importInput.files[0];
    importInput.value = "";
    if (!file) return;
    if (!confirm("Import this save? This replaces your current trainer/team on this device.")) return;
    try {
      await importSaveFromFile(file);
      renderTrainer(container, state);
    } catch (e) {
      exportMsg.textContent = e.message || "Couldn't read that file.";
    }
  });

  // the two panels: Save (under this name, or to a file) and Load (a saved name, or a file)
  saveAsBtn.textContent = "Save under this name";
  exportBtn.textContent = "Save to a file";
  importBtn.textContent = "Load from a file";
  const panels = {
    save: [el("div", { class: "sheet-tools-row" }, [saveAsBtn, exportBtn]), el("div", { class: "sheet-tools-row" }, [saveMsg, exportMsg])],
    load: [el("div", { class: "sheet-tools-row" }, [savedSelect, loadBtn, deleteBtn]), el("div", { class: "sheet-tools-row" }, [importBtn, importInput])],
  };
  let openPanel = null;
  function showPanel(which) {
    openPanel = openPanel === which ? null : which;
    saveIcon.setAttribute("aria-expanded", String(openPanel === "save"));
    loadIcon.setAttribute("aria-expanded", String(openPanel === "load"));
    saveIcon.classList.toggle("on", openPanel === "save");
    loadIcon.classList.toggle("on", openPanel === "load");
    sheetPanel.toggleAttribute("hidden", !openPanel);
    sheetPanel.replaceChildren(...(openPanel ? panels[openPanel] : []));
  }
  saveIcon.addEventListener("click", () => showPanel("save"));
  loadIcon.addEventListener("click", () => showPanel("load"));

  // --- Ability scores ---
  // Score + bonus-assignment layout modeled on Baldur's Gate 3's character
  // creation screen: roll/type a base score per ability, then optionally
  // assign one +2 and one +1 bonus (to two DIFFERENT abilities, same as
  // the 5e rule this echoes) on top of it. The bonus lives separately in
  // t.abilityBonus rather than being folded into t.abilities so re-rolling
  // or retyping a score never has to "guess" whether a bonus was already
  // baked in.
  if (!t.abilityBonus) t.abilityBonus = { plus2: "", plus1: "" };
  const abilityCard = el("div", { class: "card" }, [
    el("h4", {}, "Abilities"),
  ]);
  const abilityHeader = el("div", { class: "ability-grid ability-grid-header" }, [
    el("span", {}, ""), el("span", {}, "Score"), el("span", { class: "ability-bonus-head" }, "+2"), el("span", { class: "ability-bonus-head" }, "+1"), el("span", {}, "Modifier"),
  ]);
  const abilityRows = el("div");
  abilityCard.appendChild(abilityHeader);
  abilityCard.appendChild(abilityRows);
  container.appendChild(abilityCard);

  function effectiveScore(ability) {
    const base = t.abilities[ability];
    if (base === null || base === undefined) return null;
    let bonus = 0;
    if (t.abilityBonus.plus2 === ability) bonus += 2;
    if (t.abilityBonus.plus1 === ability) bonus += 1;
    return base + bonus;
  }

  function renderAbilities() {
    abilityRows.innerHTML = "";
    Object.keys(SKILL_GROUPS).forEach((ability) => {
      const score = t.abilities[ability];
      const scoreInput = el("input", { type: "number", value: score ?? "" });
      const modOut = el("span", { class: "result-banner neutral ability-mod-badge" }, fmtMod(abilityMod(effectiveScore(ability))));
      scoreInput.addEventListener("input", () => {
        t.abilities[ability] = scoreInput.value === "" ? null : Number(scoreInput.value);
        persist();
        renderSkills();
        modOut.textContent = fmtMod(abilityMod(effectiveScore(ability)));
      });

      const plus2Check = el("input", { type: "checkbox" });
      plus2Check.checked = t.abilityBonus.plus2 === ability;
      const plus1Check = el("input", { type: "checkbox" });
      plus1Check.checked = t.abilityBonus.plus1 === ability;
      plus2Check.addEventListener("change", () => {
        t.abilityBonus.plus2 = plus2Check.checked ? ability : "";
        // A bonus can't stack on one ability -- taking +2 here bumps a
        // +1 already sitting on this same ability off it.
        if (plus2Check.checked && t.abilityBonus.plus1 === ability) t.abilityBonus.plus1 = "";
        persist();
        renderAbilities();
        renderSkills();
      });
      plus1Check.addEventListener("change", () => {
        t.abilityBonus.plus1 = plus1Check.checked ? ability : "";
        if (plus1Check.checked && t.abilityBonus.plus2 === ability) t.abilityBonus.plus2 = "";
        persist();
        renderAbilities();
        renderSkills();
      });

      const rollBtn = el("button", { class: "btn secondary" }, "Roll 4d6");
      rollBtn.addEventListener("click", () => {
        const { rolls, total } = rollAbilityScore();
        t.abilities[ability] = total;
        persist();
        scoreInput.value = total;
        modOut.textContent = fmtMod(abilityMod(effectiveScore(ability)));
        rollNote.textContent = `Rolled: ${rolls.join(", ")} → dropped ${rolls[0]}, kept ${rolls.slice(1).join("+")} = ${rolls[1] + rolls[2] + rolls[3]}${total === 12 && rolls[1] + rolls[2] + rolls[3] < 8 ? " (below 8, set to 12)" : ""}`;
        renderSkills();
      });
      const rollNote = el("span", { class: "view-sub" }, "");

      abilityRows.appendChild(el("div", { class: "ability-row-wrap" }, [
        el("div", { class: "ability-grid" }, [
          el("span", { class: "ability-name" }, ability),
          scoreInput,
          el("label", { class: "ability-bonus-cell" }, [plus2Check]),
          el("label", { class: "ability-bonus-cell" }, [plus1Check]),
          modOut,
        ]),
        el("div", { class: "ability-row-foot" }, [rollBtn, rollNote]),
      ]));
    });
  }

  // --- Skills ---
  const skillCard = el("div", { class: "card" }, [
    el("h4", {}, "Skill Checks"),
  ]);
  const skillRows = el("div");
  skillCard.appendChild(skillRows);
  container.appendChild(skillCard);

  function renderSkills() {
    skillRows.innerHTML = "";
    Object.entries(SKILL_GROUPS).forEach(([ability, skills]) => {
      const mod = abilityMod(effectiveScore(ability));
      skillRows.appendChild(el("div", { class: "moveset-group" }, [el("h4", {}, `${ability} (${fmtMod(mod)})`)]));
      skills.forEach((skill) => {
        const profCheck = el("input", { type: "checkbox" });
        profCheck.checked = !!t.skillProficiencies[skill];
        profCheck.style.width = "auto";
        // Total modifier = ability modifier + proficiency bonus (only if
        // ticked) — proficiency bonus itself comes from badges, see
        // proficiencyBonusFor above. Shown as a standing badge next to the
        // skill (Baldur's Gate 3-style), not just revealed by rolling.
        function totalBonus() { return (mod ?? 0) + (profCheck.checked ? proficiencyBonusFor(t.badges) : 0); }
        const modClass = (n) => (n > 0 ? "good" : n < 0 ? "bad" : "neutral");
        const modBadge = el("span", { class: `result-banner ${modClass(totalBonus())} ability-mod-badge` }, fmtMod(totalBonus()));
        profCheck.addEventListener("input", () => {
          t.skillProficiencies[skill] = profCheck.checked;
          persist();
          modBadge.textContent = fmtMod(totalBonus());
          modBadge.className = `result-banner ${modClass(totalBonus())} ability-mod-badge`;
        });
        const resultOut = el("span", { class: "view-sub" }, "");
        const rollBtn = el("button", { class: "btn secondary" }, `Roll ${skill}`);
        rollBtn.addEventListener("click", () => {
          const d20 = 1 + Math.floor(Math.random() * 20);
          const bonus = totalBonus();
          resultOut.textContent = `d20 (${d20}) ${bonus >= 0 ? "+" : ""}${bonus} = ${d20 + bonus}`;
        });
        skillRows.appendChild(el("div", { class: "card", style: "margin-bottom:8px;display:flex;align-items:center;gap:12px;flex-wrap:wrap" }, [
          el("span", { style: "min-width:130px;font-weight:600" }, skill),
          el("label", { style: "display:flex;align-items:center;gap:5px;font-size:13px;color:var(--text-dim)" }, [profCheck, "Proficient"]),
          modBadge,
          rollBtn,
          resultOut,
        ]));
      });
    });
  }

  renderAbilities();
  renderSkills();
}
