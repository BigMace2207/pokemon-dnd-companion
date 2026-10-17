// The Lava Tower's cylindrical background: a real rotating cylinder, drawn with a small WebGL shader.
//
// The page background is the outside wall of a round stone tower, seen from close up. Each pixel
// is mapped onto a cylinder (so bricks bend away and squash toward the left and right edges, and
// the wall darkens as it turns from the camera), textured with procedurally painted worn bricks and
// glowing lava cracks. Scrolling spins the tower and lowers the camera; the fire at the foot of the
// wall lights it more strongly the deeper you go. Even when idle it turns very slowly.
//
// No image files: both textures are painted on 2D canvases at start-up. If WebGL isn't available,
// start() returns false and css/lava.css's flat parallax wall is used instead.

import { createDebris } from "./lavaDebris.js";

let BRICK_W = 4096, BRICK_H = 512;          // doubled to 8192 x 1024 when the GPU allows it
const BRICKS_AROUND = 28, COURSES = 8;
const CRACK_W = 2048, CRACK_H = 1024;
const TAU = Math.PI * 2;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- textures -----------------------------------------------------------------------------

// Cel-shaded stone bricks: every brick is built from flat bands of tone (no gradients) -- a base
// colour, a lit top and left bevel, a shaded bottom and right bevel, flat mottled patches, a few hatch
// strokes in the shadow, chips and cracks -- all inside a hard ink outline. 8 staggered courses; the
// pattern wraps seamlessly round the circumference.
const TONES = [[140, 122, 104], [126, 108, 92], [150, 130, 108], [134, 112, 90], [144, 131, 114], [121, 104, 90], [136, 117, 96]];
const INK = "#0d0807";
const rgb = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;
const tone = (c, d) => c.map((v, i) => Math.max(0, Math.min(255, Math.round(v + d * (i === 2 ? 0.8 : 1)))));

function blobPath(g, cx, cy, rx, ry, pts, rnd) {
  g.beginPath();
  for (let i = 0; i < pts; i++) {
    const a = (i / pts) * TAU, k = 0.65 + rnd() * 0.5;
    const x = cx + Math.cos(a) * rx * k, y = cy + Math.sin(a) * ry * k;
    if (i) g.lineTo(x, y); else g.moveTo(x, y);
  }
  g.closePath();
}

function brickParams(rnd) {
  const base = TONES[Math.floor(rnd() * TONES.length)];
  return {
    base,
    jit: Array.from({ length: 8 }, () => rnd()),
    lightAmt: 24 + rnd() * 12, darkAmt: -(32 + rnd() * 12),
    blobs: Array.from({ length: 2 + Math.floor(rnd() * 3) }, () => ({ cx: rnd(), cy: rnd(), rx: 0.1 + rnd() * 0.18, ry: 0.15 + rnd() * 0.3, shift: rnd() < 0.5 ? 11 + rnd() * 8 : -(12 + rnd() * 10), seed: rnd() * 1e6 })),
    hatch: Array.from({ length: 3 + Math.floor(rnd() * 3) }, () => ({ x: 0.5 + rnd() * 0.45, y: 0.55 + rnd() * 0.4, len: 0.1 + rnd() * 0.12 })),
    chip: rnd() < 0.45 ? { right: rnd() < 0.5, bottom: rnd() < 0.5, w: 0.05 + rnd() * 0.08, h: 0.2 + rnd() * 0.3 } : null,
    crack: rnd() < 0.3 ? { x: 0.2 + rnd() * 0.6, seed: rnd() * 1e6 } : null,
    pits: Array.from({ length: 2 + Math.floor(rnd() * 3) }, () => ({ x: rnd(), y: rnd(), r: 0.012 + rnd() * 0.02 })),
  };
}

