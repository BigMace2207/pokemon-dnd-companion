// What a wheel event means on a board you can pan and zoom (the hub, the Whiteboard, the maps):
//  - a pinch on a touchpad (browsers report it as a wheel event with ctrlKey) or Ctrl/Cmd + wheel: zoom
//  - a mouse wheel (whole "notches": line mode, or 120-unit steps with no sideways part): zoom, as before
//  - two fingers sliding on a touchpad (smooth pixel deltas, often with a sideways part): pan
// A gesture keeps the meaning it started with until the wheel goes quiet for a moment, so a slow touchpad scroll
// whose deltas happen to look like a notch never flips into zooming halfway through.

let latched = null, quietTimer = 0;

export function wheelIntent(e) {
  clearTimeout(quietTimer);
  quietTimer = setTimeout(() => { latched = null; }, 180);
  if (e.ctrlKey || e.metaKey) return (latched = "zoom");   // a pinch, or the keyboard asking for zoom
  if (latched) return latched;
  const notch = e.deltaMode !== 0 || (e.deltaX === 0 && Number.isInteger(e.wheelDeltaY) && e.wheelDeltaY !== 0 && e.wheelDeltaY % 120 === 0);
  return (latched = notch ? "zoom" : "pan");
}

// the wheel's vertical step in pixels, whatever unit the browser reported it in (Firefox's mouse wheel counts lines)
export const wheelPx = (e) => e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 600 : 1);
