import { el, field } from "../../../components.js";

const ABILITIES = ["Strength", "Dexterity", "Constitution", "Intelligence", "Wisdom", "Charisma"];

export const abilityModifier = (score) => Math.floor((Number(score) - 10) / 2);
export const proficiencyForLevel = (level) => 2 + Math.floor((Math.max(1, Number(level) || 1) - 1) / 4);

// 4d6, drop the lowest die.
function rollScore() {
  const dice = Array.from({ length: 4 }, () => 1 + Math.floor(Math.random() * 6)).sort((a, b) => a - b);
  return dice.slice(1).reduce((a, b) => a + b, 0);
}

export function renderAbilityScores(container) {
  container.innerHTML = "";
  container.appendChild(el("h1", { class: "view-title" }, "Ability Scores"));
  const levelInput = el("input", { type: "number", min: "1", max: "20", value: "1" });
  const profOut = el("p", { class: "view-sub" }, "");
  const inputs = ABILITIES.map(() => el("input", { type: "number", min: "1", max: "30", value: "10" }));
  const mods = ABILITIES.map(() => el("span", { class: "view-sub" }, "+0"));

  function refresh() {
    inputs.forEach((inp, i) => {
      const m = abilityModifier(inp.value);
      mods[i].textContent = (m >= 0 ? "+" : "") + m;
    });
    profOut.textContent = `Proficiency bonus: +${proficiencyForLevel(levelInput.value)}`;
  }
  inputs.forEach((i) => i.addEventListener("input", refresh));
  levelInput.addEventListener("input", refresh);

  const rollBtn = el("button", { class: "btn secondary" }, "Roll all (4d6, drop lowest)");
  rollBtn.addEventListener("click", () => { inputs.forEach((i) => { i.value = String(rollScore()); }); refresh(); });

  container.appendChild(el("div", { class: "card" }, [
    field("Character level", levelInput), profOut,
    el("div", { class: "grid-3" }, ABILITIES.map((name, i) => el("div", {}, [field(name, inputs[i]), mods[i]]))),
    rollBtn,
  ]));
  refresh();
}