function drawBrick(g, x, y, w, h, P, S) {
  const j = P.jit.map((v) => v * 3.2 * S);
  const quad = () => { g.beginPath(); g.moveTo(x + j[0], y + j[1]); g.lineTo(x + w - j[2], y + j[3]); g.lineTo(x + w - j[4], y + h - j[5]); g.lineTo(x + j[6], y + h - j[7]); g.closePath(); };
  const base = P.base, light = tone(base, P.lightAmt), dark = tone(base, P.darkAmt), deep = tone(base, P.darkAmt * 1.7);
  g.save();
  quad();
  g.fillStyle = rgb(base); g.fill();
  g.clip();
  // flat mottled patches (hard edges, one step lighter or darker than the brick)
  for (const b of P.blobs) {
    const r = mulberry32(b.seed | 0);
    blobPath(g, x + b.cx * w, y + b.cy * h, b.rx * w, b.ry * h, 7, r);
    g.fillStyle = rgb(tone(base, b.shift)); g.fill();
  }
  const t = h * 0.17, side = w * 0.075;
  // lit bevel: top and left
  g.fillStyle = rgb(light);
  g.beginPath(); g.moveTo(x, y); g.lineTo(x + w, y); g.lineTo(x + w - t, y + t); g.lineTo(x + side, y + t); g.lineTo(x, y + h * 0.3); g.closePath(); g.fill();
  g.fillStyle = rgb(tone(base, P.lightAmt * 0.55));
  g.beginPath(); g.moveTo(x, y + h * 0.3); g.lineTo(x + side, y + t); g.lineTo(x + side, y + h * 0.8); g.lineTo(x, y + h); g.closePath(); g.fill();
  // shaded bevel: bottom and right
  g.fillStyle = rgb(dark);
  g.beginPath(); g.moveTo(x, y + h); g.lineTo(x + h * 0.22, y + h * 0.78); g.lineTo(x + w - side * 1.1, y + h * 0.78); g.lineTo(x + w, y + h * 0.62); g.lineTo(x + w, y + h); g.closePath(); g.fill();
  g.beginPath(); g.moveTo(x + w, y + t); g.lineTo(x + w, y + h); g.lineTo(x + w - side * 1.1, y + h * 0.78); g.lineTo(x + w - side * 1.1, y + t * 1.6); g.closePath(); g.fill();
  g.fillStyle = rgb(deep);
  g.beginPath(); g.moveTo(x + w, y + h * 0.7); g.lineTo(x + w, y + h); g.lineTo(x + w * 0.82, y + h); g.lineTo(x + w - side * 1.1, y + h * 0.88); g.closePath(); g.fill();
  // hatching in the shadow, the way an inker would
  g.strokeStyle = "rgba(13,8,7,.45)"; g.lineWidth = 1.6 * S; g.lineCap = "round";
  for (const k of P.hatch) { g.beginPath(); g.moveTo(x + k.x * w, y + k.y * h); g.lineTo(x + k.x * w - k.len * h * 0.8, y + k.y * h + k.len * h); g.stroke(); }
  // pits
  g.fillStyle = "rgba(13,8,7,.5)";
  for (const p of P.pits) { g.beginPath(); g.arc(x + p.x * w, y + p.y * h, p.r * h * 2.2, 0, TAU); g.fill(); }
  // chipped corner: a flat dark notch with a lit lip
  if (P.chip) {
    const c = P.chip, cw = c.w * w, ch = c.h * h;
    const cx = c.right ? x + w - cw : x, cy = c.bottom ? y + h - ch : y;
    g.fillStyle = "#1b1411";
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + cw, cy); g.lineTo(c.right ? cx : cx + cw, cy + ch); g.closePath(); g.fill();
    g.strokeStyle = rgb(light); g.lineWidth = 1.8 * S;
    g.beginPath(); g.moveTo(cx + (c.right ? 0 : cw), cy + ch); g.lineTo(c.right ? cx : cx + cw, cy); g.stroke();
  }
  // hairline crack: ink line with a light edge beside it
  if (P.crack) {
    const r = mulberry32(P.crack.seed | 0);
    let cx = x + P.crack.x * w, cy = y;
    const pts = [[cx, cy]];
    while (cy < y + h * 0.95) { cy += (4 + r() * 6) * S; cx += (r() - 0.5) * 9 * S; pts.push([cx, cy]); }
    g.strokeStyle = "rgba(255,235,210,.28)"; g.lineWidth = 2.2 * S;
    g.beginPath(); pts.forEach(([px, py], i) => (i ? g.lineTo(px + 2.4 * S, py) : g.moveTo(px + 2.4 * S, py))); g.stroke();
    g.strokeStyle = INK; g.lineWidth = 1.8 * S;
    g.beginPath(); pts.forEach(([px, py], i) => (i ? g.lineTo(px, py) : g.moveTo(px, py))); g.stroke();
  }
  // a crisp highlight glint on the top-left
  g.fillStyle = "rgba(255,244,225,.4)";
  g.fillRect(x + w * 0.1, y + h * 0.055, w * 0.2, h * 0.04);
  g.restore();
  // ink outline
  quad();
  g.strokeStyle = INK; g.lineWidth = 3.4 * S; g.lineJoin = "round"; g.stroke();
}

function paintBricks() {
  const c = document.createElement("canvas");
  c.width = BRICK_W; c.height = BRICK_H;
  const g = c.getContext("2d");
  const S = BRICK_W / 4096 * 1.25;
  const rnd = mulberry32(2112);
  const bw = BRICK_W / BRICKS_AROUND, rh = BRICK_H / COURSES, gap = 5 * S;
  g.fillStyle = "#1b1411";
  g.fillRect(0, 0, BRICK_W, BRICK_H);
  for (let r = 0; r < COURSES; r++) {
    const off = r % 2 ? bw / 2 : 0;
    for (let i = -1; i <= BRICKS_AROUND; i++) {
      const P = brickParams(rnd);
      const x = i * bw + off, y = r * rh;
      for (const dx of [0, BRICK_W, -BRICK_W]) {
        if (x + dx > BRICK_W || x + dx + bw < 0) continue;
        drawBrick(g, x + dx + gap / 2, y + gap / 2, bw - gap, rh - gap, P, S);
      }
    }
  }
  // big flat patches of grime and weathering across several bricks at once
  for (let n = 0; n < 26; n++) {
    const cx = rnd() * BRICK_W, cy = rnd() * BRICK_H, rx = (80 + rnd() * 260) * S, ry = (40 + rnd() * 140) * S;
    const dark = rnd() < 0.75, seed = rnd() * 1e6;
    for (const dx of [0, BRICK_W, -BRICK_W]) {
      blobPath(g, cx + dx, cy, rx, ry, 9, mulberry32(seed | 0));
      g.fillStyle = dark ? "rgba(22,10,5,.13)" : "rgba(255,205,150,.06)";
      g.fill();
    }
  }
  return c;
}

// Emissive map: glowing cracks over black, added on top of the lit bricks by the shader.
function paintCracks() {
  const c = document.createElement("canvas");
  c.width = CRACK_W; c.height = CRACK_H;
  const g = c.getContext("2d");
  g.fillStyle = "#000"; g.fillRect(0, 0, CRACK_W, CRACK_H);
  g.globalCompositeOperation = "lighter";
  g.lineCap = "round"; g.lineJoin = "round";
  const rnd = mulberry32(666);
  function walk(x, y, ang, len, depth, out) {
    const pts = [[x, y]];
    let walked = 0;
    while (walked < len) {
      const step = 5 + rnd() * 9;
      ang += (rnd() - 0.5) * 1.5;
      x += Math.cos(ang) * step; y += Math.sin(ang) * step; walked += step;
      pts.push([x, y]);
      if (depth < 2 && rnd() < 0.12 && walked > 20) walk(x, y, ang + (rnd() < 0.5 ? -1 : 1) * (0.5 + rnd() * 0.6), (len - walked) * (0.35 + rnd() * 0.3) + 14, depth + 1, out);
    }
    out.push(pts);
  }
  const paths = [];
  for (let i = 0; i < 40; i++) walk(rnd() * CRACK_W, rnd() * CRACK_H, Math.PI / 2 + (rnd() - 0.5) * 1.2, 90 + rnd() * 220, 0, paths);
  const stroke = (style, width, blur) => {
    g.strokeStyle = style; g.lineWidth = width; g.shadowColor = style; g.shadowBlur = blur;
    for (const pts of paths) for (const dx of [0, CRACK_W, -CRACK_W]) {
      g.beginPath();
      pts.forEach(([px, py], i) => (i ? g.lineTo(px + dx, py) : g.moveTo(px + dx, py)));
      g.stroke();
    }
  };
  stroke("rgba(255,34,8,.55)", 6, 9);
  stroke("rgba(255,68,22,.95)", 2.2, 3);
  stroke("rgba(255,196,160,1)", 0.9, 0);
  return c;
}

