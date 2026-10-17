// Short and long rest dialogs. A short rest lets you spend hit dice (rolling the die and
// adding Constitution); both rests restore the things the rules say they do.

import { el, modal, btn, toast } from "../ui.js";
import { spendHitDie, shortRest, longRest } from "../engine/character.js";
import { roll } from "../engine/dice.js";
import { fmtMod } from "../engine/dice.js";

export function openShortRest(S) {
  const { char } = S;
  const log = el("div", { class: "dnd-stack dnd-small" });
  const pool = el("div", { class: "dnd-row" });
  const hpLine = el("div", {});

  function draw() {
    const d = S.d;
    hpLine.textContent = `HP ${d.hp.current} / ${d.hp.max}  ·  CON ${fmtMod(d.scores.CON.mod)} per die`;
    pool.replaceChildren(...d.hitDice.map((h) => {
      const left = h.total - h.used;
      return btn(`Spend d${h.die}  (${left}/${h.total})`, () => {
        if (d.hp.current >= d.hp.max) { toast("Already at full HP.", ""); return; }
        const r = roll(`1d${h.die}`).total;
        const res = spendHitDie(char, d, h.die, r);
        if (!res) { toast("No hit dice of that size left.", "bad"); return; }
        log.append(el("div", {}, `d${h.die}: rolled ${r} ${fmtMod(d.scores.CON.mod)} → healed ${res.gained}.`));
        S.commit();
        draw();
      }, "btn secondary small", left <= 0 ? { disabled: "" } : {});
    }));
  }
  draw();
  modal({
    title: "Short rest (1 hour)",
    body: [
      hpLine,
      el("p", { class: "dnd-small dnd-muted" }, "Spend hit dice to recover HP. Features that recharge on a short rest, and Warlock pact slots, are restored when you finish."),
      pool, log,
    ],
    actions: [{ label: "Cancel" }, {
      label: "Finish rest", cls: "btn", onClick: () => {
        shortRest(char, S.d);
        S.commit();
        toast("Short rest complete.", "good");
      },
    }],
  });
}

export function openLongRest(S) {
  const { char } = S;
  modal({
    title: "Long rest (8 hours)",
    body: [
      el("ul", { class: "dnd-list" }, [
        "Hit points back to full, temporary HP removed",
        "All spell slots and Pact Magic slots restored",
        "Every feature that recharges on a rest restored",
        "Regain up to half your hit dice (minimum one)",
        "Exhaustion reduced by 1 level",
        "Death saves cleared, concentration ended",
      ].map((t) => el("li", {}, t))),
    ],
    actions: [{ label: "Cancel" }, {
      label: "Take long rest", cls: "btn", onClick: () => {
        longRest(char, S.d);
        S.commit();
        toast("Fully rested.", "good");
      },
    }],
  });
}
