// Interface preferences for this device (Settings -> Interface and Accessibility): how big each part of the hub is, the text
// size, whether to cut motion, high contrast and strong focus outlines. They live in localStorage and are applied as custom
// properties and attributes on <html>, also before first paint (js/layout-init.js does the same from the same key: keep the
// key, the ranges and the names in step). The cleaning and the numbers are plain functions, tested in tests/js/uiPrefs.test.mjs.
//
//   a size is a percentage: 100 is as designed. The bar's css reads var(--ui-<id>) as a zoom (css/ui-prefs.css).
//   the text size scales every "calc(Npx * var(--s))" in the app at once (--s is multiplied by --ui-text).

const KEY = "pkdnd-ui";
export const SIZE_RANGE = { min: 60, max: 160, step: 5 };
export const TEXT_RANGE = { min: 85, max: 150, step: 5 };
export const GLASS_RANGE = { min: 20, max: 100, step: 5 };   // how solid the bars and panels are: 100 is as designed, lower is more see-through

/** The parts of the interface whose size can be changed. `id` is also the css variable: --ui-<id>. */
export const SIZE_PARTS = [
  { id: "minimap", label: "Minimap", hint: "The round map at the top left of the hub" },
  { id: "title", label: "Title and quick buttons", hint: "The bar at the top left" },
  { id: "pages", label: "Page buttons", hint: "The round buttons and the players pill at the top right" },
  { id: "toolbar", label: "Tool bar", hint: "The drawing and board tools along the bottom, and their options" },
  { id: "character", label: "Character and team", hint: "Bottom left of the hub" },
  { id: "zoom", label: "Zoom controls", hint: "The zoom buttons at the bottom right" },
  { id: "tabs", label: "Side tabs", hint: "LOG, DICE and the other tabs on the right edge" },
  { id: "panels", label: "Pull-out panels", hint: "The compendium, bag, widgets and encounters" },
  { id: "mapeditor", label: "Map editor bars", hint: "The top bar, tool bar and zoom in the Map editor" },
];
const PART_IDS = new Set(SIZE_PARTS.map((p) => p.id));

/** A number rounded to the range's step and kept inside it; anything that isn't a number is 100. */
export function clampPct(v, range) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 100;
  return Math.max(range.min, Math.min(range.max, Math.round(n / range.step) * range.step));
}

export const GLASS_DEFAULT = 50;   // half see-through unless someone has chosen otherwise
export const DEFAULTS = { sizes: {}, text: 100, glass: GLASS_DEFAULT, dots: true, motion: "system", contrast: false, focus: false };

/** Anything that was stored (or typed) turned into safe preferences: unknown parts dropped, numbers clamped, defaults left out. */
export function cleanUi(raw) {
  const out = { sizes: {}, text: 100, glass: GLASS_DEFAULT, dots: true, motion: "system", contrast: false, focus: false };
  const sizes = raw && typeof raw.sizes === "object" && raw.sizes ? raw.sizes : {};
  for (const id of Object.keys(sizes)) {
    if (!PART_IDS.has(id)) continue;
    const v = clampPct(sizes[id], SIZE_RANGE);
    if (v !== 100) out.sizes[id] = v;
  }
  if (raw && raw.text != null) out.text = clampPct(raw.text, TEXT_RANGE);
  // (the old default of 100 was never a choice: only a value someone moved the slider to, or one saved with the flag, is kept)
  const chose = !!raw && raw.glass != null && (raw.glassSet === true || Number(raw.glass) !== 100);
  if (chose) { out.glass = clampPct(raw.glass, GLASS_RANGE); out.glassSet = true; }
  out.dots = !raw || raw.dots !== false;   // (the dots are on unless they were switched off)
  if (raw && raw.motion === "on") out.motion = "on";
  out.contrast = !!raw && raw.contrast === true;
  out.focus = !!raw && raw.focus === true;
  return out;
}

/** The css custom properties these preferences set (only the ones that differ from the design). */
export function cssVars(ui) {
  const vars = {};
  for (const [id, pct] of Object.entries(ui.sizes || {})) vars[`--ui-${id}`] = String(pct / 100);
  if (ui.text && ui.text !== 100) vars["--ui-text"] = String(ui.text / 100);
  if (ui.glass && ui.glass < 100) vars["--ui-glass"] = String(ui.glass / 100);
  return vars;
}

export function getUi() {
  try { return cleanUi(JSON.parse(localStorage.getItem(KEY) || "{}")); } catch { return cleanUi({}); }
}

/** Put preferences on the page: the properties and the three attributes the stylesheet and scripts look at. */
export function applyUi(ui = getUi(), root = document.documentElement) {
  for (const id of PART_IDS) root.style.removeProperty(`--ui-${id}`);
  root.style.removeProperty("--ui-text");
  root.style.removeProperty("--ui-glass");
  for (const [k, v] of Object.entries(cssVars(ui))) root.style.setProperty(k, v);
  const flag = (name, on, value) => (on ? root.setAttribute(name, value) : root.removeAttribute(name));
  flag("data-reduce-motion", ui.motion === "on", "on");
  flag("data-contrast", ui.contrast, "high");
  flag("data-focus", ui.focus, "strong");
  flag("data-glass", ui.glass < 100, "on");
  flag("data-hub-dots", ui.dots === false, "off");
}

/** Change some preferences, keep them on this device and apply them now. Returns the new preferences. */
export function setUi(patch) {
  const next = cleanUi({ ...getUi(), ...patch, ...(patch.glass !== undefined ? { glassSet: true } : {}), sizes: { ...getUi().sizes, ...(patch.sizes || {}) } });
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage blocked: just this visit */ }
  applyUi(next);
  window.dispatchEvent(new CustomEvent("ui-prefs-changed", { detail: next }));
  return next;
}
export const setPartSize = (id, pct) => setUi({ sizes: { [id]: clampPct(pct, SIZE_RANGE) } });
export const resetSizes = () => { const cur = getUi(); try { localStorage.setItem(KEY, JSON.stringify(cleanUi({ ...cur, sizes: {} }))); } catch { /* storage blocked */ } applyUi(getUi()); window.dispatchEvent(new CustomEvent("ui-prefs-changed", { detail: getUi() })); };

// ---- Changes held back until they are saved (Settings): text size, transparency and the rest only change what is on screen once
// they are saved, so the page doesn't move under the pointer while someone is still choosing.
let draft = null;
export const hasDraft = () => draft !== null;
export const getDraft = () => (draft ? cleanUi(draft) : getUi());
/** Hold a change: `sizes` merges part sizes, `sizesAll` replaces them all. Nothing on screen changes. */
export function stageUi(patch) {
  const base = draft ? cleanUi(draft) : getUi();
  const { sizes, sizesAll, ...rest } = patch;
  draft = cleanUi({ ...base, ...rest, ...(rest.glass !== undefined ? { glassSet: true } : {}), sizes: sizesAll || { ...base.sizes, ...(sizes || {}) } });
  window.dispatchEvent(new CustomEvent("ui-draft-changed"));
}
/** Save what was held back and apply it. */
export function commitUi() {
  if (!draft) return getUi();
  const next = cleanUi(draft);
  draft = null;
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage blocked: just this visit */ }
  applyUi(next);
  window.dispatchEvent(new CustomEvent("ui-prefs-changed", { detail: next }));
  window.dispatchEvent(new CustomEvent("ui-draft-changed"));
  return next;
}
/** Throw away what was held back. */
export function discardUi() { draft = null; window.dispatchEvent(new CustomEvent("ui-draft-changed")); }
