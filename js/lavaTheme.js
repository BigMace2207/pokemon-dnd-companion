// The Lava theme's background (css/lava.css): a blurred, slowly churning lava sea with embers rising through it, fixed
// behind every D&D page (#lavaSky). The hub draws the same sea inside its own board (js/hubKits/dnd.js uses lavaSky()).
// It's built once when the theme turns on and removed when it turns off; nothing here touches the app's own DOM, so
// pages that re-render never disturb it. The motion is CSS (css/hub.css "the lava hub"): transform/opacity only, still
// for prefers-reduced-motion, Low graphics and calm lava effects. (The old Lava Tower is archived in the second brain.)

/** The lava sea's markup: seven blurred blobs, a basalt crust, and 22 embers each with its own drift. */
export function lavaSky(cls = "hub-lava-sky") {
  const sky = document.createElement("div");
  sky.className = cls;
  sky.setAttribute("aria-hidden", "true");
  const sea = document.createElement("div");
  sea.className = "lava-sea";
  for (let i = 0; i < 7; i++) { const b = document.createElement("i"); b.className = `lava-blob b${i}`; sea.append(b); }
  const crust = document.createElement("div");
  crust.className = "lava-crust";
  const embers = document.createElement("div");
  embers.className = "lava-embers";
  for (let i = 0; i < 22; i++) {
    const e = document.createElement("i");
    e.style.cssText = `--x:${(i * 37 + 11) % 100}%;--d:${(7 + (i * 5) % 8).toFixed(1)}s;--delay:${(-((i * 1.7) % 9)).toFixed(1)}s;--s:${(0.6 + (i % 4) * 0.3).toFixed(1)};--sway:${(i % 2 ? 1 : -1) * (10 + (i * 7) % 26)}px`;
    embers.append(e);
  }
  sky.append(sea, crust, embers);
  return sky;
}

/** Adds or removes #lavaSky to match the theme (called from deviceSettings.applyTheme). */
export function syncLavaFx() {
  const on = document.documentElement.getAttribute("data-theme") === "lava";
  const existing = document.getElementById("lavaSky");
  if (on && !existing && document.body) {
    const sky = lavaSky("");
    sky.id = "lavaSky";
    document.body.prepend(sky);
  } else if (!on && existing) {
    existing.remove();
  }
}
