// The phone hub's radial wheel, and its bottom sheets. Built on Apple's fluid-interface rules (WWDC 2018 "Designing
// Fluid Interfaces"), via the apple-design skill:
//  - One dot at the bottom holds nearly everything. Tap it and the options bloom out of it along an arc (anchored to
//    the dot, so they go back where they came from).
//  - The options come in pages, one group at a time (On the board, Your trainer, ...). Swipe sideways to turn to the
//    next page: it follows the finger 1:1 round the arc, and on release it turns exactly one page (a quick flick or a
//    pull past a third of the way) or springs back. It can never skip a page, and it rubber-bands past the first and
//    last. Dots under the title show which page you're on.
//  - Every animation is a spring that starts from the current value, so opening, closing and spinning can all be
//    grabbed and reversed mid-way.
//  - Taps need ~8px of sideways travel (hysteresis) before a press becomes a swipe, so a tap on an option is never a swipe.
// Reduced motion: no springs or bloom, the wheel just fades.

import { el } from "../components.js";
import { hubSound } from "../hubSound.js";

const PER_PAGE = 5;  // options on the arc at once, at most (six crowd the labels)
const R = 132;       // the ring's radius, in px
const PAGE_PX = 240; // a sideways drag this long turns one whole page
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const svgIcon = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;

