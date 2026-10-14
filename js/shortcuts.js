// Two keyboard shortcuts for desktop use, active everywhere:
//   /    jump to the page's search box (when it has one)
//   Esc  close the Quick Console / Dice Tray if either is open
// Neither fires while you're typing in a field (except Esc, which always
// closes a floating panel), so they never get in the way of normal input.

function isTyping(target) {
  const t = target;
  return !!t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));
}

// getClientRects() is empty for display:none, and (unlike offsetParent) works for fixed-position panels
function visible(el) {
  return !!el && el.getClientRects().length > 0;
}

function closeFloatingPanels() {
  let closed = false;
  for (const [panelSel, btnId] of [[".quick-console-panel", "quickConsoleBtn"], [".dice-widget-panel", "diceWidgetBtn"]]) {
    const panel = document.querySelector(panelSel);
    if (panel && panel.style.display !== "none" && visible(panel)) {
      document.getElementById(btnId)?.click(); // the button toggles its own panel
      closed = true;
    }
  }
  return closed;
}

export function mountShortcuts() {
  window.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "Escape") {
      if (closeFloatingPanels()) e.preventDefault();
      return;
    }
    if (e.key === "/" && !isTyping(e.target)) {
      const search = [...document.querySelectorAll('main input[type="text"], main input[type="search"]')].find(visible);
      if (search) {
        e.preventDefault();
        search.focus();
        search.select?.();
      }
    }
  });
}
