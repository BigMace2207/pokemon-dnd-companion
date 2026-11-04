// A little animation for every move used in battle, after the mainline games: fireballs that burst into flame, a
// stream of water that splashes, a lightning bolt from above, leaves that spin across, rocks that fall, rings of
// psychic power, dark slashes and so on, picked by the move's type. Physical moves lunge at the target, special moves
// fly or beam across to it, status moves glow around the user. A hit makes the target flinch and blink; a miss sails
// past as it sidesteps. Each one comes with its sound (js/hubSound.js moveSound), timed to land with the hit.
//
// Everything is drawn on a throw-away overlay above the battle scene and moves with transform and opacity only
// (Web Animations), so it never touches the scene's layout and a re-render underneath can't break it. It plays once,
// when the move is used (the player's own move, or a new "used <move>" line in the Battle Log for everyone else),
// never on a poll that merely redraws. With prefers-reduced-motion only a soft type-coloured glow fades in and out at
// the target; the Low graphics setting uses fewer particles. These run up to ~1s, past the usual 0.25s rule: the user
// asked for game-style move animations (see CLAUDE.md).

import { TYPE_COLORS } from "./data.js";
import { getGfx } from "./gfx.js";
import { moveSound } from "./hubSound.js";

const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const rnd = (a, b) => a + Math.random() * (b - a);
const EASE_OUT = "cubic-bezier(.2,.8,.2,1)";
const EASE_IN = "cubic-bezier(.5,0,.9,.4)";

// the centre of a slot's sprite, relative to the stage
function centreOf(slot, stage) {
  const target = slot?.querySelector?.(".battle-sprite") || slot;
  if (!target) return null;
  const r = target.getBoundingClientRect(), s = stage.getBoundingClientRect();
  return { x: r.left - s.left + r.width / 2, y: r.top - s.top + r.height / 2, w: r.width || 96, cx: r.left + r.width / 2, sprite: slot?.querySelector?.(".battle-sprite") || null };
}

/**
 * Play a move's animation and sound on the battle stage.
 * stage: the positioned element around the scene. from: the user's slot element; to: the targets' slot elements.
 * Returns { hitAt } (seconds until it lands) and a `done` promise for when the overlay is gone.
 */
