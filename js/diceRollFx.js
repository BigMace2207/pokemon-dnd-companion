// A small floating "dice roll" toast — bottom-left corner (the Quick
// Console owns the bottom-right) — that shows the actual d20 rolled for an
// attack and its outcome, similar to the inline attack-roll popup in games
// like Baldur's Gate. Purely cosmetic: the real roll already happened by
// the time this is called, this just narrates it.

import { el } from "./components.js";

let activeCard = null;
let hideTimer = null;
let settleTimer = null;

export function showDiceRollFx({ label, d20, hit, resultText }) {
  if (activeCard) { activeCard.remove(); clearTimeout(hideTimer); clearTimeout(settleTimer); }

  const die = el("div", { class: "dice-fx-die rolling" }, "⚅");
  const rollLine = el("div", { class: "dice-fx-roll" }, "Rolling…");
  const card = el("div", { class: "dice-fx-card" }, [
    die,
    el("div", { class: "dice-fx-info" }, [
      el("div", { class: "dice-fx-label" }, label),
      rollLine,
    ]),
  ]);
  document.body.appendChild(card);
  activeCard = card;

  settleTimer = setTimeout(() => {
    die.textContent = String(d20);
    die.classList.remove("rolling");
    die.classList.add(hit ? "hit" : "miss");
    rollLine.textContent = `d20: ${d20} — ${resultText || (hit ? "HIT" : "MISS")}`;
  }, 600);

  hideTimer = setTimeout(() => {
    card.classList.add("fade-out");
    setTimeout(() => { card.remove(); if (activeCard === card) activeCard = null; }, 400);
  }, 3400);
}
