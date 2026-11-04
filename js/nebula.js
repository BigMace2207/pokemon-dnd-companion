// The cosmic theme's nebula, in the spirit of a starry arena under a violet sky: slow clouds of purple and blue smoke,
// a couple of soft light flares that breathe, and small pale shards drifting through the dark. It sits behind the stars
// (the cosmic sky on every page, js/cosmicParallax.js, and the hub's starfield, js/views/hub.js).
//
// Performance: everything is CSS. The clouds and flares are radial gradients painted once and then only moved with
// transform/opacity animations, so the GPU does the work; nothing here listens to the mouse or re-renders. Phones get
// fewer shards (css/cosmic.css), and prefers-reduced-motion stills it all.

const SHARDS = 26;

// a fixed pseudo-random sequence, so the sky looks the same on every visit (and on every device)
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

export function nebulaLayer(extraClass = "") {
  const root = document.createElement("div");
  root.className = `nebula ${extraClass}`.trim();
  root.setAttribute("aria-hidden", "true");
  for (const n of [1, 2, 3, 4]) {
    const c = document.createElement("div");
    c.className = `neb-cloud c${n}`;
    root.append(c);
  }
  for (const n of [1, 2]) {
    const f = document.createElement("div");
    f.className = `neb-flare f${n}`;
    root.append(f);
  }
  const r = rng(7);
  for (let i = 0; i < SHARDS; i++) {
    const s = document.createElement("i");
    s.className = "neb-shard";
    s.style.cssText = `--x:${(r() * 100).toFixed(1)}%;--y:${(30 + r() * 75).toFixed(1)}%;--z:${(2 + r() * 4).toFixed(1)}px;`
      + `--t:${(18 + r() * 22).toFixed(1)}s;--dl:${(-r() * 40).toFixed(1)}s;--rot:${Math.round(r() * 90)}deg;--dx:${Math.round(r() * 60 - 30)}px`;
    root.append(s);
  }
  return root;
}