export function playMoveFx(stage, { move, from, to = [], missed = false }) {
  const type = move?.type || "Normal", category = move?.category || "Physical";
  const a = centreOf(from, stage);
  const targets = (to.length ? to : category === "Status" ? [from] : []).map((t) => centreOf(t, stage)).filter(Boolean);
  const b = targets[0] || a;
  if (!a && !b) return { hitAt: 0, done: Promise.resolve() };
  const origin = a || b;
  const color = TYPE_COLORS[type] || "#e4e4e7";
  const status = category === "Status";
  const hitAt = reduced() ? 0.25 : status ? 0.35 : category === "Physical" ? 0.3 : type === "Electric" ? 0.25 : 0.5;
  moveSound(type, { category, hitAt, missed, x: origin.cx, tx: b?.cx });

  const layer = document.createElement("div");
  layer.className = "move-fx";
  layer.setAttribute("aria-hidden", "true");
  stage.append(layer);
  const anims = [];
  const k = Math.max(0.6, Math.min(1.6, (b?.w || 96) / 96));   // particle sizes follow the sprites' size
  const many = (n) => (n > 0 ? Math.max(1, Math.round(n * (getGfx() === "low" ? 0.5 : 1))) : 0);

  const dot = (x, y, size, style = {}) => {
    const d = document.createElement("span");
    d.className = "move-fx-p";
    Object.assign(d.style, { left: `${x - size / 2}px`, top: `${y - size / 2}px`, width: `${size}px`, height: `${size}px`, ...style });
    layer.append(d);
    return d;
  };
  const run = (node, frames, opts) => { const an = node.animate(frames, { fill: "both", ...opts }); anims.push(an.finished.catch(() => {})); return an; };

  if (reduced()) {
    for (const t of targets.length ? targets : [origin]) {
      run(dot(t.x, t.y, 110 * k, { background: `radial-gradient(circle, ${color}cc, transparent 70%)` }), [{ opacity: 0 }, { opacity: missed ? 0.3 : 0.8 }, { opacity: 0 }], { duration: 600, easing: "ease-in-out" });
    }
    return finish();
  }

  // ---- the pieces every recipe is built from
  const orb = (p, size, c = color, glow = true) => dot(p.x, p.y, size * k, { background: `radial-gradient(circle at 35% 35%, #fff, ${c} 45%, ${c}00 72%)`, ...(glow ? { boxShadow: `0 0 ${14 * k}px ${c}` } : {}), borderRadius: "50%" });
  // a particle flying from p to q (a bit of arc), starting after `delay` ms
  const fly = (node, p, q, { dur = hitAt * 1000, delay = 0, arc = 0, spin = 0, s0 = 0.6, s1 = 1, overshoot = missed } = {}) => {
    const dx = q.x - p.x, dy = q.y - p.y;
    const ex = overshoot ? dx * 1.6 : dx, ey = overshoot ? dy * 1.6 - 30 : dy;
    return run(node, [
      { transform: `translate(0px,0px) scale(${s0}) rotate(0deg)`, opacity: 0 },
      { transform: `translate(${dx * 0.5}px,${dy * 0.5 - arc}px) scale(${(s0 + s1) / 2}) rotate(${spin / 2}deg)`, opacity: 1, offset: 0.5 },
      { transform: `translate(${ex}px,${ey}px) scale(${s1}) rotate(${spin}deg)`, opacity: overshoot ? 0 : 1 },
    ], { duration: dur, delay, easing: "linear" });
  };
  // particles thrown outwards from p
  const burstAt = (p, n, { c = color, size = 10, dist = 46, dur = 520, delay = hitAt * 1000, shape = "round", up = 0 } = {}) => {
    for (let i = 0; i < many(n); i++) {
      const ang = (i / n) * Math.PI * 2 + rnd(-0.3, 0.3), r = dist * k * rnd(0.6, 1.1);
      const node = dot(p.x, p.y, size * k * rnd(0.7, 1.2), { background: c, borderRadius: shape === "round" ? "50%" : shape === "diamond" ? "2px" : "40% 0", boxShadow: `0 0 ${6 * k}px ${c}` });
      const rot = shape === "round" ? 0 : rnd(-180, 180);
      run(node, [
        { transform: `translate(0,0) scale(.4) rotate(45deg)`, opacity: 1 },
        { transform: `translate(${Math.cos(ang) * r}px,${Math.sin(ang) * r - up * k}px) scale(1) rotate(${45 + rot}deg)`, opacity: 0 },
      ], { duration: dur * rnd(0.8, 1.15), delay, easing: EASE_OUT });
    }
  };
  // particles rising up from around p (flames, bubbles, sparkles)
  const riseAt = (p, n, { c = color, size = 12, height = 60, dur = 650, delay = hitAt * 1000, spread = 40, shape = "round" } = {}) => {
    for (let i = 0; i < many(n); i++) {
      const x = p.x + rnd(-spread, spread) * k, y = p.y + rnd(0, 26) * k;
      const node = dot(x, y, size * k * rnd(0.7, 1.3), { background: shape === "flame" ? `radial-gradient(circle at 50% 70%, #fff7c2, ${c} 50%, ${c}00 75%)` : shape === "bubble" ? `radial-gradient(circle at 35% 35%, #ffffffaa, ${c}88 60%, ${c})` : c, borderRadius: shape === "flame" ? "50% 50% 40% 40%" : "50%", boxShadow: shape === "bubble" ? "none" : `0 0 ${8 * k}px ${c}` });
      run(node, [
        { transform: "translate(0,0) scale(.5)", opacity: 0 },
        { transform: `translate(${rnd(-6, 6)}px,${-height * 0.4 * k}px) scale(1)`, opacity: 1, offset: 0.3 },
        { transform: `translate(${rnd(-10, 10)}px,${-height * k}px) scale(.3)`, opacity: 0 },
      ], { duration: dur * rnd(0.8, 1.2), delay: delay + rnd(0, 260), easing: "ease-out" });
    }
  };
  const ring = (p, { c = color, size = 70, dur = 600, delay = hitAt * 1000, s0 = 0.2, s1 = 1.6, width = 3 } = {}) =>
    run(dot(p.x, p.y, size * k, { border: `${width * k}px solid ${c}`, borderRadius: "50%", boxShadow: `0 0 ${12 * k}px ${c}, inset 0 0 ${10 * k}px ${c}` }),
      [{ transform: `scale(${s0})`, opacity: 0.95 }, { transform: `scale(${s1})`, opacity: 0 }], { duration: dur, delay, easing: EASE_OUT });
  const flash = (c, peak = 0.35, delay = hitAt * 1000, dur = 380) =>
    run(dot(0, 0, 0, { left: "0", top: "0", width: "100%", height: "100%", background: c, borderRadius: "0" }), [{ opacity: 0 }, { opacity: peak, offset: 0.25 }, { opacity: 0 }], { duration: dur, delay, easing: "ease-out" });
  // thin streaks across p (claws, wind, glints): angle in degrees
  const slashes = (p, n, { c = "#fff", angle = -35, len = 90, delay = hitAt * 1000, gap = 70 } = {}) => {
    for (let i = 0; i < n; i++) {
      const node = dot(p.x, p.y + (i - (n - 1) / 2) * 14 * k, 0, { width: `${len * k}px`, height: `${3 * k}px`, marginLeft: `${-len * k / 2}px`, background: `linear-gradient(90deg, transparent, ${c}, transparent)`, boxShadow: `0 0 ${8 * k}px ${c}`, borderRadius: "2px" });
      run(node, [
        { transform: `rotate(${angle}deg) scaleX(0)`, opacity: 1 },
        { transform: `rotate(${angle}deg) scaleX(1)`, opacity: 1, offset: 0.5 },
        { transform: `rotate(${angle}deg) scaleX(1.1)`, opacity: 0 },
      ], { duration: 360, delay: delay + i * gap, easing: EASE_OUT });
    }
  };
  // a beam from p to q that grows out of p, then thins away
  const beam = (p, q, { c = color, thick = 14, dur = hitAt * 1000 + 300 } = {}) => {
    const dx = q.x - p.x, dy = q.y - p.y, len = Math.hypot(dx, dy) * (missed ? 1.4 : 1), ang = Math.atan2(dy, dx) * 180 / Math.PI;
    const node = dot(p.x, p.y, 0, { width: `${len}px`, height: `${thick * k}px`, marginTop: `${-thick * k / 2}px`, transformOrigin: "0 50%", background: `linear-gradient(90deg, ${c}00, #fff 20%, ${c} 60%, ${c}cc)`, borderRadius: "99px", boxShadow: `0 0 ${16 * k}px ${c}` });
    run(node, [
      { transform: `rotate(${ang}deg) scale(0, 1)`, opacity: 1 },
      { transform: `rotate(${ang}deg) scale(1, 1)`, opacity: 1, offset: (hitAt * 1000) / dur },
      { transform: `rotate(${ang}deg) scale(1, 0.1)`, opacity: 0 },
    ], { duration: dur, easing: EASE_OUT });
  };
  // a jagged lightning bolt dropping onto p from above the scene
  const bolt = (p, delay = 0) => {
    const h = Math.max(60, p.y + 10), w = 60 * k;
    const pts = []; let x = w / 2;
    for (let i = 0; i <= 7; i++) { pts.push(`${x.toFixed(1)},${(h * i / 7).toFixed(1)}`); x = w / 2 + rnd(-w / 2.2, w / 2.2); }
    pts[pts.length - 1] = `${w / 2},${h}`;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", String(w)); svg.setAttribute("height", String(h)); svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    svg.classList.add("move-fx-p");
    Object.assign(svg.style, { left: `${p.x - w / 2}px`, top: `${p.y - h}px`, overflow: "visible", filter: "none" });
    for (const [sw, stroke] of [[9 * k, "#facc1566"], [4 * k, "#fde047"], [1.6 * k, "#fff"]]) {
      const pl = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
      pl.setAttribute("points", pts.join(" ")); pl.setAttribute("fill", "none"); pl.setAttribute("stroke", stroke); pl.setAttribute("stroke-width", String(sw)); pl.setAttribute("stroke-linejoin", "round");
      svg.append(pl);
    }
    layer.append(svg);
    run(svg, [{ opacity: 0 }, { opacity: 1, offset: 0.1 }, { opacity: 0.2, offset: 0.3 }, { opacity: 1, offset: 0.45 }, { opacity: 0 }], { duration: 420, delay, easing: "linear" });
  };
  const lunge = () => {
    const sp = a?.sprite; if (!sp || !b || from === to[0]) return;
    const dx = (b.x - a.x) * 0.35, dy = (b.y - a.y) * 0.35;
    run(sp, [{ transform: "translate(0,0)" }, { transform: `translate(${dx}px,${dy}px)`, offset: 0.45 }, { transform: "translate(0,0)" }], { duration: hitAt * 1000 * 2, easing: "ease-in-out", fill: "none" });
  };
  const sceneShake = (delay = hitAt * 1000) => run(layer.parentElement.querySelector(".battle-scene") || layer, [
    { transform: "translate(0,0)" }, { transform: "translate(-6px,2px)" }, { transform: "translate(5px,-2px)" }, { transform: "translate(-4px,1px)" }, { transform: "translate(3px,0)" }, { transform: "translate(0,0)" },
  ], { duration: 480, delay, easing: "linear", fill: "none" });

  // ---- the recipes, by type
  const phys = category === "Physical";
  if (phys) lunge();
  const projectiles = (n, make, opts = {}) => { for (const t of targets) for (let i = 0; i < many(n); i++) fly(make(origin), origin, t, { delay: i * (opts.gap ?? 45), dur: hitAt * 1000 - Math.min(i * (opts.gap ?? 45), hitAt * 600), ...opts }); };

  if (status) {
    const at = targets[0] || origin;
    ring(at, { delay: 0, dur: 700 }); ring(at, { delay: 160, dur: 700 });
    riseAt(at, type === "Fairy" || type === "Psychic" ? 10 : 7, { delay: 120, shape: type === "Poison" ? "bubble" : "round", size: 8 });
    if (type === "Dark" || type === "Ghost") flash("#000", 0.3, 0, 600);
  } else switch (type) {
    case "Fire":
      if (!phys) projectiles(5, (p) => orb(p, 26, "#fb923c"), { gap: 60, arc: 20 });
      for (const t of targets) { riseAt(t, 14, { c: "#f97316", shape: "flame", size: 22, height: 80 }); burstAt(t, 8, { c: "#fde047", size: 6, dist: 50 }); }
      break;
    case "Water":
      if (!phys) projectiles(10, (p) => orb(p, 16, "#60a5fa", false), { gap: 30, arc: 10 });
      for (const t of targets) { burstAt(t, 14, { c: "#93c5fd", size: 9, dist: 58, up: 20 }); ring(t, { c: "#bfdbfe", size: 60, width: 2 }); }
      break;
    case "Electric":
      for (const t of targets) { bolt(t, 0); bolt(t, 140); burstAt(t, 10, { c: "#fde047", size: 5, dist: 56, shape: "diamond" }); }
      flash("#fde047", 0.28, 0);
      break;
    case "Grass":
      projectiles(phys ? 0 : 8, (p) => dot(p.x, p.y, 16 * k, { background: "linear-gradient(135deg, #86efac, #16a34a)", borderRadius: "0 80% 0 80%" }), { gap: 40, spin: 540, arc: 30, s0: 1 });
      for (const t of targets) burstAt(t, 10, { c: "#4ade80", size: 10, shape: "leaf", dist: 52 });
      break;
    case "Ice":
      if (!phys) for (const t of targets) beam(origin, t, { c: "#a5f3fc", thick: 12 });
      for (const t of targets) { burstAt(t, 12, { c: "#cffafe", size: 10, shape: "diamond", dist: 50 }); ring(t, { c: "#a5f3fc", size: 64 }); }
      break;
    case "Fighting":
      for (const t of targets) for (let i = 0; i < 3; i++) burstAt({ x: t.x + rnd(-18, 18) * k, y: t.y + rnd(-18, 18) * k }, 8, { c: i % 2 ? "#fdba74" : "#fff", size: 7, dist: 34, delay: hitAt * 1000 + i * 110, dur: 320 });
      break;
    case "Poison":
      if (!phys) projectiles(4, (p) => orb(p, 22, "#a855f7"), { gap: 70, arc: 50 });
      for (const t of targets) riseAt(t, 12, { c: "#c084fc", shape: "bubble", size: 14, height: 56 });
      break;
    case "Ground":
      sceneShake();
      for (const t of targets) riseAt({ x: t.x, y: t.y + 24 * k }, 14, { c: "#a16207", size: 10, height: 70, spread: 50 });
      break;
    case "Rock":
      for (const t of targets) for (let i = 0; i < many(5); i++) {
        const x = t.x + rnd(-30, 30) * k, node = dot(x, t.y, rnd(14, 24) * k, { background: "linear-gradient(135deg, #d6d3d1, #78716c)", borderRadius: "30% 45% 35% 50%" });
        run(node, [{ transform: `translate(0,${-t.y - 30}px) rotate(0deg)`, opacity: 1 }, { transform: `translate(0,${missed ? 40 : 0}px) rotate(${rnd(-90, 90)}deg)`, opacity: 1, offset: 0.8 }, { transform: `translate(0,${missed ? 50 : 6}px) rotate(${rnd(-90, 90)}deg)`, opacity: 0 }], { duration: hitAt * 1000 + 260, delay: i * 70, easing: EASE_IN });
      }
      if (!missed) sceneShake(hitAt * 1000 + 120);
      break;
    case "Flying":
      for (const t of targets) slashes(t, 3, { c: "#e0f2fe", angle: -8, len: 150, gap: 50 });
      break;
    case "Psychic":
      for (const t of targets) for (let i = 0; i < 3; i++) ring(t, { c: "#f472b6", size: 90, s0: 1.6, s1: 0.2, delay: i * 140, dur: 520 });
      flash("#f472b6", 0.18, 0, 600);
      break;
    case "Ghost":
      if (!phys) projectiles(1, (p) => orb(p, 44, "#7c3aed"), { arc: 10 });
      for (const t of targets) { ring(t, { c: "#a78bfa", size: 80 }); riseAt(t, 6, { c: "#4c1d95", size: 18, height: 50 }); }
      break;
    case "Dark":
      flash("#000", 0.4, 0, hitAt * 1000 + 300);
      for (const t of targets) { slashes(t, 2, { c: "#a78bfa", angle: -40, len: 110 }); slashes(t, 1, { c: "#a78bfa", angle: 40, len: 110, delay: hitAt * 1000 + 140 }); }
      break;
    case "Bug":
      projectiles(phys ? 0 : 12, (p) => dot(p.x + rnd(-10, 10), p.y + rnd(-10, 10), 6 * k, { background: "#a3e635", borderRadius: "50%", boxShadow: `0 0 ${5 * k}px #a3e635` }), { gap: 25, arc: 40 });
      if (phys) for (const t of targets) slashes(t, 2, { c: "#bef264", angle: -45, len: 80 });
      for (const t of targets) burstAt(t, 8, { c: "#bef264", size: 5, dist: 40 });
      break;
    case "Dragon":
      if (!phys) for (const t of targets) beam(origin, t, { c: "#818cf8", thick: 18 });
      for (const t of targets) { ring(t, { c: "#6366f1", size: 70 }); ring(t, { c: "#c4b5fd", size: 50, delay: hitAt * 1000 + 120 }); burstAt(t, 10, { c: "#a5b4fc", size: 7, dist: 54 }); }
      break;
    case "Steel":
      if (!phys) projectiles(3, (p) => dot(p.x, p.y, 18 * k, { background: "linear-gradient(135deg, #f8fafc, #94a3b8)", borderRadius: "3px" }), { gap: 60, spin: 720 });
      for (const t of targets) { burstAt(t, 8, { c: "#e2e8f0", size: 8, shape: "diamond", dist: 44 }); slashes(t, 2, { c: "#f8fafc", angle: 30, len: 70, gap: 90 }); }
      break;
    case "Fairy":
      if (!phys) projectiles(6, (p) => orb(p, 14, "#f9a8d4"), { gap: 45, arc: 35 });
      for (const t of targets) { burstAt(t, 12, { c: "#fbcfe8", size: 8, shape: "diamond", dist: 56 }); riseAt(t, 8, { c: "#fce7f3", size: 6, height: 60 }); }
      break;
    default:   // Normal and anything else: an impact star (a white energy orb first for a special move)
      if (!phys) projectiles(1, (p) => orb(p, 30, "#f4f4f5"));
      for (const t of targets) { burstAt(t, 10, { c: "#fff", size: 8, dist: 40, dur: 360 }); ring(t, { c: "#fff", size: 50, dur: 360 }); }
  }

  // ---- how the target takes it
  for (const t of status ? [] : targets) {
    if (!t.sprite) continue;
    if (missed) run(t.sprite, [{ transform: "translateX(0)" }, { transform: "translateX(18px)", offset: 0.4 }, { transform: "translateX(0)" }], { duration: 520, delay: hitAt * 800, easing: "ease-in-out", fill: "none" });
    else run(t.sprite, [
      { transform: "translateX(0)", opacity: 1 }, { transform: "translateX(-7px)", opacity: 0.25 }, { transform: "translateX(6px)", opacity: 1 },
      { transform: "translateX(-4px)", opacity: 0.25 }, { transform: "translateX(2px)", opacity: 1 }, { transform: "translateX(0)", opacity: 1 },
    ], { duration: 460, delay: hitAt * 1000, easing: "linear", fill: "none" });
  }
  return finish();

  function finish() {
    const done = Promise.all(anims).then(() => layer.remove());
    setTimeout(() => layer.remove(), 2500);   // a safety net if an animation never reports back
    return { hitAt, done };
  }
}

