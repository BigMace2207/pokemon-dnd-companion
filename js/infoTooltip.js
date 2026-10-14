// A generic hover (desktop) / tap (touch) info popover -- one shared
// tooltip element, repositioned and repopulated per hover/tap instead of
// building one per row. js/combatantInfo.js (the Battle screen's original
// version of this) is now a thin wrapper around this same module; the
// Pokédex, Move Dex, and Bag also attach through here.

import { el } from "./components.js";

let tooltipEl = null;
function ensureTooltip() {
  if (!tooltipEl) {
    tooltipEl = el("div", { class: "info-tooltip" });
    tooltipEl.style.display = "none";
    document.body.appendChild(tooltipEl);
    document.addEventListener("click", () => hideTooltip());
    // A hidden scroll ancestor moving out from under an open tooltip looks
    // broken (it stays pinned to stale coordinates), so just close it.
    document.addEventListener("scroll", () => hideTooltip(), true);
  }
  return tooltipEl;
}

function hideTooltip() {
  if (tooltipEl) { tooltipEl.style.display = "none"; tooltipEl._anchor = null; }
}

// Fixed-position, anchored to the cursor (not the hovered row/card) so it
// shows up right where the mouse is instead of off at the row's corner --
// tips can otherwise land far from a wide table row's actual pointer
// position. Measured off-screen first since it needs its own size to
// flip to the other side of the cursor near a viewport edge.
function positionTooltip(x, y) {
  const tip = ensureTooltip();
  const offset = 16;
  const pad = 8;
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  const w = tip.offsetWidth;
  const h = tip.offsetHeight;
  let left = x + offset;
  let top = y + offset;
  if (left + w > vw - pad) left = x - w - offset;
  if (top + h > vh - pad) top = y - h - offset;
  left = Math.max(pad, Math.min(left, vw - w - pad));
  top = Math.max(pad, Math.min(top, vh - h - pad));
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

// anchor: the element to attach hover/tap to. buildContent(): () => Node[]
// -- called fresh each time the tooltip opens (not memoized at attach
// time), so it reflects whatever's current if the underlying data can
// change while the row's on screen.
export function attachInfoTooltip(anchor, buildContent) {
  function show(x, y) {
    const tip = ensureTooltip();
    tip.innerHTML = "";
    buildContent().forEach((n) => tip.appendChild(n));
    tip.style.display = "block";
    tip._anchor = anchor;
    positionTooltip(x, y);
  }
  anchor.addEventListener("mouseenter", (e) => show(e.clientX, e.clientY));
  // Keep it glued to the cursor while it crosses a wide row/card instead
  // of staying pinned to wherever it first appeared.
  anchor.addEventListener("mousemove", (e) => {
    if (tooltipEl && tooltipEl.style.display === "block" && tooltipEl._anchor === anchor) {
      positionTooltip(e.clientX, e.clientY);
    }
  });
  anchor.addEventListener("mouseleave", hideTooltip);
  anchor.addEventListener("click", (e) => {
    e.stopPropagation();
    if (tooltipEl && tooltipEl.style.display === "block" && tooltipEl._anchor === anchor) { hideTooltip(); return; }
    const rect = anchor.getBoundingClientRect();
    show(e.clientX || rect.left + rect.width / 2, e.clientY || rect.top + rect.height / 2);
  });
  anchor.classList.add("has-info");
}

// Small building blocks so every tooltip's content reads consistently.
export function tooltipTitle(text) { return el("div", { class: "info-tooltip-title" }, text); }
export function tooltipRow(text) { return el("div", { class: "info-tooltip-row" }, text); }
