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