// ---- shader -------------------------------------------------------------------------------

const VERT = "attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }";
const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 uRes;
uniform float uR, uRot, uDepth, uTime, uBrickH, uFloorH, uCam;
uniform vec2 uShake;
uniform sampler2D uBrick, uCrack;

const float TAU = 6.2831853;
const vec3 INKC = vec3(0.04, 0.025, 0.02);

// hard-edged (cel) steps instead of smooth gradients
float cel(float v, float n) { float s = v * n; float f = floor(s); return (f + smoothstep(0.44, 0.56, fract(s))) / n; }
float hash21(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

// signed distance to an arched window opening (negative inside); p is in px from its centre, y down
float winSdf(vec2 p, float hw, float hh) {
  float archC = -hh + hw;
  return p.y < archC ? length(vec2(p.x, p.y - archC)) - hw : max(abs(p.x) - hw, p.y - hh);
}

// A deep-set arched opening, built from the surface outwards: you see into its inner side wall and ceiling
// (we look up at the tower from off to one side), a bevelled stone surround, a keystone, a projecting sill and
// the shadows they cast. p is relative to the window's centre in px; kk scales the small details.
vec3 archWindow(vec3 col, vec2 p, float hw, float hh, float fw, float depthPx, float sgn, float ax, float shade, float on, float flick, float facing, float kk) {
  float ink = 2.0 * kk;
  float rv = depthPx * (0.36 + 0.64 * ax);
  float rvv = depthPx * 0.46;
  float d = winSdf(p, hw, hh);
  float d2 = winSdf(vec2(p.x + sgn * rv, p.y - rvv), hw, hh);
  float dCeil = winSdf(vec2(p.x, p.y - rvv), hw, hh);
  vec3 stoneLit = vec3(0.68, 0.6, 0.5) * shade;
  vec3 stoneMid = vec3(0.5, 0.43, 0.36) * shade;
  vec3 stoneDark = vec3(0.3, 0.25, 0.21) * shade;
  float sillHalf = hw + fw + 8.0 * kk;
  float sillTop = hh + fw - 2.0 * kk;
  col += vec3(1.0, 0.2, 0.04) * exp(-max(d, 0.0) / (34.0 * kk)) * 0.2 * on * flick * facing * step(0.0, d);
  float shd = winSdf(vec2(p.x - 8.0 * kk, p.y - 10.0 * kk), hw + fw, hh + fw);
  if (shd < 0.0 && d > fw) col *= 0.45;
  if (abs(p.x) < sillHalf + 6.0 * kk && p.y > sillTop + 11.0 * kk && p.y < sillTop + 26.0 * kk) col *= 0.58;
  if (abs(p.x) < sillHalf && p.y > sillTop && p.y < sillTop + 11.0 * kk) {
    col = p.y < sillTop + 3.5 * kk ? stoneLit * 1.08 : (p.y < sillTop + 9.3 * kk ? stoneMid * 0.85 : INKC);
  }
  if (d > 0.0 && d < fw) {
    bool upperLeft = (-p.x - p.y) > 0.0;
    col = d < fw * 0.42 ? (upperLeft ? stoneDark : stoneLit) : (upperLeft ? stoneLit * 1.05 : stoneMid);
    if (p.y < -hh + hw * 0.2 && abs(p.x) < 6.5 * kk) col = abs(abs(p.x) - 6.5 * kk) < 0.9 * kk ? INKC : stoneLit * 1.12;
  } else if (d >= fw && d < fw + ink) {
    col = INKC;
  } else if (d <= 0.0) {
    if (d > -ink) {
      col = INKC;
    } else if (d2 >= 0.0) {
      vec3 wall = (dCeil >= 0.0 ? stoneDark * 0.5 : stoneMid * 0.7);
      float nearGlow = cel(exp(-d2 / (11.0 * kk)), 3.0);
      wall = wall * (0.7 + 0.5 * nearGlow) + vec3(0.95, 0.2, 0.04) * 0.38 * nearGlow * on * flick;
      col = d2 < ink * 0.9 ? INKC : wall;
    } else {
      float gy = clamp((p.y + hh) / (2.0 * hh), 0.0, 1.0);
      float g = cel(on * flick * (0.35 + 0.65 * pow(gy, 0.9)), 3.0);
      vec3 deep = mix(vec3(0.05, 0.02, 0.02), vec3(1.0, 0.24, 0.05), g) * facing;
      float bx = abs(p.x + sgn * rv * 0.5), by = abs(p.y - rvv * 0.5 + hh * 0.12);
      float bar = step(bx, 1.7 * kk) + step(by, 1.7 * kk);
      col = bar > 0.5 ? mix(INKC, stoneDark, 0.6) : deep;
    }
  }
  return col;
}

// a wall torch: bracket, a flickering flame in flat colour bands, and a glow on the stone around it
vec3 torch(vec3 col, vec2 p, float s, float t, float seed, float facing) {
  float fh = 46.0 * s;
  if (abs(p.x) < 4.0 * s && p.y > 0.0 && p.y < 30.0 * s) col = vec3(0.08, 0.06, 0.05);
  if (abs(p.x) < 11.0 * s && p.y > 22.0 * s && p.y < 30.0 * s) col = vec3(0.16, 0.12, 0.1);
  col += vec3(1.0, 0.26, 0.05) * exp(-length(p + vec2(0.0, 24.0 * s)) / (60.0 * s)) * 0.3 * facing;
  float h = -p.y / fh;
  float wob = 0.14 * sin(t * 9.0 + seed + h * 5.0);
  float wdt = (1.0 - h) * 0.42 + 0.05;
  float px = p.x / (fh * 0.5) + wob * h;
  if (h > 0.0 && h < 1.0 && abs(px) < wdt * 1.6) {
    float inner = step(abs(px), wdt * 0.8) * step(h, 0.62);
    col = inner > 0.5 ? vec3(1.0, 0.82, 0.55) : vec3(1.0, 0.3, 0.06);
  }
  return col;
}

void main() {
  vec2 fc = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) - uShake;
  float x = (fc.x - uRes.x * 0.5) / uR;
  float ax = abs(x);
  float hgt = clamp(fc.y / uRes.y, 0.0, 1.0);
  float heat = pow(hgt, 3.0) * (0.3 + 0.7 * uDepth);
  float kf = uR / 520.0;

  // beyond the tower: a dark void, with a few distant stars, lit red by the lava below and the glowing wall beside it
  float side = max(0.0, ax - 1.0);
  vec3 sky = mix(vec3(0.015, 0.012, 0.014), vec3(0.06, 0.03, 0.025), hgt);
  sky += vec3(1.0, 0.14, 0.03) * (heat * 0.5 + exp(-side * 5.0) * 0.16 * (0.4 + 0.6 * hgt));
  vec2 sg = floor(fc / 5.0);
  sky += vec3(0.9, 0.6, 0.5) * step(0.9965, hash21(sg)) * (0.25 + 0.2 * sin(uTime + hash21(sg + 3.0) * 20.0)) * (1.0 - hgt);

  float c = sqrt(max(0.0, 1.0 - x * x));          // how squarely this part of the wall faces the camera
  float th = asin(clamp(x, -1.0, 1.0));            // angle round the tower
  float u = (th + uRot) / TAU;
  float bow = uR * 0.22 * (1.0 - c);               // we look up at the tower: every ring of stone bows up toward the sides
  float wy = fc.y + bow + uCam;                    // height in the tower's world: 0 is the roof's eave, growing downwards
  float key = 0.5 + 0.5 * cos(th - 0.55);
  float facing = 0.45 + 0.55 * c;
  float shade = 0.4 + 0.75 * pow(c, 0.85);
  float flick = 0.8 + 0.2 * sin(uTime * 2.6 + floor(wy / 40.0));

  vec3 col = sky;
  float mask = 0.0;

  if (wy >= 0.0) {
    // ---- the wall -----------------------------------------------------------------------
    vec3 brick = texture2D(uBrick, vec2(u, wy / uBrickH)).rgb;
    vec3 crack = texture2D(uCrack, vec2(u, wy / (3.14159265 * uR))).rgb;
    float lit = cel((0.22 + 0.8 * pow(c, 0.85)) * (0.62 + 0.5 * key), 4.0);
    col = brick * lit;
    float hb = cel(clamp(heat * 1.3, 0.0, 1.0), 3.0);
    col = mix(col, col * vec3(2.1, 0.42, 0.18) + vec3(0.22, 0.02, 0.0) * hb, hb);
    float sgn = x < 0.0 ? -1.0 : 1.0;

    // shadow under the roof's overhang
    col *= mix(0.42, 1.0, cel(smoothstep(0.0, 70.0 * kf, wy), 3.0));

    // small windows at every floor boundary, five round the tower, staggered from floor to floor
    float ringId = floor(wy / uFloorH + 0.5);
    float ringY = wy - ringId * uFloorH;
    if (ringId >= 1.0) {
      float uu = u * 5.0 + mod(ringId, 2.0) * 0.5;
      float cell = floor(uu);
      float rx = (fract(uu) - 0.5) * (TAU * uR / 5.0);
      float on = step(0.28, hash21(vec2(cell, ringId)));
      float fk = kf * 1.35;
      col = archWindow(col, vec2(rx, ringY), 23.0 * fk, 52.0 * fk, 9.5 * fk, 31.0 * fk, sgn, ax, shade, on, flick, facing, fk);
    }

    // the room on this floor: a different feature on every floor, turned to its own angle
    float band = floor(wy / uFloorH);
    float ry = wy - (band + 0.5) * uFloorH;
    float ang = fract(band * 0.61803398875) * TAU;
    float rx = (mod(th + uRot - ang + 3.14159265, TAU) - 3.14159265) * uR;
    float kind = mod(band, 8.0);
    vec2 q = vec2(rx, ry);
    vec3 stoneLit = vec3(0.68, 0.6, 0.5) * shade;
    vec3 stoneMid = vec3(0.5, 0.43, 0.36) * shade;
    vec3 stoneDark = vec3(0.3, 0.25, 0.21) * shade;
    if (abs(rx) < 300.0 * kf && abs(ry) < 300.0 * kf) {
      if (kind < 0.5) {
        // the great hall: one tall window between two torches
        col = archWindow(col, q, 54.0 * kf, 100.0 * kf, 13.0 * kf, 36.0 * kf, sgn, ax, shade, 1.0, flick, facing, 1.4 * kf);
        col = torch(col, q - vec2(-112.0 * kf, 30.0 * kf), kf, uTime, 1.0, facing);
        col = torch(col, q - vec2(112.0 * kf, 30.0 * kf), kf, uTime, 4.0, facing);
      } else if (kind < 1.5) {
        // a balcony with a lit doorway behind its railing
        col = archWindow(col, q - vec2(0.0, -22.0 * kf), 32.0 * kf, 66.0 * kf, 11.0 * kf, 30.0 * kf, sgn, ax, shade, 1.0, flick, facing, 1.3 * kf);
        float sx = abs(rx);
        if (sx < 96.0 * kf && ry > 42.0 * kf && ry < 50.0 * kf) col = stoneLit * 1.05;
        if (sx < 96.0 * kf && ry >= 50.0 * kf && ry < 68.0 * kf) col = ry > 66.0 * kf ? INKC : stoneMid * 0.85;
        if (sx < 106.0 * kf && ry > 68.0 * kf && ry < 100.0 * kf) col *= 0.55;
        if (sx < 90.0 * kf && ry > 14.0 * kf && ry < 42.0 * kf) {
          float post = abs(fract(rx / (15.0 * kf) + 0.5) - 0.5) * 15.0 * kf;
          if (post < 2.8 * kf) col = ry < 22.0 * kf ? stoneLit : stoneMid;
        }
        if (sx < 96.0 * kf && ry > 10.0 * kf && ry < 16.0 * kf) col = ry < 12.5 * kf ? stoneLit * 1.1 : stoneDark;
      } else if (kind < 2.5) {
        // a portcullis gate, with torches
        col = archWindow(col, q, 52.0 * kf, 92.0 * kf, 14.0 * kf, 34.0 * kf, sgn, ax, shade, 1.0, flick, facing, 1.4 * kf);
        float d = winSdf(q, 52.0 * kf, 92.0 * kf);
        if (d < -4.0 * kf) {
          float vb = abs(fract(rx / (13.0 * kf) + 0.5) - 0.5) * 13.0 * kf;
          float hb2 = abs(fract(ry / (19.0 * kf) + 0.5) - 0.5) * 19.0 * kf;
          if (vb < 2.4 * kf || hb2 < 2.0 * kf) col = vec3(0.36, 0.37, 0.4) * (0.5 + 0.7 * facing);
          if (vb < 0.8 * kf || hb2 < 0.7 * kf) col = vec3(0.6, 0.62, 0.66) * facing;
        }
        col = torch(col, q - vec2(-92.0 * kf, 30.0 * kf), kf, uTime, 2.0, facing);
        col = torch(col, q - vec2(92.0 * kf, 30.0 * kf), kf, uTime, 7.0, facing);
      } else if (kind < 3.5) {
        // the forge: a wide white-hot mouth and a chimney stack
        float hwf = 72.0 * kf, hhf = 36.0 * kf, fwf = 13.0 * kf;
        float d = max(abs(rx) - hwf, abs(ry) - hhf);
        if (abs(rx) < 15.0 * kf && ry < -hhf && ry > -230.0 * kf) {
          col = abs(abs(rx) - 15.0 * kf) < 1.6 * kf ? INKC : (rx < 0.0 ? stoneMid * 0.9 : stoneDark * 0.9);
          col *= 0.8 + 0.2 * cel(clamp((ry + 230.0 * kf) / (230.0 * kf), 0.0, 1.0), 3.0);
        }
        if (d > 0.0 && d < fwf) { bool ul = (-rx - ry) > 0.0; col = d < fwf * 0.4 ? (ul ? stoneDark : stoneLit) : (ul ? stoneLit : stoneMid); }
        else if (d >= fwf && d < fwf + 2.4 * kf) col = INKC;
        else if (d <= 0.0) {
          float g = cel(clamp(0.45 + 0.4 * sin(uTime * 3.0 + rx * 0.05) * 0.5 + 0.5 * (1.0 - length(vec2(rx / hwf, ry / hhf))), 0.0, 1.0), 4.0);
          col = mix(vec3(0.5, 0.06, 0.01), vec3(1.0, 0.86, 0.55), g) * facing;
          float bar = step(abs(fract(rx / (24.0 * kf) + 0.5) - 0.5) * 24.0 * kf, 2.4 * kf);
          if (bar > 0.5) col = INKC;
        }
        col += vec3(1.0, 0.25, 0.04) * exp(-max(d, 0.0) / (60.0 * kf)) * 0.28 * facing * step(0.0, d);
      } else if (kind < 4.5) {
        // a rose window
        float r0 = 66.0 * kf, fwr = 14.0 * kf;
        float rr = length(q);
        float rvv2 = 22.0 * kf;
        float rv2 = 22.0 * kf * (0.36 + 0.64 * ax);
        float r2 = length(q + vec2(sgn * rv2, -rvv2));
        if (rr > r0 && rr < r0 + fwr) { bool ul = (-rx - ry) > 0.0; col = rr < r0 + fwr * 0.42 ? (ul ? stoneDark : stoneLit) : (ul ? stoneLit * 1.05 : stoneMid); }
        else if (rr >= r0 + fwr && rr < r0 + fwr + 2.4 * kf) col = INKC;
        else if (rr <= r0) {
          if (rr > r0 - 2.4 * kf) col = INKC;
          else if (r2 > r0) { col = stoneMid * 0.6; if (r2 < r0 + 2.0 * kf) col = INKC; }
          else {
            float a2 = atan(q.y, q.x);
            float sector = floor((a2 + 3.14159265) / (TAU / 8.0));
            float pane = hash21(vec2(sector, floor(band)));
            float g = cel(0.5 + 0.5 * pane, 3.0) * flick;
            col = mix(vec3(0.1, 0.02, 0.02), vec3(1.0, 0.3 + 0.3 * pane, 0.05), g) * facing;
            float spoke = abs(sin(a2 * 4.0)) * rr;
            if (spoke < 3.0 * kf || abs(rr - r0 * 0.52) < 2.6 * kf || rr < r0 * 0.15) col = rr < r0 * 0.15 ? stoneMid : INKC;
          }
        }
      } else if (kind < 5.5) {
        // the library: three tall narrow windows
        col = archWindow(col, q - vec2(-66.0 * kf, 0.0), 16.0 * kf, 76.0 * kf, 8.0 * kf, 26.0 * kf, sgn, ax, shade, 1.0, flick, facing, kf * 1.1);
        col = archWindow(col, q, 16.0 * kf, 76.0 * kf, 8.0 * kf, 26.0 * kf, sgn, ax, shade, 0.9, flick, facing, kf * 1.1);
        col = archWindow(col, q - vec2(66.0 * kf, 0.0), 16.0 * kf, 76.0 * kf, 8.0 * kf, 26.0 * kf, sgn, ax, shade, 0.0, flick, facing, kf * 1.1);
      } else if (kind < 6.5) {
        // a ledge with two gargoyles
        float sx = abs(rx);
        if (sx < 150.0 * kf && ry > 20.0 * kf && ry < 38.0 * kf) col = ry < 25.0 * kf ? stoneLit : (ry > 36.0 * kf ? INKC : stoneMid * 0.85);
        if (sx < 160.0 * kf && ry > 38.0 * kf && ry < 74.0 * kf) col *= 0.55;
        for (int gi = 0; gi < 2; gi++) {
          float gx = gi == 0 ? -88.0 : 88.0;
          vec2 g = vec2(rx - gx * kf, ry) / kf;
          float body = step(abs(g.x), 14.0) * step(-40.0, g.y) * step(g.y, 22.0);
          float head = step(length(vec2(g.x - (gx < 0.0 ? 8.0 : -8.0), g.y + 54.0)), 13.0);
          float wing = step(14.0, abs(g.x)) * step(abs(g.x), 46.0) * step(-46.0 + (abs(g.x) - 14.0) * 0.9, g.y) * step(g.y, -2.0);
          if (body + head + wing > 0.5) {
            bool lit2 = (g.x * (gx < 0.0 ? -1.0 : 1.0) + g.y) < -10.0;
            col = (lit2 ? vec3(0.34, 0.3, 0.27) : vec3(0.16, 0.14, 0.13)) * shade;
          }
          if (length(vec2(g.x - (gx < 0.0 ? 11.0 : -11.0), g.y + 56.0)) < 2.6) col = vec3(1.0, 0.25, 0.05);
        }
      } else {
        // a hanging banner between two torches
        float sx = abs(rx);
        float bottom = 74.0 * kf - 30.0 * kf * (1.0 - sx / (42.0 * kf));
        if (sx < 46.0 * kf && ry > -118.0 * kf && ry < bottom + 4.0 * kf) col *= 0.6;
        if (sx < 48.0 * kf && ry > -118.0 * kf && ry < -108.0 * kf) col = ry < -114.0 * kf ? vec3(0.95, 0.72, 0.3) : vec3(0.6, 0.42, 0.14);
        if (sx < 42.0 * kf && ry >= -108.0 * kf && ry < bottom) {
          float edge = step(sx, 36.0 * kf) * step(ry, bottom - 6.0 * kf) * step(-102.0 * kf, ry);
          float fold = cel(0.5 + 0.5 * sin(rx / (11.0 * kf) + 1.0), 2.0);
          col = (edge > 0.5 ? vec3(0.62, 0.08, 0.07) * (0.75 + 0.35 * fold) : vec3(0.95, 0.72, 0.3)) * (0.5 + 0.6 * facing);
          float dia = abs(rx) / (20.0 * kf) + abs(ry + 8.0 * kf) / (32.0 * kf);
          if (dia < 1.0) col = dia > 0.82 ? vec3(0.4, 0.05, 0.05) : vec3(0.95, 0.72, 0.3) * (0.6 + 0.5 * facing);
        }
        col = torch(col, q - vec2(-96.0 * kf, 30.0 * kf), kf, uTime, 3.0, facing);
        col = torch(col, q - vec2(96.0 * kf, 30.0 * kf), kf, uTime, 9.0, facing);
      }
    }

    // light from the cracks bleeds onto the nearby brick, and pulses slowly
    float pulse = 0.78 + 0.22 * sin(uTime * 1.4 + u * 50.0);
    col += crack * pulse * (0.35 + 0.65 * pow(c, 0.5));
    mask = 1.0 - smoothstep(1.0 - 1.5 / uR, 1.0, ax);
  }

  // ---- the roof: a cone of red tiles with a wide eave, a gold finial, and a flag ---------
  float hR = -wy / uR;                             // height above the eave, in tower radii
  float coneH = 0.62;
  if (wy < 0.0 && hR <= coneH) {
    float rr = 1.1 * (1.0 - hR / coneH);
    if (ax < rr) {
      float thr = asin(clamp(x / rr, -1.0, 1.0));
      float ur = (thr + uRot) / TAU;
      float rows = 13.0, cols = 34.0;
      float rowF = hR / coneH * rows;
      float tu = ur * cols + floor(rowF) * 0.5;
      float tv = fract(rowF);
      float id = hash21(vec2(floor(tu), floor(rowF)));
      vec3 baseT = id < 0.33 ? vec3(0.58, 0.12, 0.08) : (id < 0.66 ? vec3(0.44, 0.08, 0.07) : vec3(0.66, 0.2, 0.11));
      float lr = cel((0.3 + 0.8 * pow(cos(thr), 0.9)) * (0.62 + 0.5 * (0.5 + 0.5 * cos(thr - 0.55))), 4.0);
      vec3 t = baseT * lr;
      t *= tv > 0.78 ? 1.22 : (tv < 0.16 ? 0.7 : 1.0);
      if (fract(tu) < 0.06 || tv < 0.05) t = INKC;
      col = t;
      mask = 1.0;
    }
  }
  // the eave: a dark timber fascia hanging below the roof's edge
  if (wy >= 0.0 && wy < 15.0 * kf && ax < 1.1) {
    col = wy < 11.0 * kf ? (wy < 3.0 * kf ? vec3(0.34, 0.2, 0.12) * shade : vec3(0.2, 0.12, 0.08) * (0.5 + 0.6 * c)) : INKC;
    mask = 1.0;
  }
  // the gold finial, the flagpole and a waving pennant
  if (wy < 0.0) {
    float tipH = coneH;
    if (length(vec2(x, (hR - tipH) * 1.0)) < 0.035) { col = vec3(0.95, 0.72, 0.28); mask = 1.0; }
    if (ax < 0.006 && hR > tipH * 0.95 && hR < 1.02) { col = vec3(0.16, 0.1, 0.07); mask = 1.0; }
    float xr = (x - 0.008) / 0.42;
    if (xr > 0.0 && xr < 1.0) {
      float hc = 0.9 + 0.025 * sin(uTime * 3.0 + xr * 7.0) * xr;
      float hh2 = 0.085 * (1.0 - 0.9 * xr);
      if (abs(hR - hc) < hh2) {
        float fold = cel(0.5 + 0.5 * sin(xr * 12.0 - uTime * 3.0), 2.0);
        col = abs(hR - hc) > hh2 * 0.78 ? vec3(0.95, 0.72, 0.3) : vec3(0.7, 0.08, 0.07) * (0.7 + 0.4 * fold);
        mask = 1.0;
      }
    }
  }

  gl_FragColor = vec4(mix(sky, col, mask), 1.0);
}
`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || "shader error");
  return s;
}

function texture(gl, canvas, unit) {
  const t = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  const aniso = gl.getExtension("EXT_texture_filter_anisotropic");
  if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
  return t;
}

// ---- the tower ----------------------------------------------------------------------------

let state = null;
let desired = { index: 0, count: 1 };

// Move the camera to a floor of the tower (0 is the roof). Each page of the app is a floor.
// initial: the first placement when the app opens (no animation, and it doesn't count as a click).
export function setFloor(index, count, initial = false) {
  desired = { index, count: Math.max(1, count) };
  state?.setFloor(desired.index, desired.count, initial);
}

// getScroll(): the (already eased) scroll distance in px. motionOK(): false for reduced motion / calm.
// Returns true when the WebGL tower is running.
export function startTower({ getScroll, motionOK, onLost }) {
  if (state) return true;
  const canvas = document.createElement("canvas");
  canvas.id = "lavaTower";
  canvas.setAttribute("aria-hidden", "true");
  let gl;
  try { gl = canvas.getContext("webgl", { antialias: false, alpha: false, powerPreference: "low-power" }); } catch { gl = null; }
  if (!gl) return false;
  let prog, buf, bricks, cracks;
  try {
    prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error("link failed");
    gl.useProgram(prog);
    buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    // a sharper brick texture where the GPU allows it
    if (gl.getParameter(gl.MAX_TEXTURE_SIZE) >= 8192) { BRICK_W = 8192; BRICK_H = 1024; }
    bricks = texture(gl, paintBricks(), 0);
    cracks = texture(gl, paintCracks(), 1);
    gl.uniform1i(gl.getUniformLocation(prog, "uBrick"), 0);
    gl.uniform1i(gl.getUniformLocation(prog, "uCrack"), 1);
  } catch (err) {
    console.warn("Lava tower: WebGL setup failed, using the flat wall.", err);
    return false;
  }
  const U = Object.fromEntries(["uRes", "uR", "uRot", "uDepth", "uTime", "uBrickH", "uShake", "uFloorH", "uCam"].map((n) => [n, gl.getUniformLocation(prog, n)]));
  document.body.insertBefore(canvas, document.body.firstChild);
  const debris = createDebris();
  canvas.after(debris.canvas);
  let speed = 0; // eased scroll speed in px/s: drives the shaking and the crumbling
  // camera: which floor we are on, and the eased move between floors (world px, spin in radians)
  let floorH = 600, floorIndex = desired.index, floorCount = desired.count;
  let curCam = 0, curRot = 0, prevCam = 0;
  const anim = { t: 1, fromCam: 0, toCam: 0, fromRot: 0, toRot: 0, rate: 1, spins: 0, rotFree: false };
  const spin = { free: false, vel: 0 };
  let lastClick = null;   // the floor chosen by the previous click: clicking it again unlocks the rotation   // unlocked rotation: rad/s, coasting down under friction
  const ease = (t) => (t < 0.5 ? 4 * t ** 3 : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const GOLD = 0.61803398875;
  const bandAngle = (index) => ((((index - 1) * GOLD) % 1) + 1) % 1 * TAU;  // must match the shader: fract(band * GOLD) * TAU
  function floorCam(index) {
    if (index <= 0) return -Math.min(0.82 * H, Math.max(0.5 * H, R * 1.12 + 80));   // on the roof: the eave sits mid-screen, flag above
    return (index - 1 + 0.5) * floorH - H * 0.34;                                     // this floor's room sits in the upper part of the screen
  }
  function aim(index, count, animate) {
    floorCount = count;
    const toCam = floorCam(index);
    const dir = index >= floorIndex ? 1 : -1;
    let toRot = index === 0 ? curRot : bandAngle(index);
    if (animate) {
      if (index === 0) toRot = curRot + dir * 1.0;
      else toRot += TAU * (dir > 0 ? Math.ceil((curRot + 0.9 - toRot) / TAU) : Math.floor((curRot - 0.9 - toRot) / TAU));
      Object.assign(anim, { t: 0, fromCam: curCam, toCam, fromRot: curRot, toRot, rate: 1, spins: 0, rotFree: false });
      spin.free = false; spin.vel = 0;   // choosing a floor locks the rotation again
    } else {
      curCam = toCam; curRot = toRot;
      Object.assign(anim, { t: 1, fromCam: toCam, toCam, fromRot: toRot, toRot, rotFree: false });
      spin.free = false; spin.vel = 0;
    }
    floorIndex = index;
  }

  let W = 0, H = 0, R = 1, brickH = 1, raf = 0, last = performance.now(), drift = 0, lastDraw = 0, still = 0, lastScroll = 0, running = true;

  function size() {
    W = Math.max(2, window.innerWidth); H = Math.max(2, window.innerHeight);
    canvas.width = W; canvas.height = H;     // 1 canvas pixel per CSS pixel: the wall is soft stone anyway
    gl.viewport(0, 0, W, H);
    debris.resize(W, H, Math.min(640, Math.max(320, W * 0.27)));
    // a slimmer tower, a bit over half the screen wide on a desktop, with the dark void and lava glow either side
    R = Math.min(640, Math.max(320, W * 0.27));
    brickH = BRICK_H * (TAU * R / BRICK_W);  // on-screen height of the brick texture
    floorH = Math.max(520, H * 0.95);
  }

  function draw(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const moving = motionOK();
    const s = moving ? getScroll() : 0;
    if (moving) drift += dt * 0.03;          // the tower keeps turning slowly; choosing a floor snaps it back round to that room
    if (anim.t < 1) {
      anim.t = Math.min(1, anim.t + (dt * anim.rate) / 0.95);
      const e = ease(anim.t);
      curCam = anim.fromCam + (anim.toCam - anim.fromCam) * e;
      if (!anim.rotFree) curRot = anim.fromRot + (anim.toRot - anim.fromRot) * e;
    }
    if (spin.free) {
      curRot += spin.vel * dt;
      spin.vel *= Math.exp(-dt * 0.7);          // friction: it coasts down slowly and does not settle on any window
      if (Math.abs(spin.vel) < 0.08) { spin.free = false; spin.vel = 0; }
    }
    const camSpeed = dt > 0 ? Math.abs(curCam - prevCam) / dt : 0;
    prevCam = curCam;
    const world = curCam + s * 0.5;
    const total = Math.max(1, floorCount - 1) * floorH;
    const depth = Math.max(0, Math.min(1, (world + 0.4 * H) / total));
    const fast = Math.max(dt > 0 ? Math.abs(s - lastScroll) / dt : 0, camSpeed);
    speed = speed * 0.9 + fast * 0.1;
    // the tower shakes while the page moves or the camera descends, and settles when it stops
    const amp = moving ? Math.min(1, speed / 1800) * 6 : 0;
    const tt = now / 1000;
    const sx = (Math.sin(tt * 53) + 0.6 * Math.sin(tt * 97 + 1)) * amp * 0.62;
    const sy = (Math.sin(tt * 61 + 2) + 0.6 * Math.sin(tt * 89)) * amp * 0.62;
    gl.uniform2f(U.uShake, sx, sy);
    gl.uniform2f(U.uRes, W, H);
    gl.uniform1f(U.uR, R);
    gl.uniform1f(U.uRot, (curRot + s * 0.0012 + drift) % TAU);
    gl.uniform1f(U.uDepth, depth);
    gl.uniform1f(U.uTime, (now / 1000) % 1000);
    gl.uniform1f(U.uBrickH, brickH);
    gl.uniform1f(U.uFloorH, floorH);
    gl.uniform1f(U.uCam, world);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (moving) debris.step(dt, speed); else debris.clear();
    lastDraw = now;
    still = Math.abs(s - lastScroll) > 0.5 || anim.t < 1 || spin.free ? 0 : still + dt;
    lastScroll = s;
    return moving;
  }

  // full speed while scrolling, a gentle ~20fps while it just idles round, nothing when hidden or motion is off
  function frame(now) {
    raf = 0;
    if (!running) return;
    if (still > 1.2 && now - lastDraw < 33) { raf = requestAnimationFrame(frame); return; }
    const again = draw(now);
    if (again && !document.hidden) raf = requestAnimationFrame(frame);
  }
  const kick = () => { if (!raf && running) raf = requestAnimationFrame(frame); };

  const onResize = () => { size(); aim(floorIndex, floorCount, false); kick(); };
  const onVis = () => { if (!document.hidden) { last = performance.now(); kick(); } };
  const onLost2 = (e) => { e.preventDefault(); stopTower(); onLost?.(); };
  window.addEventListener("resize", onResize);
  document.addEventListener("visibilitychange", onVis);
  canvas.addEventListener("webglcontextlost", onLost2);
  size();
  aim(desired.index, desired.count, false);
  prevCam = curCam;
  kick();

  state = {
    canvas, kick,
    setFloor(index, count, initial) {
      if (initial || !motionOK()) { aim(index, count, false); lastClick = initial ? null : index; kick(); return; }
      const again = index === lastClick;
      lastClick = index;
      if (again) {
        // the same floor as the previous click (not just the floor we happen to be on): unlock the rotation, like a free-spinning scroll wheel. Every click flicks the
        // tower faster (it stacks, up to a limit), and it coasts to a stop on its own instead of settling on a window.
        const s0 = getScroll();
        if (anim.t < 1) {
          const e = ease(anim.t);
          const camNow = curCam + s0 * 0.5;
          if (!anim.rotFree && !spin.free) {
            // carry on with the speed the eased spin had, then let go of it
            const de = anim.t < 0.5 ? 12 * anim.t * anim.t : 12 * (1 - anim.t) * (1 - anim.t);
            spin.vel = (anim.toRot - anim.fromRot) * de * anim.rate / 0.95;
          }
          anim.rotFree = true;
          anim.spins = Math.min(4, anim.spins + 1);
          anim.rate = Math.min(2, 1 + anim.spins * 0.25);                           // the camera hurries a little
          if (e > 0.96) Object.assign(anim, { t: 0, fromCam: camNow });
          else anim.fromCam = (camNow - anim.toCam * e) / (1 - e);
          curCam = camNow;
        }
        curRot += s0 * 0.0012 + drift; drift = 0;
        spin.vel = Math.max(-30, Math.min(30, (spin.free || anim.rotFree ? spin.vel : 0) + (spin.vel < 0 ? -5 : 5)));
        spin.free = true;
        kick();
        return;
      }
      // fold the scroll offset into the camera so the page reset to the top doesn't make the tower jump
      const s0 = getScroll();
      curCam += s0 * 0.5; curRot += s0 * 0.0012 + drift; drift = 0;   // and the idle turn, so the spin to the new room starts from where it is
      aim(index, count, true);
      kick();
    },
    stop() {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVis);
      canvas.removeEventListener("webglcontextlost", onLost2);
      try { gl.deleteTexture(bricks); gl.deleteTexture(cracks); gl.deleteBuffer(buf); gl.deleteProgram(prog); gl.getExtension("WEBGL_lose_context")?.loseContext(); } catch { /* already gone */ }
      debris.destroy();
      canvas.remove();
    },
  };
  return true;
}

export function stopTower() { state?.stop(); state = null; }
// call after the scroll position changed so an idle (throttled) loop wakes up and redraws
export function wakeTower() { state?.kick(); }
