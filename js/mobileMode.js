// The phone layout switch (see js/layout-init.js, which sets it before first paint). `html.m` turns on css/mobile.css
// and the hub's radial wheel. "auto" follows the device: a coarse pointer on a viewport up to 820px wide. It updates
// live when that changes (rotating an iPad, resizing a window), and fires "layout-changed".

const KEY = "pkdnd-layout";
const QUERY = "(pointer: coarse) and (max-width: 820px)";

export function getLayoutPref() {
  try { return localStorage.getItem(KEY) || "auto"; } catch { return "auto"; }
}
export function setLayoutPref(pref) {
  try { if (pref === "auto") localStorage.removeItem(KEY); else localStorage.setItem(KEY, pref); } catch { /* storage blocked */ }
  applyLayout();
}
export const isPhoneLayout = () => document.documentElement.classList.contains("m");

export function applyLayout() {
  const pref = getLayoutPref();
  const phone = pref === "phone" || (pref !== "desktop" && matchMedia(QUERY).matches);
  const was = isPhoneLayout();
  document.documentElement.classList.toggle("m", phone);
  if (was !== phone) window.dispatchEvent(new CustomEvent("layout-changed", { detail: { phone } }));
}

let watching = false;
export function watchLayout() {
  if (watching) return;
  watching = true;
  matchMedia(QUERY).addEventListener?.("change", applyLayout);
  applyLayout();
}
