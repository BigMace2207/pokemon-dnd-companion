// A floating dice tray — one button beside the Quick Console in the shared
// bottom-right widget dock (js/widgetDock.js) that opens upward into the standard D&D die set (d4/d6/d8/d10/
// d12/d20), each rollable with a little spin animation, for whenever you
// just need a quick roll outside of an actual attack.

import { el } from "./components.js";
import { widgetDock, dockIcon } from "./widgetDock.js";

const DICE_SIDES = [4, 6, 8, 10, 12, 20];

export function mountDiceWidget() {
  if (document.getElementById("diceWidgetBtn")) return; // already mounted

  const btn = el("button", { id: "diceWidgetBtn", class: "dice-widget-btn", title: "Dice Tray", "aria-label": "Dice tray" }, [el("span", { class: "dock-text" }, "⚅"), dockIcon("M12 2.5l8.2 4.75v9.5L12 21.5l-8.2-4.75v-9.5zM12 2.5v9.5M3.8 7.25L12 12l8.2-4.75M8 14.5h.01M16 14.5h.01M12 17.5h.01")]);
  const panel = el("div", { class: "dice-widget-panel" });
  panel.style.display = "none";
  document.body.appendChild(panel);
  widgetDock().appendChild(btn);

  let open = false;
  function toggle() {
    open = !open;
    panel.style.display = open ? "grid" : "none";
    btn.classList.toggle("open", open);
    if (open) render();
  }
  btn.addEventListener("click", toggle);

  function render() {
    panel.innerHTML = "";
    DICE_SIDES.forEach((sides) => {
      const die = el("button", { class: "dice-widget-die" }, `d${sides}`);
      const resultEl = el("div", { class: "dice-widget-result" }, "");
      die.addEventListener("click", () => {
        if (die.classList.contains("rolling")) return;
        die.classList.add("rolling");
        resultEl.textContent = "";
        setTimeout(() => {
          die.classList.remove("rolling");
          resultEl.textContent = String(1 + Math.floor(Math.random() * sides));
        }, 550);
      });
      panel.appendChild(el("div", { class: "dice-widget-item" }, [die, resultEl]));
    });
  }
}
