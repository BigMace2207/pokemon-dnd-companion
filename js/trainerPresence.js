// Watches the Trainers Online list in the background (regardless of which
// page is open) and pops a small toast whenever someone comes online, so
// you don't have to keep the Trainers Online page open to notice.
// Deliberately silent on the way out — a trainer "going offline" is often
// just a phone locking or a flaky connection, not a meaningful event worth
// interrupting anyone for. Trainers you've removed from your own list (see
// js/hiddenTrainers.js) are skipped — if you don't want to see them there,
// you probably don't want to be notified about them either.

import { el } from "./components.js";
import { listTrainers } from "./network.js";
import { getHiddenTrainerIds } from "./hiddenTrainers.js";

const POLL_MS = 6000;

let stackEl = null;
function ensureStack() {
  if (!stackEl) {
    stackEl = el("div", { class: "presence-toast-stack" });
    document.body.appendChild(stackEl);
  }
  return stackEl;
}

function showToast(text, kind) {
  const stack = ensureStack();
  const toast = el("div", { class: "presence-toast " + kind }, text);
  stack.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("show"));
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 400);
  }, 3500);
}

export function startTrainerPresenceWatcher(networkId) {
  let known = null; // null until the first successful poll, so we never toast for everyone already online at page load

  async function tick() {
    const others = await listTrainers(networkId);
    if (others === null) return; // server unreachable this round — try again next tick
    const hidden = getHiddenTrainerIds();
    const now = new Map(others.map((t) => [t.id, t.name]));

    if (known) {
      for (const [id, name] of now) {
        if (!known.has(id) && !hidden.has(id)) showToast(`${name} came online`, "online");
      }
    }
    known = now;
  }

  tick();
  setInterval(tick, POLL_MS);
}
