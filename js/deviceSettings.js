// Per-device settings -- localStorage-backed like js/hiddenTrainers.js, so
// these stick to this browser/app install regardless of which trainer name
// is currently in use (there's no real "login" here, just a save file per
// device), and survive across relaunches until explicitly changed again.

import { syncLavaFx } from "./lavaTheme.js";

const THEME_KEY = "pokemon-dnd-theme";
const THEME_PREV_KEY = "pokemon-dnd-theme-prev"; // what to go back to when the lava theme is switched off
const LAVA_FX_KEY = "pokemon-dnd-lava-fx";        // "full" (default) or "calm" (no particles or motion)
const HIDDEN_VIEWS_KEY = "pokemon-dnd-hidden-views";
const HIDDEN_VIEWS_CHANGED_EVENT = "pokemon-dnd-hidden-views-changed";
const CAMPAIGN_KEY = "pokemon-dnd-campaign-id";

// Everything starts visible except these -- the DM-only and
// deep-reference pages a new player at the table doesn't need front and
// center. Once a hidden page is shown (see setViewHidden), it stays shown
// on this device from then on, even after picking a different trainer
// name -- this is a one-time default, not something re-applied each visit.
const DEFAULT_HIDDEN_VIEWS = ["statcalc", "damagecalc", "tierguide", "controlcentre"];

// ---------------- Theme ----------------

export function getTheme() {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === "light" || v === "dark" || v === "lava" ? v : "system";
  } catch {
    return "system";
  }
}

// "previous" (used by the top-bar toggle) means: leave the lava theme for whatever was set before it.
export function setTheme(theme) {
  try {
    const cur = getTheme();
    if (theme === "previous") {
      theme = localStorage.getItem(THEME_PREV_KEY) || "system";
      if (theme === "lava") theme = "system";
    } else if (theme === "lava" && cur !== "lava") {
      localStorage.setItem(THEME_PREV_KEY, cur);
    }
    localStorage.setItem(THEME_KEY, theme);
  } catch { /* ignore */ }
  applyTheme();
}

export function getLavaFx() {
  try { return localStorage.getItem(LAVA_FX_KEY) === "calm" ? "calm" : "full"; } catch { return "full"; }
}
export function setLavaFx(mode) {
  try { localStorage.setItem(LAVA_FX_KEY, mode === "calm" ? "calm" : "full"); } catch { /* ignore */ }
  applyTheme();
}

// Sets the data-theme attribute style.css's dark/light variable blocks key
// off of ("lava" is styled by css/lava.css). "system" removes the attribute
// entirely, falling back to the existing prefers-color-scheme media query.
export function applyTheme() {
  const theme = getTheme();
  const root = document.documentElement;
  if (theme === "light" || theme === "dark" || theme === "lava") root.setAttribute("data-theme", theme);
  else root.removeAttribute("data-theme");
  if (getLavaFx() === "calm") root.setAttribute("data-lava-fx", "calm");
  else root.removeAttribute("data-lava-fx");
  syncLavaFx();
}

// ---------------- Sidebar page visibility ----------------

export function getHiddenViews() {
  try {
    const raw = localStorage.getItem(HIDDEN_VIEWS_KEY);
    // Never touched on this device yet -- use the defaults above. Once the
    // user changes anything, this is always an explicit (possibly empty)
    // array from then on, distinguishable from "never set" by raw !== null.
    if (raw === null) return new Set(DEFAULT_HIDDEN_VIEWS);
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed : DEFAULT_HIDDEN_VIEWS);
  } catch {
    return new Set(DEFAULT_HIDDEN_VIEWS);
  }
}


export function setViewHidden(key, hidden) {
  const set = getHiddenViews();
  if (hidden) set.add(key);
  else set.delete(key);
  try { localStorage.setItem(HIDDEN_VIEWS_KEY, JSON.stringify([...set])); } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent(HIDDEN_VIEWS_CHANGED_EVENT));
}

export function onHiddenViewsChanged(fn) {
  window.addEventListener(HIDDEN_VIEWS_CHANGED_EVENT, fn);
}

// ---------------- Selected campaign ----------------
// Which campaign this device is currently pointed at (see
// js/views/campaignSelect.js) -- device-level like theme, not part of the
// trainer save itself, since the same save's networkId is what a campaign's
// member list actually keys on regardless of which campaign is selected.

export function getSelectedCampaignId() {
  try { return localStorage.getItem(CAMPAIGN_KEY) || null; } catch { return null; }
}

export function setSelectedCampaignId(id) {
  try { localStorage.setItem(CAMPAIGN_KEY, id); } catch { /* ignore */ }
}

export function clearSelectedCampaignId() {
  try { localStorage.removeItem(CAMPAIGN_KEY); } catch { /* ignore */ }
}
