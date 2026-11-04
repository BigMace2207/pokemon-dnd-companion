// The graphics setting (Settings -> Appearance -> Graphics): how much of the cosmic sky moves.
//   high:   everything: stars twinkle and rise at full frame rate, the nebula drifts, glass panels blur what's behind.
//   medium: the default. Stars at 30 frames a second, a still nebula with a few shards, solid glass (blurring a moving
//           sky every frame is the single most expensive effect on a phone or a laptop's graphics chip).
//   low:    a still sky that only moves when you pan or zoom, no nebula drift or shards, no extra effects.
// It's a per-device choice (localStorage), set on <html data-gfx> before the first paint (js/layout-init.js) so CSS can
// switch effects off, and announced with a "gfx-changed" event so the canvases can change pace.

const KEY = "pkdnd-gfx";
export const GFX_LEVELS = ["low", "medium", "high"];

export function getGfx() {
  try { const v = localStorage.getItem(KEY); if (GFX_LEVELS.includes(v)) return v; } catch { /* storage blocked */ }
  return "medium";
}

export function setGfx(level) {
  if (!GFX_LEVELS.includes(level)) return;
  try { localStorage.setItem(KEY, level); } catch { /* storage blocked: just this visit */ }
  document.documentElement.dataset.gfx = level;
  window.dispatchEvent(new CustomEvent("gfx-changed", { detail: level }));
}
