// A collapsible side drawer with two tabs — My Log and Battle Log — mounted
// into the Battle screen and the My Team page so either log is a click
// away without leaving what you're doing. Starts hidden; each view mounts
// its own instance (cleaned up like the rest of that view's polling via
// registerInterval, since the container gets wiped on the next render).

import { el } from "./components.js";
import { getLog, clearLog } from "./log.js";
import { getBattleLog, postBattleLog } from "./network.js";
import { loadSave } from "./storage.js";
import { registerInterval } from "./intervals.js";

const POLL_MS = 3000;

export function mountLogDrawer(container) {
  let open = false;
  let activeTab = "battle"; // "mine" | "battle"

  const toggleBtn = el("button", { class: "log-drawer-toggle" }, "LOG");
  const panel = el("div", { class: "log-drawer-panel" });
  panel.style.display = "none";
  container.appendChild(el("div", { class: "log-drawer" }, [toggleBtn, panel]));

  function toggle() {
    open = !open;
    panel.style.display = open ? "flex" : "none";
    toggleBtn.classList.toggle("open", open);
    if (open) render();
  }
  toggleBtn.addEventListener("click", toggle);

  function tabsRow() {
    return el("div", { class: "log-drawer-tabs" }, [["mine", "My Log"], ["battle", "Battle Log"]].map(([key, label]) => {
      const b = el("button", { class: "pill-btn" + (activeTab === key ? " active" : "") }, label);
      b.addEventListener("click", () => { activeTab = key; render(); });
      return b;
    }));
  }

  function renderMine(body) {
    const clearBtn = el("button", { class: "btn secondary" }, "Clear My Log");
    clearBtn.addEventListener("click", () => { clearLog(); render(); });
    body.appendChild(clearBtn);
    const entries = getLog();
    if (!entries.length) { body.appendChild(el("p", { class: "view-sub" }, "Nothing logged yet.")); return; }
    [...entries].reverse().slice(0, 100).forEach((e) => {
      body.appendChild(el("div", { class: "log-drawer-entry" }, [
        el("div", { class: "view-sub" }, new Date(e.ts).toLocaleString()),
        el("div", {}, e.text),
      ]));
    });
  }

  async function renderBattle(body) {
    const save = loadSave();
    const textInput = el("input", { type: "text", placeholder: "Post to the battle log…" });
    const postBtn = el("button", { class: "btn secondary" }, "Post");
    async function post() {
      const text = textInput.value.trim();
      if (!text) return;
      await postBattleLog(save.trainer.name || "A trainer", text);
      textInput.value = "";
      render();
    }
    postBtn.addEventListener("click", post);
    textInput.addEventListener("keydown", (e) => { if (e.key === "Enter") post(); });
    body.appendChild(el("div", { class: "grid-2" }, [textInput, postBtn]));

    const entries = await getBattleLog();
    if (!entries.length) { body.appendChild(el("p", { class: "view-sub" }, "Nothing logged yet.")); return; }
    [...entries].reverse().slice(0, 100).forEach((e) => {
      body.appendChild(el("div", { class: "log-drawer-entry" }, [
        el("div", { style: "display:flex;justify-content:space-between;gap:8px" }, [
          el("strong", {}, e.fromName || "Someone"),
          el("span", { class: "view-sub" }, new Date(e.ts * 1000).toLocaleTimeString()),
        ]),
        el("div", {}, e.text),
      ]));
    });
  }

  async function render() {
    if (!open) return;
    panel.innerHTML = "";
    panel.appendChild(el("div", { class: "log-drawer-header" }, [el("strong", {}, "Logs"), tabsRow()]));
    const body = el("div", { class: "log-drawer-body" });
    panel.appendChild(body);
    if (activeTab === "mine") renderMine(body);
    else await renderBattle(body);
  }

  registerInterval(setInterval(() => { if (open) render(); }, POLL_MS));
}
