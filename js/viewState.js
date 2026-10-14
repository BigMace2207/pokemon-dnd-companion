// A tiny in-memory, per-session store for the ephemeral UI state a view
// would otherwise lose every time it's rebuilt (container.innerHTML = ""
// happens on every navigation) — which tab is active, what's typed into a
// search box, which accordion is open, and so on. This is deliberately
// separate from the trainer's actual saved data (js/storage.js), which
// already survives navigation on its own since it's read from localStorage
// fresh each render; this module is only for the view-local bits that
// aren't "data" at all, just where you left off looking.
//
// Module-scoped, so it survives view switches (the whole point) but resets
// on an actual page reload — that's fine, "keep state when you leave and
// come back" doesn't imply surviving a hard refresh.

const store = new Map();

export function getViewState(key, fallback) {
  return store.has(key) ? store.get(key) : fallback;
}

export function setViewState(key, value) {
  store.set(key, value);
}
