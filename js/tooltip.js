// One tooltip for the whole app. Anything with data-tip (and optionally data-tip-title / data-tip-hint) shows a card on hover
// or keyboard focus; plain `title` attributes are upgraded to the same card the first time they are hovered, so every icon
// button and chip explains itself without the browser's slow native tooltip. Text only (never innerHTML).

let tip = null, timer = null, current = null;

function ensure() {
  if (tip) return tip;
  tip = document.createElement("div");
  tip.id = "appTip";
  tip.setAttribute("role", "tooltip");
  tip.hidden = true;
  document.body.append(tip);
  return tip;
}

function show(target) {
  const text = target.dataset.tip, title = target.dataset.tipTitle, hint = target.dataset.tipHint;
  if (!text && !title) return;
  const box = ensure();
  box.replaceChildren();
  if (title) { const h = document.createElement("strong"); h.textContent = title; box.append(h); }
  if (text) { const p = document.createElement("span"); p.textContent = text; box.append(p); }
  if (hint) { const s = document.createElement("em"); s.textContent = hint; box.append(s); }
  box.hidden = false;
  box.classList.toggle("fast", !!target.closest(".pl-wb"));
  const r = target.getBoundingClientRect(), b = box.getBoundingClientRect();
  let x = r.left + r.width / 2 - b.width / 2, y = r.bottom + 8;
  if (y + b.height > window.innerHeight - 8) y = Math.max(8, r.top - b.height - 8);
  x = Math.max(8, Math.min(window.innerWidth - b.width - 8, x));
  box.style.left = `${Math.round(x)}px`; box.style.top = `${Math.round(y)}px`;
  current = target;
}
function hide() { clearTimeout(timer); timer = null; current = null; if (tip) tip.hidden = true; }

// Turn a native title into our tip (once), so it never shows twice.
function upgrade(el) {
  const t = el.getAttribute?.("title");
  if (t && !el.dataset.tip) { el.dataset.tip = t; el.removeAttribute("title"); }
}

export function installTooltips() {
  if (window.__appTips) return;
  window.__appTips = true;
  const find = (node) => {
    for (let n = node instanceof Element ? node : node?.parentElement; n && n !== document.body; n = n.parentElement) { upgrade(n); if (n.dataset?.tip || n.dataset?.tipTitle) return n; }
    return null;
  };
  document.addEventListener("pointerover", (e) => {
    if (e.pointerType === "touch") return;
    const t = find(e.target);
    if (!t || t === current) return;
    clearTimeout(timer);
    timer = setTimeout(() => show(t), current || t.closest(".pl-wb") ? 0 : 280);   // the whiteboard is a tool: its hover is instant
  });
  document.addEventListener("pointerout", (e) => { const t = find(e.target); if (t && !t.contains(e.relatedTarget)) hide(); });
  document.addEventListener("focusin", (e) => { const t = find(e.target); if (t) show(t); });
  document.addEventListener("focusout", hide);
  document.addEventListener("pointerdown", hide);
  document.addEventListener("scroll", hide, true);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") hide(); });
}
