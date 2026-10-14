// Tiny helper so views that poll the network (setInterval) get cleaned up
// when you navigate away — app.js clears everything registered here right
// before swapping in the next view, so a background poll never keeps
// running against DOM nodes that no longer exist.

let active = [];

export function registerInterval(id) {
  active.push(id);
}

export function clearAllIntervals() {
  active.forEach(clearInterval);
  active = [];
}