// ------------------------------------------------------------------ reading the Battle Log
// "<who> used <Move> on <target> for ...", "<who> used <Move> — MISSED ...", "<who> used <Move> (status move ...)":
// the lines both the players' screen and the DM's console write. Labels come as "Ash's Pikachu" or "Ash: Pikachu".
/**
 * Work out which move a log line is about, who used it and who it hit.
 * labelsOf(c) gives the names a combatant can appear under. Returns null for anything that isn't a move.
 */
export function parseMoveLine(text, combatants, moveNames, labelsOf) {
  const i = String(text || "").indexOf(" used ");
  if (i < 0) return null;
  const who = text.slice(0, i), rest = text.slice(i + 6);
  let moveName = null;
  for (const n of moveNames) if (rest.startsWith(n) && (rest.length === n.length || /^[\s—(.,!:;-]/.test(rest.slice(n.length))) && (!moveName || n.length > moveName.length)) moveName = n;
  if (!moveName) return null;
  const bestMatch = (str, pred) => {
    let best = null, bestLen = 0;
    for (const c of combatants) for (const l of labelsOf(c)) if (l && pred(str, l) && l.length > bestLen) { best = c; bestLen = l.length; }
    return best;
  };
  const attacker = bestMatch(who, (s, l) => s === l || s.startsWith(`${l} (`));
  const after = rest.slice(moveName.length);
  const targets = combatants.filter((c) => c !== attacker && labelsOf(c).some((l) => l && after.includes(l)));
  return { moveName, attacker, targets, missed: /MISSED/.test(after), status: /status move/.test(after) };
}
