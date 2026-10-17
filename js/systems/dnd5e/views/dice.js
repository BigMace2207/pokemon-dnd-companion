// Dice roller: a full expression roller (2d6+3, 4d6dl1, 2d20kh1, 1d8!...), one-tap dice,
// advantage/disadvantage, saved macros and a history shared with the character sheet.

import { el, btn, chip, field, section, textInput, toast, confirmDialog, checkbox } from "../ui.js";
import { pageTitle } from "./common.js";
import { stats } from "../engine/dice.js";
import { expressionRoll, d20Test, recentRolls, onRoll, clearRolls, rollMode, setRollMode } from "../rolls.js";
import { getSettings, setSettings, activeCharacter } from "../store.js";

const DICE = [4, 6, 8, 10, 12, 20, 100];
const DEFAULT_MACROS = [
  { name: "Fireball", expr: "8d6" }, { name: "Greatsword", expr: "2d6+4" }, { name: "Sneak Attack (L5)", expr: "3d6" },
  { name: "Stat roll (4d6 drop lowest)", expr: "4d6dl1" }, { name: "Healing Word", expr: "1d4+3" },
];

export function renderDice(container) {
  container.replaceChildren();
  container.append(...pageTitle("Dice Roller", "Roll anything. Rolls appear on-screen and, if you share them in Settings, in the campaign's Battle Log."));
  const char = activeCharacter();
  const who = char?.name || "";
  const state = { expr: "1d20", count: {}, mode: "normal" };

  const exprIn = el("input", { type: "text", value: state.expr, class: "dnd-expr", autocomplete: "off", spellcheck: "false", "aria-label": "Dice expression", placeholder: "e.g. 2d6+4, 4d6dl1, 2d20kh1+5" });
  const hint = el("div", { class: "dnd-small dnd-muted" });
  const resultHost = el("div", { class: "dnd-bigresult", "aria-live": "polite" }, el("span", { class: "dnd-muted" }, "Roll to see the result here."));
  const historyHost = el("div", { class: "dnd-stack" });

  function updateHint() {
    const s = stats(exprIn.value);
    hint.textContent = s ? `Range ${s.min}–${s.max}, average ${Number.isInteger(s.avg) ? s.avg : s.avg.toFixed(1)}` : exprIn.value.trim() ? "Can't parse that yet." : "";
  }

  function doRoll(expr, label = "Roll") {
    const e = expr.trim();
    const mode = state.mode;
    // a lone d20 respects advantage/disadvantage
    const lone = /^d?1?d20$/i.test(e.replace(/\s/g, "")) || /^1d20$/i.test(e);
    let entry;
    if (lone && mode !== "normal") entry = d20Test({ label: "d20", mod: 0, mode, who });
    else entry = expressionRoll(e, { label, who });
    if (!entry) { toast("Couldn't parse that expression.", "bad"); return; }
    drawResult(entry);
  }

  function drawResult(entry) {
    resultHost.className = `dnd-bigresult${entry.crit ? " crit" : entry.fumble ? " fumble" : ""}`;
    resultHost.replaceChildren(el("div", { class: "total" }, String(entry.total)), el("div", { class: "dnd-small dnd-muted" }, entry.detail || ""), el("div", { class: "dnd-small" }, entry.label));
  }

  function drawHistory() {
    const rolls = recentRolls();
    historyHost.replaceChildren(...(rolls.length ? rolls.slice(0, 30).map((r) => el("div", { class: `dnd-history${r.crit ? " crit" : r.fumble ? " fumble" : ""}` }, [
      el("strong", { class: "dnd-mono" }, String(r.total)),
      el("span", { class: "dnd-grow" }, [r.label, el("span", { class: "dnd-muted dnd-small" }, ` · ${r.detail || ""}`)]),
      el("span", { class: "dnd-muted dnd-tiny" }, new Date(r.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })),
    ])) : [el("p", { class: "view-sub" }, "Nothing rolled yet.")]));
  }

  exprIn.addEventListener("input", () => { state.expr = exprIn.value; updateHint(); });
  exprIn.addEventListener("keydown", (e) => { if (e.key === "Enter") doRoll(exprIn.value); });

  // dice pad
  const modeBar = el("div", { class: "dnd-segment", role: "group", "aria-label": "Advantage" });
  function drawMode() {
    modeBar.replaceChildren(...[["dis", "Disadvantage"], ["normal", "Normal"], ["adv", "Advantage"]].map(([m, l]) => {
      const b = el("button", { type: "button", class: state.mode === m ? "on" : "" }, l);
      b.addEventListener("click", () => { state.mode = m; drawMode(); });
      return b;
    }));
  }
  drawMode();
  const pad = el("div", { class: "dnd-dicepad" }, DICE.map((n) => {
    const b = el("button", { type: "button", class: "dnd-die", title: `Roll d${n} (Shift+click adds to the expression)` }, [el("span", { class: "n" }, `d${n}`)]);
    b.addEventListener("click", (e) => {
      if (e.shiftKey) { exprIn.value = `${exprIn.value.trim() ? `${exprIn.value.trim()}+` : ""}1d${n}`; state.expr = exprIn.value; updateHint(); return; }
      doRoll(`1d${n}`, `d${n}`);
    });
    return b;
  }));
  const multi = el("div", { class: "dnd-row" }, [
    ...[2, 3, 4, 5, 6, 8].map((n) => btn(`${n}×`, () => { const cur = /d(\d+)/.exec(exprIn.value); exprIn.value = `${n}d${cur ? cur[1] : 6}${/[+-]\d+$/.exec(exprIn.value)?.[0] || ""}`; state.expr = exprIn.value; updateHint(); }, "btn secondary tiny")),
  ]);

  // macros
  const macroHost = el("div", { class: "dnd-chip-row" });
  const macros = () => getSettings().macros || DEFAULT_MACROS;
  function drawMacros() {
    macroHost.replaceChildren(...macros().map((m, i) => {
      const wrap = el("span", { class: "dnd-macro" });
      const run = el("button", { type: "button", class: "dnd-chip dnd-pickable", title: m.expr }, `${m.name}  ${m.expr}`);
      run.addEventListener("click", () => doRoll(m.expr, m.name));
      const del = el("button", { type: "button", class: "dnd-macro-del", "aria-label": `Delete ${m.name}` }, "✕");
      del.addEventListener("click", async () => { if (await confirmDialog(`Delete the macro "${m.name}"?`, { ok: "Delete", danger: true })) { setSettings({ macros: macros().filter((_, j) => j !== i) }); drawMacros(); } });
      wrap.append(run, del);
      return wrap;
    }));
  }
  const macroName = textInput("", () => {}, { placeholder: "Name (e.g. Longsword)", ariaLabel: "Macro name" });
  const saveMacro = btn("Save current as macro", () => {
    if (!stats(exprIn.value)) { toast("Type a valid expression first.", "bad"); return; }
    setSettings({ macros: [...macros(), { name: macroName.value.trim() || exprIn.value.trim(), expr: exprIn.value.trim() }] });
    macroName.value = ""; drawMacros(); toast("Macro saved.", "good");
  }, "btn secondary small");

  const share = checkbox("Share my rolls in the Battle Log", !!getSettings().shareRolls, (v) => setSettings({ shareRolls: v }));
  const rowMode = el("div", { class: "dnd-row" }, [el("span", { class: "dnd-small dnd-muted" }, "Sheet roll mode:"), ...["dis", "normal", "adv"].map((m) => btn(m === "dis" ? "Dis" : m === "adv" ? "Adv" : "Normal", () => { setRollMode(m); drawRowMode(); }, `btn tiny ${rollMode() === m ? "" : "secondary"}`))]);
  function drawRowMode() { rowMode.replaceChildren(...[...rowMode.children].slice(0, 1), ...["dis", "normal", "adv"].map((m) => btn(m === "dis" ? "Dis" : m === "adv" ? "Adv" : "Normal", () => { setRollMode(m); drawRowMode(); }, `btn tiny ${rollMode() === m ? "" : "secondary"}`))); }

  container.append(el("div", { class: "dnd-split" }, [
    el("div", { class: "dnd-stack" }, [
      section("Roll", [
        field("Expression", exprIn), hint,
        el("div", { class: "dnd-row" }, [btn("Roll", () => doRoll(exprIn.value), "btn"), modeBar]),
        resultHost,
      ]),
      section("Dice", [pad, el("p", { class: "dnd-small dnd-muted" }, "Tap a die to roll it, Shift+tap to build an expression."), multi]),
      section("Macros", [macroHost, el("div", { class: "dnd-row", style: "margin-top:10px" }, [macroName, saveMacro])]),
      section("Settings", [share, rowMode, el("p", { class: "dnd-small dnd-muted" }, "Syntax: NdS, kh/kl (keep), dh/dl (drop), r1 (reroll 1s), ! (explode), mi (minimum), plus + − and flat numbers.")]),
    ]),
    section("History", [historyHost, btn("Clear", () => { clearRolls(); drawHistory(); }, "btn secondary small")], { cls: "dnd-history-card" }),
  ]));
  drawMacros(); drawHistory(); updateHint();
  const off = onRoll((e) => { if (!document.body.contains(historyHost)) { off(); return; } drawHistory(); if (e) drawResult(e); });
  void chip;
}
