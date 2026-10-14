// Personal ("out of battle") log — pure localStorage, never sent to the
// server, so it's private to this device/browser by construction. Fed by
// local actions (My Team edits) and by DM directives once they're applied
// (see js/directives.js) — either way it only ever lives here.

const KEY = "pokemon-dnd-personal-log-v1";

export function getLog() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function addLogEntry(text) {
  try {
    const log = getLog();
    log.push({ id: `${Date.now()}-${Math.random()}`, text, ts: Date.now() });
    localStorage.setItem(KEY, JSON.stringify(log.slice(-300)));
  } catch {
    // private browsing / storage blocked — just skip logging rather than crash
  }
}

export function clearLog() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
