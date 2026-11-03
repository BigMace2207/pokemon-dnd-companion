// Pull tabs on the right edge of the screen. LOG (My Log and Battle Log) is always there; a game system can add its own
// (system.pullTabs: the Pokémon system adds its Rulebook and Type Chart), so reference pages are a click away without
// leaving what you're doing. One panel is open at a time; clicking its tab again (or Esc) slides it away. A reference
// panel is built the first time it opens and then kept, so it remembers where you'd scrolled to.

import { el } from "./components.js";
import { getLog, clearLog } from "./log.js";
import { getBattleLog, postBattleLog } from "./network.js";
import { loadSave } from "./storage.js";

const POLL_MS = 3000;

// tabs: [{ id, label (short, on the tab), title (panel heading), render(container, state), wide }]
export function mountLogDrawer(container, { tabs = [], state = null } = {}) {
  document.querySelector(".pull-tabs")?.remove();   // a new campaign mounts a fresh set
  document.querySelector(".pull-panels")?.remove();
  let open = null;            // which tab's panel is out
  let logTab = "battle";      // "mine" | "battle"
  const all = [{ id: "log", label: "LOG", title: "Logs" }, ...tabs];

  const tabStack = el("div", { class: "pull-tabs", role: "tablist", "aria-label": "Side panels" });
  const panelHost = el("div", { class: "pull-panels" });
  container.append(tabStack, panelHost);
  const panels = new Map();   // id -> panel element

  const tabBtns = all.map((t) => {
    const b = el("button", { type: "button", class: "pull-tab", role: "tab", "aria-selected": "false", "aria-controls": `pull-${t.id}`, title: t.title }, t.label);
    b.addEventListener("click", () => toggle(t.id));
    tabStack.append(b);
    return [t.id, b];
  });

  function panelFor(t) {
    let p = panels.get(t.id);
    if (p) return p;
    const body = el("div", { class: "pull-body" });
    const close = el("button", { type: "button", class: "pull-close", "aria-label": `Close ${t.title}`, title: "Close" }, "×");
    close.addEventListener("click", () => toggle(t.id));
    const head = el("div", { class: "pull-head" }, [el("strong", {}, t.title), t.id === "log" ? logTabs() : el("span"), close]);
    p = el("section", { class: `pull-panel${t.wide ? " wide" : ""}`, id: `pull-${t.id}`, role: "tabpanel", "aria-label": t.title }, [head, body]);
    p.__body = body; p.__head = head;
    panelHost.append(p);
    panels.set(t.id, p);
    if (t.render) t.render(body, state);   // reference pages: drawn once, then kept
    return p;
  }

  function toggle(id) {
    const next = open === id ? null : id;
    if (open) panels.get(open)?.classList.remove("open");
    open = next;
    for (const [tid, b] of tabBtns) { b.classList.toggle("open", tid === open); b.setAttribute("aria-selected", String(tid === open)); }
    if (!open) return;
    const p = panelFor(all.find((t) => t.id === open));
    void p.offsetWidth;   // lay it out closed first, so it slides in
    p.classList.add("open");
    if (open === "log") renderLog();
  }
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && open && !e.target.closest?.("input, textarea, [contenteditable='true']")) toggle(open);
  });

  // ---- the log panel ---------------------------------------------------------------------------------------------------
  function logTabs() {
    const wrap = el("div", { class: "pull-seg" });
    const draw = () => wrap.replaceChildren(...[["mine", "My Log"], ["battle", "Battle Log"]].map(([key, label]) => {
      const b = el("button", { type: "button", class: `pull-seg-btn${logTab === key ? " on" : ""}` }, label);
      b.addEventListener("click", () => { logTab = key; draw(); renderLog(); });
      return b;
    }));
    draw();
    return wrap;
  }

  function renderMine(body) {
    const clearBtn = el("button", { type: "button", class: "pull-btn" }, "Clear my log");
    clearBtn.addEventListener("click", () => { clearLog(); renderLog(); });
    const entries = getLog();
    body.replaceChildren(clearBtn, ...(entries.length
      ? [...entries].reverse().slice(0, 100).map((e) => el("div", { class: "pull-entry" }, [el("span", { class: "pull-when" }, new Date(e.ts).toLocaleString()), el("div", {}, e.text)]))
      : [el("p", { class: "pull-empty" }, "Nothing logged yet.")]));
  }

  async function renderBattle(body) {
    const save = loadSave();
    const textInput = el("input", { type: "text", class: "pull-input", placeholder: "Post to the battle log…", "aria-label": "Post to the battle log" });
    const postBtn = el("button", { type: "button", class: "pull-btn solid" }, "Post");
    async function post() {
      const text = textInput.value.trim();
      if (!text) return;
      await postBattleLog(save.trainer.name || "A trainer", text);
      textInput.value = "";
      renderLog();
    }
    postBtn.addEventListener("click", post);
    textInput.addEventListener("keydown", (e) => { if (e.key === "Enter") post(); });
    const entries = await getBattleLog();
    if (document.activeElement === body.querySelector(".pull-input")) return;   // don't wipe a half-typed post
    body.replaceChildren(el("div", { class: "pull-post" }, [textInput, postBtn]), ...(entries.length
      ? [...entries].reverse().slice(0, 100).map((e) => el("div", { class: "pull-entry" }, [
        el("div", { class: "pull-entry-top" }, [el("strong", {}, e.fromName || "Someone"), el("span", { class: "pull-when" }, new Date(e.ts * 1000).toLocaleTimeString())]),
        el("div", {}, e.text),
      ]))
      : [el("p", { class: "pull-empty" }, "Nothing logged yet.")]));
  }

  function renderLog() {
    if (open !== "log") return;
    const body = panels.get("log").__body;
    if (logTab === "mine") renderMine(body); else renderBattle(body);
  }

  // Lives for the whole page (not tied to one view), so the log keeps updating whichever page is open.
  setInterval(() => { if (open === "log" && !document.hidden) renderLog(); }, POLL_MS);
}
