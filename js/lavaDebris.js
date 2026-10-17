// Crumbling masonry for the Lava Tower: bits of brick break off all over the tower face (not just at
// its edge), tumble down and drop into the lava, with puffs of dust and a few glowing embers from the
// cracks. A trickle when idle; scrolling shakes far more loose. Drawn on its own transparent 2D canvas
// above the tower and below the page content, so it never touches the app's DOM.

const TAU = Math.PI * 2;

export function createDebris() {
  const canvas = document.createElement("canvas");
  canvas.id = "lavaDebris";
  canvas.setAttribute("aria-hidden", "true");
  const ctx = canvas.getContext("2d");
  let W = 0, H = 0, R = 0, acc = 0;
  const parts = [];

  // one soft dust sprite, scaled and faded per puff
  const dust = document.createElement("canvas");
  dust.width = dust.height = 64;
  {
    const g = dust.getContext("2d");
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, "rgba(205,188,170,.6)");
    grad.addColorStop(0.55, "rgba(160,140,125,.25)");
    grad.addColorStop(1, "rgba(120,100,90,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
  }

  function resize(w, h, r) { W = w; H = h; R = r; canvas.width = w; canvas.height = h; }

  function addDust(x, y, size, life) {
    parts.push({ k: "dust", x, y, vx: (Math.random() - 0.5) * 14, vy: -8 - Math.random() * 14, size, life: 0, max: life });
  }

  // a piece breaks away from the wall somewhere on the visible face of the tower
  function spawn(power) {
    const lx = (Math.random() * 2 - 1) * 0.94;               // position across the tower, -1 (left edge) .. 1 (right edge)
    const face = Math.sqrt(1 - lx * lx);                      // how squarely that part faces us: pieces are foreshortened near the edges
    const x = W / 2 + lx * R;
    const y = 30 + Math.random() * (H - 140);
    const size = (3 + Math.random() * 8) * (0.7 + power * 0.9) * (0.45 + 0.55 * face);
    const g = 70 + Math.random() * 62 | 0;
    parts.push({
      k: "chunk", x, y, vx: (Math.random() - 0.5) * 36 * (1 + power * 1.5), vy: -10 + Math.random() * 30,
      rot: Math.random() * TAU, vr: (Math.random() - 0.5) * 9, size, face, color: `rgb(${g + 14},${g + 6},${g - 8})`,
    });
    if (Math.random() < 0.55) addDust(x, y, 16 + Math.random() * 26 * (0.6 + power), 1.1 + Math.random() * 1.1);
    if (Math.random() < 0.18 + power * 0.25) {
      parts.push({ k: "ember", x, y, vx: (Math.random() - 0.5) * 50, vy: -10 + Math.random() * 20, size: 1.5 + Math.random() * 2.2, life: 0, max: 0.9 + Math.random() * 0.9 });
    }
  }

  function clear() { ctx.clearRect(0, 0, W, H); parts.length = 0; }

  // speed: scroll speed in px/s. More scrolling shakes far more loose.
  function step(dt, speed) {
    const power = Math.min(1, speed / 2200);
    acc += (3 + Math.min(95, speed * 0.085)) * dt;
    while (acc >= 1) { acc -= 1; if (parts.length < 320) spawn(power); }
    ctx.clearRect(0, 0, W, H);
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      if (p.k === "chunk") {
        p.vy += 1150 * dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
        if (p.y > H - 14) {               // lands in the lava: a splash of embers
          for (let n = 0; n < 2; n++) parts.push({ k: "ember", x: p.x, y: H - 14, vx: (Math.random() - 0.5) * 120, vy: -110 - Math.random() * 120, size: 1.6 + Math.random() * 2, life: 0, max: 0.7 });
          parts.splice(i, 1);
          continue;
        }
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.scale(p.face, 1);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size * 0.35, p.size, p.size * 0.7);
        ctx.fillStyle = "rgba(255,255,255,.12)";
        ctx.fillRect(-p.size / 2, -p.size * 0.35, p.size, p.size * 0.18);
        ctx.fillStyle = "rgba(0,0,0,.3)";
        ctx.fillRect(-p.size / 2, p.size * 0.17, p.size, p.size * 0.18);
        ctx.restore();
      } else if (p.k === "dust") {
        p.life += dt;
        if (p.life >= p.max) { parts.splice(i, 1); continue; }
        p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 4 * dt;
        const t = p.life / p.max;
        const s = p.size * (0.6 + t * 1.6);
        ctx.globalAlpha = (1 - t) * 0.85;
        ctx.drawImage(dust, p.x - s / 2, p.y - s / 2, s, s);
        ctx.globalAlpha = 1;
      } else {
        p.life += dt;
        if (p.life >= p.max) { parts.splice(i, 1); continue; }
        p.vy += 260 * dt;
        p.x += p.vx * dt; p.y += p.vy * dt;
        const t = p.life / p.max;
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = 1 - t;
        ctx.fillStyle = t < 0.4 ? "#ffb08a" : "#ff3a14";
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (1 - t * 0.5), 0, TAU); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
      }
    }
  }

  return { canvas, resize, step, clear, destroy() { clear(); canvas.remove(); } };
}
