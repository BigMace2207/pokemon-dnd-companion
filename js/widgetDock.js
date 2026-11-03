// One fixed container in the bottom-right corner that holds the floating
// widget buttons (Dice Tray, Quick Console). Putting them in the same flex
// row -- instead of each having its own hard-coded fixed offsets -- is what
// keeps them level and evenly spaced at every window size; see "Widget dock"
// in css/style.css.

export function widgetDock() {
  let dock = document.getElementById("widgetDock");
  if (!dock) {
    dock = document.createElement("div");
    dock.id = "widgetDock";
    dock.className = "widget-dock";
    document.body.appendChild(dock);
  }
  return dock;
}

// A line icon for a dock button. The button keeps its text too; the Cosmic theme shows the icon instead (css/cosmic.css).
export function dockIcon(d) {
  const span = document.createElement("span");
  span.className = "dock-icon";
  span.setAttribute("aria-hidden", "true");
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;
  return span;
}
