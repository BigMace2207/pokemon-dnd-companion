// Drag and drop for fingers. The app's drags (team Pokémon, your trainer, bag items, Dex rows, Whiteboard palette
// items...) are HTML5 drag-and-drop, which phones don't do with touch. This turns a press-and-hold on anything
// draggable into the same events: dragstart on the thing, dragenter / dragover / dragleave on whatever is under your
// finger, then drop and dragend, with a little copy of it following your finger. So every existing drop target (the
// board, a trainer's card, Send To, a Whiteboard slot) works on a phone without knowing the difference.
//
// Hold still for a moment to pick something up: a quick swipe still scrolls a list or pans the board. Only on the phone
// layout (html.m); the browser's own drag is turned off there (css/mobile.css) so the two never both run.

const HOLD_MS = 260, SLOP = 9;

// a stand-in for the browser's DataTransfer (the real one can't be made or filled outside a real drag everywhere)
function dataTransfer() {
  const data = new Map();
  return {
    dropEffect: "move", effectAllowed: "all", files: [], items: [],
    get types() { return [...data.keys()]; },
    setData(type, value) { data.set(type, String(value)); },
    getData(type) { return data.get(type) ?? ""; },
    clearData(type) { if (type) data.delete(type); else data.clear(); },
    setDragImage() {},
  };
}
function fire(target, type, dt, x, y) {
  if (!target) return false;
  const e = new Event(type, { bubbles: true, cancelable: true });
  for (const [k, v] of Object.entries({ dataTransfer: dt, clientX: x, clientY: y, pageX: x, pageY: y })) Object.defineProperty(e, k, { value: v });
  target.dispatchEvent(e);
  return e.defaultPrevented;
}

export function enableTouchDrag() {
  if (enableTouchDrag.on) return;
  enableTouchDrag.on = true;
  let press = null, drag = null;

  const ghostOf = (src) => {
    const img = src.querySelector("img");
    const g = img ? img.cloneNode(true) : src.cloneNode(true);
    g.removeAttribute?.("id");
    g.className = `touch-drag-ghost${img ? " img" : ""}`;
    if (!img) { const r = src.getBoundingClientRect(); g.style.width = `${Math.min(r.width, 220)}px`; }
    document.body.append(g);
    return g;
  };
  const place = (x, y) => { if (drag) drag.ghost.style.transform = `translate(${x}px, ${y}px) translate(-50%, -60%) scale(1.08)`; };
  const under = (x, y) => document.elementFromPoint(x, y);

  function begin() {
    const { src, x, y } = press;
    press = null;
    const dt = dataTransfer();
    fire(src, "dragstart", dt, x, y);
    if (!dt.types.length) return;   // the thing decided not to be dragged after all
    drag = { src, dt, ghost: ghostOf(src), over: null };
    src.classList.add("touch-dragging");
    navigator.vibrate?.(8);
    place(x, y);
    move(x, y);
  }
  function move(x, y) {
    place(x, y);
    const t = under(x, y);
    if (t !== drag.over) {
      if (drag.over) fire(drag.over, "dragleave", drag.dt, x, y);
      if (t) fire(t, "dragenter", drag.dt, x, y);
      drag.over = t;
    }
    if (t) fire(t, "dragover", drag.dt, x, y);
  }
  function finish(x, y, dropIt) {
    const d = drag;
    drag = null;
    d.ghost.remove();
    d.src.classList.remove("touch-dragging");
    const t = dropIt ? under(x, y) : null;
    if (t) fire(t, "drop", d.dt, x, y);
    else if (d.over) fire(d.over, "dragleave", d.dt, x, y);
    fire(d.src, "dragend", d.dt, x, y);
  }

  document.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "touch" || !document.documentElement.classList.contains("m")) return;
    const src = e.target.closest?.('[draggable="true"]');
    if (!src || e.target.closest("input, textarea, select")) return;
    press = { src, x: e.clientX, y: e.clientY, id: e.pointerId, timer: setTimeout(() => { if (press) begin(); }, HOLD_MS) };
  }, true);
  document.addEventListener("pointermove", (e) => {
    if (drag) { e.preventDefault(); move(e.clientX, e.clientY); return; }
    if (press && e.pointerId === press.id && Math.hypot(e.clientX - press.x, e.clientY - press.y) > SLOP) { clearTimeout(press.timer); press = null; }   // a swipe: let it scroll
  }, true);
  const up = (e) => {
    if (press && e.pointerId === press.id) { clearTimeout(press.timer); press = null; }
    if (drag) { e.preventDefault(); finish(e.clientX, e.clientY, e.type === "pointerup"); }
  };
  document.addEventListener("pointerup", up, true);
  document.addEventListener("pointercancel", (e) => {
    // the browser took the touch for a scroll; if we'd already picked something up, it ends here (no drop)
    if (press && e.pointerId === press.id) { clearTimeout(press.timer); press = null; }
    if (drag) finish(e.clientX, e.clientY, false);
  }, true);
  // while carrying something, the page mustn't scroll under your finger
  document.addEventListener("touchmove", (e) => { if (drag) e.preventDefault(); }, { passive: false });
  // a long press mustn't also open the system menu on the thing
  document.addEventListener("contextmenu", (e) => { if (drag || press) e.preventDefault(); }, true);
}
