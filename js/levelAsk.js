// A small number popover at a screen point: "what level?" for a Pokémon dropped on the hub or the Whiteboard, and
// "how many?" when sending more than one of something. Resolves to the number, null when the person chose none (only
// offered when it's optional), or undefined when they cancelled (Esc, clicking away).

import { el } from "./components.js";

export function askNumber({ x, y, title, label, min = 1, max = 100, initial = "", required = true, okLabel = "OK", skipLabel = "None" } = {}) {
  document.querySelector(".level-ask")?.dispatchEvent(new Event("cancel-ask"));
  return new Promise((resolve) => {
    const input = el("input", { type: "number", min: String(min), max: String(max), inputmode: "numeric", value: String(initial ?? ""), placeholder: `${min}–${max}`, "aria-label": label });
    const add = el("button", { type: "button", class: "level-ask-ok" }, okLabel);
    const skip = required ? null : el("button", { type: "button", class: "level-ask-skip" }, skipLabel);
    const box = el("div", { class: "level-ask", role: "dialog", "aria-label": `${label}: ${title}` }, [
      el("strong", {}, title), el("label", {}, [label, input]), el("div", { class: "level-ask-row" }, [skip, add].filter(Boolean)),
    ]);
    box.style.left = `${Math.max(8, Math.min(window.innerWidth - 230, x - 110))}px`;
    box.style.top = `${Math.max(8, Math.min(window.innerHeight - 170, y - 20))}px`;
    document.body.append(box);
    let done = false;
    const finish = (v) => { if (done) return; done = true; box.remove(); document.removeEventListener("pointerdown", away, true); resolve(v); };
    const away = (e) => { if (!box.contains(e.target)) finish(undefined); };
    const ok = () => {
      const n = Math.round(Number(input.value));
      if (input.value !== "" && n >= min && n <= max) finish(n);
      else if (!input.value && !required) finish(null);
      else { input.classList.add("bad"); input.focus(); }
    };
    add.addEventListener("click", ok);
    skip?.addEventListener("click", () => finish(null));
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") ok(); if (e.key === "Escape") finish(undefined); e.stopPropagation(); });
    box.addEventListener("cancel-ask", () => finish(undefined));
    setTimeout(() => document.addEventListener("pointerdown", away, true), 0);
    setTimeout(() => { input.focus(); input.select(); }, 0);
  });
}

export function askLevel({ x, y, name = "this Pokémon", required = false, initial = "" } = {}) {
  return askNumber({ x, y, title: name, label: "Level", min: 1, max: 100, initial: initial || "", required, okLabel: "Add", skipLabel: "No level" });
}