// A spring on one number, Apple's way: a damping ratio (1 = no overshoot) and a response in seconds (how quickly it
// gets there). Starts from wherever the value is now, with the velocity it already has.
export function spring({ from, to, velocity = 0, damping = 1, response = 0.35, onUpdate, onDone }) {
  const k = (2 * Math.PI / response) ** 2, c = (4 * Math.PI * damping) / response;
  let x = from, v = velocity, last = performance.now(), raf = 0, done = false;
  const tick = (now) => {
    const dt = Math.min(0.032, (now - last) / 1000); last = now;
    for (let i = 0; i < 4; i++) { const h = dt / 4; v += (-k * (x - to) - c * v) * h; x += v * h; }
    if (Math.abs(x - to) < 0.005 * Math.max(1, Math.abs(to)) && Math.abs(v) < 0.05) { x = to; onUpdate(x); done = true; onDone?.(); return; }
    onUpdate(x);
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return { stop: () => cancelAnimationFrame(raf), get value() { return x; }, get velocity() { return v; }, get done() { return done; } };
}
// Apple's momentum projection: where a flick at velocity v (units/s) would come to rest
const project = (v, d = 0.998) => (v / 1000) * d / (1 - d);
// soft resistance past an edge: the further you pull, the less it follows
const rubberband = (over, dim, c = 0.55) => (over * dim * c) / (dim + c * Math.abs(over));

// items: [{ id, label, group, d (an SVG path), run(), on? }]; getCurrent() -> { label, d } for the dot's icon
export function mountWheel(root, { getItems, getCurrent }) {
  const dot = el("button", { type: "button", class: "wheel-dot", "aria-haspopup": "menu", "aria-expanded": "false" });
  const scrim = el("div", { class: "wheel-scrim", "aria-hidden": "true" });
  const pad = el("div", { class: "wheel-pad", "aria-hidden": "true" });
  const ring = el("div", { class: "wheel-ring", role: "menu", "aria-label": "Hub options" });
  const caption = el("div", { class: "wheel-caption", "aria-live": "polite" });
  const wrap = el("div", { class: "hub-wheel" }, [scrim, pad, ring, caption, dot]);
  root.append(wrap);

  const dotsRow = el("div", { class: "wheel-pages", "aria-hidden": "true" });
  caption.after(dotsRow);
  // pages: [{ group, idx: [item indexes] }]; pos is the page being shown, fractional while a swipe is under way
  let items = [], nodes = [], pages = [], pos = 0, page = 0, openAmt = 0, isOpen = false, turn = null, bloom = null;

  function drawDot() {
    const cur = getCurrent();
    dot.innerHTML = svgIcon(cur.d);
    dot.setAttribute("aria-label", `Options (now: ${cur.label})`);
  }
  function paginate() {
    const groups = new Map();
    items.forEach((it, i) => { if (!groups.has(it.group)) groups.set(it.group, []); groups.get(it.group).push(i); });
    pages = [];
    for (const [group, idx] of groups) {
      const n = Math.ceil(idx.length / PER_PAGE);
      const size = Math.ceil(idx.length / n);   // split a long group evenly (8 tools: 4 and 4, not 6 and 2)
      for (let k = 0; k < n; k++) pages.push({ group, idx: idx.slice(k * size, (k + 1) * size) });
    }
  }
  function build() {
    items = getItems();
    nodes = items.map((it) => {
      const b = el("button", { type: "button", class: `wheel-item${it.on ? " on" : ""}`, role: "menuitem", "aria-label": it.label, tabindex: "-1" }, [
        el("span", { class: "wheel-ico" }), el("span", { class: "wheel-label" }, it.label),
      ]);
      b.querySelector(".wheel-ico").innerHTML = svgIcon(it.d);
      b.addEventListener("click", () => { if (moved) return; choose(it); });
      return b;
    });
    ring.replaceChildren(...nodes);
    paginate();
    page = clamp(page, 0, pages.length - 1); pos = page;
    dotsRow.replaceChildren(...pages.map(() => el("i")));
    drawDot();
    layout();
  }
  // the wheel folds back into the dot first, then the option runs, so a page change starts from a calm dot
  function choose(it) {
    navigator.vibrate?.(8);
    close();
    setTimeout(() => { it.run(); drawDot(); }, reduced() ? 0 : 170);
  }

  // Each page's options sit evenly on the top half of the circle; the pages are half a turn apart, so as you swipe the
  // page you're leaving turns down out of one side and the next comes up from the other.
  function layout() {
    const span = Math.max(0, openAmt);
    pages.forEach((pg, p) => {
      const n = pg.idx.length;
      pg.idx.forEach((i, j) => {
        const node = nodes[i];
        const phi = -168 + ((j + 0.5) * 156) / n + (p - pos) * 180;   // the ends stay clear of the bottom corners
        const rad = (phi * Math.PI) / 180;
        const x = Math.cos(rad) * R * span, y = Math.sin(rad) * R * span;
        const out = phi < -180 ? -180 - phi : phi > 0 ? phi : 0;
        const vis = clamp(1 - out / 40, 0, 1);
        node.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${(0.55 + 0.45 * span).toFixed(3)})`;
        node.style.opacity = (span * vis).toFixed(3);
        const live = isOpen && p === page && Math.abs(pos - page) < 0.25;
        node.style.pointerEvents = live ? "auto" : "none";
        node.tabIndex = live ? 0 : -1;
      });
    });
    const near = clamp(Math.round(pos), 0, pages.length - 1);
    caption.textContent = pages[near]?.group || "";
    [...dotsRow.children].forEach((d, i) => d.classList.toggle("on", i === near));
    const mid = 1 - Math.min(1, Math.abs(pos - near) * 2.2);   // the title fades as the page turns between groups
    caption.style.opacity = String(span * mid);
    dotsRow.style.opacity = String(span);
    scrim.style.opacity = String(span * 0.6);
  }

  // ---- open and close: a spring on how far the wheel has bloomed out of the dot
  function setOpen(want) {
    if (want !== isOpen) hubSound(want ? "open" : "close", dot.getBoundingClientRect().left + dot.offsetWidth / 2);
    isOpen = want;
    wrap.classList.toggle("open", want);
    document.documentElement.classList.toggle("wheel-open", want);
    dot.setAttribute("aria-expanded", String(want));
    bloom?.stop();
    if (want) { build(); }
    if (reduced()) { openAmt = want ? 1 : 0; layout(); return; }
    bloom = spring({ from: openAmt, to: want ? 1 : 0, damping: want ? 0.86 : 1, response: want ? 0.38 : 0.26, onUpdate: (v) => { openAmt = v; layout(); } });
    if (want) setTimeout(() => nodes[pages[page]?.idx[0]]?.focus({ preventScroll: true }), 60);
  }
  const close = () => { if (isOpen) setOpen(false); };
  dot.addEventListener("click", () => setOpen(!isOpen));
  scrim.addEventListener("click", close);
  document.addEventListener("keydown", (e) => {
    if (!isOpen || !document.body.contains(wrap)) return;
    if (e.key === "Escape") { close(); dot.focus(); }
    else if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); goTo(page + (e.key === "ArrowRight" ? 1 : -1), 0); }
  });

  // ---- swiping: sideways drags turn the page, 1:1, then exactly one page (or back) on release
  let drag = null, moved = false;
  function start(e) {
    if (!isOpen) return;
    turn?.stop();
    drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, from: pos, hist: [[pos, performance.now()]], captured: false };
    moved = false;
  }
  function move(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.sx;
    if (!drag.captured) {
      if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(e.clientY - drag.sy)) return;   // still a tap (or not sideways)
      drag.captured = true; moved = true;
      try { wrap.setPointerCapture(e.pointerId); } catch { /* gone */ }
    }
    // swiping left brings the next page in from the right; it can't go further than one page either way
    const raw = drag.from - dx / PAGE_PX;
    const lo = Math.max(0, page - 1), hi = Math.min(pages.length - 1, page + 1);
    pos = raw < lo ? lo - rubberband(lo - raw, 1) : raw > hi ? hi + rubberband(raw - hi, 1) : raw;
    drag.hist.push([pos, performance.now()]);
    if (drag.hist.length > 6) drag.hist.shift();
    layout();
  }
  function end(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag; drag = null;
    if (!d.captured) return;
    try { wrap.releasePointerCapture(e.pointerId); } catch { /* gone */ }
    const [p0, t0] = d.hist[0], [p1, t1] = d.hist[d.hist.length - 1];
    const v = t1 > t0 ? ((p1 - p0) / (t1 - t0)) * 1000 : 0;   // pages per second at release
    // a flick or a pull past a third of a page turns it; never more than one
    const dir = Math.abs(v) > 0.9 ? Math.sign(v) : Math.abs(pos - page) > 0.33 ? Math.sign(pos - page) : 0;
    goTo(page + dir, v);
    setTimeout(() => { moved = false; }, 0);
  }
  function goTo(target, velocity) {
    const next = clamp(target, 0, pages.length - 1);
    if (next !== page) { navigator.vibrate?.(4); hubSound("tick"); }
    page = next;
    turn?.stop();
    if (reduced()) { pos = page; layout(); return; }
    turn = spring({ from: pos, to: page, velocity, damping: 1, response: 0.36, onUpdate: (v) => { pos = v; layout(); } });
  }
  for (const target of [pad, ring]) target.addEventListener("pointerdown", start);
  wrap.addEventListener("pointermove", move);
  wrap.addEventListener("pointerup", end);
  wrap.addEventListener("pointercancel", end);
  pad.addEventListener("click", () => { if (!moved) close(); });

  drawDot();
  return { refresh: () => { if (isOpen) build(); else drawDot(); }, close, open: () => setOpen(true), get isOpen() { return isOpen; } };
}

// A bottom sheet you can drag down to dismiss (phone layout only): grab its top edge, it follows 1:1, resists being
// pulled up, and on release a quick flick or a long pull closes it while a small one springs it back.
export function sheetDrag(sheet, close) {
  let st = null;
  sheet.addEventListener("pointerdown", (e) => {
    if (!document.documentElement.classList.contains("m")) return;
    const r = sheet.getBoundingClientRect();
    if (e.clientY - r.top > 40 || e.target.closest("input, select, textarea")) return;
    st = { id: e.pointerId, y0: e.clientY, h: r.height, dy: 0, hist: [[0, performance.now()]], live: false };
  });
  sheet.addEventListener("pointermove", (e) => {
    if (!st || e.pointerId !== st.id) return;
    const dy = e.clientY - st.y0;
    if (!st.live) {
      if (Math.abs(dy) < 6) return;
      st.live = true;
      try { sheet.setPointerCapture(e.pointerId); } catch { /* gone */ }
      sheet.style.transition = "none";
    }
    st.dy = dy > 0 ? dy : -rubberband(-dy, st.h);
    sheet.style.transform = `translateY(${st.dy}px)`;
    st.hist.push([st.dy, performance.now()]);
    if (st.hist.length > 6) st.hist.shift();
  });
  const end = (e) => {
    if (!st || e.pointerId !== st.id) return;
    const s = st; st = null;
    if (!s.live) return;
    const [y0, t0] = s.hist[0], [y1, t1] = s.hist[s.hist.length - 1];
    const v = t1 > t0 ? ((y1 - y0) / (t1 - t0)) * 1000 : 0;
    const dismiss = s.dy + project(v, 0.99) > s.h * 0.35 || v > 900;
    const finish = () => { sheet.style.transition = ""; sheet.style.transform = ""; };
    if (reduced()) { finish(); if (dismiss) close(); return; }
    spring({ from: s.dy, to: dismiss ? s.h + 40 : 0, velocity: v, damping: 1, response: dismiss ? 0.3 : 0.35,
      onUpdate: (y) => { sheet.style.transform = `translateY(${y}px)`; },
      onDone: () => { if (dismiss) { close(); requestAnimationFrame(finish); } else finish(); } });
  };
  sheet.addEventListener("pointerup", end);
  sheet.addEventListener("pointercancel", end);
}
